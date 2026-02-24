import { describe, it, expect, afterEach } from 'vitest';
import { GeneratedRepoTarget, validateGeneratorConfig } from '../../../src/targets/generator/index.js';
import { SeededRng, seedFromString, createRng } from '../../../src/targets/generator/rng.js';
import type { GeneratorConfig } from '../../../src/types/target.js';

describe('SeededRng', () => {
  it('produces deterministic output for the same seed', () => {
    const rng1 = new SeededRng('test-seed');
    const rng2 = new SeededRng('test-seed');

    const seq1 = Array.from({ length: 10 }, () => rng1.random());
    const seq2 = Array.from({ length: 10 }, () => rng2.random());

    expect(seq1).toEqual(seq2);
  });

  it('produces different output for different seeds', () => {
    const rng1 = new SeededRng('seed-a');
    const rng2 = new SeededRng('seed-b');

    const val1 = rng1.random();
    const val2 = rng2.random();

    expect(val1).not.toBe(val2);
  });

  it('int produces values in range', () => {
    const rng = new SeededRng('range-test');
    for (let i = 0; i < 100; i++) {
      const val = rng.int(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('pick selects from array', () => {
    const rng = new SeededRng('pick-test');
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it('shuffle is deterministic', () => {
    const rng1 = new SeededRng('shuffle-seed');
    const rng2 = new SeededRng('shuffle-seed');

    const arr1 = [1, 2, 3, 4, 5];
    const arr2 = [1, 2, 3, 4, 5];

    rng1.shuffle(arr1);
    rng2.shuffle(arr2);

    expect(arr1).toEqual(arr2);
  });
});

describe('seedFromString', () => {
  it('returns consistent hash', () => {
    expect(seedFromString('hello')).toBe(seedFromString('hello'));
  });

  it('returns different hash for different strings', () => {
    expect(seedFromString('hello')).not.toBe(seedFromString('world'));
  });
});

describe('createRng', () => {
  it('produces values in [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

describe('validateGeneratorConfig', () => {
  const validConfig: GeneratorConfig = {
    fileCount: 20,
    moduleCount: 4,
    dependencyDepth: 2,
    testCoverage: 50,
    documentationLevel: 'minimal',
    seed: 'test',
  };

  it('accepts valid config', () => {
    expect(validateGeneratorConfig(validConfig)).toHaveLength(0);
  });

  it('rejects fileCount out of range', () => {
    expect(validateGeneratorConfig({ ...validConfig, fileCount: 5 })).toContainEqual(
      expect.stringContaining('fileCount'),
    );
    expect(validateGeneratorConfig({ ...validConfig, fileCount: 200 })).toContainEqual(
      expect.stringContaining('fileCount'),
    );
  });

  it('rejects moduleCount out of range', () => {
    expect(validateGeneratorConfig({ ...validConfig, moduleCount: 1 })).toContainEqual(
      expect.stringContaining('moduleCount'),
    );
    expect(validateGeneratorConfig({ ...validConfig, moduleCount: 15 })).toContainEqual(
      expect.stringContaining('moduleCount'),
    );
  });

  it('rejects dependencyDepth out of range', () => {
    expect(validateGeneratorConfig({ ...validConfig, dependencyDepth: 0 })).toContainEqual(
      expect.stringContaining('dependencyDepth'),
    );
  });

  it('rejects testCoverage out of range', () => {
    expect(validateGeneratorConfig({ ...validConfig, testCoverage: -1 })).toContainEqual(
      expect.stringContaining('testCoverage'),
    );
    expect(validateGeneratorConfig({ ...validConfig, testCoverage: 101 })).toContainEqual(
      expect.stringContaining('testCoverage'),
    );
  });

  it('rejects empty seed', () => {
    expect(validateGeneratorConfig({ ...validConfig, seed: '' })).toContainEqual(
      expect.stringContaining('seed'),
    );
  });
});

describe('GeneratedRepoTarget', () => {
  let target: GeneratedRepoTarget | undefined;

  afterEach(async () => {
    if (target) {
      await target.teardown();
      target = undefined;
    }
  });

  it('generates deterministic output (same seed = same file structure)', async () => {
    const config: GeneratorConfig = {
      fileCount: 15,
      moduleCount: 3,
      dependencyDepth: 2,
      testCoverage: 50,
      documentationLevel: 'minimal',
      seed: 'determinism-test',
    };

    // First generation
    const target1 = new GeneratedRepoTarget(config);
    const wd1 = await target1.setup();

    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const listSourceFiles = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      return entries
        .filter(e => {
          const parent = e.parentPath ?? (e as { path?: string }).path ?? '';
          return e.isFile() && !parent.includes('.git') && !e.name.startsWith('.');
        })
        .map(e => {
          const parent = e.parentPath ?? (e as { path?: string }).path ?? '';
          return join(parent, e.name).replace(dir, '');
        })
        .sort();
    };

    const readSourceContents = async (dir: string, files: string[]): Promise<Map<string, string>> => {
      const contents = new Map<string, string>();
      for (const f of files) {
        const content = await readFile(join(dir, f), 'utf-8');
        contents.set(f, content);
      }
      return contents;
    };

    const files1 = await listSourceFiles(wd1.path);
    const contents1 = await readSourceContents(wd1.path, files1);
    await target1.teardown();

    // Second generation with same seed
    const target2 = new GeneratedRepoTarget(config);
    const wd2 = await target2.setup();
    target = target2; // ensure cleanup

    const files2 = await listSourceFiles(wd2.path);
    const contents2 = await readSourceContents(wd2.path, files2);

    // Same files generated with identical content
    expect(files1).toEqual(files2);
    for (const [path, content] of contents1) {
      expect(contents2.get(path)).toBe(content);
    }
  }, 30_000);

  it('creates a valid git repository', async () => {
    target = new GeneratedRepoTarget({
      fileCount: 10,
      moduleCount: 2,
      dependencyDepth: 1,
      testCoverage: 0,
      documentationLevel: 'none',
      seed: 'git-test',
    });

    const wd = await target.setup();
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(wd.path);
    const log = await git.log();

    expect(log.total).toBeGreaterThanOrEqual(1);
    expect(log.latest?.message).toContain('Initial commit');
  }, 15_000);

  it('returns a valid manifest', async () => {
    target = new GeneratedRepoTarget({
      fileCount: 15,
      moduleCount: 3,
      dependencyDepth: 2,
      testCoverage: 50,
      documentationLevel: 'thorough',
      seed: 'manifest-test',
    });

    await target.setup();
    const manifest = target.getGroundTruth();

    expect(manifest.name).toBe('generated-project');
    expect(manifest.decisions.length).toBeGreaterThan(0);
    expect(manifest.baselineTestCoverage).toBe(50);
  }, 15_000);

  it('throws on invalid config', async () => {
    target = new GeneratedRepoTarget({
      fileCount: 5, // too low
      moduleCount: 2,
      dependencyDepth: 1,
      testCoverage: 50,
      documentationLevel: 'none',
      seed: 'bad-config',
    });

    await expect(target.setup()).rejects.toThrow('Invalid generator config');
  });

  it('reset restores to initial state', async () => {
    target = new GeneratedRepoTarget({
      fileCount: 10,
      moduleCount: 2,
      dependencyDepth: 1,
      testCoverage: 0,
      documentationLevel: 'none',
      seed: 'reset-test',
    });

    const wd = await target.setup();
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    // Create a new file
    await writeFile(join(wd.path, 'dirty-file.txt'), 'dirty');

    await target.reset();

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(wd.path);
    expect(files).not.toContain('dirty-file.txt');
  }, 15_000);

  it('validate returns valid state after setup', async () => {
    target = new GeneratedRepoTarget({
      fileCount: 10,
      moduleCount: 2,
      dependencyDepth: 1,
      testCoverage: 0,
      documentationLevel: 'none',
      seed: 'validate-test',
    });

    await target.setup();
    const result = await target.validate();

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  }, 15_000);

  it('teardown is idempotent', async () => {
    target = new GeneratedRepoTarget({
      fileCount: 10,
      moduleCount: 2,
      dependencyDepth: 1,
      testCoverage: 0,
      documentationLevel: 'none',
      seed: 'teardown-test',
    });

    await target.setup();
    await target.teardown();
    await target.teardown(); // second call should not throw
    target = undefined;
  }, 15_000);
});
