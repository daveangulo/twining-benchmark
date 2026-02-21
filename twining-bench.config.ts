import type { BenchmarkConfig, ScoreWeights } from './src/types/config.js';

/**
 * Twining Benchmark Harness configuration.
 * CLI flags override values defined here.
 */

export const scoreWeights: ScoreWeights = {
  contradiction: 0.25,
  integration: 0.30,
  redundancy: 0.20,
  coherence: 0.15,
  overhead: 0.10,
};

const config: BenchmarkConfig = {
  targetPath: './targets/synthetic',
  defaultRuns: 3,
  scenarioDirectories: [],
  agentTimeoutMs: 15 * 60 * 1000,
  tokenBudgetPerRun: 500_000,
  budgetDollars: 100,
  outputDirectory: './benchmark-results',
  maxTurns: 50,
  retryCount: 0,
  dashboardPort: 3838,
  evaluatorModel: 'claude-sonnet-4-5-20250929',
  scoreWeights: {},
};

export default config;
