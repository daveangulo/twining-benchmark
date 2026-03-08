import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { ResultsStore } from '../../results/store.js';
import { exportMarkdown, exportCsv, exportAggregatedCsv } from '../../results/exporter.js';
import { buildReport } from './results.js';
import { DEFAULT_CONFIG } from '../../types/config.js';

/**
 * Create the `export` command for exporting benchmark results (FR-DSH-005).
 */
export function createExportCommand(): Command {
  return new Command('export')
    .description('Export benchmark results as markdown, CSV, or aggregated CSV')
    .argument('<run-id>', 'Run ID to export (or "latest" for most recent)')
    .option('--format <format>', 'Output format: markdown, csv, aggregated-csv', 'markdown')
    .option('--output <path>', 'Output file path (defaults to stdout)')
    .option('--results-dir <dir>', 'Results directory', DEFAULT_CONFIG.outputDirectory)
    .action(async (runId: string, opts: { format: string; output?: string; resultsDir: string }) => {
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

        // Generate output based on format
        let content: string;

        switch (opts.format) {
          case 'markdown': {
            const metadata = await store.getMetadata(resolvedRunId);
            const scores = await store.loadScores(resolvedRunId);
            const report = buildReport(metadata, scores);
            content = exportMarkdown(report);
            break;
          }
          case 'csv': {
            const scores = await store.loadScores(resolvedRunId);
            content = exportCsv(scores);
            break;
          }
          case 'aggregated-csv': {
            const metadata = await store.getMetadata(resolvedRunId);
            const scores = await store.loadScores(resolvedRunId);
            const report = buildReport(metadata, scores);
            content = exportAggregatedCsv(report.aggregated);
            break;
          }
          default: {
            console.error(`Error: Unknown format "${opts.format}". Use markdown, csv, or aggregated-csv.`);
            process.exitCode = 1;
            return;
          }
        }

        // Write to file or stdout
        if (opts.output) {
          await writeFile(opts.output, content, 'utf-8');
          console.log(`Exported ${opts.format} to ${opts.output}`);
        } else {
          process.stdout.write(content);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });
}
