/**
 * Pre-built synthetic repository target (FR-TGT-001).
 *
 * Provides a purpose-built TypeScript project ("TaskFlow Pro") as the default
 * test target for benchmark scenarios. The project features:
 *
 * - 3-layer architecture: Services → Repositories → Database utilities
 * - Repository pattern for data access (architectural decision #1)
 * - Event-driven notification system (architectural decision #2)
 * - 2 seeded bugs for bug-investigation scenario
 * - Working test suite with full coverage of non-bug paths
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

import type {
  ITestTarget,
  SeededBug,
  ScenarioTag,
} from '../target.interface.js';
import type {
  WorkingDirectory,
  ValidationResult,
  ArchitecturalManifest,
} from '../../types/target.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Path to the fixture files */
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

/** Scenario tags to create in the git repo */
const SCENARIO_TAGS: ScenarioTag[] = [
  {
    name: 'scenario/refactor-handoff',
    description: 'Baseline state for refactoring handoff scenario',
  },
  {
    name: 'scenario/architecture-cascade',
    description: 'Baseline state for architecture decision cascade scenario',
  },
  {
    name: 'scenario/bug-investigation',
    description: 'State with seeded bugs for bug investigation scenario',
  },
  {
    name: 'scenario/multi-session-build',
    description: 'Baseline state for multi-session feature build scenario',
  },
];

/** Known seeded bugs in the synthetic repo */
export const SEEDED_BUGS: SeededBug[] = [
  {
    id: 'pagination-off-by-one',
    symptom:
      'Page 2 of search results shows duplicates from page 1. The last item of page 1 appears as the first item of page 2.',
    file: 'src/utils/pagination.ts',
    rootCause:
      'In the paginate() function, the offset calculation for pages after page 1 is (page - 1) * pageSize - 1, which is one less than the correct offset of (page - 1) * pageSize. This causes an overlap of one item between consecutive pages.',
    correctFix:
      'Change the offset calculation to: const offset = (page - 1) * pageSize; (remove the conditional and the - 1)',
  },
  {
    id: 'order-total-floating-point',
    symptom:
      'Order totals sometimes show unexpected fractional cents (e.g., $3.3000000000000003 instead of $3.30) when orders contain items with decimal prices.',
    file: 'src/models/order.ts',
    rootCause:
      'The calculateOrderTotal() function uses plain floating-point arithmetic (reduce with addition and multiplication) without rounding. IEEE 754 precision errors accumulate across items with decimal prices.',
    correctFix:
      'Round the result to 2 decimal places: return Math.round(items.reduce(...) * 100) / 100;',
  },
];

/**
 * Ground truth manifest for the synthetic repo.
 */
const GROUND_TRUTH: ArchitecturalManifest = {
  name: 'taskflow-pro',
  description:
    'A task and order management system with event-driven notifications, built with a 3-layer architecture using the repository pattern.',
  decisions: [
    {
      id: 'repository-pattern',
      description:
        'All data access uses the Repository pattern. Services depend on repositories (UserRepository, OrderRepository), never on the Database utility directly. BaseRepository provides common CRUD operations.',
      affectedFiles: [
        'src/repositories/base.repository.ts',
        'src/repositories/user.repository.ts',
        'src/repositories/order.repository.ts',
        'src/services/user.service.ts',
        'src/services/order.service.ts',
      ],
      expectedPatterns: [
        'extends BaseRepository',
        'constructor(.*Repository)',
        'this\\..*Repository\\.',
      ],
      antiPatterns: [
        'new Database()',
        'getDatabase()',
        'db\\.insert',
        'db\\.findAll',
      ],
    },
    {
      id: 'event-driven-notifications',
      description:
        'Inter-service communication uses an EventBus. Services emit typed events for significant state changes. The NotificationService listens for events rather than being called directly. No service directly calls another service for side effects.',
      affectedFiles: [
        'src/events/event-bus.ts',
        'src/events/event-types.ts',
        'src/services/order.service.ts',
        'src/services/notification.service.ts',
      ],
      expectedPatterns: [
        'eventBus\\.emit',
        'eventBus\\.on',
        'EventBus',
      ],
      antiPatterns: [
        'notificationService\\.',
        'new NotificationService',
        'import.*NotificationService.*from.*order',
      ],
    },
  ],
  moduleDependencies: {
    'services/user.service': [
      'repositories/user.repository',
      'events/event-bus',
    ],
    'services/order.service': [
      'repositories/order.repository',
      'repositories/user.repository',
      'events/event-bus',
    ],
    'services/notification.service': ['events/event-bus'],
    'repositories/user.repository': [
      'repositories/base.repository',
      'utils/database',
    ],
    'repositories/order.repository': [
      'repositories/base.repository',
      'utils/database',
    ],
    'repositories/base.repository': ['utils/database', 'utils/logger'],
  },
  baselineTestCoverage: 80,
};

export class SyntheticRepoTarget implements ITestTarget {
  readonly name = 'synthetic-repo';

  private workingDir: string | undefined;
  private cleanupFn: (() => Promise<void>) | undefined;

  /**
   * Set up an isolated working directory with the synthetic repo.
   *
   * Creates a temp directory, copies fixtures, installs dependencies,
   * initializes git, and creates scenario tags.
   */
  async setup(): Promise<WorkingDirectory> {
    // Create temp directory
    const tmpDir = await mkdtemp(join(tmpdir(), 'twining-bench-'));
    this.workingDir = tmpDir;

    // Copy fixture files (exclude node_modules — we'll install fresh)
    await cp(FIXTURES_DIR, tmpDir, {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
    });

    // Install dependencies
    const { execa } = await import('execa');
    await execa('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    // Initialize git repo
    const git = simpleGit(tmpDir);
    await git.init();
    await git.addConfig('user.email', 'benchmark@twining-bench.local');
    await git.addConfig('user.name', 'Twining Benchmark');
    await git.addConfig('commit.gpgsign', 'false');
    await git.add('.');
    await git.commit('Initial commit: TaskFlow Pro synthetic repo');

    // Create scenario tags
    for (const tag of SCENARIO_TAGS) {
      await git.addAnnotatedTag(tag.name, tag.description);
    }

    this.cleanupFn = async () => {
      await rm(tmpDir, { recursive: true, force: true });
    };

    return {
      path: tmpDir,
      gitDir: join(tmpDir, '.git'),
      cleanup: this.cleanupFn,
    };
  }

  /**
   * Validate the target repo is in a usable state.
   *
   * Checks that TypeScript compiles and all tests pass.
   */
  async validate(): Promise<ValidationResult> {
    if (!this.workingDir) {
      return {
        valid: false,
        errors: ['Target not set up. Call setup() first.'],
        warnings: [],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const { execa } = await import('execa');

    // Check TypeScript compilation
    try {
      await execa('npx', ['tsc', '--noEmit'], {
        cwd: this.workingDir,
        stdio: 'pipe',
      });
    } catch {
      errors.push('TypeScript compilation failed');
    }

    // Check tests pass
    try {
      await execa('npx', ['vitest', 'run'], {
        cwd: this.workingDir,
        stdio: 'pipe',
      });
    } catch {
      errors.push('Test suite has failures');
    }

    // Check git status
    const git = simpleGit(this.workingDir);
    const status = await git.status();
    if (status.modified.length > 0 || status.not_added.length > 0) {
      warnings.push('Working directory has uncommitted changes');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get the ground truth architectural manifest.
   */
  getGroundTruth(): ArchitecturalManifest {
    return GROUND_TRUTH;
  }

  /**
   * Get the known seeded bugs.
   */
  getSeededBugs(): SeededBug[] {
    return [...SEEDED_BUGS];
  }

  /**
   * Reset the target to its initial state.
   *
   * Uses git to discard all changes and return to the initial commit.
   */
  async reset(): Promise<void> {
    if (!this.workingDir) {
      throw new Error('Target not set up. Call setup() first.');
    }

    const git = simpleGit(this.workingDir);
    await git.checkout('.');
    await git.clean('f', ['-d']);

    // Reset to initial commit (first commit)
    const log = await git.log();
    const initialCommit = log.all[log.all.length - 1];
    if (initialCommit) {
      await git.reset(['--hard', initialCommit.hash]);
    }
  }

  /**
   * Reset to a specific scenario starting state.
   */
  async resetToScenario(scenarioTag: string): Promise<void> {
    if (!this.workingDir) {
      throw new Error('Target not set up. Call setup() first.');
    }

    const git = simpleGit(this.workingDir);
    await git.checkout('.');
    await git.clean('f', ['-d']);

    // Checkout the tagged state
    const tagRef = await git.raw(['rev-parse', scenarioTag]);
    await git.reset(['--hard', tagRef.trim()]);
  }

  /**
   * Clean up all resources.
   */
  async teardown(): Promise<void> {
    if (this.cleanupFn) {
      await this.cleanupFn();
      this.cleanupFn = undefined;
      this.workingDir = undefined;
    }
  }

  /**
   * Get the path to the working directory (if set up).
   */
  getWorkingDir(): string | undefined {
    return this.workingDir;
  }
}
