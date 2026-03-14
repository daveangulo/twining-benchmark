/**
 * Benchmark configuration — loaded from twining-bench.config.ts or CLI flags.
 * Supports all options from FR-CLI-006.
 */
export interface BenchmarkConfig {
  /** Path to the default target configuration */
  targetPath: string;
  /** Default number of runs per scenario/condition pair */
  defaultRuns: number;
  /** Additional directories to scan for custom scenarios */
  scenarioDirectories: string[];
  /** Agent session timeout in milliseconds (default: 15 minutes) */
  agentTimeoutMs: number;
  /** Maximum token budget per run */
  tokenBudgetPerRun: number;
  /** Maximum dollar budget for entire suite (default: $100) */
  budgetDollars: number;
  /** Default output directory for results */
  outputDirectory: string;
  /** Default max turns per agent session */
  maxTurns: number;
  /** Number of retries for failed runs (default: 0) */
  retryCount: number;
  /** Dashboard server port (default: 3838) */
  dashboardPort: number;
  /** LLM-as-judge model to use (default: claude-sonnet) */
  evaluatorModel: string;
  /** Composite score weights per scenario (overrides defaults) */
  scoreWeights?: Record<string, ScoreWeights>;
}

/**
 * Weights for composite Coordination Effectiveness Score (CES).
 * See PRD Section 9.2.
 */
export interface ScoreWeights {
  contradiction: number;
  integration: number;
  redundancy: number;
  coherence: number;
  overhead: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: BenchmarkConfig = {
  targetPath: './targets/synthetic',
  defaultRuns: 5,
  scenarioDirectories: [],
  agentTimeoutMs: 15 * 60 * 1000,
  tokenBudgetPerRun: 500_000,
  budgetDollars: 100,
  outputDirectory: './benchmark-results',
  maxTurns: 50,
  retryCount: 0,
  dashboardPort: 3838,
  evaluatorModel: 'claude-sonnet-4-5-20250929',
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  contradiction: 0.25,
  integration: 0.30,
  redundancy: 0.20,
  coherence: 0.15,
  overhead: 0.10,
};
