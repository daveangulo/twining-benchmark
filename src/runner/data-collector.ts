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
 * Path prefixes for infrastructure files that should be filtered
 * out of code-level file change metrics.
 */
const INFRASTRUCTURE_PATH_PREFIXES = ['.twining/', 'node_modules/'];

/**
 * Check whether a file path belongs to infrastructure (not agent code).
 */
function isInfrastructurePath(filePath: string): boolean {
  return INFRASTRUCTURE_PATH_PREFIXES.some(prefix => filePath.startsWith(prefix));
}

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
   * Stage all working directory changes so git diffs capture agent
   * Write/Edit modifications that were never committed.
   * Returns the diff base ref to use.
   */
  private async stageAllChanges(git: ReturnType<typeof simpleGit>, beforeHash: string): Promise<string> {
    await git.add(['-A']);
    return beforeHash === 'initial' ? 'HEAD' : beforeHash;
  }

  /**
   * Unstage everything so the working directory index is clean for
   * subsequent operations.
   */
  private async unstageAll(git: ReturnType<typeof simpleGit>): Promise<void> {
    await git.reset(['HEAD']);
  }

  /**
   * Compute file changes from git diff between two states.
   *
   * Expects changes to already be staged (call stageAllChanges first).
   * Uses --cached to diff the staged index against the baseline commit.
   */
  async computeFileChanges(workingDir: string, beforeHash: string): Promise<FileChange[]> {
    const git = simpleGit(workingDir);
    const fileChanges: FileChange[] = [];

    try {
      const diffBase = await this.stageAllChanges(git, beforeHash);

      const numstat = await git.diff(['--cached', '--numstat', diffBase]);
      const lines = numstat.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;

        const added = parts[0] === '-' ? 0 : parseInt(parts[0] ?? '0', 10);
        const removed = parts[1] === '-' ? 0 : parseInt(parts[1] ?? '0', 10);
        const filePath = parts[2] ?? '';

        fileChanges.push({
          path: filePath,
          changeType: 'modified', // refined below via --name-status
          linesAdded: added,
          linesRemoved: removed,
        });
      }

      // Get the full diff for each file
      for (const fc of fileChanges) {
        try {
          fc.diff = await git.diff(['--cached', diffBase, '--', fc.path]);
        } catch {
          // Diff unavailable for this file
        }
      }

      // Detect change types (added/deleted/modified) using --name-status
      const nameStatus = await git.diff(['--cached', '--name-status', diffBase]);
      const statusLines = nameStatus.trim().split('\n').filter(Boolean);

      for (const line of statusLines) {
        const [status, filePath] = line.split('\t');
        if (!filePath) continue;
        const existing = fileChanges.find(fc => fc.path === filePath);
        if (existing) {
          if (status === 'D') {
            existing.changeType = 'deleted';
          } else if (status === 'A') {
            existing.changeType = 'added';
          }
        }
      }

      await this.unstageAll(git);
    } catch {
      // Git operations failed — return empty
    }

    return fileChanges;
  }

  /**
   * Get the full git diff as a string.
   *
   * Expects changes to already be staged (call stageAllChanges first).
   * Uses --cached to diff the staged index against the baseline commit.
   */
  async getFullDiff(workingDir: string, beforeHash: string): Promise<string> {
    const git = simpleGit(workingDir);
    try {
      const diffBase = await this.stageAllChanges(git, beforeHash);
      const diff = await git.diff(['--cached', diffBase]);
      await this.unstageAll(git);
      return diff;
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
    // Compute file changes from git, splitting infrastructure from code
    const allFileChanges = await this.computeFileChanges(workingDir, beforeHash);
    transcript.fileChanges = allFileChanges.filter(fc => !isInfrastructurePath(fc.path));
    const infraChanges = allFileChanges.filter(fc => isInfrastructurePath(fc.path));
    if (infraChanges.length > 0) {
      transcript.infrastructureFileChanges = infraChanges;
    }

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
   * Commit all current working-directory changes as a checkpoint between
   * agent sessions.  The next session's `capturePreSessionGitState` will
   * return this new hash, isolating its diff from previous sessions.
   *
   * Returns the new commit hash.
   */
  async commitSessionSnapshot(workingDir: string, sessionId: string): Promise<string> {
    const git = simpleGit(workingDir);
    await git.add(['-A']);
    await git.commit(`benchmark: session ${sessionId} checkpoint`);
    const log = await git.log({ maxCount: 1 });
    return log.latest?.hash ?? 'unknown';
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
