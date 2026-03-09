import { Command } from 'commander';
import { runSmokeTest } from '../../runner/smoke-test.js';

export function createSmokeTestCommand(): Command {
  return new Command('smoke-test')
    .description('Run end-to-end smoke test to validate harness pipeline')
    .option('--timeout <minutes>', 'Per-session timeout in minutes', '5')
    .option('--budget <dollars>', 'Maximum API spend in dollars', '10')
    .action(async (opts) => {
      console.log('Running smoke test...\n');
      const result = await runSmokeTest({
        timeoutMinutes: Number(opts.timeout),
        budgetDollars: Number(opts.budget),
      });

      for (const check of result.checks) {
        const icon = check.passed ? 'PASS' : 'FAIL';
        console.log(`  [${icon}] ${check.name}: ${check.detail}`);
      }

      const duration = (result.duration / 1000).toFixed(1);
      console.log(`\n${result.passed ? 'All checks passed' : 'Some checks FAILED'} (${duration}s)`);
      process.exit(result.passed ? 0 : 1);
    });
}
