import type {
  AggregatedResults,
  BenchmarkReport,
  ConditionRanking,
  PairwiseComparison,
  ScoredResults,
  StatisticalSummary,
} from '../types/results.js';

// ─── Significance Indicators ───────────────────────────────────────

function sigIndicator(sig: PairwiseComparison['significance']): string {
  switch (sig) {
    case 'significant':
      return '\u{1F7E2}';
    case 'suggestive':
      return '\u{1F7E1}';
    case 'not-distinguishable':
      return '\u{1F534}';
  }
}

/** Format significance as a p-value label (used in Markdown export). */
export function sigLabel(sig: ConditionRanking['significance']): string {
  switch (sig) {
    case 'significant':
      return 'p < 0.05';
    case 'suggestive':
      return 'p < 0.10';
    case 'not-distinguishable':
      return 'p > 0.10';
  }
}

// ─── Key Findings Generator ────────────────────────────────────────

/**
 * Auto-generate key findings from the largest metric deltas (FR-DSH-005).
 * Looks at pairwise comparisons to find the most impactful differences.
 */
export function generateKeyFindings(report: BenchmarkReport): string[] {
  const findings: string[] = [];
  const significant = report.comparisons.filter(
    (c) => c.significance === 'significant',
  );

  // Sort by absolute delta, largest first
  const sorted = [...significant].sort(
    (a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent),
  );

  // Find the twining vs baseline comparison for the headline
  const twiningVsBaseline = sorted.find(
    (c) =>
      (c.conditionA === 'full-twining' && c.conditionB === 'baseline') ||
      (c.conditionA === 'baseline' && c.conditionB === 'full-twining'),
  );

  if (twiningVsBaseline) {
    const direction =
      twiningVsBaseline.deltaPercent > 0 ? 'improved' : 'reduced';
    const abs = Math.abs(twiningVsBaseline.deltaPercent);
    findings.push(
      `Twining ${direction} ${twiningVsBaseline.metric} by ${abs.toFixed(0)}% vs. baseline`,
    );
  }

  // Find the structured-reload vs twining gap
  const structuredVsTwining = sorted.find(
    (c) =>
      (c.conditionA === 'structured-framework-reload' &&
        c.conditionB === 'full-twining') ||
      (c.conditionA === 'full-twining' &&
        c.conditionB === 'structured-framework-reload'),
  );

  if (structuredVsTwining) {
    // Calculate how much of the baseline→twining gap the structured reload closes
    const baselineComparison = significant.find(
      (c) =>
        c.metric === structuredVsTwining.metric &&
        ((c.conditionA === 'structured-framework-reload' &&
          c.conditionB === 'baseline') ||
          (c.conditionA === 'baseline' &&
            c.conditionB === 'structured-framework-reload')),
    );
    if (baselineComparison && twiningVsBaseline) {
      const gapClosed =
        (Math.abs(baselineComparison.deltaPercent) /
          Math.abs(twiningVsBaseline.deltaPercent)) *
        100;
      if (gapClosed < 100) {
        findings.push(
          `Structured file reload closed ${gapClosed.toFixed(0)}% of the gap between baseline and Twining`,
        );
      }
    }
  }

  // Add top N remaining significant findings
  const remainingLimit = Math.max(0, 4 - findings.length);
  for (const comp of sorted.slice(0, remainingLimit + findings.length)) {
    if (findings.length >= 5) break;
    const existing = findings.some(
      (f) => f.includes(comp.conditionA) && f.includes(comp.metric),
    );
    if (existing) continue;

    const abs = Math.abs(comp.deltaPercent);
    const direction = comp.deltaPercent > 0 ? 'higher' : 'lower';
    findings.push(
      `${comp.conditionA} scored ${abs.toFixed(0)}% ${direction} than ${comp.conditionB} on ${comp.metric}`,
    );
  }

  return findings;
}

// ─── Primary Metrics Table ─────────────────────────────────────────

/**
 * Format milliseconds into Xm Ys format.
 */
function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * Build a primary metrics table showing success rate, test pass rate, cost, and time
 * for each condition. Groups by condition across all scenarios.
 */
export function buildPrimaryMetricsTable(
  aggregated: AggregatedResults[],
  conditionSuccessRates?: Record<string, number>,
): string {
  if (aggregated.length === 0) return '';

  // Group by condition, merging across scenarios
  const conditions = [...new Set(aggregated.map(a => a.condition))];

  const lines: string[] = [];
  lines.push('## Primary Metrics');
  lines.push('');
  lines.push('```');
  lines.push('Primary Metrics (per condition)');
  lines.push('───────────────────────────────────────────────────');

  const colWidths = { condition: 23, success: 9, tests: 8, cost: 9, time: 10 };
  const header =
    pad('Condition', colWidths.condition) +
    pad('Success', colWidths.success) +
    pad('Tests', colWidths.tests) +
    pad('Cost', colWidths.cost) +
    pad('Time', colWidths.time);
  lines.push(header);

  for (const cond of conditions) {
    const condResults = aggregated.filter(a => a.condition === cond);

    // Compute mean metrics across scenarios for this condition
    let totalTestsPass = 0;
    let totalTestsFail = 0;
    let totalCost = 0;
    let totalWallTime = 0;
    let count = 0;

    for (const r of condResults) {
      totalTestsPass += r.metricSummaries.testsPass.mean;
      totalTestsFail += r.metricSummaries.testsFail.mean;
      totalCost += r.metricSummaries.costUsd.mean;
      totalWallTime += r.metricSummaries.wallTimeMs.mean;
      count++;
    }

    const avgTestsPass = count > 0 ? totalTestsPass / count : 0;
    const avgTestsFail = count > 0 ? totalTestsFail / count : 0;
    const avgCost = count > 0 ? totalCost / count : 0;
    const avgWallTime = count > 0 ? totalWallTime / count : 0;

    const successRate = conditionSuccessRates?.[cond];
    const successStr = successRate !== undefined
      ? `${Math.round(successRate * 100)}%`
      : '—';

    const totalTests = avgTestsPass + avgTestsFail;
    const testsStr = totalTests > 0
      ? `${Math.round(avgTestsPass)}/${Math.round(totalTests)}`
      : '—';

    const costStr = avgCost > 0 ? `$${avgCost.toFixed(2)}` : '—';
    const timeStr = avgWallTime > 0 ? formatTime(avgWallTime) : '—';

    lines.push(
      pad(cond, colWidths.condition) +
      pad(successStr, colWidths.success) +
      pad(testsStr, colWidths.tests) +
      pad(costStr, colWidths.cost) +
      pad(timeStr, colWidths.time),
    );
  }

  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ─── Markdown Export (FR-DSH-005) ──────────────────────────────────

/**
 * Pad a string to a given width (right-padded).
 */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/**
 * Pad a string to a given width (left-padded, for numbers).
 */
function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

/**
 * Build the ranking table from Section 9.3 in plain-text box-drawing format.
 */
function buildRankingTable(rankings: ConditionRanking[]): string {
  const lines: string[] = [];
  const colWidths = { rank: 4, condition: 32, ces: 7, delta: 10 };

  const hdr = () =>
    `\u2502 ${pad('#', colWidths.rank)}\u2502 ${pad('Condition', colWidths.condition)}\u2502 ${pad('CES', colWidths.ces)}\u2502 ${pad('vs. Best', colWidths.delta)}\u2502`;
  const sep = (left: string, mid: string, right: string, fill: string) =>
    `${left}${fill.repeat(colWidths.rank + 2)}${mid}${fill.repeat(colWidths.condition + 2)}${mid}${fill.repeat(colWidths.ces + 2)}${mid}${fill.repeat(colWidths.delta + 2)}${right}`;

  lines.push(sep('\u250C', '\u252C', '\u2510', '\u2500'));
  lines.push(hdr());
  lines.push(sep('\u251C', '\u253C', '\u2524', '\u2500'));

  for (const r of rankings) {
    const rankStr = padLeft(String(r.rank), colWidths.rank);
    const condStr = pad(r.condition, colWidths.condition);
    const cesStr = padLeft(r.compositeScore.toFixed(1), colWidths.ces);
    const deltaStr =
      r.deltaVsBest === 0
        ? padLeft('\u2014', colWidths.delta)
        : padLeft(
            `${r.deltaVsBest.toFixed(1)} ${sigIndicator(r.significance)}`,
            colWidths.delta,
          );
    lines.push(
      `\u2502 ${rankStr}\u2502 ${condStr}\u2502 ${cesStr}\u2502 ${deltaStr}\u2502`,
    );
  }

  lines.push(sep('\u2514', '\u2534', '\u2518', '\u2500'));
  return lines.join('\n');
}

/**
 * Build the condition comparison detail table in Markdown format.
 */
function buildComparisonMarkdown(
  aggregated: AggregatedResults[],
  comparisons: PairwiseComparison[],
): string {
  if (aggregated.length === 0) return '';

  // Group by scenario
  const scenarios = [...new Set(aggregated.map((a) => a.scenario))];
  const sections: string[] = [];

  for (const scenario of scenarios) {
    const scenarioResults = aggregated.filter((a) => a.scenario === scenario);
    const scenarioComparisons = comparisons.filter(
      (c) =>
        scenarioResults.some((r) => r.condition === c.conditionA) &&
        scenarioResults.some((r) => r.condition === c.conditionB),
    );

    sections.push(`### ${scenario}`);
    sections.push('');

    // Score dimensions table
    const dimensions = new Set<string>();
    for (const r of scenarioResults) {
      for (const key of Object.keys(r.scoreSummaries)) {
        dimensions.add(key);
      }
    }

    if (dimensions.size > 0) {
      const header = `| Condition | ${[...dimensions].join(' | ')} | Composite |`;
      const divider = `|${'-'.repeat(header.split('|').length - 2).split('').map(() => '---').join('|')}|`;

      sections.push(header);
      sections.push(divider);

      for (const r of scenarioResults) {
        const cells = [...dimensions].map((dim) => {
          const s = r.scoreSummaries[dim];
          return s ? `${s.mean.toFixed(1)} \u00B1 ${s.standardDeviation.toFixed(1)}` : 'N/A';
        });
        const comp = r.compositeScore;
        cells.push(`**${comp.mean.toFixed(1)}** \u00B1 ${comp.standardDeviation.toFixed(1)}`);
        sections.push(`| ${r.condition} | ${cells.join(' | ')} |`);
      }
    }

    // Pairwise significance
    if (scenarioComparisons.length > 0) {
      sections.push('');
      sections.push('**Pairwise Significance:**');
      sections.push('');
      for (const comp of scenarioComparisons) {
        const dir = comp.deltaPercent > 0 ? '+' : '';
        sections.push(
          `- ${comp.conditionA} vs ${comp.conditionB} (${comp.metric}): ${dir}${comp.deltaPercent.toFixed(1)}% ${sigIndicator(comp.significance)} (p=${comp.pValue.toFixed(3)})`,
        );
      }
    }

    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Format a StatisticalSummary into a human-readable string.
 */
function formatSummary(s: StatisticalSummary): string {
  return `${s.mean.toFixed(1)} \u00B1 ${s.standardDeviation.toFixed(1)} (n=${s.n}, range: ${s.min.toFixed(1)}\u2013${s.max.toFixed(1)})`;
}

/**
 * Build the full methodology summary section.
 */
function buildMethodology(report: BenchmarkReport): string {
  const conditions = [...new Set(report.aggregated.map((a) => a.condition))];
  const scenarios = [...new Set(report.aggregated.map((a) => a.scenario))];
  const iterations =
    report.aggregated.length > 0 ? report.aggregated[0]!.iterations : 0;

  return [
    '## Methodology',
    '',
    `- **Scenarios tested:** ${scenarios.join(', ')}`,
    `- **Conditions compared:** ${conditions.join(', ')}`,
    `- **Iterations per pair:** ${iterations}`,
    `- **Statistical test:** Mann-Whitney U (two-tailed, \u03B1=0.05)`,
    `- **Composite score:** Coordination Effectiveness Score (CES) — weighted average of quality dimensions minus overhead penalty`,
    '',
  ].join('\n');
}

/**
 * Export a benchmark report as a publication-ready Markdown document.
 * Follows the results summary template from PRD Section 9.3.
 */
export function exportMarkdown(report: BenchmarkReport): string {
  const sections: string[] = [];
  const timestamp = report.timestamp;

  // Determine verdict — find Twining vs best non-Twining
  const twiningRanking = report.ranking.find(
    (r) => r.condition === 'full-twining' || r.condition.toLowerCase().includes('twining'),
  );
  const bestNonTwining = report.ranking.find(
    (r) => r.condition !== twiningRanking?.condition,
  );

  let verdictLine: string;
  if (twiningRanking && bestNonTwining) {
    const delta = twiningRanking.compositeScore - bestNonTwining.compositeScore;
    if (delta > 0) {
      verdictLine = `Twining outperforms all alternatives by +${delta.toFixed(1)} points (CES)`;
    } else if (delta < 0) {
      verdictLine = `Twining underperforms best alternative by ${delta.toFixed(1)} points (CES)`;
    } else {
      verdictLine = `Twining tied with ${bestNonTwining.condition}`;
    }
  } else if (report.ranking.length > 0) {
    const top = report.ranking[0]!;
    verdictLine = `Best condition: ${top.condition} (CES: ${top.compositeScore.toFixed(1)})`;
  } else {
    verdictLine = 'No results available';
  }

  // Confidence line
  const sigComparisons = report.comparisons.filter(
    (c) => c.significance === 'significant',
  );
  const iterations =
    report.aggregated.length > 0 ? report.aggregated[0]!.iterations : 0;
  const highVarianceCount = report.aggregated.filter((a) =>
    a.compositeScore.highVariance,
  ).length;
  const varianceStatus =
    highVarianceCount === 0 ? 'low variance' : `${highVarianceCount} high-variance metrics`;
  const bestPValue = sigComparisons.length > 0
    ? Math.min(...sigComparisons.map((c) => c.pValue))
    : 1.0;
  const confidenceLevel =
    bestPValue < 0.01 && highVarianceCount === 0
      ? 'High'
      : bestPValue < 0.05
        ? 'Moderate'
        : 'Low';

  // Header (matches Section 9.3 template)
  sections.push(
    '# Twining Benchmark Results',
    '',
    `**Run:** ${report.runId}`,
    `**Date:** ${timestamp}`,
    '',
    `> **VERDICT:** ${verdictLine}`,
    `> **CONFIDENCE:** ${confidenceLevel} (p < ${bestPValue < 0.001 ? '0.001' : bestPValue.toFixed(2)}, ${iterations} runs, ${varianceStatus})`,
    '',
  );

  // Primary metrics table (before CES)
  const primaryMetrics = buildPrimaryMetricsTable(
    report.aggregated,
    report.conditionSuccessRates,
  );
  if (primaryMetrics) {
    sections.push(primaryMetrics);
  }

  // Ranking table
  sections.push('## Condition Ranking (by Composite Effectiveness Score)', '');
  sections.push('```');
  sections.push(buildRankingTable(report.ranking));
  sections.push('```');
  sections.push('');
  sections.push(
    `${sigIndicator('significant')} = statistically significant (p < 0.05) | ${sigIndicator('suggestive')} = suggestive (p < 0.10) | ${sigIndicator('not-distinguishable')} = not distinguishable`,
  );
  sections.push('');

  // Key findings
  const findings =
    report.keyFindings.length > 0
      ? report.keyFindings
      : generateKeyFindings(report);
  if (findings.length > 0) {
    sections.push('## Key Findings', '');
    for (const f of findings) {
      sections.push(`- ${f}`);
    }
    sections.push('');
  }

  // Methodology
  sections.push(buildMethodology(report));

  // Detailed comparison tables
  sections.push('## Detailed Results', '');
  sections.push(
    buildComparisonMarkdown(report.aggregated, report.comparisons),
  );

  // Token/cost summary
  const tokenSummaries = report.aggregated
    .filter((a) => a.metricSummaries.totalTokens.n > 0)
    .map(
      (a) => {
        const m = a.metricSummaries;
        const costStr = m.costUsd.mean > 0
          ? `$${m.costUsd.mean.toFixed(2)}/run`
          : `${formatSummary(m.totalTokens)} tokens`;
        return `- **${a.condition}** (${a.scenario}): ${costStr} | input: ${Math.round(m.inputTokens.mean).toLocaleString()} | output: ${Math.round(m.outputTokens.mean).toLocaleString()} | cache_read: ${Math.round(m.cacheReadTokens.mean).toLocaleString()} | turns: ${Math.round(m.numTurns.mean)} | compactions: ${Math.round(m.compactionCount.mean)}`;
      },
    );
  if (tokenSummaries.length > 0) {
    sections.push('## Resource Usage', '');
    sections.push(...tokenSummaries);
    sections.push('');
  }

  // Footer
  sections.push(
    '---',
    '',
    `*Generated by twining-bench on ${timestamp}*`,
    '',
  );

  return sections.join('\n');
}

// ─── CSV Export (FR-DSH-005) ───────────────────────────────────────

/**
 * Escape a CSV field value.
 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export scored results as CSV.
 * Each row is one iteration of one scenario/condition pair.
 */
export function exportCsv(results: ScoredResults[]): string {
  if (results.length === 0) return '';

  // Collect all dimension names across all results
  const allDimensions = new Set<string>();
  for (const r of results) {
    for (const dim of Object.keys(r.scores)) {
      allDimensions.add(dim);
    }
  }
  const dimensions = [...allDimensions].sort();

  // Header
  const headers = [
    'runId',
    'scenario',
    'condition',
    'iteration',
    'composite',
    ...dimensions.map((d) => `score_${d}`),
    ...dimensions.map((d) => `confidence_${d}`),
    ...dimensions.map((d) => `method_${d}`),
    'totalTokens',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheCreationTokens',
    'costUsd',
    'wallTimeMs',
    'agentSessions',
    'numTurns',
    'compactionCount',
    'contextUtilization',
    'linesAdded',
    'linesRemoved',
    'filesChanged',
    'reverts',
    'testsPass',
    'testsFail',
    'compiles',
  ];

  const rows: string[] = [headers.map(csvEscape).join(',')];

  for (const r of results) {
    const cells: string[] = [
      r.runId,
      r.scenario,
      r.condition,
      String(r.iteration),
      String(r.composite),
      ...dimensions.map((d) =>
        r.scores[d] !== undefined ? String(r.scores[d].value) : '',
      ),
      ...dimensions.map((d) =>
        r.scores[d] !== undefined ? r.scores[d].confidence : '',
      ),
      ...dimensions.map((d) =>
        r.scores[d] !== undefined ? r.scores[d].method : '',
      ),
      String(r.metrics.totalTokens),
      String(r.metrics.inputTokens),
      String(r.metrics.outputTokens),
      String(r.metrics.cacheReadTokens),
      String(r.metrics.cacheCreationTokens),
      String(r.metrics.costUsd),
      String(r.metrics.wallTimeMs),
      String(r.metrics.agentSessions),
      String(r.metrics.numTurns),
      String(r.metrics.compactionCount),
      String(r.metrics.contextUtilization),
      String(r.metrics.gitChurn.linesAdded),
      String(r.metrics.gitChurn.linesRemoved),
      String(r.metrics.gitChurn.filesChanged),
      String(r.metrics.gitChurn.reverts),
      String(r.metrics.testsPass),
      String(r.metrics.testsFail),
      String(r.metrics.compiles),
    ];
    rows.push(cells.map(csvEscape).join(','));
  }

  return rows.join('\n') + '\n';
}

/**
 * Export aggregated results as CSV (one row per scenario/condition pair).
 */
export function exportAggregatedCsv(aggregated: AggregatedResults[]): string {
  if (aggregated.length === 0) return '';

  const headers = [
    'scenario',
    'condition',
    'iterations',
    'composite_mean',
    'composite_median',
    'composite_stddev',
    'composite_ci_lower',
    'composite_ci_upper',
    'composite_high_variance',
    'totalTokens_mean',
    'inputTokens_mean',
    'outputTokens_mean',
    'cacheReadTokens_mean',
    'cacheCreationTokens_mean',
    'costUsd_mean',
    'wallTimeMs_mean',
    'numTurns_mean',
    'compactionCount_mean',
    'contextUtilization_mean',
    'linesAdded_mean',
    'linesRemoved_mean',
    'testsPass_mean',
    'testsFail_mean',
  ];

  const rows: string[] = [headers.map(csvEscape).join(',')];

  for (const a of aggregated) {
    const cs = a.compositeScore;
    const cells: string[] = [
      a.scenario,
      a.condition,
      String(a.iterations),
      String(cs.mean),
      String(cs.median),
      String(cs.standardDeviation),
      String(cs.confidenceInterval[0]),
      String(cs.confidenceInterval[1]),
      String(cs.highVariance),
      String(a.metricSummaries.totalTokens.mean),
      String(a.metricSummaries.inputTokens.mean),
      String(a.metricSummaries.outputTokens.mean),
      String(a.metricSummaries.cacheReadTokens.mean),
      String(a.metricSummaries.cacheCreationTokens.mean),
      String(a.metricSummaries.costUsd.mean),
      String(a.metricSummaries.wallTimeMs.mean),
      String(a.metricSummaries.numTurns.mean),
      String(a.metricSummaries.compactionCount.mean),
      String(a.metricSummaries.contextUtilization.mean),
      String(a.metricSummaries.gitChurn.linesAdded.mean),
      String(a.metricSummaries.gitChurn.linesRemoved.mean),
      String(a.metricSummaries.testsPass.mean),
      String(a.metricSummaries.testsFail.mean),
    ];
    rows.push(cells.map(csvEscape).join(','));
  }

  return rows.join('\n') + '\n';
}
