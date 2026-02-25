import { describe, it, expect } from 'vitest';
import { parseTestOutput, detectPatterns } from '../../../src/analyzer/code-analysis.js';
import { resolve } from 'node:path';

describe('parseTestOutput', () => {
  describe('vitest format', () => {
    it('parses passed only', () => {
      const output = 'Tests  5 passed (5)';
      const result = parseTestOutput(output);
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.total).toBe(5);
    });

    it('parses passed and failed', () => {
      const output = 'Tests  5 passed | 2 failed (7)';
      const result = parseTestOutput(output);
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.total).toBe(7);
    });

    it('parses passed, failed, and skipped', () => {
      const output = 'Tests  5 passed | 2 failed | 1 skipped (8)';
      const result = parseTestOutput(output);
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(8);
    });

    it('parses from real vitest output with surrounding lines', () => {
      const output = `
 ✓ tests/unit/foo.test.ts (3 tests) 5ms
 ✗ tests/unit/bar.test.ts (2 tests) 12ms

 Test Files  1 failed | 1 passed (2)
      Tests  3 passed | 2 failed (5)
   Start at  14:30:00
   Duration  200ms
`;
      const result = parseTestOutput(output);
      expect(result.passed).toBe(3);
      expect(result.failed).toBe(2);
      expect(result.total).toBe(5);
    });
  });

  describe('jest format', () => {
    it('parses jest summary line', () => {
      const output = `
Test Suites: 1 failed, 2 passed, 3 total
Tests:       5 passed, 2 failed, 7 total
Snapshots:   0 total
Time:        3.456 s
`;
      const result = parseTestOutput(output);
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(2);
      expect(result.total).toBe(7);
    });

    it('parses jest with skipped tests', () => {
      const output = 'Tests:       3 passed, 1 failed, 2 skipped, 6 total';
      const result = parseTestOutput(output);
      expect(result.passed).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.total).toBe(6);
    });
  });

  describe('mocha format', () => {
    it('parses mocha passing/failing/pending', () => {
      const output = `
  10 passing (2s)
  3 failing
  1 pending
`;
      const result = parseTestOutput(output);
      expect(result.passed).toBe(10);
      expect(result.failed).toBe(3);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(14);
    });

    it('parses mocha passing only', () => {
      const output = '  5 passing (500ms)';
      const result = parseTestOutput(output);
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(5);
    });
  });

  describe('coverage parsing', () => {
    it('parses "All files" coverage format', () => {
      const output = `
Tests  10 passed (10)
---------|---------|----------|---------|---------|
File     | % Stmts | % Branch | % Funcs | % Lines |
---------|---------|----------|---------|---------|
All files|   85.2  |    70.1  |   90.0  |   85.2  |
---------|---------|----------|---------|---------|
`;
      const result = parseTestOutput(output);
      expect(result.coveragePct).toBeCloseTo(85.2);
    });

    it('parses "Statements" coverage format', () => {
      const output = 'Tests  5 passed (5)\nStatements : 92.5%';
      const result = parseTestOutput(output);
      expect(result.coveragePct).toBeCloseTo(92.5);
    });
  });

  describe('edge cases', () => {
    it('returns zeros for unrecognized output', () => {
      const result = parseTestOutput('Build succeeded with no warnings');
      expect(result.passed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(0);
      expect(result.coveragePct).toBeUndefined();
    });

    it('returns zeros for empty string', () => {
      const result = parseTestOutput('');
      expect(result.total).toBe(0);
    });
  });
});

describe('detectPatterns', () => {
  it('detects patterns in the synthetic repo fixtures', () => {
    const fixturesPath = resolve(
      import.meta.dirname ?? '.',
      '../../../src/targets/synthetic-repo/fixtures',
    );

    const patterns = detectPatterns(fixturesPath);

    expect(patterns.length).toBeGreaterThan(0);

    const patternNames = patterns.map(p => p.patternName);
    expect(patternNames).toContain('repository-pattern');

    for (const p of patterns) {
      expect(p.files.length).toBeGreaterThan(0);
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  }, 30_000);
});
