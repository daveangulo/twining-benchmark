import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type {
  AgentTranscript,
  FileChange,
  CoordinationArtifacts,
  Condition,
} from '../types/index.js';

/**
 * Collected session data bundle.
 * Includes transcript + enrichment data from git and coordination artifacts.
 */
export interface CollectedSessionData {
  transcript: AgentTranscript;
  gitDiff: string;
  coordinationArtifacts: CoordinationArtifacts;
}

/**
 * Options for the data collector.
 */
export interface DataCollectorOptions {
  /** Directory to save collected data */
  outputDir: string;
  /** Run ID for organizing output */
  runId: string;
}

/**
 * DataCollector — captures per-session raw data (FR-RUN-003).
 *
 * Responsibilities:
 * - Git diff capture (before/after each session)
 * - Token count aggregation
 * - Timing data recording
 * - Tool usage logging
 * - Coordination artifact snapshots (start/end state)
 * - Saves all raw data as JSON in the run output directory
 */
export class DataCollector {
  private readonly outputDir: string;
  private readonly runId: string;

  constructor(options: DataCollectorOptions) {
    this.outputDir = options.outputDir;
    this.runId = options.runId;
  }

  /**
   * Capture a git snapshot (commit hash) before a session starts.
   * Returns the current HEAD commit hash.
   */
  async capturePreSessionGitState(workingDir: string): Promise<string> {
    const git = simpleGit(workingDir);
    try {
      const log = await git.log({ maxCount: 1 });
      return log.latest?.hash ?? 'initial';
    } catch {
      return 'initial';
    }
  }

  /**
   * Compute file changes from git diff between two states.
   */
  async computeFileChanges(workingDir: string, beforeHash: string): Promise<FileChange[]> {
    const git = simpleGit(workingDir);
    const fileChanges: FileChange[] = [];

    try {
      const numstatArgs = beforeHash === 'initial'
        ? ['--numstat', 'HEAD']
        : ['--numstat', `${beforeHash}..HEAD`];

      const numstat = await git.diff(numstatArgs);
      const lines = numstat.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;

        const added = parts[0] === '-' ? 0 : parseInt(parts[0] ?? '0', 10);
        const removed = parts[1] === '-' ? 0 : parseInt(parts[1] ?? '0', 10);
        const filePath = parts[2] ?? '';

        let changeType: FileChange['changeType'] = 'modified';
        if (removed === 0 && added > 0) {
          // Could be new file - check with diff-tree
          changeType = 'added';
        }

        fileChanges.push({
          path: filePath,
          changeType,
          linesAdded: added,
          linesRemoved: removed,
        });
      }

      // Get the full diff for each file
      for (const fc of fileChanges) {
        try {
          const patchArgs = beforeHash === 'initial'
            ? ['HEAD', '--', fc.path]
            : [`${beforeHash}..HEAD`, '--', fc.path];
          fc.diff = await git.diff(patchArgs);
        } catch {
          // Diff unavailable for this file
        }
      }

      // Detect deleted files using diff --name-status
      const nameStatusArgs = beforeHash === 'initial'
        ? ['--name-status', 'HEAD']
        : ['--name-status', `${beforeHash}..HEAD`];
      const nameStatus = await git.diff(nameStatusArgs);
      const statusLines = nameStatus.trim().split('\n').filter(Boolean);

      for (const line of statusLines) {
        const [status, filePath] = line.split('\t');
        if (status === 'D' && filePath) {
          const existing = fileChanges.find(fc => fc.path === filePath);
          if (existing) {
            existing.changeType = 'deleted';
          }
        } else if (status === 'A' && filePath) {
          const existing = fileChanges.find(fc => fc.path === filePath);
          if (existing) {
            existing.changeType = 'added';
          }
        }
      }
    } catch {
      // Git operations failed — return empty
    }

    return fileChanges;
  }

  /**
   * Get the full git diff as a string.
   */
  async getFullDiff(workingDir: string, beforeHash: string): Promise<string> {
    const git = simpleGit(workingDir);
    try {
      if (beforeHash === 'initial') {
        return await git.diff(['HEAD']);
      }
      return await git.diff([`${beforeHash}..HEAD`]);
    } catch {
      return '';
    }
  }

  /**
   * Collect coordination artifacts from the condition.
   */
  async collectCoordinationArtifacts(condition: Condition): Promise<CoordinationArtifacts> {
    return condition.collectArtifacts();
  }

  /**
   * Enrich a transcript with git-derived file changes and save.
   */
  async enrichAndSave(
    transcript: AgentTranscript,
    workingDir: string,
    beforeHash: string,
    condition: Condition,
  ): Promise<CollectedSessionData> {
    // Compute file changes from git
    const fileChanges = await this.computeFileChanges(workingDir, beforeHash);
    transcript.fileChanges = fileChanges;

    // Get full diff
    const gitDiff = await this.getFullDiff(workingDir, beforeHash);

    // Collect coordination artifacts
    const coordinationArtifacts = await this.collectCoordinationArtifacts(condition);

    const collected: CollectedSessionData = {
      transcript,
      gitDiff,
      coordinationArtifacts,
    };

    // Save to disk
    await this.saveSessionData(collected);

    return collected;
  }

  /**
   * Save collected session data as JSON files.
   */
  async saveSessionData(data: CollectedSessionData): Promise<void> {
    const sessionDir = join(
      this.outputDir,
      this.runId,
      'sessions',
      data.transcript.sessionId,
    );
    await mkdir(sessionDir, { recursive: true });

    // Save transcript
    await writeFile(
      join(sessionDir, 'transcript.json'),
      JSON.stringify(data.transcript, null, 2),
      'utf-8',
    );

    // Save git diff
    await writeFile(
      join(sessionDir, 'git-diff.patch'),
      data.gitDiff,
      'utf-8',
    );

    // Save coordination artifacts
    await writeFile(
      join(sessionDir, 'coordination-artifacts.json'),
      JSON.stringify(data.coordinationArtifacts, null, 2),
      'utf-8',
    );
  }

  /**
   * Save partial run state for crash recovery (FR-RUN-002).
   */
  async savePartialRunState(
    runId: string,
    completedSessions: CollectedSessionData[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const runDir = join(this.outputDir, runId);
    await mkdir(runDir, { recursive: true });

    await writeFile(
      join(runDir, 'run-state.json'),
      JSON.stringify({
        runId,
        completedSessionCount: completedSessions.length,
        completedSessionIds: completedSessions.map(s => s.transcript.sessionId),
        metadata,
        savedAt: new Date().toISOString(),
      }, null, 2),
      'utf-8',
    );
  }

  /**
   * Load partial run state for resume capability.
   */
  async loadPartialRunState(runId: string): Promise<{
    completedSessionIds: string[];
    metadata: Record<string, unknown>;
  } | null> {
    const statePath = join(this.outputDir, runId, 'run-state.json');
    try {
      const raw = await readFile(statePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        completedSessionIds: string[];
        metadata: Record<string, unknown>;
      };
      return parsed;
    } catch {
      return null;
    }
  }
}
