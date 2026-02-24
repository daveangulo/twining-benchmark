import { describe, it, expect } from 'vitest';

// We test the exported functions from code-analysis that don't require
// a full filesystem or git setup. detectPatterns requires a real tsconfig,
// so we test the interface and parseTestOutput logic through runTestSuite.

describe('code-analysis module', () => {
  it('exports expected functions', async () => {
    const mod = await import('../../../src/analyzer/code-analysis.js');

    expect(typeof mod.analyzeGitChurn).toBe('function');
    expect(typeof mod.detectPatterns).toBe('function');
    expect(typeof mod.runTestSuite).toBe('function');
    expect(typeof mod.checkCompilation).toBe('function');
  });
});

describe('detectPatterns', () => {
  // detectPatterns requires a real tsconfig and project files.
  // We test it against the synthetic repo fixtures.

  it('detects patterns in the synthetic repo fixtures', async () => {
    const { detectPatterns } = await import('../../../src/analyzer/code-analysis.js');
    const { resolve } = await import('node:path');

    const fixturesPath = resolve(
      import.meta.dirname ?? '.',
      '../../../src/targets/synthetic-repo/fixtures',
    );

    // The synthetic repo should have repository pattern and event emitter
    const patterns = detectPatterns(fixturesPath);

    expect(patterns.length).toBeGreaterThan(0);

    const patternNames = patterns.map(p => p.patternName);
    expect(patternNames).toContain('repository-pattern');

    // Each pattern should have files and evidence
    for (const p of patterns) {
      expect(p.files.length).toBeGreaterThan(0);
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  }, 30_000);
});

describe('test output parsing', () => {
  // Since parseTestOutput is not exported, we verify the test result
  // structure is correct by checking the interface
  it('TestSuiteResults has expected shape', async () => {
    const { runTestSuite } = await import('../../../src/analyzer/code-analysis.js');

    // We can test the function exists and returns the right type
    // when given a non-existent path (it should handle errors gracefully)
    const result = await runTestSuite('/nonexistent/path');

    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('compiles');
    expect(result).toHaveProperty('compilationErrors');
    expect(typeof result.passed).toBe('number');
    expect(typeof result.failed).toBe('number');
    expect(typeof result.compiles).toBe('boolean');
  });
});
