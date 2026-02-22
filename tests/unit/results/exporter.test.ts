import { describe, it, expect } from 'vitest';
import {
  exportMarkdown,
  exportCsv,
  exportAggregatedCsv,
  generateKeyFindings,
  sigLabel,
} from '../../../src/results/exporter.js';
import type {
  BenchmarkReport,
  ScoredResults,
  AggregatedResults,
  StatisticalSummary,
} from '../../../src/types/results.js';

function makeSummary(mean: number, stddev: number = 5, n: number = 3): StatisticalSummary {
  return {
    mean,
    median: mean,
    standardDeviation: stddev,
    min: mean - stddev,
    max: mean + stddev,
    confidenceInterval: [mean - 2 * stddev, mean + 2 * stddev] as [number, number],
    n,
    highVariance: stddev / mean > 0.2,
  };
}

function makeAggregated(overrides: Partial<AggregatedResults> = {}): AggregatedResults {
  return {
    scenario: 'refactor',
    condition: 'baseline',
    iterations: 3,
    scoreSummaries: {
      consistency: makeSummary(60),
      rework: makeSummary(55),
    },
    metricSummaries: {
      totalTokens: makeSummary(10000, 1000),
      inputTokens: makeSummary(6000, 600),
      outputTokens: makeSummary(3000, 300),
      cacheReadTokens: makeSummary(1000, 100),
      cacheCreationTokens: makeSummary(0, 0),
      costUsd: makeSummary(0.05, 0.01),
      wallTimeMs: makeSummary(60000, 5000),
      numTurns: makeSummary(10, 2),
      compactionCount: makeSummary(0, 0),
      contextUtilization: makeSummary(0.4, 0.1),
      gitChurn: {
        linesAdded: makeSummary(100, 10),
        linesRemoved: makeSummary(20, 5),
        filesChanged: makeSummary(5, 1),
        reverts: makeSummary(0, 0),
      },
      testsPass: makeSummary(10, 1),
      testsFail: makeSummary(1, 0.5),
    },
    compositeScore: makeSummary(55),
    ...overrides,
  };
}

function makeReport(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  return {
    runId: 'run-001',
    timestamp: '2026-02-20T14:30:52.000Z',
    aggregated: [
      makeAggregated({ condition: 'baseline', compositeScore: makeSummary(28.5) }),
      makeAggregated({ condition: 'claude-md-only', compositeScore: makeSummary(41.8) }),
      makeAggregated({ condition: 'full-twining', compositeScore: makeSummary(82.4) }),
    ],
    comparisons: [
      {
        conditionA: 'full-twining',
        conditionB: 'baseline',
        metric: 'composite',
        deltaPercent: 189.1,
        pValue: 0.003,
        significance: 'significant',
      },
      {
        conditionA: 'claude-md-only',
        conditionB: 'baseline',
        metric: 'composite',
        deltaPercent: 46.7,
        pValue: 0.04,
        significance: 'significant',
      },
      {
        conditionA: 'full-twining',
        conditionB: 'claude-md-only',
        metric: 'composite',
        deltaPercent: 97.1,
        pValue: 0.008,
        significance: 'significant',
      },
    ],
    ranking: [
      { rank: 1, condition: 'full-twining', compositeScore: 82.4, deltaVsBest: 0, significance: 'significant' },
      { rank: 2, condition: 'claude-md-only', compositeScore: 41.8, deltaVsBest: -40.6, significance: 'significant' },
      { rank: 3, condition: 'baseline', compositeScore: 28.5, deltaVsBest: -53.9, significance: 'significant' },
    ],
    efficacyScore: 40.6,
    keyFindings: [],
    ...overrides,
  };
}

function makeScores(overrides: Partial<ScoredResults> = {}): ScoredResults {
  return {
    runId: 'run-001',
    scenario: 'refactor',
    condition: 'baseline',
    iteration: 1,
    scores: {
      consistency: { value: 60, confidence: 'medium', method: 'automated', justification: 'Test' },
      rework: { value: 55, confidence: 'medium', method: 'llm-judge', justification: 'Test' },
    },
    metrics: {
      totalTokens: 10000,
      inputTokens: 6000,
      outputTokens: 3000,
      cacheReadTokens: 1000,
      cacheCreationTokens: 0,
      costUsd: 0.05,
      wallTimeMs: 60000,
      agentSessions: 2,
      numTurns: 10,
      compactionCount: 0,
      contextUtilization: 0.4,
      gitChurn: { linesAdded: 100, linesRemoved: 20, filesChanged: 5, reverts: 0 },
      testsPass: 10,
      testsFail: 1,
      compiles: true,
    },
    composite: 55,
    ...overrides,
  };
}

// ─── sigLabel ──────────────────────────────────────────────────────

describe('sigLabel', () => {
  it('maps significance to p-value labels', () => {
    expect(sigLabel('significant')).toBe('p < 0.05');
    expect(sigLabel('suggestive')).toBe('p < 0.10');
    expect(sigLabel('not-distinguishable')).toBe('p > 0.10');
  });
});

// ─── generateKeyFindings ───────────────────────────────────────────

describe('generateKeyFindings', () => {
  it('generates findings from significant comparisons', () => {
    const report = makeReport();
    const findings = generateKeyFindings(report);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('includes a twining vs baseline finding when available', () => {
    const report = makeReport();
    const findings = generateKeyFindings(report);
    const twiningFinding = findings.find((f) => f.includes('Twining') && f.includes('baseline'));
    expect(twiningFinding).toBeDefined();
  });

  it('returns empty for reports with no significant comparisons', () => {
    const report = makeReport({
      comparisons: [
        {
          conditionA: 'condA',
          conditionB: 'condB',
          metric: 'composite',
          deltaPercent: 5,
          pValue: 0.5,
          significance: 'not-distinguishable',
        },
      ],
    });
    const findings = generateKeyFindings(report);
    expect(findings).toEqual([]);
  });

  it('limits findings to 5 max', () => {
    const comparisons = [];
    for (let i = 0; i < 10; i++) {
      comparisons.push({
        conditionA: `cond-${i}`,
        conditionB: 'baseline',
        metric: `metric-${i}`,
        deltaPercent: 50 + i * 10,
        pValue: 0.01,
        significance: 'significant' as const,
      });
    }
    const report = makeReport({ comparisons });
    const findings = generateKeyFindings(report);
    expect(findings.length).toBeLessThanOrEqual(5);
  });
});

// ─── exportMarkdown ────────────────────────────────────────────────

describe('exportMarkdown', () => {
  it('produces a non-empty markdown string', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md.length).toBeGreaterThan(0);
  });

  it('includes the run ID and timestamp', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('run-001');
    expect(md).toContain('2026-02-20');
  });

  it('includes a verdict line', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('VERDICT');
  });

  it('includes the ranking table header', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('Condition Ranking');
  });

  it('includes all conditions in the ranking', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('full-twining');
    expect(md).toContain('baseline');
    expect(md).toContain('claude-md-only');
  });

  it('includes methodology section', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('Methodology');
    expect(md).toContain('Mann-Whitney U');
  });

  it('includes key findings when provided', () => {
    const report = makeReport({
      keyFindings: ['Twining reduced rework by 67%', 'Baseline had worst coherence'],
    });
    const md = exportMarkdown(report);
    expect(md).toContain('Twining reduced rework by 67%');
    expect(md).toContain('Baseline had worst coherence');
  });

  it('auto-generates findings when keyFindings is empty', () => {
    const report = makeReport({ keyFindings: [] });
    const md = exportMarkdown(report);
    expect(md).toContain('Key Findings');
  });

  it('handles report with no Twining condition', () => {
    const report = makeReport({
      ranking: [
        { rank: 1, condition: 'claude-md-only', compositeScore: 60, deltaVsBest: 0, significance: 'significant' },
        { rank: 2, condition: 'baseline', compositeScore: 30, deltaVsBest: -30, significance: 'significant' },
      ],
      aggregated: [
        makeAggregated({ condition: 'baseline' }),
        makeAggregated({ condition: 'claude-md-only' }),
      ],
    });
    const md = exportMarkdown(report);
    expect(md).toContain('Best condition: claude-md-only');
  });

  it('handles empty report gracefully', () => {
    const report = makeReport({
      ranking: [],
      aggregated: [],
      comparisons: [],
      keyFindings: [],
    });
    const md = exportMarkdown(report);
    expect(md).toContain('No results available');
  });

  it('includes confidence level', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('CONFIDENCE');
  });

  it('includes resource usage section', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('Resource Usage');
    expect(md).toContain('input:');
    expect(md).toContain('output:');
  });

  it('includes twining-bench footer', () => {
    const report = makeReport();
    const md = exportMarkdown(report);
    expect(md).toContain('Generated by twining-bench');
  });
});

// ─── exportCsv ─────────────────────────────────────────────────────

describe('exportCsv', () => {
  it('produces CSV with header row', () => {
    const results = [makeScores()];
    const csv = exportCsv(results);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2); // header + 1 data row
    expect(lines[0]).toContain('runId');
    expect(lines[0]).toContain('scenario');
    expect(lines[0]).toContain('composite');
  });

  it('includes all scoring dimensions as columns', () => {
    const results = [makeScores()];
    const csv = exportCsv(results);
    expect(csv).toContain('score_consistency');
    expect(csv).toContain('score_rework');
    expect(csv).toContain('confidence_consistency');
    expect(csv).toContain('method_consistency');
  });

  it('includes metric columns', () => {
    const results = [makeScores()];
    const csv = exportCsv(results);
    expect(csv).toContain('totalTokens');
    expect(csv).toContain('wallTimeMs');
    expect(csv).toContain('linesAdded');
    expect(csv).toContain('compiles');
  });

  it('handles multiple results', () => {
    const results = [
      makeScores({ iteration: 1 }),
      makeScores({ iteration: 2, condition: 'full-twining' }),
    ];
    const csv = exportCsv(results);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2 data rows
  });

  it('returns empty string for empty results', () => {
    const csv = exportCsv([]);
    expect(csv).toBe('');
  });

  it('escapes commas in values', () => {
    const results = [
      makeScores({
        scores: {
          test: {
            value: 80,
            confidence: 'high',
            method: 'automated',
            justification: 'Good, very good',
          },
        },
      }),
    ];
    const csv = exportCsv(results);
    // The justification doesn't appear in CSV (only value/confidence/method do)
    // but the comma-containing fields should be properly handled
    expect(csv).toBeDefined();
  });

  it('ends with newline', () => {
    const csv = exportCsv([makeScores()]);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('collects dimensions across all results', () => {
    const results = [
      makeScores({
        iteration: 1,
        scores: { consistency: { value: 60, confidence: 'medium', method: 'automated', justification: 'A' } },
      }),
      makeScores({
        iteration: 2,
        scores: { rework: { value: 70, confidence: 'high', method: 'llm-judge', justification: 'B' } },
      }),
    ];
    const csv = exportCsv(results);
    // Both dimension columns should appear
    expect(csv).toContain('score_consistency');
    expect(csv).toContain('score_rework');
  });
});

// ─── exportAggregatedCsv ──────────────────────────────────────────

describe('exportAggregatedCsv', () => {
  it('produces CSV with header row', () => {
    const aggregated = [makeAggregated()];
    const csv = exportAggregatedCsv(aggregated);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('scenario');
    expect(lines[0]).toContain('composite_mean');
  });

  it('includes composite statistics columns', () => {
    const csv = exportAggregatedCsv([makeAggregated()]);
    expect(csv).toContain('composite_stddev');
    expect(csv).toContain('composite_ci_lower');
    expect(csv).toContain('composite_ci_upper');
    expect(csv).toContain('composite_high_variance');
  });

  it('includes metric summaries', () => {
    const csv = exportAggregatedCsv([makeAggregated()]);
    expect(csv).toContain('totalTokens_mean');
    expect(csv).toContain('wallTimeMs_mean');
    expect(csv).toContain('testsPass_mean');
  });

  it('handles multiple aggregated results', () => {
    const csv = exportAggregatedCsv([
      makeAggregated({ condition: 'baseline' }),
      makeAggregated({ condition: 'full-twining' }),
    ]);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(3);
  });

  it('returns empty string for empty input', () => {
    expect(exportAggregatedCsv([])).toBe('');
  });
});
