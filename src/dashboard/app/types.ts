/** Client-side API response types for the dashboard. */

export interface RunIndexEntry {
  id: string;
  timestamp: string;
  scenarios: string[];
  conditions: string[];
  status: 'running' | 'completed' | 'partial' | 'failed';
  compositeScore?: number;
  duration: number;
}

export interface DimensionScore {
  value: number;
  confidence: 'low' | 'medium' | 'high';
  method: 'automated' | 'llm-judge' | 'hybrid';
  justification: string;
}

export interface GitChurnMetrics {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  reverts: number;
}

export interface RunMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  wallTimeMs: number;
  agentSessions: number;
  numTurns: number;
  compactionCount: number;
  contextUtilization: number;
  gitChurn: GitChurnMetrics;
  testsPass: number;
  testsFail: number;
  compiles: boolean;
}

export interface ScoredResults {
  runId: string;
  scenario: string;
  condition: string;
  iteration: number;
  scores: Record<string, DimensionScore>;
  metrics: RunMetrics;
  composite: number;
}

export interface StatisticalSummary {
  mean: number;
  median: number;
  standardDeviation: number;
  min: number;
  max: number;
  confidenceInterval: [number, number];
  n: number;
  highVariance: boolean;
}

export interface AggregatedResults {
  scenario: string;
  condition: string;
  iterations: number;
  scoreSummaries: Record<string, StatisticalSummary>;
  metricSummaries: {
    totalTokens: StatisticalSummary;
    inputTokens: StatisticalSummary;
    outputTokens: StatisticalSummary;
    cacheReadTokens: StatisticalSummary;
    cacheCreationTokens: StatisticalSummary;
    costUsd: StatisticalSummary;
    wallTimeMs: StatisticalSummary;
    numTurns: StatisticalSummary;
    compactionCount: StatisticalSummary;
    contextUtilization: StatisticalSummary;
    gitChurn: {
      linesAdded: StatisticalSummary;
      linesRemoved: StatisticalSummary;
      filesChanged: StatisticalSummary;
      reverts: StatisticalSummary;
    };
    testsPass: StatisticalSummary;
    testsFail: StatisticalSummary;
  };
  compositeScore: StatisticalSummary;
}

export interface PairwiseComparison {
  conditionA: string;
  conditionB: string;
  metric: string;
  deltaPercent: number;
  pValue: number;
  significance: 'significant' | 'suggestive' | 'not-distinguishable';
}

export interface ConditionRanking {
  rank: number;
  condition: string;
  compositeScore: number;
  deltaVsBest: number;
  significance: 'significant' | 'suggestive' | 'not-distinguishable';
}

export interface BenchmarkReport {
  runId: string;
  timestamp: string;
  aggregated: AggregatedResults[];
  comparisons: PairwiseComparison[];
  ranking: ConditionRanking[];
  efficacyScore: number;
  keyFindings: string[];
}

export interface RunMetadata {
  id: string;
  timestamp: string;
  scenarios: string[];
  conditions: string[];
  runsPerPair: number;
  seed?: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  duration: number;
}

export interface LiveRunStatus {
  active: boolean;
  runId?: string;
  scenario?: string;
  condition?: string;
  iteration?: number;
  percentComplete?: number;
  startTime?: string;
  estimatedRemainingMs?: number;
}

export interface TrendDataPoint {
  runId: string;
  timestamp: string;
  condition: string;
  compositeScore: number;
}

export type View = 'runs' | 'compare' | 'trends';
