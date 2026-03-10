import type { BenchmarkConfig } from './config.js';

/**
 * Run status lifecycle.
 */
export type RunStatus = 'running' | 'completed' | 'partial' | 'failed';

/**
 * Environment snapshot captured at run time.
 * Ensures reproducibility per NFR-004.
 */
export interface RunEnvironment {
  nodeVersion: string;
  platform: string;
  /** Exact model string used for agent sessions */
  claudeModel: string;
  /** Twining version, if the full-twining condition is used */
  twiningVersion?: string;
  /** Model used for LLM-as-judge evaluation */
  evaluatorModel: string;
  /** Harness version from package.json */
  harnessVersion: string;
  /** Git commit SHA of the harness at run time */
  harnessCommitSha: string;
  /** Installed twining-mcp version (if available) */
  twiningMcpVersion: string;
  /** Run seed if provided */
  runSeed?: string;
}

/**
 * Top-level metadata for a benchmark run.
 * PRD Section 7.1.
 */
export interface RunMetadata {
  /** Unique run identifier (UUID) */
  id: string;
  /** ISO 8601 timestamp of when the run started */
  timestamp: string;
  /** Full config snapshot used for this run */
  config: BenchmarkConfig;
  /** Scenario names executed in this run */
  scenarios: string[];
  /** Condition names tested in this run */
  conditions: string[];
  /** Number of runs per scenario/condition pair */
  runsPerPair: number;
  /** Random seed if provided (for reproducibility) */
  seed?: string;
  /** Environment snapshot */
  environment: RunEnvironment;
  /** Current status of the run */
  status: RunStatus;
  /** Total wall time in milliseconds */
  duration: number;
}

/**
 * Index entry for the top-level run registry.
 * Stored in benchmark-results/index.json (FR-RST-001).
 */
export interface RunIndexEntry {
  id: string;
  timestamp: string;
  scenarios: string[];
  conditions: string[];
  status: RunStatus;
  /** Overall composite score (if computed) */
  compositeScore?: number;
  duration: number;
}

/**
 * Top-level index of all runs.
 */
export interface RunIndex {
  runs: RunIndexEntry[];
}
