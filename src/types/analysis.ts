import type { ScoreConfidence } from './results.js';

/**
 * Result of an LLM-as-judge evaluation (FR-ANL-002).
 */
export interface LlmJudgeEvaluation {
  /** Numerical score (0-100) */
  score: number;
  /** Confidence in the evaluation */
  confidence: ScoreConfidence;
  /** Justification paragraph */
  justification: string;
  /** Model used for evaluation */
  model: string;
  /** Token usage for the evaluation call */
  tokenUsage: {
    input: number;
    output: number;
  };
}

/**
 * Aggregated LLM-as-judge result (median of 3 evaluations).
 */
export interface AggregatedJudgeResult {
  /** Median score from 3 evaluations */
  medianScore: number;
  /** All individual evaluations */
  evaluations: LlmJudgeEvaluation[];
  /** Variance across evaluations */
  evaluationVariance: number;
}

/**
 * Detected code pattern from AST analysis (FR-ANL-001).
 */
export interface DetectedPattern {
  /** Pattern name (e.g., "event-emitter", "repository-pattern", "interface-implementation") */
  patternName: string;
  /** Files where the pattern was detected */
  files: string[];
  /** Confidence that the pattern is present */
  confidence: number;
  /** Evidence supporting the detection */
  evidence: string[];
}

/**
 * Git churn analysis result (FR-ANL-001).
 */
export interface ChurnAnalysis {
  /** Per-session churn breakdown */
  perSession: SessionChurn[];
  /** Cumulative churn across all sessions */
  cumulative: {
    linesAdded: number;
    linesRemoved: number;
    netEffectiveChanges: number;
    reverts: number;
    filesChanged: number;
  };
  /** Effective change ratio: net changes / total changes */
  effectiveChangeRatio: number;
}

/**
 * Churn data for a single session.
 */
export interface SessionChurn {
  sessionIndex: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  /** Lines that were reverted from previous sessions */
  revertedLines: number;
  /** Commits made in this session */
  commitCount: number;
}

/**
 * Test suite results from running the target's tests.
 */
export interface TestSuiteResults {
  passed: number;
  failed: number;
  skipped: number;
  /** Total test count */
  total: number;
  /** Coverage percentage (if available) */
  coveragePct?: number;
  /** Delta from baseline coverage */
  coverageDelta?: number;
  /** Whether the project compiles */
  compiles: boolean;
  /** Compilation errors (if any) */
  compilationErrors?: string[];
}

/**
 * Evaluator prompt template for LLM-as-judge (FR-ANL-002).
 */
export interface EvaluatorPromptTemplate {
  /** Unique template identifier */
  id: string;
  /** Version string for tracking changes */
  version: string;
  /** The prompt template (with placeholders) */
  template: string;
  /** Scoring dimension this template evaluates */
  dimension: string;
  /** Rubric for scoring */
  rubric: EvaluatorRubric;
}

/**
 * Scoring rubric for LLM-as-judge evaluations.
 */
export interface EvaluatorRubric {
  /** Criteria for a score of 90-100 */
  excellent: string;
  /** Criteria for a score of 70-89 */
  good: string;
  /** Criteria for a score of 40-69 */
  acceptable: string;
  /** Criteria for a score of 0-39 */
  poor: string;
}

/**
 * Cost estimate for dry-run reporting (FR-CLI-001).
 */
export interface CostEstimate {
  /** Estimated input tokens */
  projectedInputTokens: number;
  /** Estimated output tokens */
  projectedOutputTokens: number;
  /** Estimated total cost in dollars */
  projectedCostDollars: number;
  /** Cost breakdown by scenario */
  perScenario: Record<string, number>;
  /** Whether the estimate exceeds the configured budget */
  exceedsBudget: boolean;
}

/**
 * Infrastructure metrics for the Twining condition (FR-SCN-005).
 */
export interface InfrastructureMetrics {
  /** MCP server response latency percentiles in ms */
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Total search queries made */
  searchQueryCount: number;
  /** Average search query time in ms */
  avgSearchTimeMs: number;
}
