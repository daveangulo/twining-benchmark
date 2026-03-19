import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import type {
  BenchmarkConfig,
  RunMetadata,
  RunEnvironment,
  Scenario,
  Condition,
  RawResults,
  ScoredResults,
} from '../types/index.js';
import { runTests } from './test-runner.js';
import { ResultsStore } from '../results/store.js';
import { IndexManager } from '../results/index-manager.js';
import type { ITestTarget } from '../targets/target.interface.js';
import { AgentSessionManager } from './agent-session.js';
import { DataCollector, type CollectedSessionData } from './data-collector.js';
import {
  classifyFailure,
  isSessionFailed,
  withRetry,
  type RetryOptions,
} from './error-handler.js';
import { seededShuffle } from './shuffle.js';

/**
 * Options for creating a run orchestrator.
 */
export interface OrchestratorOptions {
  /** Benchmark configuration */
  config: BenchmarkConfig;
  /** Scenarios to run */
  scenarios: Scenario[];
  /** Conditions to test */
  conditions: Condition[];
  /** Target to benchmark against */
  target: ITestTarget;
  /** Number of runs per scenario/condition pair */
  runsPerPair: number;
  /** Optional random seed for reproducibility */
  seed?: string;
  /** Resume from a specific run ID (if restarting) */
  resumeRunId?: string;
  /** Optional results store for persisting scored results */
  resultsStore?: ResultsStore;
  /** Optional index manager for dashboard discovery */
  indexManager?: IndexManager;
  /** Callback for progress updates */
  onProgress?: (update: ProgressUpdate) => void;
}

/**
 * Progress update emitted during orchestration.
 */
export interface ProgressUpdate {
  type: 'run-start' | 'session-start' | 'session-complete' | 'iteration-complete' | 'run-complete';
  runId: string;
  scenario?: string;
  condition?: string;
  iteration?: number;
  sessionIndex?: number;
  totalSessions?: number;
  message: string;
}

/**
 * Result of a single iteration (one scenario × condition execution).
 */
export interface IterationResult {
  scenario: string;
  condition: string;
  iteration: number;
  sessions: CollectedSessionData[];
  allSessionsCompleted: boolean;
  errors: string[];
  wallTimeMs: number;
  /** Scored results from scenario.score(), undefined if scoring failed */
  scoredResults?: ScoredResults;
}

/**
 * Complete orchestration result.
 */
export interface OrchestrationResult {
  runMetadata: RunMetadata;
  iterations: IterationResult[];
}

const require = createRequire(import.meta.url);

/**
 * Capture the current environment for reproducibility (NFR-004).
 */
export function captureEnvironment(): RunEnvironment {
  let harnessCommitSha = 'unknown';
  try {
    harnessCommitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    // Not in a git repo or git not available
  }

  let twiningMcpVersion = 'unknown';
  try {
    twiningMcpVersion = execSync('twining-mcp --version', { encoding: 'utf-8' }).trim();
  } catch {
    // twining-mcp not installed or not available
  }

  const pkg = require('../../package.json') as { version: string };

  return {
    nodeVersion: process.version,
    platform: process.platform,
    claudeModel: process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6',
    evaluatorModel: process.env['EVALUATOR_MODEL'] ?? 'claude-sonnet-4-6',
    harnessVersion: pkg.version,
    harnessCommitSha,
    twiningMcpVersion,
  };
}

/**
 * RunOrchestrator — the main benchmark run loop (FR-RUN-002).
 *
 * Responsibilities:
 * - Iterates over scenarios × conditions × runs
 * - Sets up target → condition → executes tasks sequentially → collects → tears down
 * - Saves incrementally after each run (crash-safe)
 * - Generates unique run IDs
 * - Supports resume from last completed run
 */
export class RunOrchestrator {
  private readonly config: BenchmarkConfig;
  private readonly scenarios: Scenario[];
  private readonly conditions: Condition[];
  private readonly target: ITestTarget;
  private readonly runsPerPair: number;
  private readonly seed?: string;
  private readonly resumeRunId?: string;
  private readonly resultsStore?: ResultsStore;
  private readonly indexManager?: IndexManager;
  private readonly onProgress?: (update: ProgressUpdate) => void;
  private evaluatorClient?: Anthropic;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.scenarios = options.scenarios;
    this.conditions = options.conditions;
    this.target = options.target;
    this.runsPerPair = options.runsPerPair;
    this.seed = options.seed;
    this.resumeRunId = options.resumeRunId;
    this.resultsStore = options.resultsStore;
    this.indexManager = options.indexManager;
    this.onProgress = options.onProgress;
  }

  /**
   * Get or lazily create the Anthropic client for LLM-as-judge evaluations.
   * Returns undefined if ANTHROPIC_API_KEY is not set.
   */
  private getEvaluatorClient(): Anthropic | undefined {
    if (this.evaluatorClient) return this.evaluatorClient;
    if (!process.env['ANTHROPIC_API_KEY']) return undefined;
    this.evaluatorClient = new Anthropic();
    return this.evaluatorClient;
  }

  /**
   * Execute the full benchmark suite.
   */
  async run(): Promise<OrchestrationResult> {
    const runId = this.resumeRunId ?? uuidv4();
    const startTime = new Date();

    const collector = new DataCollector({
      outputDir: this.config.outputDirectory,
      runId,
    });

    // Load resume state if available
    const resumeState = this.resumeRunId
      ? await collector.loadPartialRunState(this.resumeRunId)
      : null;
    const completedIterationKeys = new Set<string>(
      (resumeState?.metadata as { completedIterationKeys?: string[] })
        ?.completedIterationKeys ?? [],
    );

    const runMetadata: RunMetadata = {
      id: runId,
      timestamp: startTime.toISOString(),
      config: this.config,
      scenarios: this.scenarios.map(s => s.getMetadata().name),
      conditions: this.conditions.map(c => c.name),
      runsPerPair: this.runsPerPair,
      seed: this.seed,
      environment: captureEnvironment(),
      status: 'running',
      duration: 0,
    };

    this.emitProgress({
      type: 'run-start',
      runId,
      message: `Starting benchmark run ${runId} with ${this.scenarios.length} scenarios × ${this.conditions.length} conditions × ${this.runsPerPair} runs`,
    });

    // Save initial metadata
    await this.saveRunMetadata(runMetadata);

    // Initialize results store if present
    if (this.resultsStore) {
      await this.resultsStore.initRun(runMetadata);
    }

    // Register in dashboard index
    if (this.indexManager) {
      await this.indexManager.addRun({
        id: runId,
        timestamp: runMetadata.timestamp,
        scenarios: runMetadata.scenarios,
        conditions: runMetadata.conditions,
        status: 'running',
        duration: 0,
      });
    }

    const iterations: IterationResult[] = [];

    try {
      // Build execution tuples and optionally shuffle
      type ExecutionTuple = { scenario: Scenario; condition: Condition; iteration: number };
      const tuples: ExecutionTuple[] = [];
      for (const scenario of this.scenarios) {
        for (const condition of this.conditions) {
          for (let iteration = 0; iteration < this.runsPerPair; iteration++) {
            tuples.push({ scenario, condition, iteration });
          }
        }
      }

      const executionOrder = this.seed
        ? seededShuffle(tuples, this.seed)
        : tuples;

      for (let orderIndex = 0; orderIndex < executionOrder.length; orderIndex++) {
        const { scenario, condition, iteration } = executionOrder[orderIndex]!;
        const scenarioMeta = scenario.getMetadata();
        const iterationKey = `${scenarioMeta.name}:${condition.name}:${iteration}`;

            // Skip already-completed iterations when resuming
            if (completedIterationKeys.has(iterationKey)) {
              this.emitProgress({
                type: 'iteration-complete',
                runId,
                scenario: scenarioMeta.name,
                condition: condition.name,
                iteration,
                message: `Skipping ${iterationKey} (already completed)`,
              });
              continue;
            }

            this.emitProgress({
              type: 'session-start',
              runId,
              scenario: scenarioMeta.name,
              condition: condition.name,
              iteration,
              message: `Running ${iterationKey}`,
            });

            const result = await this.executeIteration({
              runId,
              scenario,
              condition,
              iteration,
              collector,
            });

            iterations.push(result);

            // Persist scored results and transcripts via store
            if (this.resultsStore && result.scoredResults) {
              await this.resultsStore.saveScores(result.scoredResults);
            }
            if (this.resultsStore) {
              for (const session of result.sessions) {
                await this.resultsStore.saveTranscript(session.transcript);
              }
            }

            // Incremental save after each iteration (crash-safe)
            completedIterationKeys.add(iterationKey);
            const allSessions = iterations.flatMap(it => it.sessions);
            await collector.savePartialRunState(runId, allSessions, {
              currentScenario: scenarioMeta.name,
              currentCondition: condition.name,
              currentIteration: iteration,
              completedIterationKeys: [...completedIterationKeys],
            });

            this.emitProgress({
              type: 'iteration-complete',
              runId,
              scenario: scenarioMeta.name,
              condition: condition.name,
              iteration,
              message: `Completed ${iterationKey}: ${result.sessions.length} sessions, ${result.errors.length} errors`,
            });
      }

      runMetadata.status = 'completed';
    } catch (err: unknown) {
      runMetadata.status = iterations.length > 0 ? 'partial' : 'failed';
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emitProgress({
        type: 'run-complete',
        runId,
        message: `Run failed: ${errorMsg}`,
      });
    }

    runMetadata.duration = Date.now() - startTime.getTime();
    await this.saveRunMetadata(runMetadata);

    // Update results store with final metadata
    if (this.resultsStore) {
      await this.resultsStore.updateMetadata(runMetadata);
    }

    // Update dashboard index with final status
    if (this.indexManager) {
      await this.indexManager.updateRunStatus(runId, runMetadata.status);
    }

    this.emitProgress({
      type: 'run-complete',
      runId,
      message: `Run ${runId} ${runMetadata.status} in ${Math.round(runMetadata.duration / 1000)}s`,
    });

    return { runMetadata, iterations };
  }

  /**
   * Execute a single iteration (scenario × condition).
   */
  private async executeIteration(params: {
    runId: string;
    scenario: Scenario;
    condition: Condition;
    iteration: number;
    collector: DataCollector;
  }): Promise<IterationResult> {
    const { runId, scenario, condition, iteration, collector } = params;
    const scenarioMeta = scenario.getMetadata();
    const iterationStart = Date.now();
    const sessions: CollectedSessionData[] = [];
    const errors: string[] = [];
    let allCompleted = true;
    let scoredResults: ScoredResults | undefined;

    // 1. Setup target (isolated working directory)
    const workingDir = await this.target.setup();

    try {
      // 2. Setup condition in the working directory
      const conditionCtx = await condition.setup(workingDir.path);

      try {
        // 3. Setup scenario
        await scenario.setup(workingDir, conditionCtx);

        // 4. Get agent tasks
        const tasks = scenario.getAgentTasks();

        // 5. Create session manager
        const sessionManager = new AgentSessionManager({
          runId,
          scenario: scenarioMeta.name,
          condition: condition.name,
          workingDir: workingDir.path,
          agentConfig: conditionCtx.agentConfig,
          timeoutMs: this.config.agentTimeoutMs,
          model: this.config.agentModel,
        });

        // 6. Execute tasks sequentially
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i]!;

          this.emitProgress({
            type: 'session-start',
            runId,
            scenario: scenarioMeta.name,
            condition: condition.name,
            iteration,
            sessionIndex: i,
            totalSessions: tasks.length,
            message: `Task ${i + 1}/${tasks.length} for ${scenarioMeta.name}:${condition.name}:${iteration}`,
          });

          // Capture pre-session git state
          const beforeHash = await collector.capturePreSessionGitState(workingDir.path);

          // Execute with retry logic
          const retryOptions: RetryOptions = {
            maxRetries: this.config.retryCount,
            baseDelayMs: 5000,
            exponentialBackoff: true,
          };

          const retryResult = await withRetry(
            () => sessionManager.executeTask(task),
            (transcript) => {
              if (isSessionFailed(transcript)) {
                return classifyFailure(transcript);
              }
              return null;
            },
            retryOptions,
          );

          if (retryResult.result) {
            // Enrich transcript with git data and save
            const collected = await collector.enrichAndSave(
              retryResult.result,
              workingDir.path,
              beforeHash,
              condition,
            );
            sessions.push(collected);

            // Commit checkpoint between sessions so the next session's
            // diff is isolated from this one's changes
            if (i < tasks.length - 1) {
              await collector.commitSessionSnapshot(
                workingDir.path,
                retryResult.result.sessionId,
              );
            }

            if (!retryResult.success) {
              allCompleted = false;
              for (const failure of retryResult.failures) {
                errors.push(`Task ${i}: ${failure.description}`);
              }
            }
          } else {
            allCompleted = false;
            for (const failure of retryResult.failures) {
              errors.push(`Task ${i}: ${failure.description}`);
            }
          }

          this.emitProgress({
            type: 'session-complete',
            runId,
            scenario: scenarioMeta.name,
            condition: condition.name,
            iteration,
            sessionIndex: i,
            totalSessions: tasks.length,
            message: `Task ${i + 1}/${tasks.length} ${retryResult.success ? 'completed' : 'failed'}`,
          });
        }

        // Score the iteration
        try {
          const rawResults: RawResults = {
            transcripts: sessions.map(s => s.transcript),
            finalWorkingDir: workingDir.path,
            allSessionsCompleted: allCompleted,
            errors,
          };
          const groundTruth = this.target.getGroundTruth();
          scoredResults = await scenario.score(rawResults, groundTruth, this.getEvaluatorClient());
          scoredResults.runId = runId;
          scoredResults.condition = condition.name;
          scoredResults.iteration = iteration;

          // Run tests on the final working directory state
          try {
            const testResults = await runTests(workingDir.path);
            scoredResults.metrics.testsPass = testResults.pass;
            scoredResults.metrics.testsFail = testResults.fail;
            scoredResults.metrics.compiles = testResults.compiles;
          } catch (testErr: unknown) {
            const msg = testErr instanceof Error ? testErr.message : String(testErr);
            errors.push(`Test execution failed: ${msg}`);
          }
        } catch (scoreErr: unknown) {
          const msg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
          errors.push(`Scoring failed: ${msg}`);
        }
      } finally {
        // 7. Teardown condition
        await condition.teardown();
      }
    } finally {
      // 8. Teardown target (cleanup working directory)
      await workingDir.cleanup();
    }

    return {
      scenario: scenarioMeta.name,
      condition: condition.name,
      iteration,
      sessions,
      allSessionsCompleted: allCompleted,
      errors,
      wallTimeMs: Date.now() - iterationStart,
      scoredResults,
    };
  }

  /**
   * Save run metadata to disk.
   */
  private async saveRunMetadata(metadata: RunMetadata): Promise<void> {
    const runDir = join(this.config.outputDirectory, metadata.id);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );
  }

  /**
   * Emit a progress update and write live status file for dashboard monitoring.
   */
  private emitProgress(update: ProgressUpdate): void {
    this.onProgress?.(update);
    // Write live status file (best-effort, don't block on errors)
    this.writeStatusFile(update).catch(() => {});
  }

  /**
   * Write the .current-run-status.json file for live dashboard monitoring.
   */
  private async writeStatusFile(update: ProgressUpdate): Promise<void> {
    const statusPath = join(this.config.outputDirectory, '.current-run-status.json');

    if (update.type === 'run-complete') {
      // Clean up status file when run finishes
      await rm(statusPath, { force: true });
      return;
    }

    const status = {
      active: true,
      runId: update.runId,
      scenario: update.scenario,
      condition: update.condition,
      iteration: update.iteration,
      percentComplete: this.calculatePercentComplete(update),
      startTime: new Date().toISOString(),
    };

    await writeFile(statusPath, JSON.stringify(status, null, 2), 'utf-8');
  }

  /**
   * Calculate completion percentage based on progress update context.
   */
  private calculatePercentComplete(update: ProgressUpdate): number {
    if (update.type === 'run-start') return 0;
    const totalIterations = this.scenarios.length * this.conditions.length * this.runsPerPair;
    if (totalIterations === 0) return 0;
    const iteration = update.iteration ?? 0;
    const scenarioIdx = update.scenario
      ? this.scenarios.findIndex(s => s.getMetadata().name === update.scenario)
      : 0;
    const conditionIdx = update.condition
      ? this.conditions.findIndex(c => c.name === update.condition)
      : 0;
    const completed = scenarioIdx * this.conditions.length * this.runsPerPair
      + conditionIdx * this.runsPerPair
      + iteration;
    // For iteration-complete, count the current iteration as done
    if (update.type === 'iteration-complete') {
      return Math.min(100, ((completed + 1) / totalIterations) * 100);
    }
    return Math.min(100, (completed / totalIterations) * 100);
  }
}
