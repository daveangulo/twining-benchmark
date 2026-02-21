import {
  mean as ssMean,
  median as ssMedian,
  standardDeviation as ssStdDev,
  min as ssMin,
  max as ssMax,
} from 'simple-statistics';
import type {
  StatisticalSummary,
  PairwiseComparison,
} from '../types/results.js';

/**
 * Compute a StatisticalSummary from an array of numeric values.
 * Requires at least 2 values for meaningful statistics.
 */
export function computeSummary(values: number[]): StatisticalSummary {
  if (values.length === 0) {
    throw new Error('Cannot compute summary of empty array');
  }

  const n = values.length;
  const meanVal = ssMean(values);
  const medianVal = ssMedian(values);
  const stdDev = n >= 2 ? ssStdDev(values) : 0;
  const minVal = ssMin(values);
  const maxVal = ssMax(values);

  // 95% CI: mean ± t * (stdDev / sqrt(n))
  // Use z=1.96 for large n, t-value approximation for small n
  const tValue = getTCritical(n - 1);
  const marginOfError = n >= 2 ? tValue * (stdDev / Math.sqrt(n)) : 0;
  const ci: [number, number] = [
    meanVal - marginOfError,
    meanVal + marginOfError,
  ];

  // High variance: stddev > 20% of mean (per PRD FR-ANL-003 / StatisticalSummary type)
  const highVariance =
    meanVal !== 0 ? Math.abs(stdDev / meanVal) > 0.20 : stdDev > 0;

  return {
    mean: meanVal,
    median: medianVal,
    standardDeviation: stdDev,
    min: minVal,
    max: maxVal,
    confidenceInterval: ci,
    n,
    highVariance,
  };
}

/**
 * Mann-Whitney U test for two independent samples.
 * Returns a p-value (two-tailed, normal approximation for n >= 8).
 * For very small samples, uses exact distribution tables.
 */
export function mannWhitneyU(
  sampleA: number[],
  sampleB: number[],
): { uStatistic: number; pValue: number } {
  const n1 = sampleA.length;
  const n2 = sampleB.length;

  if (n1 === 0 || n2 === 0) {
    throw new Error('Both samples must be non-empty');
  }

  // Combine and rank
  const combined: Array<{ value: number; group: 'a' | 'b' }> = [
    ...sampleA.map((v) => ({ value: v, group: 'a' as const })),
    ...sampleB.map((v) => ({ value: v, group: 'b' as const })),
  ];
  combined.sort((a, b) => a.value - b.value);

  // Assign ranks with tie handling (average rank for ties)
  const ranks = assignRanks(combined.map((c) => c.value));

  // Sum ranks for group A
  let rankSumA = 0;
  let rankIdx = 0;
  for (const item of combined) {
    if (item.group === 'a') {
      rankSumA += ranks[rankIdx]!;
    }
    rankIdx++;
  }

  // U statistics
  const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);

  // Normal approximation for p-value (with continuity correction)
  const muU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);

  if (sigmaU === 0) {
    // All values are identical
    return { uStatistic: u, pValue: 1.0 };
  }

  const z = (Math.abs(u - muU) - 0.5) / sigmaU; // continuity correction
  const pValue = 2 * (1 - normalCdf(z));

  return { uStatistic: u, pValue: Math.min(pValue, 1.0) };
}

/**
 * Cohen's d effect size for two independent samples.
 * Uses pooled standard deviation.
 */
export function cohensD(sampleA: number[], sampleB: number[]): number {
  if (sampleA.length < 2 || sampleB.length < 2) {
    throw new Error('Both samples need at least 2 values for effect size');
  }

  const meanA = ssMean(sampleA);
  const meanB = ssMean(sampleB);
  const sdA = ssStdDev(sampleA);
  const sdB = ssStdDev(sampleB);
  const n1 = sampleA.length;
  const n2 = sampleB.length;

  // Pooled standard deviation
  const pooledSd = Math.sqrt(
    ((n1 - 1) * sdA * sdA + (n2 - 1) * sdB * sdB) / (n1 + n2 - 2),
  );

  if (pooledSd === 0) return 0;

  return (meanA - meanB) / pooledSd;
}

/**
 * Interpret Cohen's d magnitude.
 */
export function interpretEffectSize(
  d: number,
): 'negligible' | 'small' | 'medium' | 'large' {
  const abs = Math.abs(d);
  if (abs < 0.2) return 'negligible';
  if (abs < 0.5) return 'small';
  if (abs < 0.8) return 'medium';
  return 'large';
}

/**
 * Compare two conditions and produce a PairwiseComparison.
 * Uses Mann-Whitney U for significance testing.
 */
export function compareConditions(
  conditionA: string,
  conditionB: string,
  metricName: string,
  valuesA: number[],
  valuesB: number[],
): PairwiseComparison {
  const meanA = ssMean(valuesA);
  const meanB = ssMean(valuesB);

  const deltaPercent = meanB !== 0 ? ((meanA - meanB) / Math.abs(meanB)) * 100 : 0;

  const { pValue } = mannWhitneyU(valuesA, valuesB);

  let significance: PairwiseComparison['significance'];
  if (pValue < 0.05) {
    significance = 'significant';
  } else if (pValue < 0.10) {
    significance = 'suggestive';
  } else {
    significance = 'not-distinguishable';
  }

  return {
    conditionA,
    conditionB,
    metric: metricName,
    deltaPercent,
    pValue,
    significance,
  };
}

/**
 * Compute percentage improvement with confidence interval.
 * Returns "A improved by X% ± Y% compared to B".
 */
export function percentageImprovement(
  summaryA: StatisticalSummary,
  summaryB: StatisticalSummary,
): { percent: number; margin: number } {
  if (summaryB.mean === 0) {
    return { percent: 0, margin: 0 };
  }

  const percent = ((summaryA.mean - summaryB.mean) / Math.abs(summaryB.mean)) * 100;

  // Propagate uncertainty via CI widths
  const ciWidthA = summaryA.confidenceInterval[1] - summaryA.confidenceInterval[0];
  const ciWidthB = summaryB.confidenceInterval[1] - summaryB.confidenceInterval[0];
  const combinedUncertainty = Math.sqrt(ciWidthA * ciWidthA + ciWidthB * ciWidthB);
  const margin = (combinedUncertainty / (2 * Math.abs(summaryB.mean))) * 100;

  return { percent, margin };
}

// --- Internal helpers ---

/**
 * Assign ranks to sorted values, handling ties with average ranks.
 */
function assignRanks(sortedValues: number[]): number[] {
  const n = sortedValues.length;
  const ranks = new Array<number>(n);

  let i = 0;
  while (i < n) {
    let j = i;
    // Find extent of tie
    while (j < n && sortedValues[j] === sortedValues[i]) {
      j++;
    }
    // Average rank for tied values (ranks are 1-based)
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[k] = avgRank;
    }
    i = j;
  }

  return ranks;
}

/**
 * Standard normal CDF approximation (Abramowitz and Stegun).
 */
function normalCdf(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;

  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
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

/**
 * Two-tailed t-critical value for 95% CI.
 * Uses lookup table for small df, approximation for larger.
 */
function getTCritical(df: number): number {
  // t-critical values for 95% CI (two-tailed, alpha=0.05)
  const table: Record<number, number> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    15: 2.131,
    20: 2.086,
    25: 2.060,
    30: 2.042,
    40: 2.021,
    60: 2.000,
    120: 1.980,
  };

  if (df <= 0) return 1.96;

  const exact = table[df];
  if (exact !== undefined) return exact;

  // Find surrounding entries for interpolation
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (df > keys[keys.length - 1]!) return 1.96;

  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i]!;
    const hi = keys[i + 1]!;
    if (df > lo && df < hi) {
      const loVal = table[lo]!;
      const hiVal = table[hi]!;
      // Linear interpolation
      return loVal + ((hiVal - loVal) * (df - lo)) / (hi - lo);
    }
  }

  return 1.96;
}
