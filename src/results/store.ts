import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunMetadata } from '../types/run.js';
import type { ScoredResults } from '../types/results.js';
import type { AgentTranscript } from '../types/transcript.js';

/**
 * Subdirectories within a run's directory (FR-RST-001).
 */
const RUN_SUBDIRS = ['raw', 'scores', 'artifacts'] as const;

/**
 * Serialize JSON with deep key sorting for deterministic, git-trackable output (FR-RST-001).
 */
export function toSortedJson(data: unknown): string {
  return JSON.stringify(data, (_key, value) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value as unknown;
  }, 2) + '\n';
}

/**
 * Results store for reading and writing benchmark results (FR-RST-001).
 *
 * Directory structure:
 *   benchmark-results/
 *     index.json
 *     <run-id>/
 *       metadata.json
 *       raw/          — agent transcripts
 *       scores/       — scored results per iteration
 *       artifacts/    — coordination artifacts
 */
export class ResultsStore {
  constructor(private readonly baseDir: string) {}

  /**
   * Initialize the run directory structure.
   * Creates: <baseDir>/<runId>/metadata.json, raw/, scores/, artifacts/
   */
  async initRun(metadata: RunMetadata): Promise<string> {
    const runDir = this.runDir(metadata.id);
    await mkdir(runDir, { recursive: true });
    for (const sub of RUN_SUBDIRS) {
      await mkdir(join(runDir, sub), { recursive: true });
    }
    await writeFile(join(runDir, 'metadata.json'), toSortedJson(metadata));
    return runDir;
  }

  /**
   * Update a run's metadata (e.g., to mark status change).
   */
  async updateMetadata(metadata: RunMetadata): Promise<void> {
    const metadataPath = join(this.runDir(metadata.id), 'metadata.json');
    await writeFile(metadataPath, toSortedJson(metadata));
  }

  /**
   * Read a run's metadata.
   */
  async getMetadata(runId: string): Promise<RunMetadata> {
    const raw = await readFile(join(this.runDir(runId), 'metadata.json'), 'utf-8');
    return JSON.parse(raw) as RunMetadata;
  }

  /**
   * Save scored results for a single iteration.
   * File: <runId>/scores/<scenario>_<condition>_<iteration>.json
   */
  async saveScores(results: ScoredResults): Promise<void> {
    const filename = `${results.scenario}_${results.condition}_${results.iteration}.json`;
    const filepath = join(this.runDir(results.runId), 'scores', filename);
    await writeFile(filepath, toSortedJson(results));
  }

  /**
   * Load all scored results for a run.
   */
  async loadScores(runId: string): Promise<ScoredResults[]> {
    const scoresDir = join(this.runDir(runId), 'scores');
    const files = await this.listJsonFiles(scoresDir);
    const results: ScoredResults[] = [];
    for (const file of files) {
      const raw = await readFile(join(scoresDir, file), 'utf-8');
      results.push(JSON.parse(raw) as ScoredResults);
    }
    return results;
  }

  /**
   * Load scored results filtered by scenario and/or condition.
   */
  async loadScoresFiltered(
    runId: string,
    scenario?: string,
    condition?: string,
  ): Promise<ScoredResults[]> {
    const all = await this.loadScores(runId);
    return all.filter(
      (r) =>
        (!scenario || r.scenario === scenario) &&
        (!condition || r.condition === condition),
    );
  }

  /**
   * Save an agent session transcript.
   * File: <runId>/raw/<sessionId>.json
   */
  async saveTranscript(transcript: AgentTranscript): Promise<void> {
    const filepath = join(
      this.runDir(transcript.runId),
      'raw',
      `${transcript.sessionId}.json`,
    );
    await writeFile(filepath, toSortedJson(transcript));
  }

  /**
   * Load a specific agent session transcript.
   */
  async loadTranscript(runId: string, sessionId: string): Promise<AgentTranscript> {
    const filepath = join(this.runDir(runId), 'raw', `${sessionId}.json`);
    const raw = await readFile(filepath, 'utf-8');
    return JSON.parse(raw) as AgentTranscript;
  }

  /**
   * Load all transcripts for a run.
   */
  async loadAllTranscripts(runId: string): Promise<AgentTranscript[]> {
    const rawDir = join(this.runDir(runId), 'raw');
    const files = await this.listJsonFiles(rawDir);
    const transcripts: AgentTranscript[] = [];
    for (const file of files) {
      const raw = await readFile(join(rawDir, file), 'utf-8');
      transcripts.push(JSON.parse(raw) as AgentTranscript);
    }
    return transcripts;
  }

  /**
   * Save a coordination artifact snapshot.
   * File: <runId>/artifacts/<label>.json
   */
  async saveArtifact(runId: string, label: string, data: unknown): Promise<void> {
    const filepath = join(this.runDir(runId), 'artifacts', `${label}.json`);
    await writeFile(filepath, toSortedJson(data));
  }

  /**
   * Load a coordination artifact.
   */
  async loadArtifact(runId: string, label: string): Promise<unknown> {
    const filepath = join(this.runDir(runId), 'artifacts', `${label}.json`);
    const raw = await readFile(filepath, 'utf-8');
    return JSON.parse(raw) as unknown;
  }

  /**
   * List all run IDs in the results directory.
   */
  async listRuns(): Promise<string[]> {
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && e.name !== '.gitkeep')
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Check if a run directory exists.
   */
  async hasRun(runId: string): Promise<boolean> {
    try {
      await readFile(join(this.runDir(runId), 'metadata.json'), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a run and all its data (FR-RST-002: clean command).
   */
  async deleteRun(runId: string): Promise<void> {
    await rm(this.runDir(runId), { recursive: true, force: true });
  }

  /**
   * Get the most recent run ID by timestamp.
   */
  async getLatestRunId(): Promise<string | undefined> {
    const runs = await this.listRuns();
    if (runs.length === 0) return undefined;

    let latest: { id: string; timestamp: string } | undefined;
    for (const runId of runs) {
      try {
        const metadata = await this.getMetadata(runId);
        if (!latest || metadata.timestamp > latest.timestamp) {
          latest = { id: metadata.id, timestamp: metadata.timestamp };
        }
      } catch {
        // Skip runs with corrupt metadata
      }
    }
    return latest?.id;
  }

  /**
   * Resolve the path for a run directory.
   */
  runDir(runId: string): string {
    return join(this.baseDir, runId);
  }

  /**
   * Ensure the base results directory exists.
   */
  async ensureBaseDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private async listJsonFiles(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir);
      return entries.filter((f) => f.endsWith('.json')).sort();
    } catch {
      return [];
    }
  }
}
