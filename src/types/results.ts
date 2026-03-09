/**
 * Confidence level for a scoring dimension.
 */
export type ScoreConfidence = 'low' | 'medium' | 'high';

/**
 * Method used to produce a score.
 */
export type ScoreMethod = 'automated' | 'llm-judge' | 'hybrid';

/**
 * A single scoring dimension result.
 */
export interface DimensionScore {
  /** Score value from 0-100 */
  value: number;
  /** Confidence in this score */
  confidence: ScoreConfidence;
  /** How the score was produced */
  method: ScoreMethod;
  /** Human-readable justification for the score */
  justification: string;
  /** Quality of the data used for scoring */
  dataQuality?: 'complete' | 'partial' | 'missing';
}

/**
 * Git churn metrics for a run.
 */
export interface GitChurnMetrics {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  /** Number of reverts detected */
  reverts: number;
}

/**
 * Aggregate metrics for a single run iteration.
 */
export interface RunMetrics {
  totalTokens: number;
  /** Non-cached input tokens */
  inputTokens: number;
  outputTokens: number;
  /** Cache read tokens (priced at 90% discount) */
  cacheReadTokens: number;
  /** Cache creation tokens */
  cacheCreationTokens: number;
  /** SDK-reported cost in USD (ground truth) */
  costUsd: number;
  wallTimeMs: number;
  agentSessions: number;
  /** Total agentic turns across all sessions */
  numTurns: number;
  /** Total context compactions across all sessions */
  compactionCount: number;
  /** Peak input tokens / context window size (0-1) */
  contextUtilization: number;
  gitChurn: GitChurnMetrics;
  testsPass: number;
  testsFail: number;
  compiles: boolean;
}

/** Standalone quality scores — evaluates output independent of coordination. */
export interface StandaloneScoreResult {
  correctness: DimensionScore;
  architecturalSoundness: DimensionScore;
  maintainability: DimensionScore;
  completeness: DimensionScore;
  /** Composite standalone score (0-100), equal weights */
  composite: number;
}

/** Coordination lift — difference between coordination and standalone scores. */
export interface CoordinationLift {
  /** coordinationScore - standaloneScore (positive = coordination helped) */
  lift: number;
  /** Coordination composite score */
  coordinationScore: number;
  /** Standalone composite score */
  standaloneScore: number;
}

/**
 * Scored results for a single iteration of a scenario/condition pair.
 * PRD Section 7.2.
 */
export interface ScoredResults {
  runId: string;
  scenario: string;
  condition: string;
  iteration: number;
  /** Scores keyed by dimension name (e.g., "consistency", "rework", "completion") */
  scores: Record<string, DimensionScore>;
  /** Quantitative metrics */
  metrics: RunMetrics;
  /** Weighted composite score (0-100) */
  composite: number;
  /** Standalone quality scores (if LLM judge available) */
  standaloneScores?: StandaloneScoreResult;
  /** Coordination lift (if both coordination and standalone scores available) */
  coordinationLift?: CoordinationLift;
}

/**
 * Statistical summary for a metric across multiple runs.
 * PRD Section FR-ANL-003.
 */
export interface StatisticalSummary {
  mean: number;
  median: number;
  standardDeviation: number;
  min: number;
  max: number;
  /** 95% confidence interval [lower, upper] */
  confidenceInterval: [number, number];
  /** Number of samples */
  n: number;
  /** Whether variance exceeds 20% of mean (flagged as high variance) */
  highVariance: boolean;
}

/**
 * Pairwise comparison between two conditions.
 */
export interface PairwiseComparison {
  conditionA: string;
  conditionB: string;
  metric: string;
  deltaPercent: number;
  /** p-value from statistical significance test */
  pValue: number;
  /** Significance level interpretation */
  significance: 'significant' | 'suggestive' | 'not-distinguishable';
}

/**
 * Aggregated results across all iterations for a scenario/condition pair.
 */
export interface AggregatedResults {
  scenario: string;
  condition: string;
  iterations: number;
  /** Statistical summaries keyed by dimension/metric name */
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

/**
 * Overall benchmark report for a complete suite run.
 */
export interface BenchmarkReport {
  runId: string;
  timestamp: string;
  /** All aggregated results */
  aggregated: AggregatedResults[];
  /** Pairwise comparisons between conditions */
  comparisons: PairwiseComparison[];
  /** Condition ranking by composite effectiveness score */
  ranking: ConditionRanking[];
  /** Overall Twining efficacy score */
  efficacyScore: number;
  /** Auto-generated key findings */
  keyFindings: string[];
}

/**
 * A single condition's ranking in the results.
 */
export interface ConditionRanking {
  rank: number;
  condition: string;
  compositeScore: number;
  /** Delta vs. best condition (negative means behind) */
  deltaVsBest: number;
  /** Significance indicator vs. next-best */
  significance: 'significant' | 'suggestive' | 'not-distinguishable';
  /** Mann-Whitney U p-value (primary) */
  pValue?: number;
  /** Z-test p-value (reference only, not appropriate for N < 30) */
  zTestPValue?: number;
}
