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

  /**
   * Standard CLAUDE.md content shared by all conditions.
   * Ensures the project guidance baseline is identical across conditions,
   * isolating the coordination mechanism as the only variable.
   */
  protected static readonly BASE_CLAUDE_MD = `# Project Guidelines

## Architecture
- This project follows the repository pattern for data access
- Services depend on repositories, never on each other directly
- Events are preferred over direct cross-service calls for decoupling
- All business logic lives in the service layer

## Coding Conventions
- Use TypeScript strict mode — no \`any\` types
- All public methods must have JSDoc comments
- Use dependency injection via constructor parameters
- Error handling: throw typed errors, never return null for errors
- Prefer async/await over raw Promises

## Testing
- Tests use vitest
- Each module has a corresponding test file in tests/
- Mock external dependencies, test business logic directly
- Minimum: test the happy path and one error path per public method

## File Organization
- src/models/ — Data models and interfaces
- src/repositories/ — Data access layer (implements repository interfaces)
- src/services/ — Business logic layer
- src/events/ — Event definitions and event bus
- src/utils/ — Shared utilities (database, logger, pagination)
- src/config/ — Configuration files
- tests/ — Test files mirroring src/ structure

## Git Practices
- Commit atomically per logical change
- Write descriptive commit messages explaining the "why"
- Run tests before committing
`;

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
