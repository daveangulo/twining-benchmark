import { describe, it, expect } from 'vitest';
import { runSmokeTest } from '../../src/runner/smoke-test.js';

describe('E2E smoke test', () => {
  it('validates full pipeline with real agent sessions', { timeout: 600_000 }, async () => {
    if (!process.env['RUN_E2E']) {
      console.log('Skipping E2E smoke test (set RUN_E2E=true to enable)');
      return;
    }

    const result = await runSmokeTest({ timeoutMinutes: 5, budgetDollars: 10 });

    for (const check of result.checks) {
      expect(check.passed, `${check.name}: ${check.detail}`).toBe(true);
    }
  });
});
