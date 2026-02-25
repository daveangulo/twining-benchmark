/**
 * External repository adapter (FR-TGT-003).
 *
 * Enables benchmarking against real-world codebases by cloning
 * external git repositories and running setup commands.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';

import type { ITestTarget } from '../target.interface.js';
import type {
  WorkingDirectory,
  ValidationResult,
  ArchitecturalManifest,
  ExternalRepoConfig,
} from '../../types/target.js';

/**
 * Validate external repo configuration.
 */
export function validateExternalConfig(config: ExternalRepoConfig): string[] {
  const errors: string[] = [];
  if (!config.gitUrl || config.gitUrl.length === 0) {
    errors.push('gitUrl is required');
  }
  if (!config.branch || config.branch.length === 0) {
    errors.push('branch is required');
  }
  if (!config.manifest) {
    errors.push('manifest is required');
  }
  return errors;
}

export class ExternalRepoTarget implements ITestTarget {
  readonly name = 'external-repo';

  private config: ExternalRepoConfig;
  private workingDir: string | undefined;
  private cleanupFn: (() => Promise<void>) | undefined;
  private initialCommitHash: string | undefined;

  constructor(config: ExternalRepoConfig) {
    this.config = config;
  }

  async setup(): Promise<WorkingDirectory> {
    const errors = validateExternalConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Invalid external repo config: ${errors.join(', ')}`);
    }

    const tmpDir = await mkdtemp(join(tmpdir(), 'twining-ext-'));
    this.workingDir = tmpDir;

    // Clone the repository
    const git = simpleGit();
    await git.clone(this.config.gitUrl, tmpDir, [
      '--branch',
      this.config.branch,
      '--single-branch',
      '--depth',
      '1',
    ]);

    // Configure git in cloned repo
    const repoGit = simpleGit(tmpDir);
    await repoGit.addConfig('user.email', 'benchmark@twining-bench.local');
    await repoGit.addConfig('user.name', 'Twining Benchmark');
    await repoGit.addConfig('commit.gpgsign', 'false');

    // Run setup commands sequentially using shell to handle quoted args
    for (const cmd of this.config.setupCommands) {
      if (!cmd.trim()) continue;

      await execa(cmd, {
        cwd: tmpDir,
        timeout: 300_000, // 5 minute timeout per command
        stdio: 'pipe',
        shell: true,
      });
    }

    // Commit the post-setup state as clean baseline
    const status = await repoGit.status();
    if (status.modified.length > 0 || status.not_added.length > 0) {
      await repoGit.add('.');
      await repoGit.commit('Benchmark baseline: post-setup state');
    }

    // Store the commit hash to reset to (post-setup baseline)
    const log = await repoGit.log();
    this.initialCommitHash = log.latest?.hash;

    this.cleanupFn = async () => {
      await rm(tmpDir, { recursive: true, force: true });
    };

    return {
      path: tmpDir,
      gitDir: join(tmpDir, '.git'),
      cleanup: this.cleanupFn,
    };
  }

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

    // Verify git repo is valid
    try {
      const git = simpleGit(this.workingDir);
      await git.status();
    } catch {
      errors.push('Git repository is not valid');
    }

    // Check manifest structure
    if (!this.config.manifest.name) {
      warnings.push('Manifest missing name');
    }
    if (this.config.manifest.decisions.length === 0) {
      warnings.push('Manifest has no architectural decisions');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  getGroundTruth(): ArchitecturalManifest {
    return structuredClone(this.config.manifest);
  }

  async reset(): Promise<void> {
    if (!this.workingDir) {
      throw new Error('Target not set up. Call setup() first.');
    }

    const git = simpleGit(this.workingDir);
    await git.checkout('.');
    await git.clean('f', ['-d']);

    // Reset to the post-setup baseline commit, discarding any agent commits
    if (this.initialCommitHash) {
      await git.reset(['--hard', this.initialCommitHash]);
    }
  }

  async teardown(): Promise<void> {
    if (this.cleanupFn) {
      await this.cleanupFn();
      this.cleanupFn = undefined;
      this.workingDir = undefined;
    }
  }
}
