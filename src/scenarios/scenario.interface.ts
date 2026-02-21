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
import type { ScoredResults } from '../types/results.js';
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

    const transcripts: AgentTranscript[] = [];
    const errors: string[] = [];
    let allCompleted = true;

    for (const task of this.tasks) {
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
      }
    }

    return {
      transcripts,
      finalWorkingDir: this.context.workingDir.path,
      allSessionsCompleted: allCompleted,
      errors,
    };
  }

  async score(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): Promise<ScoredResults> {
    return this.doScore(rawResults, groundTruth);
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

  /** Score raw results against ground truth. */
  protected abstract doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): Promise<ScoredResults>;

  /** Scenario-specific cleanup. */
  protected abstract doTeardown(): Promise<void>;
}
