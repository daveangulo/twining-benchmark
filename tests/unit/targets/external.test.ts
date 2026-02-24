import { describe, it, expect, vi } from 'vitest';
import { validateExternalConfig } from '../../../src/targets/external/index.js';
import type { ExternalRepoConfig } from '../../../src/types/target.js';

describe('validateExternalConfig', () => {
  const validConfig: ExternalRepoConfig = {
    gitUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    setupCommands: ['npm install'],
    manifest: {
      name: 'test-repo',
      description: 'A test repository',
      decisions: [
        {
          id: 'test-decision',
          description: 'Test decision',
          affectedFiles: ['src/index.ts'],
          expectedPatterns: ['test'],
          antiPatterns: [],
        },
      ],
      moduleDependencies: {},
      baselineTestCoverage: 80,
    },
  };

  it('accepts valid config', () => {
    expect(validateExternalConfig(validConfig)).toHaveLength(0);
  });

  it('rejects missing gitUrl', () => {
    const errors = validateExternalConfig({ ...validConfig, gitUrl: '' });
    expect(errors).toContainEqual(expect.stringContaining('gitUrl'));
  });

  it('rejects missing branch', () => {
    const errors = validateExternalConfig({ ...validConfig, branch: '' });
    expect(errors).toContainEqual(expect.stringContaining('branch'));
  });

  it('rejects missing manifest', () => {
    const config = { ...validConfig } as Record<string, unknown>;
    config['manifest'] = undefined;
    const errors = validateExternalConfig(config as unknown as ExternalRepoConfig);
    expect(errors).toContainEqual(expect.stringContaining('manifest'));
  });
});

describe('ExternalRepoTarget', () => {
  it('can be instantiated with valid config', async () => {
    const { ExternalRepoTarget } = await import('../../../src/targets/external/index.js');
    const config: ExternalRepoConfig = {
      gitUrl: 'https://github.com/example/repo.git',
      branch: 'main',
      setupCommands: [],
      manifest: {
        name: 'test-repo',
        description: 'test',
        decisions: [],
        moduleDependencies: {},
        baselineTestCoverage: 0,
      },
    };

    const target = new ExternalRepoTarget(config);
    expect(target.name).toBe('external-repo');
  });

  it('returns manifest from config', async () => {
    const { ExternalRepoTarget } = await import('../../../src/targets/external/index.js');
    const manifest = {
      name: 'test-repo',
      description: 'test',
      decisions: [],
      moduleDependencies: {},
      baselineTestCoverage: 80,
    };

    const config: ExternalRepoConfig = {
      gitUrl: 'https://github.com/example/repo.git',
      branch: 'main',
      setupCommands: [],
      manifest,
    };

    const target = new ExternalRepoTarget(config);
    expect(target.getGroundTruth()).toEqual(manifest);
  });

  it('setup rejects invalid config', async () => {
    const { ExternalRepoTarget } = await import('../../../src/targets/external/index.js');
    const config: ExternalRepoConfig = {
      gitUrl: '',
      branch: 'main',
      setupCommands: [],
      manifest: {
        name: 'test',
        description: 'test',
        decisions: [],
        moduleDependencies: {},
        baselineTestCoverage: 0,
      },
    };

    const target = new ExternalRepoTarget(config);
    await expect(target.setup()).rejects.toThrow('Invalid external repo config');
  });

  it('validate returns invalid when not set up', async () => {
    const { ExternalRepoTarget } = await import('../../../src/targets/external/index.js');
    const config: ExternalRepoConfig = {
      gitUrl: 'https://github.com/example/repo.git',
      branch: 'main',
      setupCommands: [],
      manifest: {
        name: 'test-repo',
        description: 'test',
        decisions: [],
        moduleDependencies: {},
        baselineTestCoverage: 0,
      },
    };

    const target = new ExternalRepoTarget(config);
    const result = await target.validate();
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('not set up'));
  });

  it('reset throws when not set up', async () => {
    const { ExternalRepoTarget } = await import('../../../src/targets/external/index.js');
    const config: ExternalRepoConfig = {
      gitUrl: 'https://github.com/example/repo.git',
      branch: 'main',
      setupCommands: [],
      manifest: {
        name: 'test-repo',
        description: 'test',
        decisions: [],
        moduleDependencies: {},
        baselineTestCoverage: 0,
      },
    };

    const target = new ExternalRepoTarget(config);
    await expect(target.reset()).rejects.toThrow('not set up');
  });

  it('teardown is idempotent when not set up', async () => {
    const { ExternalRepoTarget } = await import('../../../src/targets/external/index.js');
    const config: ExternalRepoConfig = {
      gitUrl: 'https://github.com/example/repo.git',
      branch: 'main',
      setupCommands: [],
      manifest: {
        name: 'test-repo',
        description: 'test',
        decisions: [],
        moduleDependencies: {},
        baselineTestCoverage: 0,
      },
    };

    const target = new ExternalRepoTarget(config);
    await target.teardown(); // should not throw
    await target.teardown(); // idempotent
  });
});
