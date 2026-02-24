import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printRunSummary, printComparison, buildReport } from '../../../src/cli/commands/results.js';
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
