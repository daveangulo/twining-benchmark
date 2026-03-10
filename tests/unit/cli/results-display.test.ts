import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printRunSummary, printComparison, buildReport } from '../../../src/cli/commands/results.js';
import { buildPrimaryMetricsTable, exportMarkdown } from '../../../src/results/exporter.js';
import type { RunMetadata } from '../../../src/types/run.js';
import type { ScoredResults } from '../../../src/types/results.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';

// --- Helpers ---

function makeMetadata(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
    id: 'test-run-001',
    timestamp: '2026-01-01T00:00:00Z',
    config: DEFAULT_CONFIG,
    scenarios: ['multi-session-build'],
    conditions: ['baseline', 'full-twining'],
    runsPerPair: 3,
    environment: {
      nodeVersion: 'v20.0.0',
      platform: 'darwin',
      claudeModel: 'claude-sonnet-4-5-20250929',
    },
    status: 'completed',
    duration: 60000,
    ...overrides,
  };
}

function makeScoredResult(overrides: Partial<ScoredResults> = {}): ScoredResults {
  return {
    runId: 'test-run-001',
    scenario: 'multi-session-build',
    condition: 'full-twining',
    iteration: 1,
    scores: {
      consistency: { value: 85, confidence: 'high', method: 'llm-judge', justification: '' },
      integration: { value: 90, confidence: 'high', method: 'automated', justification: '' },
      redundancy: { value: 75, confidence: 'medium', method: 'llm-judge', justification: '' },
      coherence: { value: 80, confidence: 'medium', method: 'llm-judge', justification: '' },
    },
    metrics: {
      totalTokens: 150000,
      inputTokens: 120000,
      outputTokens: 30000,
      cacheReadTokens: 20000,
      cacheCreationTokens: 5000,
      costUsd: 0.75,
      wallTimeMs: 45000,
      agentSessions: 3,
      numTurns: 20,
      compactionCount: 1,
      contextUtilization: 0.7,
      gitChurn: { linesAdded: 150, linesRemoved: 30, filesChanged: 8, reverts: 0 },
      testsPass: 15,
      testsFail: 0,
      compiles: true,
    },
    composite: 82.5,
    ...overrides,
  };
}

describe('buildReport', () => {
  it('builds a report from scored results', () => {
    const metadata = makeMetadata();
    const scores = [
      makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
      makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
      makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
      makeScoredResult({ condition: 'baseline', iteration: 2, composite: 62 }),
    ];

    const report = buildReport(metadata, scores);

    expect(report.runId).toBe('test-run-001');
    expect(report.aggregated).toHaveLength(2);
    expect(report.ranking).toHaveLength(2);
    expect(report.ranking[0]!.condition).toBe('full-twining');
    expect(report.efficacyScore).toBeGreaterThan(0);
  });

  it('returns empty report when no scores', () => {
    const report = buildReport(makeMetadata(), []);

    expect(report.aggregated).toHaveLength(0);
    expect(report.ranking).toHaveLength(0);
    expect(report.efficacyScore).toBe(0);
    expect(report.keyFindings).toHaveLength(0);
  });
});

describe('printRunSummary', () => {
  let output: string[] = [];
  const origLog = console.log;

  beforeEach(() => {
    output = [];
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = origLog;
  });

  it('shows "no scored results" when scores are empty', () => {
    printRunSummary(makeMetadata(), []);
    const text = output.join('\n');
    expect(text).toContain('No scored results');
  });

  it('produces full KPI template with VERDICT and CONFIDENCE', () => {
    const scores = [
      makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
      makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
      makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
      makeScoredResult({ condition: 'baseline', iteration: 2, composite: 62 }),
    ];

    printRunSummary(makeMetadata(), scores);
    const text = output.join('\n');

    expect(text).toContain('VERDICT');
    expect(text).toContain('CONFIDENCE');
  });

  it('includes ranking table', () => {
    const scores = [
      makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
      makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
      makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
      makeScoredResult({ condition: 'baseline', iteration: 2, composite: 62 }),
    ];

    printRunSummary(makeMetadata(), scores);
    const text = output.join('\n');

    expect(text).toContain('Condition Ranking');
    expect(text).toContain('full-twining');
    expect(text).toContain('baseline');
  });

  it('includes methodology section', () => {
    const scores = [
      makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
      makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
    ];

    printRunSummary(makeMetadata(), scores);
    const text = output.join('\n');

    expect(text).toContain('Methodology');
  });
});

describe('printComparison', () => {
  let output: string[] = [];
  const origLog = console.log;

  beforeEach(() => {
    output = [];
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = origLog;
  });

  it('shows comparison header', () => {
    const metaA = makeMetadata({ id: 'run-aaa' });
    const metaB = makeMetadata({ id: 'run-bbb' });

    printComparison(metaA, [], metaB, []);
    const text = output.join('\n');

    expect(text).toContain('COMPARISON');
    expect(text).toContain('run-aaa');
    expect(text).toContain('run-bbb');
  });

  it('shows "no scored results" when both empty', () => {
    printComparison(makeMetadata(), [], makeMetadata(), []);
    const text = output.join('\n');

    expect(text).toContain('No scored results');
  });

  it('shows condition ranking comparison when scores available', () => {
    const metaA = makeMetadata({ id: 'run-a' });
    const metaB = makeMetadata({ id: 'run-b' });

    const scoresA = [
      makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 80 }),
      makeScoredResult({ condition: 'baseline', iteration: 1, composite: 55 }),
    ];
    const scoresB = [
      makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
      makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
    ];

    printComparison(metaA, scoresA, metaB, scoresB);
    const text = output.join('\n');

    expect(text).toContain('Condition Rankings');
    expect(text).toContain('full-twining');
    expect(text).toContain('baseline');
  });
});

describe('Primary Metrics', () => {
  describe('buildPrimaryMetricsTable', () => {
    it('returns empty string for empty aggregated results', () => {
      const result = buildPrimaryMetricsTable([], {});
      expect(result).toBe('');
    });

    it('includes Primary Metrics header and column headers', () => {
      const report = buildReport(makeMetadata(), [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
      ]);

      const table = buildPrimaryMetricsTable(report.aggregated, report.conditionSuccessRates);

      expect(table).toContain('Primary Metrics');
      expect(table).toContain('Condition');
      expect(table).toContain('Success');
      expect(table).toContain('Tests');
      expect(table).toContain('Cost');
      expect(table).toContain('Time');
    });

    it('displays correct success rate from conditionSuccessRates', () => {
      const report = buildReport(makeMetadata(), [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
      ]);

      const table = buildPrimaryMetricsTable(report.aggregated, report.conditionSuccessRates);

      // All have compiles: true, so success should be 100%
      expect(table).toContain('100%');
    });

    it('displays test counts as pass/total', () => {
      const report = buildReport(makeMetadata(), [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60,
          metrics: {
            totalTokens: 150000, inputTokens: 120000, outputTokens: 30000,
            cacheReadTokens: 20000, cacheCreationTokens: 5000,
            costUsd: 0.50, wallTimeMs: 30000, agentSessions: 2,
            numTurns: 15, compactionCount: 0, contextUtilization: 0.5,
            gitChurn: { linesAdded: 100, linesRemoved: 20, filesChanged: 5, reverts: 0 },
            testsPass: 10, testsFail: 2, compiles: true,
          },
        }),
      ]);

      const table = buildPrimaryMetricsTable(report.aggregated, report.conditionSuccessRates);

      // full-twining: 15/15, baseline: 10/12
      expect(table).toContain('15/15');
      expect(table).toContain('10/12');
    });

    it('displays cost formatted as dollar amount', () => {
      const report = buildReport(makeMetadata(), [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
      ]);

      const table = buildPrimaryMetricsTable(report.aggregated, report.conditionSuccessRates);

      expect(table).toContain('$0.75');
    });

    it('displays time formatted as Xm Ys', () => {
      const report = buildReport(makeMetadata(), [
        makeScoredResult({
          condition: 'full-twining', iteration: 1, composite: 85,
          metrics: {
            totalTokens: 150000, inputTokens: 120000, outputTokens: 30000,
            cacheReadTokens: 20000, cacheCreationTokens: 5000,
            costUsd: 3.42, wallTimeMs: 323000, agentSessions: 3,
            numTurns: 20, compactionCount: 1, contextUtilization: 0.7,
            gitChurn: { linesAdded: 150, linesRemoved: 30, filesChanged: 8, reverts: 0 },
            testsPass: 12, testsFail: 0, compiles: true,
          },
        }),
      ]);

      const table = buildPrimaryMetricsTable(report.aggregated, report.conditionSuccessRates);

      // 323000ms = 5m 23s
      expect(table).toContain('5m 23s');
    });
  });

  describe('Primary Metrics in printRunSummary output', () => {
    let output: string[] = [];
    const origLog = console.log;

    beforeEach(() => {
      output = [];
      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = origLog;
    });

    it('includes Primary Metrics section in results display', () => {
      const scores = [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
        makeScoredResult({ condition: 'baseline', iteration: 2, composite: 62 }),
      ];

      printRunSummary(makeMetadata(), scores);
      const text = output.join('\n');

      expect(text).toContain('Primary Metrics');
      expect(text).toContain('Success');
      expect(text).toContain('Tests');
      expect(text).toContain('Cost');
      expect(text).toContain('Time');
    });

    it('Primary Metrics appears before Condition Ranking', () => {
      const scores = [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
      ];

      printRunSummary(makeMetadata(), scores);
      const text = output.join('\n');

      const primaryIdx = text.indexOf('Primary Metrics');
      const rankingIdx = text.indexOf('Condition Ranking');
      expect(primaryIdx).toBeGreaterThan(-1);
      expect(rankingIdx).toBeGreaterThan(-1);
      expect(primaryIdx).toBeLessThan(rankingIdx);
    });
  });

  describe('Primary Metrics in markdown export', () => {
    it('includes Primary Metrics section in exported markdown', () => {
      const report = buildReport(makeMetadata(), [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
        makeScoredResult({ condition: 'baseline', iteration: 2, composite: 62 }),
      ]);

      const markdown = exportMarkdown(report);

      expect(markdown).toContain('Primary Metrics');
      expect(markdown).toContain('Success');
      expect(markdown).toContain('Tests');
      expect(markdown).toContain('Cost');
      expect(markdown).toContain('Time');
    });

    it('Primary Metrics appears before Condition Ranking in markdown', () => {
      const report = buildReport(makeMetadata(), [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 60 }),
      ]);

      const markdown = exportMarkdown(report);

      const primaryIdx = markdown.indexOf('Primary Metrics');
      const rankingIdx = markdown.indexOf('Condition Ranking');
      expect(primaryIdx).toBeGreaterThan(-1);
      expect(rankingIdx).toBeGreaterThan(-1);
      expect(primaryIdx).toBeLessThan(rankingIdx);
    });
  });
});
