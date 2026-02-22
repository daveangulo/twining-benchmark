#!/usr/bin/env tsx
/**
 * Phase 0: Concept Validation Runner
 *
 * Standalone script that runs the refactor-handoff scenario against
 * a subset of conditions (baseline, claude-md-only, full-twining)
 * to validate whether the benchmark methodology produces meaningful,
 * differentiable results.
 *
 * PRD Section 10 — Phase 0.
 *
 * Usage:
 *   npx tsx src/phase0/phase0-runner.ts --scenario refactor --condition baseline --runs 3
 *   npx tsx src/phase0/phase0-runner.ts --scenario refactor --condition all --runs 3
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { v4 as uuidv4 } from 'uuid';

import { SyntheticRepoTarget } from '../targets/synthetic-repo/index.js';
import { CONDITION_REGISTRY } from '../conditions/registry.js';
import { AgentSessionManager } from '../runner/agent-session.js';
import { DataCollector, type CollectedSessionData } from '../runner/data-collector.js';
import {
  classifyFailure,
  isSessionFailed,
  withRetry,
} from '../runner/error-handler.js';
import { RefactoringHandoffScenario } from '../scenarios/refactoring-handoff.js';
import type {
  ConditionName,
  AgentTranscript,
  ScoredResults,
} from '../types/index.js';
import { Logger } from '../cli/utils/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Phase 0 conditions — max-contrast comparison */
const PHASE0_CONDITIONS: ConditionName[] = [
  'baseline',
  'claude-md-only',
  'full-twining',
];

/** Default output directory for Phase 0 results */
const PHASE0_OUTPUT_DIR = resolve('benchmark-results/phase0');

/** Agent timeout: 15 minutes */
const AGENT_TIMEOUT_MS = 15 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Phase0RunResult {
  runId: string;
  scenario: string;
  condition: ConditionName;
  iteration: number;
  timestamp: string;
  sessions: Phase0SessionResult[];
  scoredResults: ScoredResults;
  wallTimeMs: number;
  errors: string[];
}

interface Phase0SessionResult {
  sessionId: string;
  taskIndex: number;
  prompt: string;
  exitReason: string;
  tokenUsage: { input: number; output: number; total: number };
  timing: { durationMs: number; timeToFirstActionMs: number };
  toolCallCount: number;
  fileChanges: Array<{ path: string; changeType: string; linesAdded: number; linesRemoved: number }>;
  error?: string;
}

interface Phase0Config {
  scenario: string;
  conditions: ConditionName[];
  runs: number;
  outputDir: string;
  verbose: boolean;
}

// ─── CLI Parsing ──────────────────────────────────────────────────────────────

function parseCliArgs(): Phase0Config {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', default: 'refactor' },
      condition: { type: 'string', default: 'all' },
      runs: { type: 'string', default: '3' },
      output: { type: 'string', default: PHASE0_OUTPUT_DIR },
      verbose: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const conditions = resolveConditions(values.condition ?? 'all');
  const runs = parseInt(values.runs ?? '3', 10);

  if (isNaN(runs) || runs < 1) {
    console.error('Error: --runs must be a positive integer');
    process.exit(1);
  }

  return {
    scenario: values.scenario ?? 'refactor',
    conditions,
    runs,
    outputDir: values.output ?? PHASE0_OUTPUT_DIR,
    verbose: values.verbose ?? false,
  };
}

function resolveConditions(input: string): ConditionName[] {
  if (input === 'all') return [...PHASE0_CONDITIONS];
  const names = input.split(',').map(s => s.trim()) as ConditionName[];
  for (const name of names) {
    if (!PHASE0_CONDITIONS.includes(name)) {
      console.error(
        `Error: Unknown Phase 0 condition "${name}". ` +
        `Available: ${PHASE0_CONDITIONS.join(', ')}`,
      );
      process.exit(1);
    }
  }
  return names;
}

// ─── Summary Extraction ───────────────────────────────────────────────────────

function summarizeSession(transcript: AgentTranscript): Phase0SessionResult {
  return {
    sessionId: transcript.sessionId,
    taskIndex: transcript.taskIndex,
    prompt: transcript.prompt.slice(0, 200) + '...',
    exitReason: transcript.exitReason,
    tokenUsage: transcript.tokenUsage,
    timing: {
      durationMs: transcript.timing.durationMs,
      timeToFirstActionMs: transcript.timing.timeToFirstActionMs,
    },
    toolCallCount: transcript.toolCalls.length,
    fileChanges: transcript.fileChanges.map(fc => ({
      path: fc.path,
      changeType: fc.changeType,
      linesAdded: fc.linesAdded,
      linesRemoved: fc.linesRemoved,
    })),
    error: transcript.error,
  };
}

// ─── Core Execution ───────────────────────────────────────────────────────────

async function runSingleIteration(
  conditionName: ConditionName,
  iteration: number,
  config: Phase0Config,
  log: Logger,
): Promise<Phase0RunResult> {
  const runId = uuidv4();
  const startTime = Date.now();
  const errors: string[] = [];
  const sessions: Phase0SessionResult[] = [];
  const collectedSessions: CollectedSessionData[] = [];

  log.info(`Starting iteration ${iteration + 1}/${config.runs}`, {
    condition: conditionName,
    runId,
  });

  // 1. Set up the synthetic repo target
  const target = new SyntheticRepoTarget();
  const workingDir = await target.setup();

  log.info('Target repo set up', { path: workingDir.path });

  try {
    // 2. Set up the condition
    const conditionEntry = CONDITION_REGISTRY[conditionName];
    const condition = conditionEntry.create();
    const conditionCtx = await condition.setup(workingDir.path);

    log.info('Condition set up', { condition: conditionName });

    try {
      // 3. Set up the scenario
      const scenario = new RefactoringHandoffScenario();
      await scenario.setup(workingDir, conditionCtx);
      const tasks = scenario.getAgentTasks();

      log.info('Scenario set up', { tasks: tasks.length });

      // 4. Create data collector
      const collector = new DataCollector({
        outputDir: config.outputDir,
        runId,
      });

      // 5. Create session manager
      const sessionManager = new AgentSessionManager({
        runId,
        scenario: 'refactoring-handoff',
        condition: conditionName,
        workingDir: workingDir.path,
        agentConfig: conditionCtx.agentConfig,
        timeoutMs: AGENT_TIMEOUT_MS,
      });

      // 6. Execute tasks sequentially
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;
        log.info(`Executing task ${i + 1}/${tasks.length}`, {
          role: task.role ?? `agent-${i}`,
          condition: conditionName,
        });

        const beforeHash = await collector.capturePreSessionGitState(workingDir.path);

        const retryResult = await withRetry(
          () => sessionManager.executeTask(task),
          (transcript) => {
            if (isSessionFailed(transcript)) {
              return classifyFailure(transcript);
            }
            return null;
          },
          { maxRetries: 1, baseDelayMs: 5000, exponentialBackoff: true },
        );

        if (retryResult.result) {
          const collected = await collector.enrichAndSave(
            retryResult.result,
            workingDir.path,
            beforeHash,
            condition,
          );
          collectedSessions.push(collected);
          sessions.push(summarizeSession(retryResult.result));

          // Commit checkpoint between sessions so the next session's
          // diff is isolated from this one's changes
          if (i < tasks.length - 1) {
            await collector.commitSessionSnapshot(
              workingDir.path,
              retryResult.result.sessionId,
            );
          }

          log.info(`Task ${i + 1} completed`, {
            exit: retryResult.result.exitReason,
            tokens: retryResult.result.tokenUsage.total,
            duration: `${Math.round(retryResult.result.timing.durationMs / 1000)}s`,
            fileChanges: retryResult.result.fileChanges.length,
          });

          if (!retryResult.success) {
            for (const failure of retryResult.failures) {
              errors.push(`Task ${i}: ${failure.description}`);
            }
          }
        } else {
          for (const failure of retryResult.failures) {
            errors.push(`Task ${i}: ${failure.description}`);
            log.error(`Task ${i + 1} failed`, { error: failure.description });
          }
        }
      }

      // 7. Score the results
      const transcripts = collectedSessions.map(s => s.transcript);
      const rawResults = {
        transcripts,
        finalWorkingDir: workingDir.path,
        allSessionsCompleted: transcripts.every(t => t.exitReason === 'completed'),
        errors,
      };

      const groundTruth = target.getGroundTruth();
      const scoredResults = await scenario.score(rawResults, groundTruth);
      scoredResults.runId = runId;
      scoredResults.condition = conditionName;
      scoredResults.iteration = iteration;

      // 8. Run tests on the final state
      const testResults = await runTests(workingDir.path, log);
      scoredResults.metrics.testsPass = testResults.pass;
      scoredResults.metrics.testsFail = testResults.fail;
      scoredResults.metrics.compiles = testResults.compiles;

      await scenario.teardown();

      const wallTimeMs = Date.now() - startTime;

      log.info(`Iteration ${iteration + 1} complete`, {
        composite: scoredResults.composite.toFixed(1),
        tokens: scoredResults.metrics.totalTokens,
        wallTime: `${Math.round(wallTimeMs / 1000)}s`,
        errors: errors.length,
      });

      return {
        runId,
        scenario: 'refactoring-handoff',
        condition: conditionName,
        iteration,
        timestamp: new Date().toISOString(),
        sessions,
        scoredResults,
        wallTimeMs,
        errors,
      };
    } finally {
      await condition.teardown();
    }
  } finally {
    await workingDir.cleanup();
  }
}

/**
 * Run the target's test suite and return pass/fail counts.
 */
async function runTests(
  workingDir: string,
  log: Logger,
): Promise<{ pass: number; fail: number; compiles: boolean }> {
  try {
    const { execa } = await import('execa');

    // Check compilation
    let compiles = true;
    try {
      await execa('npx', ['tsc', '--noEmit'], { cwd: workingDir, stdio: 'pipe' });
    } catch {
      compiles = false;
      log.warn('TypeScript compilation failed');
    }

    // Run tests
    try {
      const result = await execa('npx', ['vitest', 'run', '--reporter=json'], {
        cwd: workingDir,
        stdio: 'pipe',
      });

      // Parse JSON output to get pass/fail counts
      try {
        const jsonOutput = JSON.parse(result.stdout) as {
          numPassedTests?: number;
          numFailedTests?: number;
        };
        return {
          pass: jsonOutput.numPassedTests ?? 0,
          fail: jsonOutput.numFailedTests ?? 0,
          compiles,
        };
      } catch {
        // JSON parse failed — count from exit code
        return { pass: 1, fail: 0, compiles };
      }
    } catch {
      log.warn('Test suite failed');
      return { pass: 0, fail: 1, compiles };
    }
  } catch {
    return { pass: 0, fail: 0, compiles: false };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseCliArgs();
  const log = new Logger({ level: config.verbose ? 'debug' : 'info' });

  console.log('');
  console.log('=== Phase 0: Concept Validation Runner ===');
  console.log('');
  console.log(`  Scenario:    ${config.scenario}`);
  console.log(`  Conditions:  ${config.conditions.join(', ')}`);
  console.log(`  Runs/pair:   ${config.runs}`);
  console.log(`  Output:      ${config.outputDir}`);
  console.log(`  Total runs:  ${config.conditions.length * config.runs}`);
  console.log('');

  if (config.scenario !== 'refactor') {
    console.error('Error: Phase 0 only supports the "refactor" scenario');
    process.exit(1);
  }

  // Ensure output directory exists
  await mkdir(config.outputDir, { recursive: true });

  const allResults: Phase0RunResult[] = [];
  const suiteStartTime = Date.now();

  for (const conditionName of config.conditions) {
    console.log(`\n--- Condition: ${conditionName} ---\n`);

    for (let i = 0; i < config.runs; i++) {
      try {
        const result = await runSingleIteration(conditionName, i, config, log);
        allResults.push(result);

        // Save incrementally after each run
        await saveResults(config.outputDir, allResults);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Run ${i + 1} failed for ${conditionName}: ${msg}`);

        // Save what we have so far
        await saveResults(config.outputDir, allResults);
      }
    }
  }

  const totalWallTime = Date.now() - suiteStartTime;

  // Save final results
  await saveResults(config.outputDir, allResults);

  // Print summary
  console.log('\n=== Phase 0 Summary ===\n');
  console.log(`  Total runs completed: ${allResults.length}/${config.conditions.length * config.runs}`);
  console.log(`  Total wall time: ${formatDuration(totalWallTime)}`);
  console.log('');

  // Per-condition summary
  for (const condition of config.conditions) {
    const conditionResults = allResults.filter(r => r.condition === condition);
    if (conditionResults.length === 0) continue;

    const avgComposite = conditionResults.reduce(
      (sum, r) => sum + r.scoredResults.composite,
      0,
    ) / conditionResults.length;

    const avgTokens = conditionResults.reduce(
      (sum, r) => sum + r.scoredResults.metrics.totalTokens,
      0,
    ) / conditionResults.length;

    const avgWallTime = conditionResults.reduce(
      (sum, r) => sum + r.wallTimeMs,
      0,
    ) / conditionResults.length;

    console.log(`  ${condition}:`);
    console.log(`    Composite score: ${avgComposite.toFixed(1)} (avg of ${conditionResults.length} runs)`);
    console.log(`    Avg tokens: ${Math.round(avgTokens).toLocaleString()}`);
    console.log(`    Avg wall time: ${formatDuration(avgWallTime)}`);
    console.log('');
  }

  // Estimate cost
  const totalTokens = allResults.reduce(
    (sum, r) => sum + r.scoredResults.metrics.totalTokens,
    0,
  );
  const estimatedCost = estimateCost(totalTokens);
  console.log(`  Estimated total cost: $${estimatedCost.toFixed(2)}`);
  console.log(`  Results saved to: ${config.outputDir}/phase0-results.json`);
  console.log('');
  console.log('  Run phase0-analyze.ts to generate the full comparison report.');
  console.log('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveResults(
  outputDir: string,
  results: Phase0RunResult[],
): Promise<void> {
  await writeFile(
    join(outputDir, 'phase0-results.json'),
    JSON.stringify(results, null, 2),
    'utf-8',
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Estimate cost at Sonnet 4 rates: $3/MTok input, $15/MTok output.
 * Since we don't split input/output at the aggregate level, assume 70/30 split.
 */
function estimateCost(totalTokens: number): number {
  const inputTokens = totalTokens * 0.7;
  const outputTokens = totalTokens * 0.3;
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
