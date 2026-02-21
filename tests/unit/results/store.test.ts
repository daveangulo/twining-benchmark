import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResultsStore, toSortedJson } from '../../../src/results/store.js';
import type { RunMetadata } from '../../../src/types/run.js';
import type { ScoredResults } from '../../../src/types/results.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';

function makeMetadata(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
    id: 'run-001',
    timestamp: '2026-02-20T14:30:52.000Z',
    config: {
      targetPath: './targets/synthetic',
      defaultRuns: 3,
      scenarioDirectories: [],
      agentTimeoutMs: 900_000,
      tokenBudgetPerRun: 500_000,
      budgetDollars: 100,
      outputDirectory: './benchmark-results',
      maxTurns: 50,
      retryCount: 0,
      dashboardPort: 3838,
      evaluatorModel: 'claude-sonnet-4-5-20250929',
    },
    scenarios: ['refactor'],
    conditions: ['baseline', 'full-twining'],
    runsPerPair: 3,
    environment: {
      nodeVersion: 'v20.0.0',
      platform: 'darwin',
      claudeModel: 'claude-sonnet-4-5-20250929',
    },
    status: 'running',
    duration: 0,
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
      consistency: {
        value: 75,
        confidence: 'medium',
        method: 'automated',
        justification: 'Test justification',
      },
    },
    metrics: {
      totalTokens: 10000,
      wallTimeMs: 60000,
      agentSessions: 2,
      gitChurn: { linesAdded: 100, linesRemoved: 20, filesChanged: 5, reverts: 0 },
      testsPass: 10,
      testsFail: 1,
      compiles: true,
    },
    composite: 72.5,
    ...overrides,
  };
}

function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'session-001',
    runId: 'run-001',
    scenario: 'refactor',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Refactor the user service',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 5000, output: 3000, total: 8000 },
    timing: {
      startTime: '2026-02-20T14:30:52.000Z',
      endTime: '2026-02-20T14:35:52.000Z',
      durationMs: 300000,
      timeToFirstActionMs: 5000,
    },
    exitReason: 'completed',
    ...overrides,
  };
}

describe('ResultsStore', () => {
  let tempDir: string;
  let store: ResultsStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-test-'));
    store = new ResultsStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('initRun', () => {
    it('creates the run directory with subdirectories', async () => {
      const metadata = makeMetadata();
      const runDir = await store.initRun(metadata);

      const entries = await readdir(runDir);
      expect(entries).toContain('metadata.json');
      expect(entries).toContain('raw');
      expect(entries).toContain('scores');
      expect(entries).toContain('artifacts');
    });

    it('writes metadata as sorted JSON', async () => {
      const metadata = makeMetadata();
      await store.initRun(metadata);

      const raw = await readFile(join(store.runDir('run-001'), 'metadata.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe('run-001');
      expect(parsed.status).toBe('running');

      // Verify sorted keys
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });
  });

  describe('updateMetadata', () => {
    it('updates metadata on disk', async () => {
      const metadata = makeMetadata();
      await store.initRun(metadata);

      metadata.status = 'completed';
      metadata.duration = 120000;
      await store.updateMetadata(metadata);

      const loaded = await store.getMetadata('run-001');
      expect(loaded.status).toBe('completed');
      expect(loaded.duration).toBe(120000);
    });
  });

  describe('scores', () => {
    it('saves and loads scored results', async () => {
      const metadata = makeMetadata();
      await store.initRun(metadata);

      const scores = makeScores();
      await store.saveScores(scores);

      const loaded = await store.loadScores('run-001');
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.composite).toBe(72.5);
      expect(loaded[0]!.condition).toBe('baseline');
    });

    it('loads multiple scored results', async () => {
      const metadata = makeMetadata();
      await store.initRun(metadata);

      await store.saveScores(makeScores({ iteration: 1, condition: 'baseline' }));
      await store.saveScores(makeScores({ iteration: 2, condition: 'baseline' }));
      await store.saveScores(makeScores({ iteration: 1, condition: 'full-twining' }));

      const all = await store.loadScores('run-001');
      expect(all).toHaveLength(3);
    });

    it('filters by scenario and condition', async () => {
      const metadata = makeMetadata();
      await store.initRun(metadata);

      await store.saveScores(makeScores({ condition: 'baseline', iteration: 1 }));
      await store.saveScores(makeScores({ condition: 'full-twining', iteration: 1 }));

      const filtered = await store.loadScoresFiltered('run-001', 'refactor', 'baseline');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.condition).toBe('baseline');
    });
  });

  describe('transcripts', () => {
    it('saves and loads a transcript', async () => {
      await store.initRun(makeMetadata());

      const transcript = makeTranscript();
      await store.saveTranscript(transcript);

      const loaded = await store.loadTranscript('run-001', 'session-001');
      expect(loaded.sessionId).toBe('session-001');
      expect(loaded.prompt).toBe('Refactor the user service');
    });

    it('loads all transcripts', async () => {
      await store.initRun(makeMetadata());

      await store.saveTranscript(makeTranscript({ sessionId: 'session-001' }));
      await store.saveTranscript(makeTranscript({ sessionId: 'session-002' }));

      const all = await store.loadAllTranscripts('run-001');
      expect(all).toHaveLength(2);
    });
  });

  describe('artifacts', () => {
    it('saves and loads artifacts', async () => {
      await store.initRun(makeMetadata());

      const data = { preSessionState: { 'CONTEXT.md': 'hello' }, postSessionState: {} };
      await store.saveArtifact('run-001', 'session1-coordination', data);

      const loaded = await store.loadArtifact('run-001', 'session1-coordination');
      expect(loaded).toEqual(data);
    });
  });

  describe('run management', () => {
    it('lists all runs', async () => {
      await store.initRun(makeMetadata({ id: 'run-001' }));
      await store.initRun(makeMetadata({ id: 'run-002' }));

      const runs = await store.listRuns();
      expect(runs).toEqual(['run-001', 'run-002']);
    });

    it('returns empty list when no runs', async () => {
      const runs = await store.listRuns();
      expect(runs).toEqual([]);
    });

    it('checks if a run exists', async () => {
      await store.initRun(makeMetadata());
      expect(await store.hasRun('run-001')).toBe(true);
      expect(await store.hasRun('nonexistent')).toBe(false);
    });

    it('deletes a run', async () => {
      await store.initRun(makeMetadata());
      expect(await store.hasRun('run-001')).toBe(true);

      await store.deleteRun('run-001');
      expect(await store.hasRun('run-001')).toBe(false);
    });

    it('gets the latest run by timestamp', async () => {
      await store.initRun(makeMetadata({ id: 'run-old', timestamp: '2026-01-01T00:00:00.000Z' }));
      await store.initRun(makeMetadata({ id: 'run-new', timestamp: '2026-02-20T14:30:52.000Z' }));

      const latest = await store.getLatestRunId();
      expect(latest).toBe('run-new');
    });
  });

  describe('ensureBaseDir', () => {
    it('creates the base directory if missing', async () => {
      const nestedDir = join(tempDir, 'nested', 'results');
      const nestedStore = new ResultsStore(nestedDir);
      await nestedStore.ensureBaseDir();

      // Should not throw
      await nestedStore.initRun(makeMetadata());
      expect(await nestedStore.hasRun('run-001')).toBe(true);
    });
  });
});

describe('toSortedJson', () => {
  it('produces sorted keys at all levels', () => {
    const input = { z: 1, a: { c: 3, b: 2 } };
    const result = toSortedJson(input);
    const parsed = JSON.parse(result);

    // Top-level keys should be sorted
    expect(Object.keys(parsed)).toEqual(['a', 'z']);
    // Nested keys should also be sorted
    expect(Object.keys(parsed.a)).toEqual(['b', 'c']);
  });

  it('preserves arrays as-is', () => {
    const input = { items: [3, 1, 2] };
    const result = toSortedJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.items).toEqual([3, 1, 2]);
  });

  it('handles null values', () => {
    const input = { a: null, b: 1 };
    const result = toSortedJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.a).toBeNull();
  });

  it('ends with newline', () => {
    const result = toSortedJson({ a: 1 });
    expect(result.endsWith('\n')).toBe(true);
  });
});
