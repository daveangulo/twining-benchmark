import { Command } from 'commander';
import { DEFAULT_CONFIG } from '../../types/config.js';

/**
 * Create the `dashboard` command.
 * Phase 3 stub — full implementation deferred.
 */
export function createDashboardCommand(): Command {
  return new Command('dashboard')
    .description('Launch the web dashboard (Phase 3)')
    .option(
      '--port <port>',
      'Port to serve the dashboard on',
      String(DEFAULT_CONFIG.dashboardPort),
    )
    .action((opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      console.log('');
      console.log(`  Dashboard is not yet implemented (Phase 3).`);
      console.log(`  It will serve on port ${port} when available.`);
      console.log('');
      console.log('  In the meantime, use:');
      console.log('    twining-bench results show latest');
      console.log('    twining-bench results compare <run-a> <run-b>');
      console.log('');
    });
}
