import { describe, it, expect } from 'vitest';
import {
  computeReworkRatio,
  computeLineSurvivalRate,
  computeContinuationIndex,
  analyzeWorkLeverage,
  workLeverageScore,
} from '../../../src/analyzer/work-leverage.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';

function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'test-session',
    runId: 'test-run',
    scenario: 'test',
    condition: 'baseline',
    taskIndex: 0,
    prompt: '',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, costUsd: 0 },
    timing: { startTime: '', endTime: '', durationMs: 0, timeToFirstActionMs: 0 },
    exitReason: 'completed',
    numTurns: 0,
    stopReason: '',
    contextWindowSize: 0,
    compactionCount: 0,
    turnUsage: [],
    ...overrides,
  };
}

describe('computeReworkRatio', () => {
  it('returns 0 when B does not remove any of A lines', () => {
    const a = makeTranscript({
      fileChanges: [{
        path: 'src/service.ts',
        changeType: 'modified',
        linesAdded: 3,
        linesRemoved: 0,
        diff: '+const x = 1;\n+const y = 2;\n+const z = 3;',
      }],
    });
    const b = makeTranscript({
      fileChanges: [{
        path: 'src/other.ts',
        changeType: 'added',
        linesAdded: 2,
        linesRemoved: 0,
        diff: '+const a = 10;\n+const b = 20;',
      }],
    });
    expect(computeReworkRatio(a, b)).toBe(0);
  });

  it('returns 1.0 when B removes all of A lines', () => {
    const a = makeTranscript({
      fileChanges: [{
        path: 'src/service.ts',
        changeType: 'modified',
        linesAdded: 2,
        linesRemoved: 0,
        diff: '+const x = 1;\n+const y = 2;',
      }],
    });
    const b = makeTranscript({
      fileChanges: [{
        path: 'src/service.ts',
        changeType: 'modified',
        linesAdded: 2,
        linesRemoved: 2,
        diff: '-const x = 1;\n-const y = 2;\n+const x = 10;\n+const y = 20;',
      }],
    });
    expect(computeReworkRatio(a, b)).toBe(1.0);
  });

  it('returns 0.5 when B removes half of A lines', () => {
    const a = makeTranscript({
      fileChanges: [{
        path: 'src/service.ts',
        changeType: 'modified',
        linesAdded: 2,
        linesRemoved: 0,
        diff: '+const x = 1;\n+const y = 2;',
      }],
    });
    const b = makeTranscript({
      fileChanges: [{
        path: 'src/service.ts',
        changeType: 'modified',
        linesAdded: 1,
        linesRemoved: 1,
        diff: '-const x = 1;\n+const x = 10;',
      }],
    });
    expect(computeReworkRatio(a, b)).toBe(0.5);
  });

  it('ignores non-source files', () => {
    const a = makeTranscript({
      fileChanges: [{
        path: 'COORDINATION.md',
        changeType: 'modified',
        linesAdded: 5,
        linesRemoved: 0,
        diff: '+line1\n+line2\n+line3\n+line4\n+line5',
      }],
    });
    const b = makeTranscript({
      fileChanges: [{
        path: 'COORDINATION.md',
        changeType: 'modified',
        linesAdded: 0,
        linesRemoved: 5,
        diff: '-line1\n-line2\n-line3\n-line4\n-line5',
      }],
    });
    // No source files → A added 0 source lines → ratio is 0
    expect(computeReworkRatio(a, b)).toBe(0);
  });
});

describe('computeLineSurvivalRate', () => {
  it('returns 1.0 when no later sessions remove lines', () => {
    const session = makeTranscript({
      fileChanges: [{
        path: 'src/a.ts',
        changeType: 'added',
        linesAdded: 3,
        linesRemoved: 0,
        diff: '+const a = 1;\n+const b = 2;\n+const c = 3;',
      }],
    });
    expect(computeLineSurvivalRate(session, [])).toBe(1.0);
  });

  it('returns 0 when all lines are removed by later sessions', () => {
    const session = makeTranscript({
      fileChanges: [{
        path: 'src/a.ts',
        changeType: 'added',
        linesAdded: 2,
        linesRemoved: 0,
        diff: '+const a = 1;\n+const b = 2;',
      }],
    });
    const later = makeTranscript({
      fileChanges: [{
        path: 'src/a.ts',
        changeType: 'modified',
        linesAdded: 0,
        linesRemoved: 2,
        diff: '-const a = 1;\n-const b = 2;',
      }],
    });
    expect(computeLineSurvivalRate(session, [later])).toBe(0);
  });
});

describe('computeContinuationIndex', () => {
  it('returns high value when B references A new symbols', () => {
    const a = makeTranscript({
      fileChanges: [{
        path: 'src/models/analytics.ts',
        changeType: 'added',
        linesAdded: 3,
        linesRemoved: 0,
        diff: '+export interface AnalyticsSummary {\n+  total: number;\n+}',
      }],
    });
    const b = makeTranscript({
      fileChanges: [{
        path: 'src/services/analytics.service.ts',
        changeType: 'added',
        linesAdded: 3,
        linesRemoved: 0,
        diff: "+import { AnalyticsSummary } from '../models/analytics';\n+const summary: AnalyticsSummary = { total: 0 };\n+export function getSummary() { return summary; }",
      }],
    });
    const idx = computeContinuationIndex(a, b);
    // 2 of 3 lines reference AnalyticsSummary
    expect(idx).toBeCloseTo(2 / 3, 1);
  });

  it('returns 0 when B does not reference A symbols', () => {
    const a = makeTranscript({
      fileChanges: [{
        path: 'src/models/user.ts',
        changeType: 'added',
        linesAdded: 1,
        linesRemoved: 0,
        diff: '+export class UserModel {}',
      }],
    });
    const b = makeTranscript({
      fileChanges: [{
        path: 'src/services/cache.ts',
        changeType: 'added',
        linesAdded: 2,
        linesRemoved: 0,
        diff: '+const cache = new Map();\n+export function getCache() { return cache; }',
      }],
    });
    expect(computeContinuationIndex(a, b)).toBe(0);
  });
});

describe('analyzeWorkLeverage', () => {
  it('handles single session', () => {
    const session = makeTranscript({
      fileChanges: [{
        path: 'src/a.ts',
        changeType: 'added',
        linesAdded: 1,
        linesRemoved: 0,
        diff: '+const x = 1;',
      }],
    });
    const result = analyzeWorkLeverage([session]);
    expect(result.reworkRatios).toHaveLength(0);
    expect(result.lineSurvivalRates).toHaveLength(1);
    expect(result.lineSurvivalRates[0]).toBe(1.0);
    expect(result.continuationIndices).toHaveLength(0);
  });

  it('produces valid results for two sessions', () => {
    const a = makeTranscript({
      fileChanges: [{
        path: 'src/a.ts',
        changeType: 'added',
        linesAdded: 2,
        linesRemoved: 0,
        diff: '+export class Foo {}\n+const bar = 1;',
      }],
    });
    const b = makeTranscript({
      fileChanges: [{
        path: 'src/b.ts',
        changeType: 'added',
        linesAdded: 1,
        linesRemoved: 0,
        diff: '+import { Foo } from "./a";',
      }],
    });
    const result = analyzeWorkLeverage([a, b]);
    expect(result.reworkRatios).toHaveLength(1);
    expect(result.reworkRatios[0]).toBe(0); // B didn't remove A's lines
    expect(result.continuationIndices).toHaveLength(1);
    expect(result.continuationIndices[0]).toBe(1.0); // B's only line references Foo
    expect(result.lineSurvivalRates).toHaveLength(2);
  });
});

describe('workLeverageScore', () => {
  it('returns 100 for perfect leverage', () => {
    const score = workLeverageScore({
      reworkRatios: [0],
      avgReworkRatio: 0,
      lineSurvivalRates: [1, 1],
      avgLineSurvivalRate: 1,
      continuationIndices: [1],
      avgContinuationIndex: 1,
    });
    expect(score).toBe(100);
  });

  it('returns 40 for complete rework with zero continuation', () => {
    const score = workLeverageScore({
      reworkRatios: [1],
      avgReworkRatio: 1,
      lineSurvivalRates: [0],
      avgLineSurvivalRate: 0,
      continuationIndices: [0],
      avgContinuationIndex: 0,
    });
    expect(score).toBe(0);
  });
});
