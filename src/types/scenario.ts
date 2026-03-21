import type Anthropic from '@anthropic-ai/sdk';
import type { ConditionContext } from './condition.js';
import type { ScoredResults } from './results.js';
import type { ArchitecturalManifest, WorkingDirectory } from './target.js';
import type { AgentTranscript } from './transcript.js';

/**
 * Known scenario names (PRD Section 4.4).
 */
export type ScenarioName =
  | 'refactoring-handoff'
  | 'architecture-cascade'
  | 'bug-investigation'
  | 'multi-session-build'
  | 'scale-stress-test'
  | 'conflict-resolution'
  | 'concurrent-agents'
  | 'context-recovery'
  | 'iterative-feature-build'
  | 'decision-volume-recovery'
  | 'evolving-requirements'
  | 'sprint-simulation';

/**
 * Metadata describing a scenario.
 */
export interface ScenarioMetadata {
  /** Unique scenario name */
  name: ScenarioName;
  /** Human-readable description */
  description: string;
  /** Estimated duration per run in minutes */
  estimatedDurationMinutes: number;
  /** Required target type/features */
  requiredTargetType: string;
  /** Number of agent sessions in this scenario */
  agentSessionCount: number;
  /** Scoring dimensions produced by this scenario */
  scoringDimensions: string[];
  /** Whether this scenario is excluded from --scenario all */
  excludeFromAll: boolean;
  /** How agent tasks are executed: sequentially (default) or in parallel */
  executionMode?: 'sequential' | 'parallel';
}

/**
 * A single task to be executed by an agent in a scenario.
 */
export interface AgentTask {
  /** Task prompt to send to the agent */
  prompt: string;
  /** Timeout for this task in milliseconds */
  timeoutMs: number;
  /** Required capabilities (tools the agent needs) */
  requiredCapabilities: string[];
  /** Sequential order within the scenario (0-based) */
  sequenceOrder: number;
  /** Maximum number of turns for this task */
  maxTurns: number;
  /** Optional role identifier for structured conditions */
  role?: string;
}

/**
 * Context created during scenario setup.
 */
export interface ScenarioContext {
  /** Working directory for this scenario run */
  workingDir: WorkingDirectory;
  /** Condition context for the current run */
  conditionContext: ConditionContext;
  /** Ground truth manifest from the target */
  groundTruth: ArchitecturalManifest;
  /** Scenario-specific metadata */
  metadata: Record<string, unknown>;
}

/**
 * Raw results from scenario execution (before scoring).
 */
export interface RawResults {
  /** Agent transcripts from all sessions */
  transcripts: AgentTranscript[];
  /** Final state of the working directory */
  finalWorkingDir: string;
  /** Whether all sessions completed */
  allSessionsCompleted: boolean;
  /** Any errors encountered during execution */
  errors: string[];
}

/**
 * Runner interface passed to scenario.execute().
 */
export interface ScenarioRunner {
  /** Execute a single agent task and return the transcript */
  runAgentTask(task: AgentTask): Promise<AgentTranscript>;
}

/**
 * Scenario interface contract.
 * All test scenarios must implement this.
 * PRD Section FR-SCN-006.
 */
export interface Scenario {
  /** Get scenario metadata */
  getMetadata(): ScenarioMetadata;
  /** Set up the scenario with target and condition */
  setup(target: WorkingDirectory, condition: ConditionContext): Promise<ScenarioContext>;
  /** Get the ordered list of agent tasks */
  getAgentTasks(): AgentTask[];
  /** Execute the scenario using the provided runner */
  execute(runner: ScenarioRunner): Promise<RawResults>;
  /** Score raw results against ground truth, optionally using LLM-as-judge */
  score(rawResults: RawResults, groundTruth: ArchitecturalManifest, evaluatorClient?: Anthropic): Promise<ScoredResults>;
  /** Clean up scenario resources */
  teardown(): Promise<void>;
}

/**
 * Registry entry for a scenario.
 */
export interface ScenarioRegistryEntry {
  metadata: ScenarioMetadata;
  /** Factory function to create the scenario */
  create: () => Scenario;
}

/**
 * Scale stress test parameters (FR-SCN-005).
 */
export interface ScaleTestConfig {
  /** Scale factor (1-5) */
  scaleFactor: number;
  /** Base session count (multiplied by scaleFactor) */
  baseSessionCount: number;
  /** Base repo line count (multiplied by scaleFactor) */
  baseRepoSize: number;
}
