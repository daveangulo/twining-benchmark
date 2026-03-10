import type { ScoreWeights } from '../types/config.js';
import { DEFAULT_SCORE_WEIGHTS as WEIGHTS } from '../types/config.js';
import { normalCdf, mannWhitneyU } from './statistics.js';
import type {
  DimensionScore,
  ScoredResults,
  AggregatedResults,
  StatisticalSummary,
  ConditionRanking,
  PairwiseComparison,
} from '../types/results.js';
import { computeSummary, compareConditions, holmBonferroni } from './statistics.js';

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
 * - overhead_penalty = coordination_overhead_ratio × 100
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

  // Smooth linear penalty — provisional, pending empirical calibration from real runs.
  // See: docs/plans/2026-03-08-benchmark-validity-fixes-design.md
  const overheadPenalty = metrics.coordinationOverheadRatio * 100;

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
    inputTokens: computeSummary(results.map((r) => r.metrics.inputTokens)),
    outputTokens: computeSummary(results.map((r) => r.metrics.outputTokens)),
    cacheReadTokens: computeSummary(results.map((r) => r.metrics.cacheReadTokens)),
    cacheCreationTokens: computeSummary(results.map((r) => r.metrics.cacheCreationTokens)),
    costUsd: computeSummary(results.map((r) => r.metrics.costUsd)),
    wallTimeMs: computeSummary(results.map((r) => r.metrics.wallTimeMs)),
    numTurns: computeSummary(results.map((r) => r.metrics.numTurns)),
    compactionCount: computeSummary(results.map((r) => r.metrics.compactionCount)),
    contextUtilization: computeSummary(results.map((r) => r.metrics.contextUtilization)),
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
  rawScores?: Map<string, number[]>,
): ConditionRanking[] {
  // Sort by composite score descending
  const sorted = [...aggregated].sort(
    (a, b) => b.compositeScore.mean - a.compositeScore.mean,
  );

  const bestScore = sorted[0]?.compositeScore.mean ?? 0;

  return sorted.map((agg, index) => {
    // Determine significance vs next-best using composite scores
    let significance: ConditionRanking['significance'] = 'not-distinguishable';
    let zTestPValue: number | undefined;
    let mwPValue: number | undefined;

    if (index > 0) {
      const prev = sorted[index - 1]!;

      // Z-test (reference only, not appropriate for N < 30)
      if (agg.compositeScore.n >= 3 && prev.compositeScore.n >= 3) {
        const diff = prev.compositeScore.mean - agg.compositeScore.mean;
        const combinedSe = Math.sqrt(
          (prev.compositeScore.standardDeviation ** 2) / prev.compositeScore.n +
          (agg.compositeScore.standardDeviation ** 2) / agg.compositeScore.n,
        );

        if (combinedSe > 0) {
          const z = diff / combinedSe;
          zTestPValue = 2 * (1 - normalCdf(Math.abs(z)));
        }
      }

      // Mann-Whitney U (primary) when raw scores are provided
      const prevScores = rawScores?.get(prev.condition);
      const currScores = rawScores?.get(agg.condition);
      if (prevScores && currScores && prevScores.length >= 2 && currScores.length >= 2) {
        const result = mannWhitneyU(prevScores, currScores);
        mwPValue = result.pValue;
      }

      // Determine significance: prefer Mann-Whitney, fall back to z-test
      const primaryPValue = mwPValue ?? zTestPValue;
      if (primaryPValue !== undefined) {
        if (primaryPValue < 0.05) {
          significance = 'significant';
        } else if (primaryPValue < 0.10) {
          significance = 'suggestive';
        }
      }
    }

    return {
      rank: index + 1,
      condition: agg.condition,
      compositeScore: agg.compositeScore.mean,
      deltaVsBest: agg.compositeScore.mean - bestScore,
      significance,
      pValue: mwPValue,
      zTestPValue,
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

  // Apply Holm-Bonferroni correction across all comparisons
  if (comparisons.length > 0) {
    const rawPValues = comparisons.map(c => c.pValue);
    const adjustedPValues = holmBonferroni(rawPValues);
    comparisons.forEach((c, i) => {
      c.adjustedPValue = adjustedPValues[i]!;
      // Re-determine significance from adjusted p-value
      if (c.adjustedPValue < 0.05) {
        c.significance = 'significant';
      } else if (c.adjustedPValue < 0.10) {
        c.significance = 'suggestive';
      } else {
        c.significance = 'not-distinguishable';
      }
    });
  }

  return comparisons;
}

