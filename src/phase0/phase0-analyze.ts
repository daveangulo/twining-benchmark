#!/usr/bin/env tsx
/**
 * Phase 0: Analysis & Report Generator
 *
 * Reads Phase 0 results and produces a comprehensive markdown report
 * comparing conditions on all primary KPIs, with effect sizes and
 * go/no-go recommendation.
 *
 * PRD Section 10 — Phase 0 deliverable #2.
 *
 * Usage:
 *   npx tsx src/phase0/phase0-analyze.ts
 *   npx tsx src/phase0/phase0-analyze.ts --input ./benchmark-results/phase0
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  computeSummary,
  cohensD,
  interpretEffectSize,
  mannWhitneyU,
} from '../analyzer/statistics.js';
import type { StatisticalSummary } from '../types/results.js';
import type { ConditionName } from '../types/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Phase0RunResult {
  runId: string;
  scenario: string;
  condition: ConditionName;
  iteration: number;
  timestamp: string;
  sessions: Phase0SessionResult[];
  scoredResults: {
    runId: string;
    scenario: string;
    condition: string;
    iteration: number;
    scores: Record<string, { value: number; confidence: string; method: string; justification: string }>;
    metrics: {
      totalTokens: number;
      wallTimeMs: number;
      agentSessions: number;
      gitChurn: { linesAdded: number; linesRemoved: number; filesChanged: number; reverts: number };
      testsPass: number;
      testsFail: number;
      compiles: boolean;
    };
    composite: number;
  };
  wallTimeMs: number;
  errors: string[];
}

interface Phase0SessionResult {
  sessionId: string;
  taskIndex: number;
  prompt: string;
  exitReason: string;
  tokenUsage: { input: number; output: number; total: number };
  timing: { durationMs: number; timeToFirstActionMs: number };
  toolCallCount: number;
  fileChanges: Array<{ path: string; changeType: string; linesAdded: number; linesRemoved: number }>;
  error?: string;
}

interface ConditionAnalysis {
  condition: ConditionName;
  runCount: number;
  composite: StatisticalSummary;
  consistency: StatisticalSummary;
  rework: StatisticalSummary;
  completion: StatisticalSummary;
  totalTokens: StatisticalSummary;
  wallTimeMs: StatisticalSummary;
  linesAdded: StatisticalSummary;
  linesRemoved: StatisticalSummary;
  filesChanged: StatisticalSummary;
  testsPass: StatisticalSummary;
  costPerRun: StatisticalSummary;
}

interface PairwiseEffectSize {
  conditionA: ConditionName;
  conditionB: ConditionName;
  metric: string;
  cohensD: number;
  interpretation: string;
  pValue: number;
  significance: string;
  meanA: number;
  meanB: number;
  delta: number;
  deltaPercent: number;
}

type GoNoGoSignal = 'green' | 'yellow' | 'red';

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseCliArgs(): { inputDir: string; outputDir: string } {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: resolve('benchmark-results/phase0') },
      output: { type: 'string' },
    },
    strict: true,
  });

  const inputDir = values.input ?? resolve('benchmark-results/phase0');
  const outputDir = values.output ?? inputDir;
  return { inputDir, outputDir };
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function analyzeCondition(
  condition: ConditionName,
  results: Phase0RunResult[],
): ConditionAnalysis {
  const composites = results.map(r => r.scoredResults.composite);
  const consistencies = results.map(r => r.scoredResults.scores['consistency']?.value ?? 0);
  const reworks = results.map(r => r.scoredResults.scores['rework']?.value ?? 0);
  const completions = results.map(r => r.scoredResults.scores['completion']?.value ?? 0);
  const tokens = results.map(r => r.scoredResults.metrics.totalTokens);
  const wallTimes = results.map(r => r.wallTimeMs);
  const added = results.map(r => r.scoredResults.metrics.gitChurn.linesAdded);
  const removed = results.map(r => r.scoredResults.metrics.gitChurn.linesRemoved);
  const files = results.map(r => r.scoredResults.metrics.gitChurn.filesChanged);
  const tests = results.map(r => r.scoredResults.metrics.testsPass);
  const costs = tokens.map(t => estimateCost(t));

  return {
    condition,
    runCount: results.length,
    composite: computeSummary(composites),
    consistency: computeSummary(consistencies),
    rework: computeSummary(reworks),
    completion: computeSummary(completions),
    totalTokens: computeSummary(tokens),
    wallTimeMs: computeSummary(wallTimes),
    linesAdded: computeSummary(added),
    linesRemoved: computeSummary(removed),
    filesChanged: computeSummary(files),
    testsPass: computeSummary(tests),
    costPerRun: computeSummary(costs),
  };
}

function computeEffectSizes(
  results: Map<ConditionName, Phase0RunResult[]>,
): PairwiseEffectSize[] {
  const conditions = [...results.keys()];
  const effects: PairwiseEffectSize[] = [];
  const metrics = ['composite', 'consistency', 'rework', 'completion', 'totalTokens'] as const;

  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++) {
      const a = conditions[i]!;
      const b = conditions[j]!;
      const resultsA = results.get(a)!;
      const resultsB = results.get(b)!;

      for (const metric of metrics) {
        const valuesA = extractMetricValues(resultsA, metric);
        const valuesB = extractMetricValues(resultsB, metric);

        if (valuesA.length < 2 || valuesB.length < 2) continue;

        const d = cohensD(valuesA, valuesB);
        const { pValue } = mannWhitneyU(valuesA, valuesB);
        const meanA = valuesA.reduce((s, v) => s + v, 0) / valuesA.length;
        const meanB = valuesB.reduce((s, v) => s + v, 0) / valuesB.length;
        const delta = meanA - meanB;
        const deltaPercent = meanB !== 0 ? (delta / Math.abs(meanB)) * 100 : 0;

        effects.push({
          conditionA: a,
          conditionB: b,
          metric,
          cohensD: d,
          interpretation: interpretEffectSize(d),
          pValue,
          significance: pValue < 0.05 ? 'significant' : pValue < 0.10 ? 'suggestive' : 'not-distinguishable',
          meanA,
          meanB,
          delta,
          deltaPercent,
        });
      }
    }
  }

  return effects;
}

function extractMetricValues(
  results: Phase0RunResult[],
  metric: string,
): number[] {
  switch (metric) {
    case 'composite':
      return results.map(r => r.scoredResults.composite);
    case 'consistency':
      return results.map(r => r.scoredResults.scores['consistency']?.value ?? 0);
    case 'rework':
      return results.map(r => r.scoredResults.scores['rework']?.value ?? 0);
    case 'completion':
      return results.map(r => r.scoredResults.scores['completion']?.value ?? 0);
    case 'totalTokens':
      return results.map(r => r.scoredResults.metrics.totalTokens);
    default:
      return [];
  }
}

function determineGoNoGo(
  effectSizes: PairwiseEffectSize[],
  analyses: Map<ConditionName, ConditionAnalysis>,
): { signal: GoNoGoSignal; reason: string } {
  // Look for detectable effect (d > 0.5) between full-twining and baseline
  const twinVsBaseline = effectSizes.filter(
    e =>
      (e.conditionA === 'full-twining' && e.conditionB === 'baseline') ||
      (e.conditionA === 'baseline' && e.conditionB === 'full-twining'),
  );

  const hasLargeEffect = twinVsBaseline.some(e => Math.abs(e.cohensD) > 0.8);
  const hasMediumEffect = twinVsBaseline.some(e => Math.abs(e.cohensD) > 0.5);
  const hasSignificantResult = twinVsBaseline.some(e => e.pValue < 0.05);
  const hasSuggestiveResult = twinVsBaseline.some(e => e.pValue < 0.10);

  // Check if all conditions have enough runs
  const twinAnalysis = analyses.get('full-twining');
  const baselineAnalysis = analyses.get('baseline');
  const minRuns = Math.min(twinAnalysis?.runCount ?? 0, baselineAnalysis?.runCount ?? 0);

  if (minRuns < 3) {
    return {
      signal: 'yellow',
      reason: `Insufficient runs (${minRuns} per condition, need >= 3). Cannot determine signal reliability.`,
    };
  }

  // Check for high variance
  const highVarianceMetrics = twinVsBaseline.filter(e => {
    const a = analyses.get(e.conditionA as ConditionName);
    const metricKey = e.metric as keyof ConditionAnalysis;
    const summary = a?.[metricKey] as StatisticalSummary | undefined;
    return summary?.highVariance ?? false;
  });

  if (hasLargeEffect && hasSignificantResult) {
    return {
      signal: 'green',
      reason: 'Large effect size (d > 0.8) with statistical significance (p < 0.05) detected between Twining and baseline. Methodology validated.',
    };
  }

  if (hasMediumEffect && hasSuggestiveResult) {
    return {
      signal: 'green',
      reason: 'Medium effect size (d > 0.5) with suggestive significance (p < 0.10) detected. Methodology shows promise; more runs recommended for Phase 1.',
    };
  }

  if (hasMediumEffect && !hasSuggestiveResult) {
    return {
      signal: 'yellow',
      reason: 'Medium effect size detected but not statistically significant. Likely need more runs (increase to 5-7 per condition) or the scenario may need more complexity.',
    };
  }

  if (highVarianceMetrics.length > 0) {
    return {
      signal: 'yellow',
      reason: `High variance in ${highVarianceMetrics.map(e => e.metric).join(', ')}. LLM non-determinism may be masking the signal. Need more runs or tighter scenario control.`,
    };
  }

  return {
    signal: 'red',
    reason: 'No detectable effect size (d < 0.5) between Twining and baseline on any primary KPI. Possible causes: (a) scenario not differentiating enough, (b) Twining\'s benefits don\'t manifest in this task, (c) need fundamentally different approach.',
  };
}

// ─── Cost Estimation ──────────────────────────────────────────────────────────

function estimateCost(totalTokens: number): number {
  const inputTokens = totalTokens * 0.7;
  const outputTokens = totalTokens * 0.3;
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

function projectFullSuiteCost(
  costPerRun: number,
): { scenarios: number; conditions: number; runs: number; totalRuns: number; projected: number } {
  // Full Phase 1+: 5 scenarios x 6 conditions x 3 runs
  const scenarios = 5;
  const conditions = 6;
  const runs = 3;
  const totalRuns = scenarios * conditions * runs;
  return {
    scenarios,
    conditions,
    runs,
    totalRuns,
    projected: costPerRun * totalRuns,
  };
}

// ─── Report Generation ───────────────────────────────────────────────────────

function generateReport(
  results: Phase0RunResult[],
  analyses: Map<ConditionName, ConditionAnalysis>,
  effectSizes: PairwiseEffectSize[],
  goNoGo: { signal: GoNoGoSignal; reason: string },
): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString().split('T')[0];

  // Header
  lines.push('# Phase 0: Concept Validation Report');
  lines.push('');
  lines.push(`**Generated:** ${timestamp}`);
  lines.push(`**Total Runs:** ${results.length}`);
  lines.push(`**Conditions Tested:** ${[...analyses.keys()].join(', ')}`);
  lines.push(`**Scenario:** refactoring-handoff`);
  lines.push('');

  // Go/No-Go
  const signalEmoji = goNoGo.signal === 'green' ? 'GREEN' : goNoGo.signal === 'yellow' ? 'YELLOW' : 'RED';
  lines.push('---');
  lines.push('');
  lines.push(`## Go/No-Go: ${signalEmoji}`);
  lines.push('');
  lines.push(`> ${goNoGo.reason}`);
  lines.push('');

  // Composite Score Ranking
  lines.push('---');
  lines.push('');
  lines.push('## Composite Score Ranking');
  lines.push('');
  lines.push('| # | Condition | Composite (mean) | Std Dev | 95% CI | Runs |');
  lines.push('|---|-----------|-----------------|---------|--------|------|');

  const ranked = [...analyses.entries()]
    .sort((a, b) => b[1].composite.mean - a[1].composite.mean);

  ranked.forEach(([condition, analysis], idx) => {
    const ci = analysis.composite.confidenceInterval;
    lines.push(
      `| ${idx + 1} | ${condition} | ${analysis.composite.mean.toFixed(1)} | ${analysis.composite.standardDeviation.toFixed(1)} | [${ci[0].toFixed(1)}, ${ci[1].toFixed(1)}] | ${analysis.runCount} |`,
    );
  });

  lines.push('');

  // Per-Dimension Comparison
  lines.push('---');
  lines.push('');
  lines.push('## Per-Dimension Scores');
  lines.push('');
  lines.push('| Condition | Consistency | Rework | Completion | Composite |');
  lines.push('|-----------|------------|--------|------------|-----------|');

  for (const [condition, analysis] of ranked) {
    lines.push(
      `| ${condition} | ${analysis.consistency.mean.toFixed(1)} (${analysis.consistency.standardDeviation.toFixed(1)}) | ${analysis.rework.mean.toFixed(1)} (${analysis.rework.standardDeviation.toFixed(1)}) | ${analysis.completion.mean.toFixed(1)} (${analysis.completion.standardDeviation.toFixed(1)}) | ${analysis.composite.mean.toFixed(1)} (${analysis.composite.standardDeviation.toFixed(1)}) |`,
    );
  }

  lines.push('');

  // Resource Usage
  lines.push('---');
  lines.push('');
  lines.push('## Resource Usage');
  lines.push('');
  lines.push('| Condition | Avg Tokens | Avg Wall Time | Avg Cost/Run | Lines Added | Lines Removed |');
  lines.push('|-----------|-----------|--------------|-------------|-------------|---------------|');

  for (const [condition, analysis] of ranked) {
    const wallTimeMin = (analysis.wallTimeMs.mean / 60000).toFixed(1);
    lines.push(
      `| ${condition} | ${Math.round(analysis.totalTokens.mean).toLocaleString()} | ${wallTimeMin}m | $${analysis.costPerRun.mean.toFixed(2)} | ${Math.round(analysis.linesAdded.mean)} | ${Math.round(analysis.linesRemoved.mean)} |`,
    );
  }

  lines.push('');

  // Effect Sizes
  lines.push('---');
  lines.push('');
  lines.push('## Effect Sizes (Cohen\'s d)');
  lines.push('');
  lines.push('| Comparison | Metric | Cohen\'s d | Interpretation | p-value | Significance | Mean A | Mean B | Delta % |');
  lines.push('|-----------|--------|----------|---------------|---------|-------------|--------|--------|---------|');

  for (const effect of effectSizes) {
    const sigIcon = effect.significance === 'significant' ? 'p<0.05' :
      effect.significance === 'suggestive' ? 'p<0.10' : 'n.s.';
    lines.push(
      `| ${effect.conditionA} vs ${effect.conditionB} | ${effect.metric} | ${effect.cohensD.toFixed(2)} | ${effect.interpretation} | ${effect.pValue.toFixed(3)} | ${sigIcon} | ${effect.meanA.toFixed(1)} | ${effect.meanB.toFixed(1)} | ${effect.deltaPercent >= 0 ? '+' : ''}${effect.deltaPercent.toFixed(1)}% |`,
    );
  }

  lines.push('');

  // Cost Projection
  lines.push('---');
  lines.push('');
  lines.push('## Cost Projection');
  lines.push('');

  const allCosts = results.map(r => estimateCost(r.scoredResults.metrics.totalTokens));
  const avgCost = allCosts.reduce((s, c) => s + c, 0) / (allCosts.length || 1);
  const totalPhase0Cost = allCosts.reduce((s, c) => s + c, 0);
  const projection = projectFullSuiteCost(avgCost);

  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Phase 0 actual cost | $${totalPhase0Cost.toFixed(2)} |`);
  lines.push(`| Avg cost per run | $${avgCost.toFixed(2)} |`);
  lines.push(`| Full suite: ${projection.scenarios} scenarios x ${projection.conditions} conditions x ${projection.runs} runs | ${projection.totalRuns} runs |`);
  lines.push(`| Projected full suite cost | $${projection.projected.toFixed(2)} |`);

  lines.push('');

  // Variance Analysis
  lines.push('---');
  lines.push('');
  lines.push('## Variance Analysis');
  lines.push('');

  const highVarianceEntries: string[] = [];
  for (const [condition, analysis] of analyses) {
    const metricChecks = [
      { name: 'composite', summary: analysis.composite },
      { name: 'consistency', summary: analysis.consistency },
      { name: 'rework', summary: analysis.rework },
      { name: 'completion', summary: analysis.completion },
    ];

    for (const check of metricChecks) {
      if (check.summary.highVariance) {
        highVarianceEntries.push(
          `- **${condition}/${check.name}**: CV=${((check.summary.standardDeviation / (check.summary.mean || 1)) * 100).toFixed(1)}% (threshold: 20%)`,
        );
      }
    }
  }

  if (highVarianceEntries.length > 0) {
    lines.push('High-variance metrics (standard deviation > 20% of mean):');
    lines.push('');
    for (const entry of highVarianceEntries) {
      lines.push(entry);
    }
    lines.push('');
    lines.push('> High variance suggests more runs are needed to achieve stable results.');
  } else {
    lines.push('No metrics flagged as high variance. Results appear stable at current run count.');
  }

  lines.push('');

  // Per-Run Details
  lines.push('---');
  lines.push('');
  lines.push('## Per-Run Details');
  lines.push('');
  lines.push('| Run ID (short) | Condition | Iter | Composite | Consistency | Rework | Completion | Tokens | Errors |');
  lines.push('|---------------|-----------|------|-----------|-------------|--------|------------|--------|--------|');

  for (const result of results) {
    const shortId = result.runId.slice(0, 8);
    const s = result.scoredResults;
    lines.push(
      `| ${shortId} | ${result.condition} | ${result.iteration + 1} | ${s.composite.toFixed(1)} | ${s.scores['consistency']?.value.toFixed(1) ?? '-'} | ${s.scores['rework']?.value.toFixed(1) ?? '-'} | ${s.scores['completion']?.value.toFixed(1) ?? '-'} | ${s.metrics.totalTokens.toLocaleString()} | ${result.errors.length} |`,
    );
  }

  lines.push('');

  // Recommendations
  lines.push('---');
  lines.push('');
  lines.push('## Recommendations for Phase 1');
  lines.push('');

  if (goNoGo.signal === 'green') {
    lines.push('1. Proceed to Phase 1 with methodology validated');
    lines.push('2. Use the observed variance to set minimum run count (recommend 3-5 per condition)');
    lines.push('3. Focus analysis on the dimensions showing the strongest signal');
  } else if (goNoGo.signal === 'yellow') {
    lines.push('1. Increase run count to 5-7 per condition before proceeding');
    lines.push('2. Consider adding complexity to the refactoring-handoff scenario');
    lines.push('3. Re-run Phase 0 with adjustments and re-evaluate');
  } else {
    lines.push('1. Investigate root cause: review agent transcripts for qualitative insights');
    lines.push('2. Evaluate whether the scenario is sufficiently challenging');
    lines.push('3. Consider: are agents inherently capable enough that coordination overhead outweighs benefits?');
    lines.push('4. If the scenario is too simple, design a harder one before investing in full automation');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Report generated by phase0-analyze.ts*');
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { inputDir, outputDir } = parseCliArgs();

  console.log('');
  console.log('=== Phase 0: Analysis & Report Generator ===');
  console.log('');
  console.log(`  Input:  ${inputDir}`);
  console.log(`  Output: ${outputDir}`);
  console.log('');

  // Load results
  const resultsPath = join(inputDir, 'phase0-results.json');
  let rawData: string;
  try {
    rawData = await readFile(resultsPath, 'utf-8');
  } catch {
    console.error(`Error: Could not read ${resultsPath}`);
    console.error('Run phase0-runner.ts first to generate results.');
    process.exit(1);
  }

  const results = JSON.parse(rawData) as Phase0RunResult[];

  if (results.length === 0) {
    console.error('Error: No results found in phase0-results.json');
    process.exit(1);
  }

  console.log(`  Found ${results.length} run results`);

  // Group by condition
  const byCondition = new Map<ConditionName, Phase0RunResult[]>();
  for (const result of results) {
    const condition = result.condition as ConditionName;
    if (!byCondition.has(condition)) {
      byCondition.set(condition, []);
    }
    byCondition.get(condition)!.push(result);
  }

  console.log(`  Conditions: ${[...byCondition.keys()].join(', ')}`);
  for (const [condition, condResults] of byCondition) {
    console.log(`    ${condition}: ${condResults.length} runs`);
  }
  console.log('');

  // Analyze each condition
  const analyses = new Map<ConditionName, ConditionAnalysis>();
  for (const [condition, condResults] of byCondition) {
    analyses.set(condition, analyzeCondition(condition, condResults));
  }

  // Compute effect sizes between all pairs
  const effectSizes = computeEffectSizes(byCondition);

  // Determine go/no-go
  const goNoGo = determineGoNoGo(effectSizes, analyses);

  // Generate report
  const report = generateReport(results, analyses, effectSizes, goNoGo);

  // Save report
  const reportPath = join(outputDir, 'phase0-report.md');
  await writeFile(reportPath, report, 'utf-8');

  // Save analysis data as JSON for downstream tooling
  const analysisData = {
    timestamp: new Date().toISOString(),
    goNoGo,
    conditions: Object.fromEntries(analyses),
    effectSizes,
  };
  await writeFile(
    join(outputDir, 'phase0-analysis.json'),
    JSON.stringify(analysisData, null, 2),
    'utf-8',
  );

  // Print summary to console
  console.log('--- Go/No-Go ---');
  console.log('');
  const signalLabel = goNoGo.signal.toUpperCase();
  console.log(`  Signal: ${signalLabel}`);
  console.log(`  Reason: ${goNoGo.reason}`);
  console.log('');

  console.log('--- Composite Scores ---');
  console.log('');
  const sorted = [...analyses.entries()].sort(
    (a, b) => b[1].composite.mean - a[1].composite.mean,
  );
  for (const [condition, analysis] of sorted) {
    console.log(`  ${condition}: ${analysis.composite.mean.toFixed(1)} +/- ${analysis.composite.standardDeviation.toFixed(1)}`);
  }
  console.log('');

  // Key effect sizes
  console.log('--- Key Effect Sizes ---');
  console.log('');
  const keyEffects = effectSizes.filter(
    e =>
      (e.conditionA === 'full-twining' || e.conditionB === 'full-twining') &&
      (e.conditionA === 'baseline' || e.conditionB === 'baseline'),
  );
  for (const effect of keyEffects) {
    console.log(
      `  ${effect.metric}: d=${effect.cohensD.toFixed(2)} (${effect.interpretation}), p=${effect.pValue.toFixed(3)}`,
    );
  }
  console.log('');

  console.log(`Report saved to: ${reportPath}`);
  console.log(`Analysis data saved to: ${join(outputDir, 'phase0-analysis.json')}`);
  console.log('');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
