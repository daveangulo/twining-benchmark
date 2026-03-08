import { Command } from 'commander';
import { DEFAULT_CONFIG } from '../../types/config.js';

/**
 * Create the `dashboard` command.
 */
export function createDashboardCommand(): Command {
  return new Command('dashboard')
    .description('Launch the web dashboard')
    .option(
      '--port <port>',
      'Port to serve the dashboard on',
      String(DEFAULT_CONFIG.dashboardPort),
    )
    .option(
      '--results-dir <dir>',
      'Results directory',
      DEFAULT_CONFIG.outputDirectory,
    )
    .option(
      '--auth <user:pass>',
      'Enable basic auth (format: user:pass)',
    )
    .option(
      '--no-open',
      'Do not open browser automatically',
    )
    .action(async (opts: {
      port: string;
      resultsDir: string;
      auth?: string;
      open: boolean;
    }) => {
      const port = parseInt(opts.port, 10);

      // Dynamic import to avoid loading express at CLI parse time
      const { startDashboardServer } = await import('../../dashboard/server.js');

      await startDashboardServer({
        resultsDir: opts.resultsDir,
        port,
        auth: opts.auth,
      });

      const url = `http://localhost:${port}`;
      console.log(`\n  Dashboard running at ${url}\n`);

      if (opts.open) {
        // Open browser (best-effort)
        const { exec } = await import('node:child_process');
        const cmd = process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'start'
          : 'xdg-open';
        exec(`${cmd} ${url}`);
      }

      // Keep process alive
      console.log('  Press Ctrl+C to stop.\n');
    });
}
