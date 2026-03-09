import { describe, it, expect } from 'vitest';
import {
  calculateCes,
  calculateCesFromScores,
  scoreSingleIteration,
  aggregateResults,
  rankConditions,
  calculateEfficacyScore,
  generatePairwiseComparisons,
  type CesInputMetrics,
} from '../../../src/analyzer/composite-scorer.js';
import { DEFAULT_SCORE_WEIGHTS } from '../../../src/types/config.js';
import type { ScoredResults, DimensionScore } from '../../../src/types/results.js';

// --- Helpers ---

function makeScoredResult(overrides: Partial<ScoredResults> = {}): ScoredResults {
  return {
    runId: 'test-run',
    scenario: 'test-scenario',
    condition: 'test-condition',
    iteration: 1,
    scores: {
      consistency: { value: 80, confidence: 'high', method: 'llm-judge', justification: '' },
      integration: { value: 90, confidence: 'high', method: 'automated', justification: '' },
      redundancy: { value: 70, confidence: 'medium', method: 'llm-judge', justification: '' },
      coherence: { value: 75, confidence: 'medium', method: 'llm-judge', justification: '' },
    },
    metrics: {
      totalTokens: 100000,
      inputTokens: 80000,
      outputTokens: 20000,
      cacheReadTokens: 10000,
      cacheCreationTokens: 5000,
      costUsd: 0.5,
      wallTimeMs: 30000,
      agentSessions: 3,
      numTurns: 15,
      compactionCount: 0,
      contextUtilization: 0.6,
      gitChurn: { linesAdded: 100, linesRemoved: 20, filesChanged: 5, reverts: 0 },
      testsPass: 10,
      testsFail: 0,
      compiles: true,
    },
    composite: 0, // will be calculated
    ...overrides,
  };
}

describe('calculateCes', () => {
  it('computes correct CES for perfect metrics', () => {
    const metrics: CesInputMetrics = {
      contradictionRate: 0,    // 100
      testPassRate: 1,          // 100
      redundantWorkPct: 0,     // 100
      architecturalCoherence: 5, // 100
      coordinationOverheadRatio: 0, // no penalty
    };

    const result = calculateCes(metrics);

    // All components = 100, weighted sum = 0.25*100 + 0.30*100 + 0.20*100 + 0.15*100 - 0.10*0
    // = 25 + 30 + 20 + 15 = 90
    expect(result.totalCes).toBeCloseTo(90, 0);
    expect(result.contradictionScore).toBe(100);
    expect(result.integrationScore).toBe(100);
    expect(result.redundancyScore).toBe(100);
    expect(result.coherenceScore).toBe(100);
    expect(result.overheadPenalty).toBe(0);
  });

  it('computes correct CES for worst metrics', () => {
    const metrics: CesInputMetrics = {
      contradictionRate: 1,
      testPassRate: 0,
      redundantWorkPct: 1,
      architecturalCoherence: 0,
      coordinationOverheadRatio: 0,
    };

    const result = calculateCes(metrics);
    expect(result.totalCes).toBe(0); // All scores are 0
    expect(result.contradictionScore).toBe(0);
    expect(result.integrationScore).toBe(0);
  });

  it('uses smooth linear overhead penalty without cliff', () => {
    // 8% overhead should produce penalty of 8 (not 0 as old cliff formula)
    const metrics: CesInputMetrics = {
      contradictionRate: 0,
      testPassRate: 1,
      redundantWorkPct: 0,
      architecturalCoherence: 5,
      coordinationOverheadRatio: 0.08,
    };
    const ces = calculateCes(metrics);
    expect(ces.overheadPenalty).toBeCloseTo(8);
  });

  it('smooth linear overhead penalty is proportional at all levels', () => {
    const lowOverhead: CesInputMetrics = {
      contradictionRate: 0,
      testPassRate: 1,
      redundantWorkPct: 0,
      architecturalCoherence: 5,
      coordinationOverheadRatio: 0.05,
    };

    const highOverhead: CesInputMetrics = {
      ...lowOverhead,
      coordinationOverheadRatio: 0.20,
    };

    const resultLow = calculateCes(lowOverhead);
    const resultHigh = calculateCes(highOverhead);

    // 5% overhead = 5 penalty, 20% overhead = 20 penalty
    expect(resultLow.overheadPenalty).toBeCloseTo(5, 0);
    expect(resultHigh.overheadPenalty).toBeCloseTo(20, 0);
    expect(resultHigh.totalCes).toBeLessThan(resultLow.totalCes);
  });

  it('overhead penalty at 10% is 10 (no cliff)', () => {
    const metrics: CesInputMetrics = {
      contradictionRate: 0,
      testPassRate: 1,
      redundantWorkPct: 0,
      architecturalCoherence: 5,
      coordinationOverheadRatio: 0.10,
    };

    const result = calculateCes(metrics);
    expect(result.overheadPenalty).toBeCloseTo(10);
  });

  it('uses custom weights', () => {
    const metrics: CesInputMetrics = {
      contradictionRate: 0,
      testPassRate: 1,
      redundantWorkPct: 0,
      architecturalCoherence: 5,
      coordinationOverheadRatio: 0,
    };

    const equalWeights = {
      contradiction: 0.2,
      integration: 0.2,
      redundancy: 0.2,
      coherence: 0.2,
      overhead: 0.2,
    };

    const result = calculateCes(metrics, equalWeights);
    // All components = 100, equal weights: 0.2*100*4 = 80
    expect(result.totalCes).toBeCloseTo(80, 0);
  });

  it('CES is clamped to [0, 100]', () => {
    // Extreme overhead penalty should not go below 0
    const metrics: CesInputMetrics = {
      contradictionRate: 1,
      testPassRate: 0,
      redundantWorkPct: 1,
      architecturalCoherence: 0,
      coordinationOverheadRatio: 1.0,
    };

    const result = calculateCes(metrics);
    expect(result.totalCes).toBeGreaterThanOrEqual(0);
    expect(result.totalCes).toBeLessThanOrEqual(100);
  });
});

describe('calculateCesFromScores', () => {
  it('maps dimension scores to CES input metrics', () => {
    const scores: Record<string, DimensionScore> = {
      consistency: { value: 80, confidence: 'high', method: 'llm-judge', justification: '' },
      integration: { value: 90, confidence: 'high', method: 'automated', justification: '' },
      redundancy: { value: 70, confidence: 'medium', method: 'llm-judge', justification: '' },
      coherence: { value: 60, confidence: 'medium', method: 'llm-judge', justification: '' },
    };

    const result = calculateCesFromScores(scores, 0.05);

    // Verify the mapping: consistency→contradiction, integration→integration, etc.
    expect(result.contradictionScore).toBeCloseTo(80, 0);
    expect(result.integrationScore).toBeCloseTo(90, 0);
    expect(result.redundancyScore).toBeCloseTo(70, 0);
    expect(result.coherenceScore).toBeCloseTo(60, 0);
    expect(result.overheadPenalty).toBeCloseTo(5); // 5% * 100 = 5
  });

  it('defaults missing dimensions to 50', () => {
    const result = calculateCesFromScores({}, 0);

    expect(result.contradictionScore).toBeCloseTo(50, 0);
    expect(result.integrationScore).toBeCloseTo(50, 0);
  });
});

describe('aggregateResults', () => {
  it('aggregates multiple iterations correctly', () => {
    const results = [
      makeScoredResult({ iteration: 1, composite: 75 }),
      makeScoredResult({ iteration: 2, composite: 80 }),
      makeScoredResult({ iteration: 3, composite: 85 }),
    ];

    const agg = aggregateResults(results);

    expect(agg.scenario).toBe('test-scenario');
    expect(agg.condition).toBe('test-condition');
    expect(agg.iterations).toBe(3);
    expect(agg.compositeScore.mean).toBeCloseTo(80, 0);
    expect(agg.compositeScore.n).toBe(3);
  });

  it('includes metric summaries', () => {
    const results = [
      makeScoredResult({ iteration: 1, composite: 75 }),
      makeScoredResult({ iteration: 2, composite: 80 }),
    ];

    const agg = aggregateResults(results);

    expect(agg.metricSummaries.totalTokens.mean).toBe(100000);
    expect(agg.metricSummaries.costUsd.mean).toBe(0.5);
    expect(agg.metricSummaries.numTurns.mean).toBe(15);
  });

  it('includes score summaries per dimension', () => {
    const results = [
      makeScoredResult({ iteration: 1, composite: 75 }),
      makeScoredResult({ iteration: 2, composite: 80 }),
    ];

    const agg = aggregateResults(results);

    expect(agg.scoreSummaries['consistency']).toBeDefined();
    expect(agg.scoreSummaries['consistency']!.mean).toBe(80);
  });

  it('throws on empty results', () => {
    expect(() => aggregateResults([])).toThrow('Cannot aggregate empty results');
  });
});

describe('rankConditions', () => {
  it('ranks conditions by composite score descending', () => {
    const aggregated = [
      { ...aggregateResults([makeScoredResult({ condition: 'low', composite: 50 })]), condition: 'low' },
      { ...aggregateResults([makeScoredResult({ condition: 'high', composite: 90 })]), condition: 'high' },
      { ...aggregateResults([makeScoredResult({ condition: 'mid', composite: 70 })]), condition: 'mid' },
    ];

    // Override the compositeScore means to match
    aggregated[0]!.compositeScore = { ...aggregated[0]!.compositeScore, mean: 50 };
    aggregated[1]!.compositeScore = { ...aggregated[1]!.compositeScore, mean: 90 };
    aggregated[2]!.compositeScore = { ...aggregated[2]!.compositeScore, mean: 70 };

    const rankings = rankConditions(aggregated);

    expect(rankings[0]!.condition).toBe('high');
    expect(rankings[0]!.rank).toBe(1);
    expect(rankings[0]!.deltaVsBest).toBe(0);

    expect(rankings[1]!.condition).toBe('mid');
    expect(rankings[1]!.rank).toBe(2);

    expect(rankings[2]!.condition).toBe('low');
    expect(rankings[2]!.rank).toBe(3);
    expect(rankings[2]!.deltaVsBest).toBeCloseTo(-40, 0);
  });

  it('produces pValue from Mann-Whitney U when rawScores provided', () => {
    const aggHigh = aggregateResults([
      makeScoredResult({ condition: 'high', composite: 90 }),
      makeScoredResult({ condition: 'high', composite: 92 }),
      makeScoredResult({ condition: 'high', composite: 88 }),
    ]);
    aggHigh.condition = 'high';
    aggHigh.compositeScore = { ...aggHigh.compositeScore, mean: 90 };

    const aggLow = aggregateResults([
      makeScoredResult({ condition: 'low', composite: 50 }),
      makeScoredResult({ condition: 'low', composite: 52 }),
      makeScoredResult({ condition: 'low', composite: 48 }),
    ]);
    aggLow.condition = 'low';
    aggLow.compositeScore = { ...aggLow.compositeScore, mean: 50 };

    const rawScores = new Map<string, number[]>([
      ['high', [90, 92, 88]],
      ['low', [50, 52, 48]],
    ]);

    const rankings = rankConditions([aggHigh, aggLow], rawScores);

    // The lower-ranked condition (index 1) should have a Mann-Whitney pValue
    expect(rankings[1]!.pValue).toBeDefined();
    expect(typeof rankings[1]!.pValue).toBe('number');
    // Best condition (rank 1) has no comparison, so no pValue
    expect(rankings[0]!.pValue).toBeUndefined();
  });

  it('still produces zTestPValue as secondary', () => {
    const aggHigh = aggregateResults([
      makeScoredResult({ condition: 'high', composite: 90 }),
      makeScoredResult({ condition: 'high', composite: 92 }),
      makeScoredResult({ condition: 'high', composite: 88 }),
    ]);
    aggHigh.condition = 'high';
    aggHigh.compositeScore = { ...aggHigh.compositeScore, mean: 90, n: 3, standardDeviation: 2 };

    const aggLow = aggregateResults([
      makeScoredResult({ condition: 'low', composite: 50 }),
      makeScoredResult({ condition: 'low', composite: 52 }),
      makeScoredResult({ condition: 'low', composite: 48 }),
    ]);
    aggLow.condition = 'low';
    aggLow.compositeScore = { ...aggLow.compositeScore, mean: 50, n: 3, standardDeviation: 2 };

    const rawScores = new Map<string, number[]>([
      ['high', [90, 92, 88]],
      ['low', [50, 52, 48]],
    ]);

    const rankings = rankConditions([aggHigh, aggLow], rawScores);

    // Both p-values should be present for the non-best condition
    expect(rankings[1]!.pValue).toBeDefined();
    expect(rankings[1]!.zTestPValue).toBeDefined();
    expect(typeof rankings[1]!.zTestPValue).toBe('number');
  });

  it('determines significance by Mann-Whitney p-value when available', () => {
    // Create two conditions with clearly separated scores so Mann-Whitney gives significant result
    const aggHigh = aggregateResults([
      makeScoredResult({ condition: 'high', composite: 90 }),
      makeScoredResult({ condition: 'high', composite: 92 }),
      makeScoredResult({ condition: 'high', composite: 88 }),
      makeScoredResult({ condition: 'high', composite: 91 }),
      makeScoredResult({ condition: 'high', composite: 89 }),
    ]);
    aggHigh.condition = 'high';
    aggHigh.compositeScore = { ...aggHigh.compositeScore, mean: 90, n: 5, standardDeviation: 1.58 };

    const aggLow = aggregateResults([
      makeScoredResult({ condition: 'low', composite: 50 }),
      makeScoredResult({ condition: 'low', composite: 52 }),
      makeScoredResult({ condition: 'low', composite: 48 }),
      makeScoredResult({ condition: 'low', composite: 51 }),
      makeScoredResult({ condition: 'low', composite: 49 }),
    ]);
    aggLow.condition = 'low';
    aggLow.compositeScore = { ...aggLow.compositeScore, mean: 50, n: 5, standardDeviation: 1.58 };

    const rawScores = new Map<string, number[]>([
      ['high', [90, 92, 88, 91, 89]],
      ['low', [50, 52, 48, 51, 49]],
    ]);

    const rankings = rankConditions([aggHigh, aggLow], rawScores);

    // With completely non-overlapping distributions, Mann-Whitney should yield significance
    expect(rankings[1]!.significance).toBe('significant');
    expect(rankings[1]!.pValue).toBeLessThan(0.05);
  });

  it('falls back to z-test when rawScores not provided', () => {
    const aggHigh = aggregateResults([
      makeScoredResult({ condition: 'high', composite: 90 }),
      makeScoredResult({ condition: 'high', composite: 92 }),
      makeScoredResult({ condition: 'high', composite: 88 }),
    ]);
    aggHigh.condition = 'high';
    aggHigh.compositeScore = { ...aggHigh.compositeScore, mean: 90, n: 3, standardDeviation: 2 };

    const aggLow = aggregateResults([
      makeScoredResult({ condition: 'low', composite: 50 }),
      makeScoredResult({ condition: 'low', composite: 52 }),
      makeScoredResult({ condition: 'low', composite: 48 }),
    ]);
    aggLow.condition = 'low';
    aggLow.compositeScore = { ...aggLow.compositeScore, mean: 50, n: 3, standardDeviation: 2 };

    // No rawScores provided
    const rankings = rankConditions([aggHigh, aggLow]);

    // Should still determine significance via z-test fallback
    expect(rankings[1]!.pValue).toBeUndefined();
    expect(rankings[1]!.zTestPValue).toBeDefined();
    // With mean diff of 40 and small SD, z-test should find significance
    expect(rankings[1]!.significance).toBe('significant');
  });
});

describe('calculateEfficacyScore', () => {
  it('returns positive when twining beats all alternatives', () => {
    const aggregated = [
      (() => {
        const a = aggregateResults([makeScoredResult({ condition: 'full-twining', composite: 85 })]);
        a.condition = 'full-twining';
        a.compositeScore = { ...a.compositeScore, mean: 85 };
        return a;
      })(),
      (() => {
        const a = aggregateResults([makeScoredResult({ condition: 'baseline', composite: 60 })]);
        a.condition = 'baseline';
        a.compositeScore = { ...a.compositeScore, mean: 60 };
        return a;
      })(),
    ];

    const score = calculateEfficacyScore(aggregated);
    expect(score).toBe(25); // 85 - 60
  });

  it('returns negative when twining loses', () => {
    const aggregated = [
      (() => {
        const a = aggregateResults([makeScoredResult({ condition: 'full-twining', composite: 50 })]);
        a.condition = 'full-twining';
        a.compositeScore = { ...a.compositeScore, mean: 50 };
        return a;
      })(),
      (() => {
        const a = aggregateResults([makeScoredResult({ condition: 'baseline', composite: 70 })]);
        a.condition = 'baseline';
        a.compositeScore = { ...a.compositeScore, mean: 70 };
        return a;
      })(),
    ];

    const score = calculateEfficacyScore(aggregated);
    expect(score).toBe(-20); // 50 - 70
  });

  it('returns 0 when no twining condition exists', () => {
    const aggregated = [
      (() => {
        const a = aggregateResults([makeScoredResult({ condition: 'baseline', composite: 60 })]);
        a.condition = 'baseline';
        return a;
      })(),
    ];

    const score = calculateEfficacyScore(aggregated);
    expect(score).toBe(0);
  });

  it('averages advantages across scenarios', () => {
    const aggregated = [
      (() => {
        const a = aggregateResults([makeScoredResult({ scenario: 's1', condition: 'full-twining', composite: 80 })]);
        a.scenario = 's1'; a.condition = 'full-twining';
        a.compositeScore = { ...a.compositeScore, mean: 80 };
        return a;
      })(),
      (() => {
        const a = aggregateResults([makeScoredResult({ scenario: 's1', condition: 'baseline', composite: 60 })]);
        a.scenario = 's1'; a.condition = 'baseline';
        a.compositeScore = { ...a.compositeScore, mean: 60 };
        return a;
      })(),
      (() => {
        const a = aggregateResults([makeScoredResult({ scenario: 's2', condition: 'full-twining', composite: 90 })]);
        a.scenario = 's2'; a.condition = 'full-twining';
        a.compositeScore = { ...a.compositeScore, mean: 90 };
        return a;
      })(),
      (() => {
        const a = aggregateResults([makeScoredResult({ scenario: 's2', condition: 'baseline', composite: 80 })]);
        a.scenario = 's2'; a.condition = 'baseline';
        a.compositeScore = { ...a.compositeScore, mean: 80 };
        return a;
      })(),
    ];

    const score = calculateEfficacyScore(aggregated);
    expect(score).toBe(15); // mean(80-60, 90-80) = mean(20, 10) = 15
  });
});

describe('generatePairwiseComparisons', () => {
  it('generates correct number of comparisons', () => {
    const results1 = [makeScoredResult({ condition: 'a', composite: 80 }), makeScoredResult({ condition: 'a', composite: 85 })];
    const results2 = [makeScoredResult({ condition: 'b', composite: 60 }), makeScoredResult({ condition: 'b', composite: 65 })];
    const results3 = [makeScoredResult({ condition: 'c', composite: 70 }), makeScoredResult({ condition: 'c', composite: 75 })];

    const agg1 = aggregateResults(results1); agg1.condition = 'a';
    const agg2 = aggregateResults(results2); agg2.condition = 'b';
    const agg3 = aggregateResults(results3); agg3.condition = 'c';

    const comparisons = generatePairwiseComparisons(
      [agg1, agg2, agg3],
      'composite',
      (agg) => {
        if (agg.condition === 'a') return [80, 85];
        if (agg.condition === 'b') return [60, 65];
        return [70, 75];
      },
    );

    // C(3,2) = 3 pairwise comparisons
    expect(comparisons).toHaveLength(3);
  });

  it('skips comparisons with fewer than 2 values', () => {
    const agg1 = aggregateResults([makeScoredResult({ condition: 'a', composite: 80 })]);
    agg1.condition = 'a';
    const agg2 = aggregateResults([makeScoredResult({ condition: 'b', composite: 60 })]);
    agg2.condition = 'b';

    const comparisons = generatePairwiseComparisons(
      [agg1, agg2],
      'composite',
      () => [50], // only 1 value — not enough
    );

    expect(comparisons).toHaveLength(0);
  });
});
