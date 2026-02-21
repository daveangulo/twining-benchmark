import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import {
  SyntheticRepoTarget,
  SEEDED_BUGS,
} from '../../../src/targets/synthetic-repo/index.js';
import type { WorkingDirectory } from '../../../src/types/target.js';

describe('SyntheticRepoTarget', () => {
  let target: SyntheticRepoTarget;
  let workingDir: WorkingDirectory | undefined;

  beforeEach(() => {
    target = new SyntheticRepoTarget();
  });

  afterEach(async () => {
    if (workingDir) {
      await workingDir.cleanup();
      workingDir = undefined;
    } else {
      await target.teardown();
    }
  });

  describe('name', () => {
    it('should be "synthetic-repo"', () => {
      expect(target.name).toBe('synthetic-repo');
    });
  });

  describe('setup()', () => {
    it('should create an isolated working directory', async () => {
      workingDir = await target.setup();
      expect(workingDir.path).toBeTruthy();
      expect(existsSync(workingDir.path)).toBe(true);
    });

    it('should initialize a git repository', async () => {
      workingDir = await target.setup();
      expect(existsSync(workingDir.gitDir)).toBe(true);
    });

    it('should have an initial commit', async () => {
      workingDir = await target.setup();
      const git = simpleGit(workingDir.path);
      const log = await git.log();
      expect(log.total).toBeGreaterThanOrEqual(1);
      expect(log.latest?.message).toContain('Initial commit');
    });

    it('should create scenario tags', async () => {
      workingDir = await target.setup();
      const git = simpleGit(workingDir.path);
      const tags = await git.tags();
      expect(tags.all).toContain('scenario/refactor-handoff');
      expect(tags.all).toContain('scenario/architecture-cascade');
      expect(tags.all).toContain('scenario/bug-investigation');
      expect(tags.all).toContain('scenario/multi-session-build');
    });

    it('should copy fixture files to working directory', async () => {
      workingDir = await target.setup();
      const files = await readdir(join(workingDir.path, 'src', 'services'));
      expect(files).toContain('user.service.ts');
      expect(files).toContain('order.service.ts');
      expect(files).toContain('notification.service.ts');
    });

    it('should have package.json with dependencies installed', async () => {
      workingDir = await target.setup();
      expect(existsSync(join(workingDir.path, 'node_modules'))).toBe(true);
      const pkg = JSON.parse(
        await readFile(join(workingDir.path, 'package.json'), 'utf-8'),
      ) as { name: string };
      expect(pkg.name).toBe('taskflow-pro');
    });

    it('should have 15+ files across 4+ directories', async () => {
      workingDir = await target.setup();
      const srcFiles = await collectFiles(join(workingDir.path, 'src'));
      const testFiles = await collectFiles(join(workingDir.path, 'tests'));
      const configFiles = await collectFiles(join(workingDir.path, 'config'));
      const docFiles = await collectFiles(join(workingDir.path, 'docs'));

      const totalFiles =
        srcFiles.length + testFiles.length + configFiles.length + docFiles.length;
      expect(totalFiles).toBeGreaterThanOrEqual(15);

      // At least 4 top-level directories with content
      const dirsWithContent = [srcFiles, testFiles, configFiles, docFiles].filter(
        (files) => files.length > 0,
      );
      expect(dirsWithContent.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('validate()', () => {
    it('should return valid after setup', async () => {
      workingDir = await target.setup();
      const result = await target.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid before setup', async () => {
      const result = await target.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('getGroundTruth()', () => {
    it('should return the architectural manifest', () => {
      const manifest = target.getGroundTruth();
      expect(manifest.name).toBe('taskflow-pro');
      expect(manifest.decisions).toHaveLength(2);
    });

    it('should include repository pattern decision', () => {
      const manifest = target.getGroundTruth();
      const repoDecision = manifest.decisions.find(
        (d) => d.id === 'repository-pattern',
      );
      expect(repoDecision).toBeDefined();
      expect(repoDecision?.affectedFiles.length).toBeGreaterThan(0);
      expect(repoDecision?.expectedPatterns.length).toBeGreaterThan(0);
      expect(repoDecision?.antiPatterns.length).toBeGreaterThan(0);
    });

    it('should include event-driven notifications decision', () => {
      const manifest = target.getGroundTruth();
      const eventDecision = manifest.decisions.find(
        (d) => d.id === 'event-driven-notifications',
      );
      expect(eventDecision).toBeDefined();
      expect(eventDecision?.affectedFiles).toContain('src/events/event-bus.ts');
    });

    it('should include module dependency graph', () => {
      const manifest = target.getGroundTruth();
      expect(
        manifest.moduleDependencies['services/user.service'],
      ).toContain('repositories/user.repository');
      expect(
        manifest.moduleDependencies['services/order.service'],
      ).toContain('events/event-bus');
    });
  });

  describe('getSeededBugs()', () => {
    it('should return at least 2 seeded bugs', () => {
      const bugs = target.getSeededBugs();
      expect(bugs.length).toBeGreaterThanOrEqual(2);
    });

    it('should include pagination off-by-one bug', () => {
      const bugs = target.getSeededBugs();
      const paginationBug = bugs.find(
        (b) => b.id === 'pagination-off-by-one',
      );
      expect(paginationBug).toBeDefined();
      expect(paginationBug?.file).toBe('src/utils/pagination.ts');
    });

    it('should include order total floating-point bug', () => {
      const bugs = target.getSeededBugs();
      const totalBug = bugs.find(
        (b) => b.id === 'order-total-floating-point',
      );
      expect(totalBug).toBeDefined();
      expect(totalBug?.file).toBe('src/models/order.ts');
    });
  });

  describe('reset()', () => {
    it('should restore the repo to initial state', async () => {
      workingDir = await target.setup();
      const git = simpleGit(workingDir.path);

      // Make a change
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(workingDir.path, 'NEW_FILE.txt'), 'test');
      await git.add('.');
      await git.commit('Add test file');

      // Verify change exists
      const logBefore = await git.log();
      expect(logBefore.total).toBe(2);

      // Reset
      await target.reset();

      // Verify reset
      const logAfter = await git.log();
      expect(logAfter.total).toBe(1);
      expect(existsSync(join(workingDir.path, 'NEW_FILE.txt'))).toBe(false);
    });

    it('should throw if not set up', async () => {
      await expect(target.reset()).rejects.toThrow('not set up');
    });
  });

  describe('teardown()', () => {
    it('should clean up the working directory', async () => {
      workingDir = await target.setup();
      const dirPath = workingDir.path;
      expect(existsSync(dirPath)).toBe(true);

      await target.teardown();
      expect(existsSync(dirPath)).toBe(false);
      workingDir = undefined; // prevent afterEach from double-cleaning
    });

    it('should be idempotent', async () => {
      workingDir = await target.setup();
      await target.teardown();
      await expect(target.teardown()).resolves.toBeUndefined();
      workingDir = undefined;
    });
  });

  describe('SEEDED_BUGS export', () => {
    it('should be importable and have correct structure', () => {
      expect(Array.isArray(SEEDED_BUGS)).toBe(true);
      for (const bug of SEEDED_BUGS) {
        expect(typeof bug.id).toBe('string');
        expect(typeof bug.symptom).toBe('string');
        expect(typeof bug.file).toBe('string');
        expect(typeof bug.rootCause).toBe('string');
        expect(typeof bug.correctFix).toBe('string');
      }
    });
  });
});

/**
 * Recursively collect all file paths under a directory.
 */
async function collectFiles(dir: string): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        files.push(...(await collectFiles(fullPath)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return files;
}
