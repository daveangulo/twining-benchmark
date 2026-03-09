/**
 * BaseScenario — Abstract base class for benchmark test scenarios.
 *
 * All scenarios must extend this class and implement the abstract methods.
 * Provides common lifecycle patterns per FR-SCN-006.
 *
 * Lifecycle:
 * 1. `setup(target, condition)` — Prepare scenario context
 * 2. `getAgentTasks()` — Return ordered list of agent tasks
 * 3. `execute(runner)` — Run all agent tasks sequentially
 * 4. `score(rawResults, groundTruth)` — Score the results
 * 5. `teardown()` — Clean up resources
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  Scenario,
  ScenarioMetadata,
  ScenarioContext,
  AgentTask,
  RawResults,
  ScenarioRunner,
} from '../types/scenario.js';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, RunMetrics } from '../types/results.js';
import type { AgentTranscript } from '../types/transcript.js';

export type {
  Scenario,
  ScenarioMetadata,
  ScenarioContext,
  AgentTask,
  RawResults,
  ScenarioRunner,
};

/**
 * Template variables available for prompt substitution.
 */
export interface PromptTemplateVars {
  /** Absolute path to the repo working directory */
  repo_path: string;
  /** 1-based agent number within the scenario */
  agent_number: string;
  /** Total number of agents in the scenario */
  total_agents: string;
  /** Scenario name */
  scenario_name: string;
  /** Additional scenario-specific variables */
  [key: string]: string;
}

/**
 * Substitute template variables in a prompt string.
 *
 * Replaces `{{variable_name}}` with the corresponding value from vars.
 * Unknown variables are left as-is.
 */
export function substitutePromptTemplate(
  template: string,
  vars: PromptTemplateVars,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match: string, key: string): string => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const val = vars[key];
      return val !== undefined ? val : match;
    }
    return match;
  });
}

/**
 * Abstract base class for benchmark scenarios.
 *
 * Subclasses must implement:
 * - `buildMetadata()` — return scenario metadata
 * - `buildAgentTasks()` — return the ordered list of agent tasks (with template variables)
 * - `doSetup()` — scenario-specific setup logic
 * - `doScore()` — scenario-specific scoring logic
 * - `doTeardown()` — scenario-specific cleanup
 */
export abstract class BaseScenario implements Scenario {
  protected context: ScenarioContext | undefined;
  protected tasks: AgentTask[] | undefined;

  getMetadata(): ScenarioMetadata {
    return this.buildMetadata();
  }

  async setup(
    target: WorkingDirectory,
    condition: ConditionContext,
  ): Promise<ScenarioContext> {
    const groundTruth = await this.getGroundTruth();
    const metadata = await this.doSetup(target, condition);

    this.context = {
      workingDir: target,
      conditionContext: condition,
      groundTruth,
      metadata,
    };

    // Build tasks with template variables resolved
    const templateVars: PromptTemplateVars = {
      repo_path: target.path,
      agent_number: '0', // Will be set per-task during substitution
      total_agents: String(this.buildMetadata().agentSessionCount),
      scenario_name: this.buildMetadata().name,
    };

    this.tasks = this.buildAgentTasks().map((task, index) => ({
      ...task,
      prompt: substitutePromptTemplate(task.prompt, {
        ...templateVars,
        agent_number: String(index + 1),
      }),
    }));

    return this.context;
  }

  getAgentTasks(): AgentTask[] {
    if (!this.tasks) {
      throw new Error('Scenario not set up. Call setup() first.');
    }
    return this.tasks;
  }

  async execute(runner: ScenarioRunner): Promise<RawResults> {
    if (!this.context || !this.tasks) {
      throw new Error('Scenario not set up. Call setup() first.');
    }

    const metadata = this.buildMetadata();

    if (metadata.executionMode === 'parallel') {
      return this.executeParallel(runner, this.tasks);
    }
    return this.executeSequential(runner, this.tasks);
  }

  private async executeSequential(runner: ScenarioRunner, tasks: AgentTask[]): Promise<RawResults> {
    const transcripts: AgentTranscript[] = [];
    const errors: string[] = [];
    let allCompleted = true;

    for (const task of tasks) {
      try {
        const transcript = await runner.runAgentTask(task);
        transcripts.push(transcript);

        if (transcript.exitReason !== 'completed') {
          allCompleted = false;
          if (transcript.error) {
            errors.push(
              `Task ${task.sequenceOrder}: ${transcript.error}`,
            );
          }
        }
      } catch (err) {
        allCompleted = false;
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Task ${task.sequenceOrder} failed: ${message}`);

        // Push a placeholder transcript so indexes stay aligned with tasks
        transcripts.push({
          sessionId: `error-${task.sequenceOrder}`,
          runId: '',
          scenario: this.buildMetadata().name,
          condition: '',
          taskIndex: task.sequenceOrder,
          prompt: task.prompt,
          toolCalls: [],
          fileChanges: [],
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, costUsd: 0 },
          timing: { startTime: new Date().toISOString(), endTime: new Date().toISOString(), durationMs: 0, timeToFirstActionMs: 0 },
          exitReason: 'error',
          error: message,
          numTurns: 0,
          stopReason: null,
          contextWindowSize: 0,
          compactionCount: 0,
          turnUsage: [],
        });
      }
    }

    return {
      transcripts,
      finalWorkingDir: this.context!.workingDir.path,
      allSessionsCompleted: allCompleted,
      errors,
    };
  }

  private async executeParallel(runner: ScenarioRunner, tasks: AgentTask[]): Promise<RawResults> {
    const results = await Promise.allSettled(
      tasks.map((task) => runner.runAgentTask(task)),
    );

    const transcripts: AgentTranscript[] = [];
    const errors: string[] = [];
    let allCompleted = true;

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const task = tasks[i]!;
      if (result.status === 'fulfilled') {
        transcripts.push(result.value);
        if (result.value.exitReason === 'error') {
          allCompleted = false;
          errors.push(`Task ${task.sequenceOrder}: ${result.value.error}`);
        }
      } else {
        allCompleted = false;
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`Task ${task.sequenceOrder} failed: ${message}`);
        // Push placeholder transcript so indexes stay aligned
        transcripts.push({
          sessionId: `error-${task.sequenceOrder}`,
          runId: '',
          scenario: this.buildMetadata().name,
          condition: '',
          taskIndex: task.sequenceOrder,
          prompt: task.prompt,
          toolCalls: [],
          fileChanges: [],
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, costUsd: 0 },
          timing: { startTime: new Date().toISOString(), endTime: new Date().toISOString(), durationMs: 0, timeToFirstActionMs: 0 },
          exitReason: 'error',
          error: message,
          numTurns: 0,
          stopReason: null,
          contextWindowSize: 0,
          compactionCount: 0,
          turnUsage: [],
        });
      }
    }

    return {
      transcripts,
      finalWorkingDir: this.context!.workingDir.path,
      allSessionsCompleted: allCompleted,
      errors,
    };
  }

  async score(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    return this.doScore(rawResults, groundTruth, evaluatorClient);
  }

  async teardown(): Promise<void> {
    await this.doTeardown();
    this.context = undefined;
    this.tasks = undefined;
  }

  /** Return the scenario metadata. */
  protected abstract buildMetadata(): ScenarioMetadata;

  /** Return the unresolved agent tasks (template variables not yet substituted). */
  protected abstract buildAgentTasks(): AgentTask[];

  /** Get ground truth for this scenario (may come from target or be scenario-specific). */
  protected abstract getGroundTruth(): Promise<ArchitecturalManifest>;

  /**
   * Scenario-specific setup logic.
   * @returns Scenario-specific metadata to store in the context.
   */
  protected abstract doSetup(
    target: WorkingDirectory,
    condition: ConditionContext,
  ): Promise<Record<string, unknown>>;

  /** Score raw results against ground truth, optionally using LLM-as-judge. */
  protected abstract doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults>;

  /** Scenario-specific cleanup. */
  protected abstract doTeardown(): Promise<void>;

  /**
   * Extract run metrics from raw results.
   * Aggregates token usage, timing, file changes, and context utilization
   * across all transcripts in the raw results.
   */
  protected extractMetrics(rawResults: RawResults): RunMetrics {
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let costUsd = 0;
    let wallTimeMs = 0;
    let numTurns = 0;
    let compactionCount = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    let maxContextUtilization = 0;
    const changedFiles = new Set<string>();

    for (const transcript of rawResults.transcripts) {
      totalTokens += transcript.tokenUsage.total;
      inputTokens += transcript.tokenUsage.input;
      outputTokens += transcript.tokenUsage.output;
      cacheReadTokens += transcript.tokenUsage.cacheRead;
      cacheCreationTokens += transcript.tokenUsage.cacheCreation;
      costUsd += transcript.tokenUsage.costUsd;
      wallTimeMs += transcript.timing.durationMs;
      numTurns += transcript.numTurns;
      compactionCount += transcript.compactionCount;

      if (transcript.contextWindowSize > 0) {
        const utilization = transcript.tokenUsage.total / transcript.contextWindowSize;
        maxContextUtilization = Math.max(maxContextUtilization, utilization);
      }

      for (const change of transcript.fileChanges) {
        linesAdded += change.linesAdded;
        linesRemoved += change.linesRemoved;
        changedFiles.add(change.path);
      }
    }

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
      wallTimeMs,
      agentSessions: rawResults.transcripts.length,
      numTurns,
      compactionCount,
      contextUtilization: maxContextUtilization,
      gitChurn: {
        linesAdded,
        linesRemoved,
        filesChanged: changedFiles.size,
        reverts: 0, // Calculated by deeper analysis later
      },
      testsPass: 0, // Filled by test runner
      testsFail: 0, // Filled by test runner
      compiles: rawResults.allSessionsCompleted,
    };
  }
}
