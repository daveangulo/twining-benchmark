import type { ScoreWeights } from '../types/config.js';
import { DEFAULT_SCORE_WEIGHTS as WEIGHTS } from '../types/config.js';
import type {
  DimensionScore,
  ScoredResults,
  AggregatedResults,
  StatisticalSummary,
  ConditionRanking,
  PairwiseComparison,
} from '../types/results.js';
import { computeSummary, compareConditions } from './statistics.js';

/**
 * Raw metric inputs for CES calculation.
 * These are the raw values from analysis before they're converted to scores.
 */
export interface CesInputMetrics {
  /** Rate of contradictions detected (0 to 1, where 0 = no contradictions) */
  contradictionRate: number;
  /** Test pass rate (0 to 1, where 1 = all tests pass) */
  testPassRate: number;
  /** Percentage of redundant work (0 to 1, where 0 = no redundancy) */
  redundantWorkPct: number;
  /** Architectural coherence rating (0 to 5) */
  architecturalCoherence: number;
  /** Coordination overhead ratio (actual coordination time / total time) */
  coordinationOverheadRatio: number;
}

/**
 * Breakdown of the CES calculation for transparency.
 */
export interface CesBreakdown {
  contradictionScore: number;
  integrationScore: number;
  redundancyScore: number;
  coherenceScore: number;
  overheadPenalty: number;
  weightedComponents: {
    contradiction: number;
    integration: number;
    redundancy: number;
    coherence: number;
    overhead: number;
  };
  totalCes: number;
}

/**
 * Calculate the Coordination Effectiveness Score (CES) per PRD Section 9.2.
 *
 * CES = (w₁ × contradiction_score) + (w₂ × integration_score) + (w₃ × redundancy_score)
 *       + (w₄ × coherence_score) - (w₅ × overhead_penalty)
 *
 * Where:
 * - contradiction_score = 100 - (contradiction_rate × 100)
 * - integration_score = test_pass_rate × 100
 * - redundancy_score = 100 - (redundant_work_% × 100)
 * - coherence_score = (architectural_coherence / 5) × 100
 * - overhead_penalty = max(0, (coordination_overhead_ratio - 0.10)) × 200
 */
export function calculateCes(
  metrics: CesInputMetrics,
  weights: ScoreWeights = WEIGHTS,
): CesBreakdown {
  // Convert raw metrics to 0-100 scores
  const contradictionScore = 100 - metrics.contradictionRate * 100;
  const integrationScore = metrics.testPassRate * 100;
  const redundancyScore = 100 - metrics.redundantWorkPct * 100;
  const coherenceScore = (metrics.architecturalCoherence / 5) * 100;

  // Overhead penalty: kicks in above 10% overhead
  const overheadPenalty =
    Math.max(0, metrics.coordinationOverheadRatio - 0.10) * 200;

  // Weighted sum
  const weightedComponents = {
    contradiction: weights.contradiction * contradictionScore,
    integration: weights.integration * integrationScore,
    redundancy: weights.redundancy * redundancyScore,
    coherence: weights.coherence * coherenceScore,
    overhead: weights.overhead * overheadPenalty,
  };

  const totalCes =
    weightedComponents.contradiction +
    weightedComponents.integration +
    weightedComponents.redundancy +
    weightedComponents.coherence -
    weightedComponents.overhead;

  return {
    contradictionScore,
    integrationScore,
    redundancyScore,
    coherenceScore,
    overheadPenalty,
    weightedComponents,
    totalCes: Math.max(0, Math.min(100, totalCes)),
  };
}

/**
 * Calculate CES from DimensionScore records (as stored in ScoredResults).
 * Maps dimension names to CES input metrics.
 */
export function calculateCesFromScores(
  scores: Record<string, DimensionScore>,
  coordinationOverheadRatio: number,
  weights: ScoreWeights = WEIGHTS,
): CesBreakdown {
  // Map dimension scores (0-100) back to raw metric ranges
  const consistencyScore = scores['consistency']?.value ?? 50;
  const integrationScore = scores['integration']?.value ?? 50;
  const redundancyScore = scores['redundancy']?.value ?? 50;
  const coherenceScore = scores['coherence']?.value ?? 50;

  const metrics: CesInputMetrics = {
    contradictionRate: (100 - consistencyScore) / 100,
    testPassRate: integrationScore / 100,
    redundantWorkPct: (100 - redundancyScore) / 100,
    architecturalCoherence: (coherenceScore / 100) * 5,
    coordinationOverheadRatio,
  };

  return calculateCes(metrics, weights);
}

/**
 * Calculate composite scores for an array of ScoredResults (one scenario/condition pair).
 * Populates the `composite` field on each result.
 */
export function scoreSingleIteration(
  result: ScoredResults,
  coordinationOverheadRatio: number,
  weights: ScoreWeights = WEIGHTS,
): number {
  const breakdown = calculateCesFromScores(
    result.scores,
    coordinationOverheadRatio,
    weights,
  );
  return breakdown.totalCes;
}

/**
 * Aggregate scored results across multiple iterations for a scenario/condition pair (FR-ANL-004).
 */
export function aggregateResults(
  results: ScoredResults[],
): AggregatedResults {
  if (results.length === 0) {
    throw new Error('Cannot aggregate empty results');
  }

  const first = results[0]!;
  const scenario = first.scenario;
  const condition = first.condition;

  // Collect dimension scores across iterations
  const dimensionNames = Object.keys(first.scores);
  const scoreSummaries: Record<string, StatisticalSummary> = {};

  for (const dim of dimensionNames) {
    const values = results.map((r) => r.scores[dim]?.value ?? 0);
    scoreSummaries[dim] = computeSummary(values);
  }

  // Aggregate quantitative metrics
  const metricSummaries = {
    totalTokens: computeSummary(results.map((r) => r.metrics.totalTokens)),
    wallTimeMs: computeSummary(results.map((r) => r.metrics.wallTimeMs)),
    gitChurn: {
      linesAdded: computeSummary(
        results.map((r) => r.metrics.gitChurn.linesAdded),
      ),
      linesRemoved: computeSummary(
        results.map((r) => r.metrics.gitChurn.linesRemoved),
      ),
      filesChanged: computeSummary(
        results.map((r) => r.metrics.gitChurn.filesChanged),
      ),
      reverts: computeSummary(
        results.map((r) => r.metrics.gitChurn.reverts),
      ),
    },
    testsPass: computeSummary(results.map((r) => r.metrics.testsPass)),
    testsFail: computeSummary(results.map((r) => r.metrics.testsFail)),
  };

  const compositeScore = computeSummary(results.map((r) => r.composite));

  return {
    scenario,
    condition,
    iterations: results.length,
    scoreSummaries,
    metricSummaries,
    compositeScore,
  };
}

/**
 * Rank conditions by their aggregated composite scores (FR-ANL-004).
 * Returns sorted array with delta-vs-best and significance indicators.
 */
export function rankConditions(
  aggregated: AggregatedResults[],
): ConditionRanking[] {
  // Sort by composite score descending
  const sorted = [...aggregated].sort(
    (a, b) => b.compositeScore.mean - a.compositeScore.mean,
  );

  const bestScore = sorted[0]?.compositeScore.mean ?? 0;

  return sorted.map((agg, index) => {
    // Determine significance vs next-best using composite scores
    let significance: ConditionRanking['significance'] = 'not-distinguishable';

    if (index > 0) {
      const prev = sorted[index - 1]!;
      // If we have enough data points, use Mann-Whitney comparison
      if (agg.compositeScore.n >= 3 && prev.compositeScore.n >= 3) {
        // Reconstruct approximate values from summary stats for comparison
        // In practice, the caller should provide raw values; here we use the p-value threshold
        const diff = prev.compositeScore.mean - agg.compositeScore.mean;
        const combinedSe = Math.sqrt(
          (prev.compositeScore.standardDeviation ** 2) / prev.compositeScore.n +
          (agg.compositeScore.standardDeviation ** 2) / agg.compositeScore.n,
        );

        if (combinedSe > 0) {
          const z = diff / combinedSe;
          // Approximate p-value from z-score
          const pValue = 2 * (1 - approxNormalCdf(Math.abs(z)));
          if (pValue < 0.05) {
            significance = 'significant';
          } else if (pValue < 0.10) {
            significance = 'suggestive';
          }
        }
      }
    }

    return {
      rank: index + 1,
      condition: agg.condition,
      compositeScore: agg.compositeScore.mean,
      deltaVsBest: agg.compositeScore.mean - bestScore,
      significance,
    };
  });
}

/**
 * Calculate the Overall Twining Efficacy Score (PRD Section 9.2).
 *
 * Efficacy = mean(CES_twining - max(CES_other_conditions)) across scenarios.
 *
 * A positive score means Twining outperforms all alternatives.
 */
export function calculateEfficacyScore(
  aggregated: AggregatedResults[],
  twiningConditionName = 'full-twining',
): number {
  // Group by scenario
  const byScenario = new Map<string, AggregatedResults[]>();
  for (const result of aggregated) {
    const existing = byScenario.get(result.scenario) ?? [];
    existing.push(result);
    byScenario.set(result.scenario, existing);
  }

  const advantages: number[] = [];

  for (const [_scenario, results] of byScenario) {
    const twiningResult = results.find(
      (r) => r.condition === twiningConditionName,
    );
    if (!twiningResult) continue;

    const otherResults = results.filter(
      (r) => r.condition !== twiningConditionName,
    );
    if (otherResults.length === 0) continue;

    const bestOther = Math.max(
      ...otherResults.map((r) => r.compositeScore.mean),
    );
    advantages.push(twiningResult.compositeScore.mean - bestOther);
  }

  if (advantages.length === 0) return 0;

  return advantages.reduce((a, b) => a + b, 0) / advantages.length;
}

/**
 * Generate pairwise comparisons between all condition pairs for each metric.
 */
export function generatePairwiseComparisons(
  aggregated: AggregatedResults[],
  metricName: string,
  getValues: (agg: AggregatedResults) => number[],
): PairwiseComparison[] {
  const comparisons: PairwiseComparison[] = [];

  for (let i = 0; i < aggregated.length; i++) {
    for (let j = i + 1; j < aggregated.length; j++) {
      const a = aggregated[i]!;
      const b = aggregated[j]!;

      const valuesA = getValues(a);
      const valuesB = getValues(b);

      if (valuesA.length >= 2 && valuesB.length >= 2) {
        comparisons.push(
          compareConditions(
            a.condition,
            b.condition,
            metricName,
            valuesA,
            valuesB,
          ),
        );
      }
    }
  }

  return comparisons;
}

/**
 * Quick normal CDF approximation for internal use.
 */
function approxNormalCdf(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;

  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422804014327;
  const p =
    d *
    Math.exp((-absZ * absZ) / 2) *
    (t *
      (0.319381530 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));

  return z > 0 ? 1 - p : p;
}
