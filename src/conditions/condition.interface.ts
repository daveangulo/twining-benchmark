import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Condition,
  ConditionName,
  ConditionContext,
  AgentConfiguration,
  CoordinationArtifacts,
} from '../types/index.js';

export type { Condition, ConditionName, ConditionContext, AgentConfiguration };

/**
 * Abstract base class for coordination conditions.
 * Implements common lifecycle patterns per FR-CND-007.
 *
 * Subclasses must implement:
 * - doSetup() — create condition-specific files/services
 * - buildAgentConfig() — return the agent configuration
 * - doTeardown() — clean up condition-specific resources
 * - getCoordinationFiles() — return paths to coordination files to track
 */
export abstract class BaseCondition implements Condition {
  abstract readonly name: ConditionName;
  abstract readonly description: string;

  protected workingDir = '';
  protected setupComplete = false;
  protected preSessionSnapshot: Record<string, string> = {};

  async setup(workingDir: string): Promise<ConditionContext> {
    this.workingDir = workingDir;
    const setupFiles = await this.doSetup(workingDir);
    this.setupComplete = true;

    // Capture pre-session state of coordination files
    this.preSessionSnapshot = await this.snapshotCoordinationFiles();

    const agentConfig = this.getAgentConfig();
    return {
      agentConfig,
      setupFiles,
      metadata: { conditionName: this.name },
    };
  }

  getAgentConfig(): AgentConfiguration {
    if (!this.setupComplete) {
      throw new Error(
        `Condition "${this.name}" has not been set up. Call setup() first.`,
      );
    }
    return this.buildAgentConfig();
  }

  async collectArtifacts(): Promise<CoordinationArtifacts> {
    const postSessionState = await this.snapshotCoordinationFiles();
    const changes = Object.keys(postSessionState).filter(
      (path) => postSessionState[path] !== this.preSessionSnapshot[path],
    );

    const artifacts: CoordinationArtifacts = {
      preSessionState: this.preSessionSnapshot,
      postSessionState,
      changes,
    };

    // Update pre-session snapshot for next session
    this.preSessionSnapshot = postSessionState;
    return artifacts;
  }

  async teardown(): Promise<void> {
    if (!this.setupComplete) {
      return; // Idempotent: nothing to tear down
    }
    await this.doTeardown();
    this.setupComplete = false;
    this.workingDir = '';
    this.preSessionSnapshot = {};
  }

  /**
   * Condition-specific setup logic.
   * @returns List of files created/modified during setup.
   */
  protected abstract doSetup(workingDir: string): Promise<string[]>;

  /** Build the agent configuration for this condition. */
  protected abstract buildAgentConfig(): AgentConfiguration;

  /** Condition-specific teardown logic. */
  protected abstract doTeardown(): Promise<void>;

  /**
   * Return relative paths (from workingDir) of coordination files to track.
   * Override in subclasses that have coordination files.
   */
  protected getCoordinationFilePaths(): string[] {
    return [];
  }

  private async snapshotCoordinationFiles(): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    for (const relPath of this.getCoordinationFilePaths()) {
      const fullPath = join(this.workingDir, relPath);
      try {
        snapshot[relPath] = await readFile(fullPath, 'utf-8');
      } catch {
        // File doesn't exist yet — that's fine
        snapshot[relPath] = '';
      }
    }
    return snapshot;
  }
}
