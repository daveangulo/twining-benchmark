import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  BenchmarkConfig,
  RunMetadata,
  RunEnvironment,
  Scenario,
  Condition,
  RawResults,
  ScoredResults,
} from '../types/index.js';
import { ResultsStore } from '../results/store.js';
import type { ITestTarget } from '../targets/target.interface.js';
import { AgentSessionManager } from './agent-session.js';
import { DataCollector, type CollectedSessionData } from './data-collector.js';
import {
  classifyFailure,
  isSessionFailed,
  withRetry,
  type RetryOptions,
} from './error-handler.js';

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

/**
 * Capture the current environment for reproducibility (NFR-004).
 */
function captureEnvironment(): RunEnvironment {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    claudeModel: process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-5-20250929',
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
  private readonly onProgress?: (update: ProgressUpdate) => void;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.scenarios = options.scenarios;
    this.conditions = options.conditions;
    this.target = options.target;
    this.runsPerPair = options.runsPerPair;
    this.seed = options.seed;
    this.resumeRunId = options.resumeRunId;
    this.resultsStore = options.resultsStore;
    this.onProgress = options.onProgress;
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
    const completedSessionIds = new Set(resumeState?.completedSessionIds ?? []);

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

    const iterations: IterationResult[] = [];

    try {
      for (const scenario of this.scenarios) {
        const scenarioMeta = scenario.getMetadata();

        for (const condition of this.conditions) {
          for (let iteration = 0; iteration < this.runsPerPair; iteration++) {
            const iterationKey = `${scenarioMeta.name}:${condition.name}:${iteration}`;

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
              completedSessionIds,
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
            const allSessions = iterations.flatMap(it => it.sessions);
            await collector.savePartialRunState(runId, allSessions, {
              currentScenario: scenarioMeta.name,
              currentCondition: condition.name,
              currentIteration: iteration,
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
        }
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
    completedSessionIds: Set<string>;
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
          scoredResults = await scenario.score(rawResults, groundTruth);
          scoredResults.runId = runId;
          scoredResults.condition = condition.name;
          scoredResults.iteration = iteration;
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
   * Emit a progress update.
   */
  private emitProgress(update: ProgressUpdate): void {
    this.onProgress?.(update);
  }
}
