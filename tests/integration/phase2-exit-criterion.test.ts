import { describe, it, expect } from 'vitest';
import { getAllScenarioNames, getScenario, resolveScenarioNames } from '../../src/scenarios/registry.js';
import { getAllConditionNames, getCondition, resolveConditionNames } from '../../src/conditions/registry.js';
import { exportMarkdown, generateKeyFindings } from '../../src/results/exporter.js';
import {
  calculateCes,
  aggregateResults,
  rankConditions,
  calculateEfficacyScore,
  generatePairwiseComparisons,
  type CesInputMetrics,
} from '../../src/analyzer/composite-scorer.js';
import { buildReport } from '../../src/cli/commands/results.js';
import { DEFAULT_SCORE_WEIGHTS } from '../../src/types/config.js';
import type { ScoredResults, BenchmarkReport, AggregatedResults } from '../../src/types/results.js';
import type { RunMetadata } from '../../src/types/run.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';
import { pairedTTest, wilcoxonSignedRank } from '../../src/analyzer/statistics.js';

// --- Helpers ---

function makeScoredResult(overrides: Partial<ScoredResults> = {}): ScoredResults {
  return {
    runId: 'test-run',
    scenario: 'multi-session-build',
    condition: 'full-twining',
    iteration: 1,
    scores: {
      consistency: { value: 85, confidence: 'high', method: 'llm-judge', justification: '' },
      integration: { value: 90, confidence: 'high', method: 'automated', justification: '' },
      redundancy: { value: 75, confidence: 'medium', method: 'llm-judge', justification: '' },
      coherence: { value: 80, confidence: 'medium', method: 'llm-judge', justification: '' },
    },
    metrics: {
      totalTokens: 150000,
      inputTokens: 120000,
      outputTokens: 30000,
      cacheReadTokens: 20000,
      cacheCreationTokens: 5000,
      costUsd: 0.75,
      wallTimeMs: 45000,
      agentSessions: 3,
      numTurns: 20,
      compactionCount: 1,
      contextUtilization: 0.7,
      gitChurn: { linesAdded: 150, linesRemoved: 30, filesChanged: 8, reverts: 0 },
      testsPass: 15,
      testsFail: 0,
      compiles: true,
    },
    composite: 82.5,
    ...overrides,
  };
}

function makeMetadata(): RunMetadata {
  return {
    id: 'phase2-exit-test',
    timestamp: '2026-02-23T00:00:00Z',
    config: DEFAULT_CONFIG,
    scenarios: ['multi-session-build'],
    conditions: ['baseline', 'full-twining'],
    runsPerPair: 3,
    environment: {
      nodeVersion: 'v20.0.0',
      platform: 'darwin',
      claudeModel: 'claude-sonnet-4-5-20250929',
    },
    status: 'completed',
    duration: 120000,
  };
}

describe('Phase 2 Exit Criterion', () => {
  describe('All 5 scenarios resolve from registry', () => {
    const expectedScenarios = [
      'refactoring-handoff',
      'architecture-cascade',
      'bug-investigation',
      'multi-session-build',
      'scale-stress-test',
    ] as const;

    it('registry contains all 5 scenarios', () => {
      const names = getAllScenarioNames();
      for (const expected of expectedScenarios) {
        expect(names).toContain(expected);
      }
    });

    it('each scenario can be resolved by name', () => {
      for (const name of expectedScenarios) {
        const entry = getScenario(name);
        expect(entry).toBeDefined();
        expect(entry.metadata.name).toBe(name);
        expect(typeof entry.create).toBe('function');
      }
    });

    it('each scenario creates a valid instance', () => {
      for (const name of expectedScenarios) {
        const entry = getScenario(name);
        const instance = entry.create();
        expect(instance).toBeDefined();
      }
    });
  });

  describe('All 6 conditions resolve from registry', () => {
    const expectedConditions = [
      'baseline',
      'claude-md-only',
      'shared-markdown',
      'file-reload-generic',
      'file-reload-structured',
      'full-twining',
    ] as const;

    it('registry contains all 6 conditions', () => {
      const names = getAllConditionNames();
      for (const expected of expectedConditions) {
        expect(names).toContain(expected);
      }
    });

    it('each condition can be resolved by name', () => {
      for (const name of expectedConditions) {
        const entry = getCondition(name);
        expect(entry).toBeDefined();
        expect(entry.name).toBe(name);
        expect(typeof entry.create).toBe('function');
      }
    });

    it('resolveConditionNames("all") returns all 6', () => {
      const names = resolveConditionNames('all');
      expect(names).toHaveLength(6);
    });
  });

  describe('CES calculation matches PRD formula', () => {
    it('perfect metrics produce expected CES with default weights', () => {
      const metrics: CesInputMetrics = {
        contradictionRate: 0,
        testPassRate: 1,
        redundantWorkPct: 0,
        architecturalCoherence: 5,
        coordinationOverheadRatio: 0,
      };

      const result = calculateCes(metrics);

      // CES = 0.25*100 + 0.30*100 + 0.20*100 + 0.15*100 - 0.10*0 = 90
      expect(result.totalCes).toBeCloseTo(90, 0);
    });

    it('overhead penalty follows smooth linear formula: ratio * 100', () => {
      const metrics: CesInputMetrics = {
        contradictionRate: 0,
        testPassRate: 1,
        redundantWorkPct: 0,
        architecturalCoherence: 5,
        coordinationOverheadRatio: 0.25,
      };

      const result = calculateCes(metrics);
      // overhead_penalty = 0.25 * 100 = 25
      expect(result.overheadPenalty).toBeCloseTo(25, 0);
      // CES = 90 - 0.10*25 = 87.5
      expect(result.totalCes).toBeCloseTo(87.5, 0);
    });
  });

  describe('BenchmarkReport can be built from mock ScoredResults', () => {
    it('builds report with correct structure', () => {
      const metadata = makeMetadata();
      const scores = [
        // 3 iterations of full-twining
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
        makeScoredResult({ condition: 'full-twining', iteration: 3, composite: 83 }),
        // 3 iterations of baseline
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 55 }),
        makeScoredResult({ condition: 'baseline', iteration: 2, composite: 58 }),
        makeScoredResult({ condition: 'baseline', iteration: 3, composite: 52 }),
      ];

      const report = buildReport(metadata, scores);

      expect(report.runId).toBe('phase2-exit-test');
      expect(report.aggregated).toHaveLength(2);
      expect(report.ranking).toHaveLength(2);
      expect(report.ranking[0]!.condition).toBe('full-twining');
      expect(report.ranking[0]!.rank).toBe(1);
      expect(report.efficacyScore).toBeGreaterThan(0);
    });
  });

  describe('exportMarkdown produces Section 9.3 template', () => {
    it('contains VERDICT, CONFIDENCE, ranking table, and key findings', () => {
      const metadata = makeMetadata();
      const scores = [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'full-twining', iteration: 2, composite: 88 }),
        makeScoredResult({ condition: 'full-twining', iteration: 3, composite: 83 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 55 }),
        makeScoredResult({ condition: 'baseline', iteration: 2, composite: 58 }),
        makeScoredResult({ condition: 'baseline', iteration: 3, composite: 52 }),
      ];

      const report = buildReport(metadata, scores);
      const markdown = exportMarkdown(report);

      // Section 9.3 template requirements
      expect(markdown).toContain('VERDICT');
      expect(markdown).toContain('CONFIDENCE');
      expect(markdown).toContain('Condition Ranking');
      expect(markdown).toContain('full-twining');
      expect(markdown).toContain('baseline');
      expect(markdown).toContain('Methodology');
      expect(markdown).toContain('Detailed Results');

      // Significance indicators should be present
      expect(markdown).toMatch(/[🟢🟡🔴]/);

      // Box-drawing table characters
      expect(markdown).toContain('┌');
      expect(markdown).toContain('│');
      expect(markdown).toContain('└');
    });

    it('contains resource usage section', () => {
      const metadata = makeMetadata();
      const scores = [
        makeScoredResult({ condition: 'full-twining', iteration: 1, composite: 85 }),
        makeScoredResult({ condition: 'baseline', iteration: 1, composite: 55 }),
      ];

      const report = buildReport(metadata, scores);
      const markdown = exportMarkdown(report);

      expect(markdown).toContain('Resource Usage');
    });
  });

  describe('Paired statistical tests (FR-ANL-003)', () => {
    it('pairedTTest detects significant paired difference', () => {
      const pairs: [number, number][] = [
        [85, 55],
        [88, 58],
        [83, 52],
        [87, 56],
        [90, 60],
      ];

      const result = pairedTTest(pairs);
      expect(result.pValue).toBeLessThan(0.01);
      expect(result.tStatistic).toBeGreaterThan(5);
    });

    it('wilcoxonSignedRank provides non-parametric alternative', () => {
      const pairs: [number, number][] = [
        [85, 55],
        [88, 58],
        [83, 52],
        [87, 56],
        [90, 60],
      ];

      const result = wilcoxonSignedRank(pairs);
      expect(result.pValue).toBeLessThan(0.1);
    });
  });

  describe('New target types', () => {
    it('GeneratedRepoTarget can be imported', async () => {
      const { GeneratedRepoTarget } = await import('../../src/targets/generator/index.js');
      const target = new GeneratedRepoTarget({
        fileCount: 10,
        moduleCount: 2,
        dependencyDepth: 1,
        testCoverage: 0,
        documentationLevel: 'none',
        seed: 'test',
      });
      expect(target.name).toBe('generated-repo');
    });

    it('ExternalRepoTarget can be imported', async () => {
      const { ExternalRepoTarget } = await import('../../src/targets/external/index.js');
      const target = new ExternalRepoTarget({
        gitUrl: 'https://github.com/example/repo.git',
        branch: 'main',
        setupCommands: [],
        manifest: {
          name: 'test',
          description: 'test',
          decisions: [],
          moduleDependencies: {},
          baselineTestCoverage: 0,
        },
      });
      expect(target.name).toBe('external-repo');
    });
  });
});
