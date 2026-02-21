import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { DEFAULT_CONFIG } from '../../types/config.js';
import type { RunMetadata } from '../../types/run.js';

interface RunEntry {
  dir: string;
  id: string;
  timestamp: string;
}

/**
 * List all runs sorted by timestamp (newest first).
 */
async function listRuns(outputDir: string): Promise<RunEntry[]> {
  const entries: RunEntry[] = [];

  try {
    const dirs = await readdir(outputDir, { withFileTypes: true });
    for (const entry of dirs) {
      if (!entry.isDirectory() || entry.name === '.gitkeep') continue;

      try {
        const metaPath = join(outputDir, entry.name, 'metadata.json');
        const raw = await readFile(metaPath, 'utf-8');
        const meta = JSON.parse(raw) as RunMetadata;
        entries.push({
          dir: join(outputDir, entry.name),
          id: meta.id,
          timestamp: meta.timestamp,
        });
      } catch {
        // Skip invalid directories
      }
    }
  } catch {
    // Output directory doesn't exist
  }

  // Sort newest first
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

/**
 * Create the `clean` command.
 */
export function createCleanCommand(): Command {
  return new Command('clean')
    .description('Remove old benchmark runs')
    .option(
      '--keep-latest <n>',
      'Number of most recent runs to keep',
      '5',
    )
    .option(
      '--output <dir>',
      'Results directory',
      DEFAULT_CONFIG.outputDirectory,
    )
    .option('--dry-run', 'Show what would be deleted without deleting')
    .action(async (opts: {
      keepLatest: string;
      output: string;
      dryRun?: boolean;
    }) => {
      const keepCount = parseInt(opts.keepLatest, 10);
      if (isNaN(keepCount) || keepCount < 0) {
        console.error('  --keep-latest must be a non-negative integer');
        process.exitCode = 1;
        return;
      }

      const runs = await listRuns(opts.output);

      if (runs.length === 0) {
        console.log('  No benchmark runs found.');
        return;
      }

      const toKeep = runs.slice(0, keepCount);
      const toDelete = runs.slice(keepCount);

      if (toDelete.length === 0) {
        console.log(`  All ${runs.length} runs are within the keep limit (${keepCount}). Nothing to clean.`);
        return;
      }

      console.log(`  Found ${runs.length} runs. Keeping ${toKeep.length}, removing ${toDelete.length}.`);
      console.log('');

      if (toKeep.length > 0) {
        console.log('  Keeping:');
        for (const run of toKeep) {
          console.log(`    ${run.id.slice(0, 8)}  ${run.timestamp}`);
        }
        console.log('');
      }

      console.log('  Removing:');
      for (const run of toDelete) {
        console.log(`    ${run.id.slice(0, 8)}  ${run.timestamp}`);
      }
      console.log('');

      if (opts.dryRun) {
        console.log('  (dry run — no files were deleted)');
        return;
      }

      let deleted = 0;
      for (const run of toDelete) {
        try {
          await rm(run.dir, { recursive: true, force: true });
          deleted++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  Failed to remove ${run.id.slice(0, 8)}: ${msg}`);
        }
      }

      console.log(`  Cleaned ${deleted} run(s).`);
      console.log('');
    });
}
