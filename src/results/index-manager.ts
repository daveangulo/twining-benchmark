import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunIndex, RunIndexEntry, RunStatus } from '../types/run.js';
import { toSortedJson } from './store.js';

const INDEX_FILENAME = 'index.json';

/**
 * Manages the top-level benchmark-results/index.json registry (FR-RST-001).
 *
 * The index provides a lightweight registry of all runs without
 * needing to read individual run metadata files.
 */
export class IndexManager {
  private readonly indexPath: string;

  constructor(baseDir: string) {
    this.indexPath = join(baseDir, INDEX_FILENAME);
  }

  /**
   * Load the current index. Returns empty index if file doesn't exist.
   */
  async load(): Promise<RunIndex> {
    try {
      const raw = await readFile(this.indexPath, 'utf-8');
      return JSON.parse(raw) as RunIndex;
    } catch {
      return { runs: [] };
    }
  }

  /**
   * Save the index to disk.
   */
  async save(index: RunIndex): Promise<void> {
    await writeFile(this.indexPath, toSortedJson(index));
  }

  /**
   * Add a new run entry to the index.
   * If a run with the same ID exists, it is replaced.
   */
  async addRun(entry: RunIndexEntry): Promise<void> {
    const index = await this.load();
    const existingIdx = index.runs.findIndex((r) => r.id === entry.id);
    if (existingIdx >= 0) {
      index.runs[existingIdx] = entry;
    } else {
      index.runs.push(entry);
    }
    // Sort by timestamp descending (newest first)
    index.runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    await this.save(index);
  }

  /**
   * Update the status and optional composite score of an existing run.
   */
  async updateRunStatus(
    runId: string,
    status: RunStatus,
    compositeScore?: number,
  ): Promise<void> {
    const index = await this.load();
    const entry = index.runs.find((r) => r.id === runId);
    if (!entry) {
      throw new Error(`Run ${runId} not found in index`);
    }
    entry.status = status;
    if (compositeScore !== undefined) {
      entry.compositeScore = compositeScore;
    }
    await this.save(index);
  }

  /**
   * Remove a run from the index.
   */
  async removeRun(runId: string): Promise<void> {
    const index = await this.load();
    index.runs = index.runs.filter((r) => r.id !== runId);
    await this.save(index);
  }

  /**
   * Get the most recent run entry.
   */
  async getLatest(): Promise<RunIndexEntry | undefined> {
    const index = await this.load();
    return index.runs[0];
  }

  /**
   * Get a run entry by ID.
   */
  async getRun(runId: string): Promise<RunIndexEntry | undefined> {
    const index = await this.load();
    return index.runs.find((r) => r.id === runId);
  }

  /**
   * Get the N most recent runs (for clean command, FR-RST-002).
   */
  async getRecentRuns(n: number): Promise<RunIndexEntry[]> {
    const index = await this.load();
    return index.runs.slice(0, n);
  }

  /**
   * Get run IDs that should be cleaned (all except the N most recent).
   */
  async getRunsToClean(keepLatest: number): Promise<string[]> {
    const index = await this.load();
    return index.runs.slice(keepLatest).map((r) => r.id);
  }

  /**
   * Get all run entries.
   */
  async listAll(): Promise<RunIndexEntry[]> {
    const index = await this.load();
    return index.runs;
  }
}
