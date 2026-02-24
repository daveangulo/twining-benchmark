import { describe, it, expect } from 'vitest';
import {
  pairedTTest,
  wilcoxonSignedRank,
} from '../../../src/analyzer/statistics.js';

describe('pairedTTest', () => {
  it('detects significant paired difference with known data', () => {
    // Textbook example: before/after treatment
    // Before: [85, 90, 78, 92, 88]  After: [95, 98, 89, 100, 96]
    // Differences: [10, 8, 11, 8, 8], mean diff = 9.0
    const pairs: [number, number][] = [
      [95, 85],
      [98, 90],
      [89, 78],
      [100, 92],
      [96, 88],
    ];

    const result = pairedTTest(pairs);

    // t should be large and positive (A > B consistently)
    expect(result.tStatistic).toBeGreaterThan(5);
    expect(result.pValue).toBeLessThan(0.01);
    expect(result.degreesOfFreedom).toBe(4);
  });

  it('returns high p-value for no paired difference', () => {
    // No systematic difference — differences hover around zero
    const pairs: [number, number][] = [
      [50, 51],
      [52, 50],
      [48, 49],
      [51, 52],
      [49, 48],
    ];

    const result = pairedTTest(pairs);
    expect(result.pValue).toBeGreaterThan(0.3);
  });

  it('handles all-zero differences', () => {
    const pairs: [number, number][] = [
      [10, 10],
      [20, 20],
      [30, 30],
    ];

    const result = pairedTTest(pairs);
    expect(result.tStatistic).toBe(0);
    expect(result.pValue).toBe(1.0);
    expect(result.degreesOfFreedom).toBe(2);
  });

  it('handles identical non-zero differences', () => {
    // All differences are exactly 5
    const pairs: [number, number][] = [
      [15, 10],
      [25, 20],
      [35, 30],
    ];

    const result = pairedTTest(pairs);
    // stdDev = 0, differences all = 5, so t is infinite and p is 0
    expect(result.tStatistic).toBe(Infinity);
    expect(result.pValue).toBe(0.0);
  });

  it('throws for fewer than 2 pairs', () => {
    expect(() => pairedTTest([[1, 2]])).toThrow('at least 2 pairs');
  });

  it('negative t when B > A', () => {
    // Non-constant differences so stdDev > 0
    const pairs: [number, number][] = [
      [10, 22],
      [15, 24],
      [12, 20],
      [8, 19],
      [11, 23],
    ];

    const result = pairedTTest(pairs);
    expect(result.tStatistic).toBeLessThan(0);
    expect(result.pValue).toBeLessThan(0.01);
  });

  it('degrees of freedom = n - 1', () => {
    const pairs: [number, number][] = [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
      [11, 12],
      [13, 14],
    ];

    const result = pairedTTest(pairs);
    expect(result.degreesOfFreedom).toBe(6);
  });
});

describe('wilcoxonSignedRank', () => {
  it('detects significant paired difference', () => {
    // Clear systematic shift
    const pairs: [number, number][] = [
      [95, 85],
      [98, 90],
      [89, 78],
      [100, 92],
      [96, 88],
      [92, 80],
      [97, 87],
      [94, 84],
    ];

    const result = wilcoxonSignedRank(pairs);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.wStatistic).toBeGreaterThanOrEqual(0);
  });

  it('returns high p-value for no systematic difference', () => {
    // Balanced differences: some positive, some negative, approximately equal
    const pairs: [number, number][] = [
      [50, 51],
      [52, 50],
      [48, 49],
      [51, 52],
      [49, 48],
      [53, 51],
      [47, 49],
      [50, 50],
    ];

    const result = wilcoxonSignedRank(pairs);
    expect(result.pValue).toBeGreaterThan(0.1);
  });

  it('handles all-zero differences', () => {
    const pairs: [number, number][] = [
      [10, 10],
      [20, 20],
      [30, 30],
    ];

    const result = wilcoxonSignedRank(pairs);
    expect(result.wStatistic).toBe(0);
    expect(result.pValue).toBe(1.0);
  });

  it('handles ties in ranks', () => {
    // Some equal absolute differences
    const pairs: [number, number][] = [
      [15, 10], // diff = 5
      [25, 20], // diff = 5 (tie)
      [32, 30], // diff = 2
      [18, 13], // diff = 5 (tie)
      [22, 20], // diff = 2 (tie)
    ];

    const result = wilcoxonSignedRank(pairs);
    // All positive differences, so should be significant
    expect(result.wStatistic).toBe(0); // W- = 0 since all positive
    expect(result.pValue).toBeLessThan(0.1);
  });

  it('throws for fewer than 2 pairs', () => {
    expect(() => wilcoxonSignedRank([[1, 2]])).toThrow('at least 2 pairs');
  });

  it('single pair after removing zeros', () => {
    // One zero difference, one non-zero → effectively n=1
    const pairs: [number, number][] = [
      [10, 10], // diff = 0, excluded
      [15, 10], // diff = 5
    ];

    const result = wilcoxonSignedRank(pairs);
    // With n=1, W+ = 1, W- = 0, W = 0
    expect(result.wStatistic).toBe(0);
  });

  it('returns valid zScore', () => {
    const pairs: [number, number][] = [
      [95, 85],
      [98, 90],
      [89, 78],
      [100, 92],
      [96, 88],
      [92, 80],
    ];

    const result = wilcoxonSignedRank(pairs);
    expect(result.zScore).toBeGreaterThanOrEqual(0);
    expect(typeof result.zScore).toBe('number');
    expect(isFinite(result.zScore)).toBe(true);
  });
});
