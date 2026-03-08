import { Command } from 'commander';
import { DEFAULT_CONFIG } from '../../types/config.js';

/**
 * Create the `cloud` command group for Fly.io-based remote execution.
 */
export function createCloudCommand(): Command {
  const cmd = new Command('cloud')
    .description('Manage cloud-based benchmark execution (Fly.io)');

  cmd
    .command('deploy')
    .description('Deploy benchmark harness to Fly.io')
    .action(async () => {
      try {
        const { execa } = await import('execa');
        console.log('\n  Deploying to Fly.io...\n');
        const result = await execa('fly', ['deploy'], { stdio: 'inherit' });
        if (result.exitCode !== 0) {
          process.exitCode = 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Deploy failed: ${msg}`);
        console.error('  Ensure the Fly CLI is installed: https://fly.io/docs/flyctl/install/');
        process.exitCode = 1;
      }
    });

  cmd
    .command('run')
    .description('Execute a benchmark run on the remote machine')
    .option('--scenario <name>', 'Scenario to run')
    .option('--condition <name>', 'Condition to test', 'all')
    .option('--runs <number>', 'Runs per pair', String(DEFAULT_CONFIG.defaultRuns))
    .action(async (opts: { scenario?: string; condition: string; runs: string }) => {
      if (!opts.scenario) {
        console.error('  --scenario is required for cloud run');
        process.exitCode = 1;
        return;
      }

      try {
        const { execa } = await import('execa');
        const remoteCmd = [
          'twining-bench', 'run',
          '--scenario', opts.scenario,
          '--condition', opts.condition,
          '--runs', opts.runs,
        ].join(' ');

        console.log(`\n  Running on remote: ${remoteCmd}\n`);
        await execa('fly', ['ssh', 'console', '-C', remoteCmd], { stdio: 'inherit' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Remote run failed: ${msg}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command('status')
    .description('Check live run status from deployed dashboard')
    .option('--app <name>', 'Fly app name')
    .action(async (opts: { app?: string }) => {
      try {
        const { execa } = await import('execa');
        // Get the app URL
        const appArgs = opts.app ? ['-a', opts.app] : [];
        const info = await execa('fly', ['status', '--json', ...appArgs]);
        const status = JSON.parse(info.stdout) as { Hostname?: string };
        const hostname = status.Hostname ?? 'unknown';

        const url = `https://${hostname}/api/status`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as Record<string, unknown>;

        if (data['active']) {
          console.log(`\n  Run in progress: ${String(data['runId'] ?? '')}`);
          console.log(`  Scenario:    ${String(data['scenario'] ?? '')}`);
          console.log(`  Condition:   ${String(data['condition'] ?? '')}`);
          console.log(`  Progress:    ${String(data['percentComplete'] ?? '?')}%\n`);
        } else {
          console.log('\n  No active benchmark run.\n');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Status check failed: ${msg}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command('logs')
    .description('Stream logs from the deployed machine')
    .action(async () => {
      try {
        const { execa } = await import('execa');
        await execa('fly', ['logs'], { stdio: 'inherit' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Logs failed: ${msg}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command('pull <run-id>')
    .description('Download results from remote machine')
    .option('--output <dir>', 'Local output directory', DEFAULT_CONFIG.outputDirectory)
    .action(async (runId: string, opts: { output: string }) => {
      try {
        const { execa } = await import('execa');
        const remotePath = `/data/benchmark-results/${runId}`;
        const localPath = `${opts.output}/${runId}`;

        console.log(`\n  Pulling ${runId} from remote...\n`);

        // Use fly sftp to download the results directory
        await execa('fly', ['sftp', 'get', remotePath, localPath], { stdio: 'inherit' });

        console.log(`  Results saved to ${localPath}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Pull failed: ${msg}`);
        console.error('  Alternatively, download via dashboard API: GET /api/runs/<id>/export/markdown');
        process.exitCode = 1;
      }
    });

  return cmd;
}
