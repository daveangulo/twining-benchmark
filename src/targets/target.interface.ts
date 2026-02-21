/**
 * ITestTarget — Interface contract for all benchmark test targets.
 *
 * All target types (synthetic, generated, external) must implement this interface.
 * Implementing this interface is sufficient for a target to be usable with all
 * scenarios and conditions in the benchmark harness.
 *
 * PRD Section FR-TGT-004.
 *
 * @example
 * ```typescript
 * class MyTarget implements ITestTarget {
 *   async setup() { ... }
 *   async validate() { ... }
 *   getGroundTruth() { ... }
 *   async reset() { ... }
 *   async teardown() { ... }
 * }
 * ```
 */

import type {
  WorkingDirectory,
  ValidationResult,
  ArchitecturalManifest,
} from '../types/target.js';

export type { WorkingDirectory, ValidationResult, ArchitecturalManifest };

/**
 * Interface contract for benchmark test targets.
 *
 * Lifecycle:
 * 1. `setup()` — Prepare an isolated working directory with the target codebase.
 * 2. `validate()` — Verify the target compiles and tests pass.
 * 3. (Run benchmark scenarios against the target)
 * 4. `reset()` — Restore the target to its initial state between runs.
 * 5. `teardown()` — Clean up all resources (temp dirs, processes, etc.).
 */
export interface ITestTarget {
  /** Unique name identifying this target type */
  readonly name: string;

  /**
   * Set up the target and return an isolated working directory.
   *
   * This should:
   * - Create a temporary directory with a copy of the target codebase
   * - Initialize a git repository with the initial state committed
   * - Install any dependencies needed for the target to compile/test
   * - Return a WorkingDirectory handle for the harness to use
   *
   * @returns A working directory handle with path and cleanup function
   * @throws If setup fails (e.g., missing files, install failure)
   */
  setup(): Promise<WorkingDirectory>;

  /**
   * Validate the target is in a usable state.
   *
   * This should verify:
   * - The codebase compiles without errors
   * - Existing tests pass
   * - Required file structure is present
   * - Dependencies are installed
   *
   * @returns Validation result with errors/warnings
   */
  validate(): Promise<ValidationResult>;

  /**
   * Get the ground truth architectural manifest for this target.
   *
   * The manifest documents the known architectural decisions, patterns,
   * and module dependencies embedded in the target. This is used by
   * the scorer to evaluate whether agents discovered and respected
   * the target's architecture.
   *
   * @returns The architectural manifest (always available, no async needed)
   */
  getGroundTruth(): ArchitecturalManifest;

  /**
   * Reset the target to its initial state.
   *
   * Called between benchmark runs to ensure each run starts from
   * a clean state. Typically implemented as `git checkout` + `git clean`.
   *
   * @throws If reset fails
   */
  reset(): Promise<void>;

  /**
   * Clean up all resources associated with this target.
   *
   * Called after all benchmark runs are complete. Should remove
   * temporary directories, stop any background processes, etc.
   * Must be idempotent — safe to call multiple times.
   */
  teardown(): Promise<void>;
}

/**
 * Scenario-specific starting state tag.
 * Used by targets to create git tags for different scenario starting points.
 */
export interface ScenarioTag {
  /** Tag name (e.g., "scenario/refactor-handoff") */
  name: string;
  /** Human-readable description of this starting state */
  description: string;
}

/**
 * Seeded bug definition for bug-investigation scenarios.
 */
export interface SeededBug {
  /** Unique identifier for the bug */
  id: string;
  /** Human-readable description of the bug's symptom */
  symptom: string;
  /** The file containing the bug */
  file: string;
  /** Description of the root cause */
  rootCause: string;
  /** Description of the correct fix */
  correctFix: string;
}
