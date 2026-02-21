import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { DEFAULT_CONFIG } from '../../types/config.js';
import type { RunMetadata } from '../../types/run.js';
import type { ScoredResults } from '../../types/results.js';
import { formatDuration } from '../utils/progress.js';

/**
 * Load run metadata from a run directory.
 */
async function loadRunMetadata(runDir: string): Promise<RunMetadata> {
  const raw = await readFile(join(runDir, 'metadata.json'), 'utf-8');
  return JSON.parse(raw) as RunMetadata;
}

/**
 * Find the latest run directory.
 */
async function findLatestRun(outputDir: string): Promise<string | null> {
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && e.name !== '.gitkeep')
      .map(e => e.name);

    if (dirs.length === 0) return null;

    // Load metadata for each and pick the most recent by timestamp
    let latest: { dir: string; timestamp: string } | null = null;
    for (const dir of dirs) {
      try {
        const meta = await loadRunMetadata(join(outputDir, dir));
        if (!latest || meta.timestamp > latest.timestamp) {
          latest = { dir, timestamp: meta.timestamp };
        }
      } catch {
        // Skip directories without valid metadata
      }
    }

    return latest ? join(outputDir, latest.dir) : null;
  } catch {
    return null;
  }
}

/**
 * Load scored results for a run.
 */
async function loadScoredResults(runDir: string): Promise<ScoredResults[]> {
  const scoresDir = join(runDir, 'scores');
  try {
    const files = await readdir(scoresDir);
    const results: ScoredResults[] = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const raw = await readFile(join(scoresDir, file), 'utf-8');
        results.push(JSON.parse(raw) as ScoredResults);
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Print a formatted summary of a run.
 */
function printRunSummary(metadata: RunMetadata, scores: ScoredResults[]): void {
  console.log('');
  console.log(`  ${'═'.repeat(60)}`);
  console.log(`  BENCHMARK RESULTS — Run ${metadata.id.slice(0, 8)}`);
  console.log(`  ${'═'.repeat(60)}`);
  console.log('');
  console.log(`  Run ID:     ${metadata.id}`);
  console.log(`  Timestamp:  ${metadata.timestamp}`);
  console.log(`  Status:     ${metadata.status}`);
  console.log(`  Duration:   ${formatDuration(metadata.duration)}`);
  console.log(`  Scenarios:  ${metadata.scenarios.join(', ')}`);
  console.log(`  Conditions: ${metadata.conditions.join(', ')}`);
  console.log(`  Runs/pair:  ${metadata.runsPerPair}`);
  if (metadata.seed) {
    console.log(`  Seed:       ${metadata.seed}`);
  }

  console.log('');
  console.log('  Environment:');
  console.log(`    Node:     ${metadata.environment.nodeVersion}`);
  console.log(`    Platform: ${metadata.environment.platform}`);
  console.log(`    Model:    ${metadata.environment.claudeModel}`);
  if (metadata.environment.twiningVersion) {
    console.log(`    Twining:  ${metadata.environment.twiningVersion}`);
  }

  if (scores.length > 0) {
    console.log('');
    console.log('  Scores:');
    console.log(
      '  ' +
      'Scenario'.padEnd(25) +
      'Condition'.padEnd(25) +
      'Iter'.padEnd(6) +
      'Composite'
    );
    console.log('  ' + '─'.repeat(65));

    for (const result of scores) {
      console.log(
        '  ' +
        result.scenario.padEnd(25) +
        result.condition.padEnd(25) +
        String(result.iteration).padEnd(6) +
        result.composite.toFixed(1)
      );
    }

    console.log('');

    // Per-dimension breakdown for the first score
    const firstScore = scores[0];
    if (firstScore && Object.keys(firstScore.scores).length > 0) {
      console.log('  Score dimensions (first iteration):');
      for (const [dim, score] of Object.entries(firstScore.scores)) {
        console.log(
          `    ${dim.padEnd(25)} ${String(score.value).padEnd(6)} (${score.confidence}, ${score.method})`
        );
      }
      console.log('');
    }
  } else {
    console.log('\n  No scored results found for this run.');
    console.log('  (Scores are generated after analysis — run scoring has not been executed yet.)');
    console.log('');
  }
}

/**
 * Print a side-by-side comparison of two runs.
 */
function printComparison(
  metaA: RunMetadata,
  scoresA: ScoredResults[],
  metaB: RunMetadata,
  scoresB: ScoredResults[],
): void {
  console.log('');
  console.log(`  ${'═'.repeat(70)}`);
  console.log(`  COMPARISON: ${metaA.id.slice(0, 8)} vs ${metaB.id.slice(0, 8)}`);
  console.log(`  ${'═'.repeat(70)}`);
  console.log('');
  console.log(`  Run A: ${metaA.id} (${metaA.timestamp})`);
  console.log(`  Run B: ${metaB.id} (${metaB.timestamp})`);
  console.log('');

  // Compare by scenario/condition pairs
  const keysA = new Map(scoresA.map(s => [`${s.scenario}:${s.condition}:${s.iteration}`, s]));
  const keysB = new Map(scoresB.map(s => [`${s.scenario}:${s.condition}:${s.iteration}`, s]));

  const allKeys = new Set([...keysA.keys(), ...keysB.keys()]);

  if (allKeys.size === 0) {
    console.log('  No scored results to compare.');
    console.log('');
    return;
  }

  console.log(
    '  ' +
    'Scenario'.padEnd(22) +
    'Condition'.padEnd(22) +
    'Run A'.padEnd(8) +
    'Run B'.padEnd(8) +
    'Delta'.padEnd(10) +
    'Change'
  );
  console.log('  ' + '─'.repeat(76));

  for (const key of [...allKeys].sort()) {
    const [scenario, condition, _iter] = key.split(':');
    const a = keysA.get(key);
    const b = keysB.get(key);

    const scoreA = a ? a.composite.toFixed(1) : '  —';
    const scoreB = b ? b.composite.toFixed(1) : '  —';

    let delta = '';
    let change = '';
    if (a && b) {
      const diff = b.composite - a.composite;
      const pct = a.composite !== 0 ? (diff / a.composite) * 100 : 0;
      const sign = diff >= 0 ? '+' : '';
      delta = `${sign}${diff.toFixed(1)}`;
      change = pct !== 0
        ? `${sign}${pct.toFixed(1)}%`
        : '0%';

      if (diff > 0) change = `\x1b[32m${change}\x1b[0m`;
      else if (diff < 0) change = `\x1b[31m${change}\x1b[0m`;
    }

    console.log(
      '  ' +
      (scenario ?? '').padEnd(22) +
      (condition ?? '').padEnd(22) +
      scoreA.padEnd(8) +
      scoreB.padEnd(8) +
      delta.padEnd(10) +
      change
    );
  }

  console.log('');
}

/**
 * Create the `results` command group.
 */
export function createResultsCommand(): Command {
  const cmd = new Command('results')
    .description('View and compare benchmark results');

  cmd
    .command('show <run-id>')
    .description('Show results for a run (use "latest" for most recent)')
    .option(
      '--output <dir>',
      'Results directory',
      DEFAULT_CONFIG.outputDirectory,
    )
    .action(async (runId: string, opts: { output: string }) => {
      try {
        let runDir: string;

        if (runId === 'latest') {
          const found = await findLatestRun(opts.output);
          if (!found) {
            console.error('  No benchmark runs found in', opts.output);
            process.exitCode = 1;
            return;
          }
          runDir = found;
        } else {
          runDir = join(opts.output, runId);
        }

        const metadata = await loadRunMetadata(runDir);
        const scores = await loadScoredResults(runDir);
        printRunSummary(metadata, scores);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Error: ${msg}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command('compare <run-id-1> <run-id-2>')
    .description('Compare two benchmark runs side-by-side')
    .option(
      '--output <dir>',
      'Results directory',
      DEFAULT_CONFIG.outputDirectory,
    )
    .action(async (runIdA: string, runIdB: string, opts: { output: string }) => {
      try {
        const resolveDir = async (id: string): Promise<string> => {
          if (id === 'latest') {
            const found = await findLatestRun(opts.output);
            if (!found) throw new Error('No benchmark runs found');
            return found;
          }
          return join(opts.output, id);
        };

        const dirA = await resolveDir(runIdA);
        const dirB = await resolveDir(runIdB);

        const metaA = await loadRunMetadata(dirA);
        const metaB = await loadRunMetadata(dirB);
        const scoresA = await loadScoredResults(dirA);
        const scoresB = await loadScoredResults(dirB);

        printComparison(metaA, scoresA, metaB, scoresB);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Error: ${msg}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}
