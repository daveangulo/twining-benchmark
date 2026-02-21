/**
 * Result of validating a target repository.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * An architectural decision or pattern embedded in a target repo.
 * Used as ground truth for scoring.
 */
export interface ArchitecturalDecision {
  /** Short identifier (e.g., "repository-pattern") */
  id: string;
  /** Human-readable description */
  description: string;
  /** Where in the codebase this decision is manifest */
  affectedFiles: string[];
  /** Expected patterns agents should discover/respect */
  expectedPatterns: string[];
  /** Anti-patterns that would indicate the decision was missed */
  antiPatterns: string[];
}

/**
 * Ground truth manifest for a target repository.
 * Documents the known architectural decisions and patterns (FR-TGT-002).
 */
export interface ArchitecturalManifest {
  /** Target repo name */
  name: string;
  /** Brief description of the repo */
  description: string;
  /** Known architectural decisions embedded in the repo */
  decisions: ArchitecturalDecision[];
  /** Module dependency graph (adjacency list) */
  moduleDependencies: Record<string, string[]>;
  /** Expected test coverage baseline */
  baselineTestCoverage: number;
}

/**
 * Working directory handle returned by target setup.
 */
export interface WorkingDirectory {
  /** Absolute path to the working directory */
  path: string;
  /** Git repository reference for operations */
  gitDir: string;
  /** Cleanup function to call when done */
  cleanup: () => Promise<void>;
}

/**
 * Target interface contract.
 * All target types (synthetic, generated, external) must implement this.
 * PRD Section FR-TGT-004.
 */
export interface Target {
  /** Set up the target and return an isolated working directory */
  setup(): Promise<WorkingDirectory>;
  /** Validate the target is in a usable state */
  validate(): Promise<ValidationResult>;
  /** Get the ground truth architectural manifest */
  getGroundTruth(): ArchitecturalManifest;
  /** Reset the target to its initial state */
  reset(): Promise<void>;
  /** Clean up all resources */
  teardown(): Promise<void>;
}

/**
 * Configuration for the programmatic repo generator (FR-TGT-002).
 */
export interface GeneratorConfig {
  /** Number of files to generate (10-100) */
  fileCount: number;
  /** Number of modules (2-10) */
  moduleCount: number;
  /** Depth of dependency chains (1-5) */
  dependencyDepth: number;
  /** Target test coverage percentage (0-100) */
  testCoverage: number;
  /** Level of documentation to include */
  documentationLevel: 'none' | 'minimal' | 'thorough';
  /** Seed for deterministic generation */
  seed: string;
}

/**
 * Configuration for external repository targets (FR-TGT-003).
 */
export interface ExternalRepoConfig {
  /** Git repository URL */
  gitUrl: string;
  /** Branch to check out */
  branch: string;
  /** Shell commands to run for setup */
  setupCommands: string[];
  /** Ground truth manifest for this repo */
  manifest: ArchitecturalManifest;
}
