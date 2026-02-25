import { describe, it, expect } from 'vitest';
import {
  computeSummary,
  mannWhitneyU,
  cohensD,
  interpretEffectSize,
  compareConditions,
  percentageImprovement,
} from '../../../src/analyzer/statistics.js';

describe('computeSummary', () => {
  it('computes correct statistics for a known dataset', () => {
    // Dataset: [2, 4, 4, 4, 5, 5, 7, 9]
    // mean = 5, median = 4.5, sample stddev ≈ 2.138
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const summary = computeSummary(values);

    expect(summary.mean).toBe(5);
    expect(summary.median).toBe(4.5);
    expect(summary.min).toBe(2);
    expect(summary.max).toBe(9);
    expect(summary.n).toBe(8);
    expect(summary.standardDeviation).toBeCloseTo(2.138, 1);
  });

  it('computes correct 95% confidence interval', () => {
    // Known dataset with 10 values, mean=50, sd≈10
    const values = [40, 42, 45, 48, 50, 50, 52, 55, 58, 60];
    const summary = computeSummary(values);

    // CI should be mean ± t * (sd / sqrt(n))
    // df=9, t ≈ 2.262
    const expectedMargin =
      2.262 * (summary.standardDeviation / Math.sqrt(10));
    const expectedLower = summary.mean - expectedMargin;
    const expectedUpper = summary.mean + expectedMargin;

    expect(summary.confidenceInterval[0]).toBeCloseTo(expectedLower, 1);
    expect(summary.confidenceInterval[1]).toBeCloseTo(expectedUpper, 1);
    // CI must contain the mean
    expect(summary.confidenceInterval[0]).toBeLessThan(summary.mean);
    expect(summary.confidenceInterval[1]).toBeGreaterThan(summary.mean);
  });

  it('flags high variance when stddev > 20% of mean', () => {
    // mean=10, stddev=3 → 30% > 20% → high variance
    const highVar = computeSummary([5, 7, 10, 13, 15]);
    expect(highVar.highVariance).toBe(true);

    // mean=100, stddev≈1 → 1% < 20% → low variance
    const lowVar = computeSummary([99, 100, 100, 101, 100]);
    expect(lowVar.highVariance).toBe(false);
  });

  it('handles a single value', () => {
    const summary = computeSummary([42]);
    expect(summary.mean).toBe(42);
    expect(summary.median).toBe(42);
    expect(summary.standardDeviation).toBe(0);
    expect(summary.min).toBe(42);
    expect(summary.max).toBe(42);
    expect(summary.n).toBe(1);
    // Single value: CI is just the value
    expect(summary.confidenceInterval[0]).toBe(42);
    expect(summary.confidenceInterval[1]).toBe(42);
  });

  it('handles two values', () => {
    const summary = computeSummary([10, 20]);
    expect(summary.mean).toBe(15);
    expect(summary.median).toBe(15);
    expect(summary.n).toBe(2);
    // With 2 values and df=1, CI should be wide (t=12.706)
    expect(summary.confidenceInterval[0]).toBeLessThan(summary.mean);
    expect(summary.confidenceInterval[1]).toBeGreaterThan(summary.mean);
  });

  it('throws on empty array', () => {
    expect(() => computeSummary([])).toThrow('empty array');
  });

  it('handles identical values (zero variance)', () => {
    const summary = computeSummary([5, 5, 5, 5, 5]);
    expect(summary.mean).toBe(5);
    expect(summary.standardDeviation).toBe(0);
    expect(summary.highVariance).toBe(false);
    expect(summary.confidenceInterval[0]).toBe(5);
    expect(summary.confidenceInterval[1]).toBe(5);
  });

  it('handles zero mean with nonzero stddev', () => {
    // mean=0, stddev>0 → should flag high variance
    const summary = computeSummary([-1, 0, 1]);
    expect(summary.mean).toBe(0);
    expect(summary.highVariance).toBe(true);
  });

  it('handles negative values', () => {
    const summary = computeSummary([-10, -5, 0, 5, 10]);
    expect(summary.mean).toBe(0);
    expect(summary.min).toBe(-10);
    expect(summary.max).toBe(10);
  });
});

describe('mannWhitneyU', () => {
  it('returns p≈1 for identical samples', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 2, 3, 4, 5];
    const result = mannWhitneyU(a, b);
    expect(result.pValue).toBeGreaterThan(0.5);
  });

  it('returns low p-value for clearly different samples', () => {
    // Two clearly separated groups
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [51, 52, 53, 54, 55, 56, 57, 58, 59, 60];
    const result = mannWhitneyU(a, b);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('computes correct U statistic for a known example', () => {
    // Classic textbook example:
    // Group A: [1, 2, 3] → ranks 1, 2, 3 → sum = 6
    // Group B: [4, 5, 6] → ranks 4, 5, 6 → sum = 15
    // U1 = 6 - 3*4/2 = 0, U2 = 9
    // U = min(0, 9) = 0
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const result = mannWhitneyU(a, b);
    expect(result.uStatistic).toBe(0);
  });

  it('handles ties correctly', () => {
    const a = [1, 2, 2, 3];
    const b = [2, 3, 4, 5];
    const result = mannWhitneyU(a, b);
    // With ties, U should still be computed
    expect(result.uStatistic).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });

  it('returns p=1 for all-identical values', () => {
    const a = [5, 5, 5];
    const b = [5, 5, 5];
    const result = mannWhitneyU(a, b);
    expect(result.pValue).toBe(1.0);
  });

  it('throws for empty samples', () => {
    expect(() => mannWhitneyU([], [1, 2, 3])).toThrow('non-empty');
    expect(() => mannWhitneyU([1, 2, 3], [])).toThrow('non-empty');
  });

  it('is symmetric: U(a,b) produces same p-value as U(b,a)', () => {
    const a = [10, 20, 30];
    const b = [15, 25, 35];
    const result1 = mannWhitneyU(a, b);
    const result2 = mannWhitneyU(b, a);
    expect(result1.pValue).toBeCloseTo(result2.pValue, 10);
    expect(result1.uStatistic).toBe(result2.uStatistic);
  });

  it('handles unequal sample sizes', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [10, 20, 30];
    const result = mannWhitneyU(a, b);
    expect(result.pValue).toBeLessThan(0.1);
  });
});

describe('cohensD', () => {
  it('returns 0 for identical samples', () => {
    const a = [5, 5, 5, 5];
    const b = [5, 5, 5, 5];
    expect(cohensD(a, b)).toBe(0);
  });

  it('computes correct effect size for known example', () => {
    // Group A: [8, 10, 12] → mean=10, sample_sd=2.0
    // Group B: [5, 7, 9]   → mean=7,  sample_sd=2.0
    // Pooled sd (using sample_sd): √((2×4 + 2×4) / 4) = 2.0
    // d = (10-7)/2.0 = 1.5
    const a = [8, 10, 12];
    const b = [5, 7, 9];
    const d = cohensD(a, b);
    expect(d).toBeCloseTo(1.5, 1);
  });

  it('returns negative d when B > A', () => {
    const a = [1, 2, 3];
    const b = [10, 11, 12];
    expect(cohensD(a, b)).toBeLessThan(0);
  });

  it('sign flips when samples are swapped', () => {
    const a = [1, 3, 5, 7];
    const b = [10, 12, 14, 16];
    const d1 = cohensD(a, b);
    const d2 = cohensD(b, a);
    expect(d1).toBeCloseTo(-d2, 10);
  });

  it('throws for samples with fewer than 2 values', () => {
    expect(() => cohensD([1], [2, 3])).toThrow('at least 2');
    expect(() => cohensD([1, 2], [3])).toThrow('at least 2');
  });

  it('handles large effect sizes', () => {
    const a = [100, 101, 102, 103, 104];
    const b = [1, 2, 3, 4, 5];
    const d = cohensD(a, b);
    expect(Math.abs(d)).toBeGreaterThan(2);
  });
});

describe('interpretEffectSize', () => {
  it('classifies negligible effect', () => {
    expect(interpretEffectSize(0)).toBe('negligible');
    expect(interpretEffectSize(0.1)).toBe('negligible');
    expect(interpretEffectSize(-0.15)).toBe('negligible');
  });

  it('classifies small effect', () => {
    expect(interpretEffectSize(0.3)).toBe('small');
    expect(interpretEffectSize(-0.4)).toBe('small');
  });

  it('classifies medium effect', () => {
    expect(interpretEffectSize(0.5)).toBe('medium');
    expect(interpretEffectSize(-0.7)).toBe('medium');
  });

  it('classifies large effect', () => {
    expect(interpretEffectSize(0.8)).toBe('large');
    expect(interpretEffectSize(1.5)).toBe('large');
    expect(interpretEffectSize(-2.0)).toBe('large');
  });
});

describe('compareConditions', () => {
  it('produces a correct PairwiseComparison', () => {
    const result = compareConditions(
      'full-twining',
      'baseline',
      'composite',
      [80, 85, 82, 84, 83],
      [50, 55, 48, 52, 51],
    );

    expect(result.conditionA).toBe('full-twining');
    expect(result.conditionB).toBe('baseline');
    expect(result.metric).toBe('composite');
    expect(result.deltaPercent).toBeGreaterThan(50); // ~60% improvement
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.significance).toBe('significant');
  });

  it('reports not-distinguishable for overlapping distributions', () => {
    const result = compareConditions(
      'condA',
      'condB',
      'metric',
      [50, 52, 48, 51, 49],
      [50, 51, 49, 52, 48],
    );

    expect(result.significance).toBe('not-distinguishable');
    expect(result.pValue).toBeGreaterThan(0.10);
  });

  it('calculates correct delta percent', () => {
    const result = compareConditions(
      'condA',
      'condB',
      'metric',
      [20, 20, 20],
      [10, 10, 10],
    );

    // meanA=20, meanB=10, delta = (20-10)/10 * 100 = 100%
    expect(result.deltaPercent).toBeCloseTo(100, 0);
  });
});

describe('percentageImprovement', () => {
  it('calculates improvement with margin of error', () => {
    const summaryA = computeSummary([80, 82, 84, 86, 88]);
    const summaryB = computeSummary([50, 52, 54, 56, 58]);

    const { percent, margin } = percentageImprovement(summaryA, summaryB);

    // ~55% improvement (84/54 - 1)
    expect(percent).toBeCloseTo(55.6, 0);
    expect(margin).toBeGreaterThan(0);
  });

  it('returns zero when reference mean is zero', () => {
    const summaryA = computeSummary([10, 10, 10]);
    const summaryB = computeSummary([0, 0, 0]);

    const { percent, margin } = percentageImprovement(summaryA, summaryB);
    expect(percent).toBe(0);
    expect(margin).toBe(0);
  });

  it('returns negative for regression', () => {
    const summaryA = computeSummary([30, 32, 28]);
    const summaryB = computeSummary([60, 62, 58]);

    const { percent } = percentageImprovement(summaryA, summaryB);
    expect(percent).toBeLessThan(0); // A is worse than B
  });
});

describe('edge cases and numerical stability', () => {
  it('handles very large values', () => {
    const values = [1e10, 1e10 + 1, 1e10 + 2];
    const summary = computeSummary(values);
    expect(summary.mean).toBeCloseTo(1e10 + 1, -2);
    expect(summary.standardDeviation).toBeCloseTo(1, 0);
  });

  it('handles very small values', () => {
    const values = [1e-10, 2e-10, 3e-10];
    const summary = computeSummary(values);
    expect(summary.mean).toBeCloseTo(2e-10, 20);
  });

  it('Mann-Whitney handles single-element samples', () => {
    const result = mannWhitneyU([1], [100]);
    expect(result.uStatistic).toBe(0);
  });

  it('computeSummary handles many identical values with one outlier', () => {
    const values = [50, 50, 50, 50, 50, 50, 50, 50, 50, 100];
    const summary = computeSummary(values);
    expect(summary.median).toBe(50);
    expect(summary.mean).toBe(55);
    expect(summary.highVariance).toBe(true);
  });
});
