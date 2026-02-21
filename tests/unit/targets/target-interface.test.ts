import { describe, it, expect } from 'vitest';
import type { ITestTarget, SeededBug, ScenarioTag } from '../../../src/targets/target.interface.js';
import type {
  WorkingDirectory,
  ValidationResult,
  ArchitecturalManifest,
} from '../../../src/types/target.js';

describe('ITestTarget interface contract', () => {
  /**
   * A minimal mock implementation to verify the interface shape is correct.
   */
  class MockTarget implements ITestTarget {
    readonly name = 'mock-target';
    private setupCalled = false;

    async setup(): Promise<WorkingDirectory> {
      this.setupCalled = true;
      return {
        path: '/tmp/mock',
        gitDir: '/tmp/mock/.git',
        cleanup: async () => {},
      };
    }

    async validate(): Promise<ValidationResult> {
      return {
        valid: this.setupCalled,
        errors: this.setupCalled ? [] : ['Not set up'],
        warnings: [],
      };
    }

    getGroundTruth(): ArchitecturalManifest {
      return {
        name: 'mock',
        description: 'A mock target for testing',
        decisions: [],
        moduleDependencies: {},
        baselineTestCoverage: 100,
      };
    }

    async reset(): Promise<void> {
      // no-op for mock
    }

    async teardown(): Promise<void> {
      this.setupCalled = false;
    }
  }

  it('should allow a class to implement ITestTarget', () => {
    const target: ITestTarget = new MockTarget();
    expect(target.name).toBe('mock-target');
  });

  it('should have setup() returning WorkingDirectory', async () => {
    const target = new MockTarget();
    const wd = await target.setup();
    expect(wd.path).toBe('/tmp/mock');
    expect(wd.gitDir).toBe('/tmp/mock/.git');
    expect(typeof wd.cleanup).toBe('function');
  });

  it('should have validate() returning ValidationResult', async () => {
    const target = new MockTarget();
    await target.setup();
    const result = await target.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('should have getGroundTruth() returning ArchitecturalManifest', () => {
    const target = new MockTarget();
    const manifest = target.getGroundTruth();
    expect(manifest.name).toBe('mock');
    expect(Array.isArray(manifest.decisions)).toBe(true);
    expect(typeof manifest.moduleDependencies).toBe('object');
    expect(typeof manifest.baselineTestCoverage).toBe('number');
  });

  it('should have reset() and teardown() as async void', async () => {
    const target = new MockTarget();
    await target.setup();
    await expect(target.reset()).resolves.toBeUndefined();
    await expect(target.teardown()).resolves.toBeUndefined();
  });
});

describe('SeededBug type', () => {
  it('should have the expected shape', () => {
    const bug: SeededBug = {
      id: 'test-bug',
      symptom: 'Something breaks',
      file: 'src/foo.ts',
      rootCause: 'Off by one',
      correctFix: 'Fix the offset',
    };
    expect(bug.id).toBe('test-bug');
    expect(bug.file).toBe('src/foo.ts');
  });
});

describe('ScenarioTag type', () => {
  it('should have the expected shape', () => {
    const tag: ScenarioTag = {
      name: 'scenario/test',
      description: 'A test scenario tag',
    };
    expect(tag.name).toBe('scenario/test');
  });
});
