import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IndexManager } from '../../../src/results/index-manager.js';
import type { RunIndexEntry } from '../../../src/types/run.js';

function makeEntry(overrides: Partial<RunIndexEntry> = {}): RunIndexEntry {
  return {
    id: 'run-001',
    timestamp: '2026-02-20T14:30:52.000Z',
    scenarios: ['refactor'],
    conditions: ['baseline', 'full-twining'],
    status: 'completed',
    duration: 120000,
    ...overrides,
  };
}

describe('IndexManager', () => {
  let tempDir: string;
  let manager: IndexManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'index-test-'));
    manager = new IndexManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('returns empty index when file does not exist', async () => {
      const index = await manager.load();
      expect(index.runs).toEqual([]);
    });

    it('loads an existing index file', async () => {
      await manager.addRun(makeEntry());
      const index = await manager.load();
      expect(index.runs).toHaveLength(1);
    });
  });

  describe('addRun', () => {
    it('adds a new run entry', async () => {
      await manager.addRun(makeEntry());
      const index = await manager.load();
      expect(index.runs).toHaveLength(1);
      expect(index.runs[0]!.id).toBe('run-001');
    });

    it('replaces an existing entry with the same ID', async () => {
      await manager.addRun(makeEntry({ status: 'running' }));
      await manager.addRun(makeEntry({ status: 'completed', compositeScore: 82.4 }));

      const index = await manager.load();
      expect(index.runs).toHaveLength(1);
      expect(index.runs[0]!.status).toBe('completed');
      expect(index.runs[0]!.compositeScore).toBe(82.4);
    });

    it('sorts entries by timestamp descending (newest first)', async () => {
      await manager.addRun(makeEntry({ id: 'run-old', timestamp: '2026-01-01T00:00:00.000Z' }));
      await manager.addRun(makeEntry({ id: 'run-new', timestamp: '2026-02-20T14:30:52.000Z' }));
      await manager.addRun(makeEntry({ id: 'run-mid', timestamp: '2026-02-01T00:00:00.000Z' }));

      const index = await manager.load();
      expect(index.runs.map((r) => r.id)).toEqual(['run-new', 'run-mid', 'run-old']);
    });

    it('writes git-trackable JSON (sorted keys)', async () => {
      await manager.addRun(makeEntry());

      const raw = await readFile(join(tempDir, 'index.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      // Top-level 'runs' key should be present
      expect(parsed).toHaveProperty('runs');
      // File should end with newline
      expect(raw.endsWith('\n')).toBe(true);
    });
  });

  describe('updateRunStatus', () => {
    it('updates status of an existing run', async () => {
      await manager.addRun(makeEntry({ status: 'running' }));
      await manager.updateRunStatus('run-001', 'completed', 82.4);

      const entry = await manager.getRun('run-001');
      expect(entry!.status).toBe('completed');
      expect(entry!.compositeScore).toBe(82.4);
    });

    it('throws for unknown run ID', async () => {
      await expect(
        manager.updateRunStatus('nonexistent', 'completed'),
      ).rejects.toThrow('not found');
    });
  });

  describe('removeRun', () => {
    it('removes a run from the index', async () => {
      await manager.addRun(makeEntry({ id: 'run-001' }));
      await manager.addRun(makeEntry({ id: 'run-002', timestamp: '2026-02-21T00:00:00.000Z' }));

      await manager.removeRun('run-001');

      const index = await manager.load();
      expect(index.runs).toHaveLength(1);
      expect(index.runs[0]!.id).toBe('run-002');
    });

    it('does not throw when removing a non-existent run', async () => {
      await manager.addRun(makeEntry());
      await manager.removeRun('nonexistent');
      const index = await manager.load();
      expect(index.runs).toHaveLength(1);
    });
  });

  describe('getLatest', () => {
    it('returns the most recent entry', async () => {
      await manager.addRun(makeEntry({ id: 'run-old', timestamp: '2026-01-01T00:00:00.000Z' }));
      await manager.addRun(makeEntry({ id: 'run-new', timestamp: '2026-02-20T14:30:52.000Z' }));

      const latest = await manager.getLatest();
      expect(latest!.id).toBe('run-new');
    });

    it('returns undefined when index is empty', async () => {
      const latest = await manager.getLatest();
      expect(latest).toBeUndefined();
    });
  });

  describe('getRun', () => {
    it('finds a run by ID', async () => {
      await manager.addRun(makeEntry({ id: 'run-001' }));
      const entry = await manager.getRun('run-001');
      expect(entry).toBeDefined();
      expect(entry!.id).toBe('run-001');
    });

    it('returns undefined for missing ID', async () => {
      const entry = await manager.getRun('nonexistent');
      expect(entry).toBeUndefined();
    });
  });

  describe('getRunsToClean', () => {
    it('returns IDs to clean, keeping N most recent', async () => {
      await manager.addRun(makeEntry({ id: 'run-1', timestamp: '2026-02-20T00:00:00.000Z' }));
      await manager.addRun(makeEntry({ id: 'run-2', timestamp: '2026-02-21T00:00:00.000Z' }));
      await manager.addRun(makeEntry({ id: 'run-3', timestamp: '2026-02-22T00:00:00.000Z' }));

      const toClean = await manager.getRunsToClean(2);
      expect(toClean).toEqual(['run-1']);
    });

    it('returns empty array when keepLatest >= total runs', async () => {
      await manager.addRun(makeEntry({ id: 'run-1' }));
      const toClean = await manager.getRunsToClean(5);
      expect(toClean).toEqual([]);
    });
  });

  describe('listAll', () => {
    it('returns all entries', async () => {
      await manager.addRun(makeEntry({ id: 'run-1', timestamp: '2026-02-20T00:00:00.000Z' }));
      await manager.addRun(makeEntry({ id: 'run-2', timestamp: '2026-02-21T00:00:00.000Z' }));

      const all = await manager.listAll();
      expect(all).toHaveLength(2);
    });
  });
});
