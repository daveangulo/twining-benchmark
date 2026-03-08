import { Command } from 'commander';
import { ResultsStore } from '../../results/store.js';
import { DEFAULT_CONFIG } from '../../types/config.js';
import { execa } from 'execa';

/**
 * Create the `reproduce` command for re-running a previous benchmark run.
 */
export function createReproduceCommand(): Command {
  return new Command('reproduce')
    .description('Reproduce a previous benchmark run from its metadata')
    .argument('<run-id>', 'Run ID to reproduce (or "latest" for most recent)')
    .option('--dry-run', 'Print the reconstructed command instead of executing it')
    .option('--results-dir <dir>', 'Results directory', DEFAULT_CONFIG.outputDirectory)
    .action(async (runId: string, opts: { dryRun?: boolean; resultsDir: string }) => {
      try {
        const store = new ResultsStore(opts.resultsDir);

        // Resolve run ID
        let resolvedRunId: string;
        if (runId === 'latest') {
          const latestId = await store.getLatestRunId();
          if (!latestId) {
            console.error('Error: No benchmark runs found in', opts.resultsDir);
            process.exitCode = 1;
            return;
          }
          resolvedRunId = latestId;
        } else {
          const exists = await store.hasRun(runId);
          if (!exists) {
            console.error(`Error: Run "${runId}" not found in`, opts.resultsDir);
            process.exitCode = 1;
            return;
          }
          resolvedRunId = runId;
        }

        // Load metadata
        const metadata = await store.getMetadata(resolvedRunId);

        // Reconstruct the command arguments
        const args: string[] = ['run'];

        // --scenario flags
        if (metadata.scenarios.length > 0) {
          args.push('--scenario', metadata.scenarios.join(','));
        }

        // --condition flags
        if (metadata.conditions.length > 0) {
          args.push('--condition', metadata.conditions.join(','));
        }

        // --runs
        args.push('--runs', String(metadata.runsPerPair));

        // --seed (if present)
        if (metadata.seed) {
          args.push('--seed', metadata.seed);
        }

        // --budget
        if (metadata.config?.budgetDollars != null) {
          args.push('--budget', String(metadata.config.budgetDollars));
        }

        const command = `twining-bench ${args.join(' ')}`;

        if (opts.dryRun) {
          console.log(command);
          return;
        }

        // Execute the reconstructed command
        console.log(`Reproducing run ${resolvedRunId}...`);
        console.log(`> ${command}\n`);

        const result = await execa('twining-bench', args, {
          stdio: 'inherit',
        });

        process.exitCode = result.exitCode;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });
}
