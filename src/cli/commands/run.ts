import { Command } from 'commander';
import { resolveScenarioNames, getScenario } from '../../scenarios/registry.js';
import { resolveConditionNames, getCondition } from '../../conditions/registry.js';
import { RunOrchestrator, type ProgressUpdate } from '../../runner/orchestrator.js';
import { DEFAULT_CONFIG, type BenchmarkConfig } from '../../types/config.js';
import { ProgressDisplay, formatDuration, formatDollars } from '../utils/progress.js';
import { configureLogger } from '../utils/logger.js';
import { SyntheticRepoTarget } from '../../targets/synthetic-repo/index.js';
import { ResultsStore } from '../../results/store.js';
import type { CostEstimate } from '../../types/analysis.js';
import type { ScenarioName } from '../../types/scenario.js';

/**
 * Sonnet 4 pricing (from PRD resolved question #2).
 */
const SONNET_4_INPUT_RATE = 3.0;   // $/MTok
const SONNET_4_OUTPUT_RATE = 15.0;  // $/MTok

/**
 * Rough token estimates per agent session (conservative).
 */
const ESTIMATED_INPUT_TOKENS_PER_SESSION = 150_000;
const ESTIMATED_OUTPUT_TOKENS_PER_SESSION = 30_000;

/**
 * Estimate cost for a dry run.
 * Uses per-session token estimates × session count per scenario × conditions × runs.
 */
function estimateCost(
  scenarioNames: ScenarioName[],
  conditionCount: number,
  runs: number,
): CostEstimate {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const perScenario: Record<string, number> = {};

  for (const name of scenarioNames) {
    const entry = getScenario(name);
    const sessions = entry.metadata.agentSessionCount * conditionCount * runs;
    const inputTokens = sessions * ESTIMATED_INPUT_TOKENS_PER_SESSION;
    const outputTokens = sessions * ESTIMATED_OUTPUT_TOKENS_PER_SESSION;
    const cost =
      (inputTokens / 1_000_000) * SONNET_4_INPUT_RATE +
      (outputTokens / 1_000_000) * SONNET_4_OUTPUT_RATE;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    perScenario[name] = cost;
  }

  const totalCost =
    (totalInputTokens / 1_000_000) * SONNET_4_INPUT_RATE +
    (totalOutputTokens / 1_000_000) * SONNET_4_OUTPUT_RATE;

  return {
    projectedInputTokens: totalInputTokens,
    projectedOutputTokens: totalOutputTokens,
    projectedCostDollars: totalCost,
    perScenario,
    exceedsBudget: false, // Caller sets this based on budget
  };
}

/**
 * Print a cost estimate table to stdout.
 */
function printCostEstimate(estimate: CostEstimate, budget: number): void {
  console.log('\n  Cost Estimate (Sonnet 4 rates: $3/MTok input, $15/MTok output)');
  console.log('  ' + '─'.repeat(60));
  console.log(`  Projected input tokens:  ${(estimate.projectedInputTokens / 1_000_000).toFixed(2)}M`);
  console.log(`  Projected output tokens: ${(estimate.projectedOutputTokens / 1_000_000).toFixed(2)}M`);
  console.log('');

  const scenarioNames = Object.keys(estimate.perScenario);
  if (scenarioNames.length > 1) {
    console.log('  Per scenario:');
    for (const [name, cost] of Object.entries(estimate.perScenario)) {
      console.log(`    ${name.padEnd(25)} ${formatDollars(cost)}`);
    }
    console.log('');
  }

  console.log(`  Total estimated cost:    ${formatDollars(estimate.projectedCostDollars)}`);
  console.log(`  Budget limit:            ${formatDollars(budget)}`);

  if (estimate.exceedsBudget) {
    console.log(`\n  \x1b[31mWARNING: Projected cost exceeds budget!\x1b[0m`);
    console.log(`  Use --budget to increase the limit, or reduce scenarios/conditions/runs.`);
  } else {
    console.log(`  \x1b[32mWithin budget.\x1b[0m`);
  }
  console.log('');
}

/**
 * Create the `run` command.
 */
export function createRunCommand(): Command {
  return new Command('run')
    .description('Execute benchmark runs')
    .requiredOption(
      '--scenario <name>',
      'Scenario to run (name or "all")',
    )
    .option(
      '--condition <name>',
      'Condition to test (name or "all")',
      'all',
    )
    .option(
      '--target <path>',
      'Path to target configuration',
      DEFAULT_CONFIG.targetPath,
    )
    .option(
      '--runs <number>',
      'Number of runs per scenario/condition pair',
      String(DEFAULT_CONFIG.defaultRuns),
    )
    .option('--seed <seed>', 'Random seed for reproducibility')
    .option(
      '--budget <dollars>',
      'Maximum dollar budget for the suite',
      String(DEFAULT_CONFIG.budgetDollars),
    )
    .option('--dry-run', 'Validate config and estimate cost without executing')
    .option('--verbose', 'Enable verbose logging')
    .action(async (opts: {
      scenario: string;
      condition: string;
      target: string;
      runs: string;
      seed?: string;
      budget: string;
      dryRun?: boolean;
      verbose?: boolean;
    }) => {
      const logger = configureLogger({
        verbose: opts.verbose,
        level: opts.verbose ? 'debug' : 'info',
      });

      try {
        // Resolve scenario and condition names
        const scenarioNames = resolveScenarioNames(opts.scenario);
        const conditionNames = resolveConditionNames(opts.condition);
        const runs = parseInt(opts.runs, 10);
        const budget = parseFloat(opts.budget);

        if (isNaN(runs) || runs < 1) {
          throw new Error('--runs must be a positive integer');
        }
        if (isNaN(budget) || budget <= 0) {
          throw new Error('--budget must be a positive number');
        }

        logger.info('Resolved configuration', {
          scenarios: scenarioNames,
          conditions: conditionNames,
          runs,
          budget,
          dryRun: opts.dryRun ?? false,
        });

        // Cost estimation
        const estimate = estimateCost(scenarioNames, conditionNames.length, runs);
        estimate.exceedsBudget = estimate.projectedCostDollars > budget;

        if (opts.dryRun) {
          console.log('\n  DRY RUN — No agent sessions will be executed.\n');
          console.log(`  Scenarios:  ${scenarioNames.join(', ')}`);
          console.log(`  Conditions: ${conditionNames.join(', ')}`);
          console.log(`  Runs:       ${runs} per pair`);

          const totalSessions = scenarioNames.reduce((sum, name) => {
            const entry = getScenario(name);
            return sum + entry.metadata.agentSessionCount * conditionNames.length * runs;
          }, 0);
          console.log(`  Total agent sessions: ${totalSessions}`);

          if (opts.seed) {
            console.log(`  Seed:       ${opts.seed}`);
          }

          printCostEstimate(estimate, budget);

          if (estimate.exceedsBudget) {
            process.exitCode = 1;
          }
          return;
        }

        // Abort if projected cost exceeds budget
        if (estimate.exceedsBudget) {
          logger.error(
            `Projected cost ${formatDollars(estimate.projectedCostDollars)} exceeds budget ${formatDollars(budget)}. Use --budget to increase or --dry-run to see breakdown.`,
          );
          process.exitCode = 1;
          return;
        }

        // Build config
        const config: BenchmarkConfig = {
          ...DEFAULT_CONFIG,
          targetPath: opts.target,
          defaultRuns: runs,
          budgetDollars: budget,
        };

        // Create scenario and condition instances
        const scenarios = scenarioNames.map(name => getScenario(name).create());
        const conditions = conditionNames.map(name => getCondition(name).create());

        // Calculate total iterations for progress
        const totalIterations = scenarioNames.length * conditionNames.length * runs;
        const progress = new ProgressDisplay(totalIterations);
        let completedIterations = 0;

        // Create target and results store
        const target = new SyntheticRepoTarget();
        const resultsStore = new ResultsStore(config.outputDirectory);

        // Create orchestrator
        const orchestrator = new RunOrchestrator({
          config,
          scenarios,
          conditions,
          target,
          resultsStore,
          runsPerPair: runs,
          seed: opts.seed,
          onProgress: (update: ProgressUpdate) => {
            if (update.type === 'iteration-complete') {
              completedIterations++;
              progress.tick(update.message);
            } else if (update.type === 'run-start') {
              logger.info(update.message);
            } else if (update.type === 'session-start') {
              logger.debug(update.message);
            } else if (update.type === 'run-complete') {
              logger.info(update.message);
            }
          },
        });

        // Execute
        const result = await orchestrator.run();

        progress.finish(`Benchmark complete: ${result.runMetadata.status}`);

        // Summary
        console.log(`\n  Run ID:     ${result.runMetadata.id}`);
        console.log(`  Status:     ${result.runMetadata.status}`);
        console.log(`  Duration:   ${formatDuration(result.runMetadata.duration)}`);
        console.log(`  Iterations: ${result.iterations.length}`);

        const scoredCount = result.iterations.filter(it => it.scoredResults).length;
        if (scoredCount > 0) {
          console.log(`  Scored:     ${scoredCount}/${result.iterations.length} iterations`);
          console.log(`  Results:    ${config.outputDirectory}/${result.runMetadata.id}/`);
        }

        const totalErrors = result.iterations.reduce(
          (sum, it) => sum + it.errors.length, 0,
        );
        if (totalErrors > 0) {
          console.log(`  Errors:     ${totalErrors}`);
        }
        console.log('');

        if (result.runMetadata.status === 'failed') {
          process.exitCode = 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(message);
        process.exitCode = 1;
      }
    });
}
