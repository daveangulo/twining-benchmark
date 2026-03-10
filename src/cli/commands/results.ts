import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { DEFAULT_CONFIG } from '../../types/config.js';
import type { RunMetadata } from '../../types/run.js';
import type { ScoredResults, BenchmarkReport } from '../../types/results.js';
import { formatDuration } from '../utils/progress.js';
import {
  aggregateResults,
  rankConditions,
  calculateEfficacyScore,
  generatePairwiseComparisons,
} from '../../analyzer/composite-scorer.js';
import { normalCdf } from '../../analyzer/statistics.js';
import {
  exportMarkdown,
  generateKeyFindings,
} from '../../results/exporter.js';

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
 * Build a BenchmarkReport from scored results and metadata.
 */
export function buildReport(
  metadata: RunMetadata,
  scores: ScoredResults[],
): BenchmarkReport {
  if (scores.length === 0) {
    return {
      runId: metadata.id,
      timestamp: metadata.timestamp,
      aggregated: [],
      comparisons: [],
      ranking: [],
      efficacyScore: 0,
      keyFindings: [],
    };
  }

  // Group by scenario+condition pair
  const groups = new Map<string, ScoredResults[]>();
  for (const s of scores) {
    const key = `${s.scenario}:${s.condition}`;
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  // Aggregate each group
  const aggregated = [...groups.values()].map(group => aggregateResults(group));

  // Generate pairwise comparisons across conditions
  const comparisons = generatePairwiseComparisons(
    aggregated,
    'composite',
    (agg) => {
      const groupKey = `${agg.scenario}:${agg.condition}`;
      return (groups.get(groupKey) ?? []).map(s => s.composite);
    },
  );

  // Rank conditions
  const ranking = rankConditions(aggregated);

  // Calculate efficacy score
  const efficacyScore = calculateEfficacyScore(aggregated);

  const report: BenchmarkReport = {
    runId: metadata.id,
    timestamp: metadata.timestamp,
    aggregated,
    comparisons,
    ranking,
    efficacyScore,
    keyFindings: [],
  };

  // Compute per-condition success rates from raw scores
  const conditionGroups = new Map<string, ScoredResults[]>();
  for (const s of scores) {
    const arr = conditionGroups.get(s.condition) ?? [];
    arr.push(s);
    conditionGroups.set(s.condition, arr);
  }
  report.conditionSuccessRates = {};
  for (const [cond, items] of conditionGroups) {
    const successCount = items.filter(s => s.metrics.compiles).length;
    report.conditionSuccessRates[cond] = items.length > 0 ? successCount / items.length : 0;
  }

  // Auto-generate key findings
  report.keyFindings = generateKeyFindings(report);

  return report;
}

/**
 * Print the full KPI summary using the Section 9.3 template.
 */
export function printRunSummary(metadata: RunMetadata, scores: ScoredResults[]): void {
  if (scores.length === 0) {
    console.log('');
    console.log(`  ${'═'.repeat(60)}`);
    console.log(`  BENCHMARK RESULTS — Run ${metadata.id.slice(0, 8)}`);
    console.log(`  ${'═'.repeat(60)}`);
    console.log('');
    console.log(`  Run ID:     ${metadata.id}`);
    console.log(`  Timestamp:  ${metadata.timestamp}`);
    console.log(`  Status:     ${metadata.status}`);
    console.log(`  Duration:   ${formatDuration(metadata.duration)}`);
    console.log('\n  No scored results found for this run.');
    console.log('  (Scores are generated after analysis — run scoring has not been executed yet.)');
    console.log('');
    return;
  }

  const report = buildReport(metadata, scores);
  const markdown = exportMarkdown(report);
  console.log('');
  console.log(markdown);
}

/**
 * Print a side-by-side comparison of two runs using the full KPI template.
 */
export function printComparison(
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

  const reportA = buildReport(metaA, scoresA);
  const reportB = buildReport(metaB, scoresB);

  // Show run info
  console.log(`  Run A: ${metaA.id} (${metaA.timestamp})`);
  console.log(`  Run B: ${metaB.id} (${metaB.timestamp})`);
  console.log('');

  if (reportA.ranking.length === 0 && reportB.ranking.length === 0) {
    console.log('  No scored results to compare.');
    console.log('');
    return;
  }

  // Condition ranking comparison
  if (reportA.ranking.length > 0 || reportB.ranking.length > 0) {
    console.log('  Condition Rankings:');
    console.log(
      '  ' +
      'Condition'.padEnd(28) +
      'Run A CES'.padEnd(12) +
      'Run B CES'.padEnd(12) +
      'Delta'.padEnd(12) +
      'Significance'
    );
    console.log('  ' + '─'.repeat(72));

    // Gather all conditions
    const allConditions = new Set([
      ...reportA.ranking.map(r => r.condition),
      ...reportB.ranking.map(r => r.condition),
    ]);

    for (const cond of allConditions) {
      const rankA = reportA.ranking.find(r => r.condition === cond);
      const rankB = reportB.ranking.find(r => r.condition === cond);

      const cesA = rankA ? rankA.compositeScore.toFixed(1) : '—';
      const cesB = rankB ? rankB.compositeScore.toFixed(1) : '—';

      let deltaStr = '';
      let sigStr = '';
      if (rankA && rankB) {
        const diff = rankB.compositeScore - rankA.compositeScore;
        const sign = diff >= 0 ? '+' : '';
        deltaStr = `${sign}${diff.toFixed(1)}`;

        // Find pairwise comparison for this condition between runs
        const aggA = reportA.aggregated.filter(a => a.condition === cond);
        const aggB = reportB.aggregated.filter(a => a.condition === cond);

        if (aggA.length > 0 && aggB.length > 0) {
          const compA = aggA[0]!.compositeScore;
          const compB = aggB[0]!.compositeScore;
          if (compA.n >= 2 && compB.n >= 2) {
            const combinedSe = Math.sqrt(
              (compA.standardDeviation ** 2) / compA.n +
              (compB.standardDeviation ** 2) / compB.n,
            );
            if (combinedSe > 0) {
              const z = Math.abs(diff) / combinedSe;
              const pValue = 2 * (1 - normalCdf(z));
              if (pValue < 0.05) {
                sigStr = '\x1b[32mp < 0.05\x1b[0m';
              } else if (pValue < 0.10) {
                sigStr = '\x1b[33mp < 0.10\x1b[0m';
              } else {
                sigStr = 'n.s.';
              }
            }
          }
        }

        if (diff > 0) deltaStr = `\x1b[32m${deltaStr}\x1b[0m`;
        else if (diff < 0) deltaStr = `\x1b[31m${deltaStr}\x1b[0m`;
      }

      console.log(
        '  ' +
        cond.padEnd(28) +
        cesA.padEnd(12) +
        cesB.padEnd(12) +
        deltaStr.padEnd(12) +
        sigStr,
      );
    }
    console.log('');
  }

  // Show efficacy score comparison
  if (reportA.efficacyScore !== 0 || reportB.efficacyScore !== 0) {
    console.log(`  Efficacy Score (Twining advantage):`);
    console.log(`    Run A: ${reportA.efficacyScore.toFixed(1)}`);
    console.log(`    Run B: ${reportB.efficacyScore.toFixed(1)}`);
    const delta = reportB.efficacyScore - reportA.efficacyScore;
    const sign = delta >= 0 ? '+' : '';
    console.log(`    Delta: ${sign}${delta.toFixed(1)}`);
    console.log('');
  }

  // Show key findings from both
  if (reportA.keyFindings.length > 0 || reportB.keyFindings.length > 0) {
    if (reportA.keyFindings.length > 0) {
      console.log(`  Key Findings (Run A):`);
      for (const f of reportA.keyFindings) {
        console.log(`    - ${f}`);
      }
      console.log('');
    }
    if (reportB.keyFindings.length > 0) {
      console.log(`  Key Findings (Run B):`);
      for (const f of reportB.keyFindings) {
        console.log(`    - ${f}`);
      }
      console.log('');
    }
  }
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
