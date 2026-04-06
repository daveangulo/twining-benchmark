import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ContextRecoveryScenario,
  CONTEXT_RECOVERY_GROUND_TRUTH,
  createContextRecoveryScenario,
} from '../../../src/scenarios/context-recovery.js';
import type { WorkingDirectory } from '../../../src/types/target.js';
import type { ConditionContext } from '../../../src/types/condition.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';
import type { ScenarioRunner, RawResults } from '../../../src/types/scenario.js';

/** Create a minimal working directory stub. */
function makeWorkingDir(path = '/tmp/test-repo'): WorkingDirectory {
  return {
    path,
    gitDir: `${path}/.git`,
    cleanup: async () => {},
  };
}

/** Create a minimal condition context stub. */
function makeConditionContext(): ConditionContext {
  return {
    agentConfig: {
      systemPrompt: '',
      mcpServers: {},
      allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
      permissionMode: 'acceptEdits',
    },
    setupFiles: [],
    metadata: { conditionName: 'baseline' },
  };
}

/** Create a mock transcript for testing scoring. */
function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'test-session',
    runId: 'test-run',
    scenario: 'context-recovery',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0, total: 1500, costUsd: 0.01 },
    timing: {
      startTime: '2026-03-08T10:00:00Z',
      endTime: '2026-03-08T10:05:00Z',
      durationMs: 300000,
      timeToFirstActionMs: 10000,
    },
    exitReason: 'completed',
    numTurns: 5,
    stopReason: 'success',
    contextWindowSize: 200000,
    compactionCount: 0,
    turnUsage: [],
    ...overrides,
  };
}

describe('ContextRecoveryScenario', () => {
  let scenario: ContextRecoveryScenario;

  beforeEach(() => {
    scenario = new ContextRecoveryScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario metadata', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('context-recovery');
      expect(meta.agentSessionCount).toBe(2);
      expect(meta.scoringDimensions).toEqual([
        'orientation-efficiency',
        'redundant-rework',
        'completion',
        'context-accuracy',
      ]);
      expect(meta.excludeFromAll).toBe(false);
      expect(meta.requiredTargetType).toBe('service-with-dependency');
    });

    it('is not excluded from --scenario all', () => {
      const meta = scenario.getMetadata();
      expect(meta.excludeFromAll).toBe(false);
    });
  });

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('returns 2 tasks in correct order (sequential)', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].sequenceOrder).toBe(0);
      expect(tasks[1].sequenceOrder).toBe(1);
      expect(tasks[0].role).toBe('original-developer');
      expect(tasks[1].role).toBe('recovery-agent');
    });

    it('Agent A has shorter timeout than Agent B', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].timeoutMs).toBe(3 * 60 * 1000); // 3 minutes
      expect(tasks[1].timeoutMs).toBe(15 * 60 * 1000); // 15 minutes
      expect(tasks[0].timeoutMs).toBeLessThan(tasks[1].timeoutMs);
    });

    it('both prompts mention analytics', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].prompt.toLowerCase()).toContain('analytics');
      expect(tasks[1].prompt.toLowerCase()).toContain('analytics');
    });

    it('Agent B prompt mentions "previous developer" and "review"', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[1].prompt.toLowerCase()).toContain('previous developer');
      expect(tasks[1].prompt.toLowerCase()).toContain('review');
    });

    it('substitutes template variables in agent prompts', async () => {
      const workDir = makeWorkingDir('/tmp/bench-99999');
      await scenario.setup(workDir, makeConditionContext());

      const tasks = scenario.getAgentTasks();

      expect(tasks[0].prompt).toContain('/tmp/bench-99999');
      expect(tasks[1].prompt).toContain('/tmp/bench-99999');
      expect(tasks[0].prompt).not.toContain('{{');
      expect(tasks[1].prompt).not.toContain('{{');
    });
  });

  describe('score()', () => {
    it('scores fast orientation highly', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/models/analytics.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+export interface AnalyticsSummary { totalUsers: number; }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            timing: {
              startTime: '2026-03-08T10:00:00Z',
              endTime: '2026-03-08T10:05:00Z',
              durationMs: 300000,
              timeToFirstActionMs: 15000, // 15 seconds — fast
            },
            fileChanges: [
              {
                path: 'src/services/analytics.service.ts',
                changeType: 'added',
                linesAdded: 50,
                linesRemoved: 0,
                diff: '+export class AnalyticsService {\n+  getSummary() {}\n+  getUserAnalytics() {}\n+  getTrends() {}\n+}',
              },
              {
                path: 'tests/analytics.test.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: '+describe("analytics test", () => {})',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // New multi-sub-score: speed(15s→15/30) + breadth(0 A files read) + coord(0) + exploration(0)
      // Agent B has no tool calls so speed fallback is timeToFirstActionMs=15s → 30 - (15/30)*30 = 15
      expect(scored.scores['orientation-efficiency'].value).toBe(15);
    });

    it('scores slow orientation lower', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            timing: {
              startTime: '2026-03-08T10:00:00Z',
              endTime: '2026-03-08T10:05:00Z',
              durationMs: 300000,
              timeToFirstActionMs: 150000, // 150 seconds — slow
            },
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // 150s > 30s window → speed=0, no breadth/coord/exploration
      expect(scored.scores['orientation-efficiency'].value).toBe(0);
    });

    it('penalizes redundant rework when B touches A files', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              { path: 'src/models/analytics.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              { path: 'src/models/analytics.ts', changeType: 'modified', linesAdded: 35, linesRemoved: 30 },
              { path: 'src/services/analytics.service.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // File overlap: 1/2 = 50% file rework (weight 0.6), no investigation overlap (weight 0.4)
      // Score = (1 - 0.5*0.6) * 100 = 70
      expect(scored.scores['redundant-rework'].value).toBe(70);
    });

    it('gives full rework score when B only adds new files', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              { path: 'src/models/analytics.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              { path: 'src/services/analytics.service.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
              { path: 'tests/analytics.test.ts', changeType: 'added', linesAdded: 40, linesRemoved: 0 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      expect(scored.scores['redundant-rework'].value).toBe(100);
    });

    it('scores completion based on pattern matching all 3 components', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/models/analytics.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+export interface AnalyticsSummary {}',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/services/analytics.service.ts',
                changeType: 'added',
                linesAdded: 50,
                linesRemoved: 0,
                diff: '+export class AnalyticsService {}',
              },
              {
                path: 'tests/analytics.test.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: '+describe("analytics test", () => {})',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // New multi-sub-score: presence 3/3=30, substance(short diffs ~3 lines→2/25),
      // test depth(1 describe→2/20), file coverage(3 files→12/15), completion(5+0=5)
      // ~51 total — but exact value depends on line filtering
      expect(scored.scores.completion.value).toBeGreaterThan(35);
      expect(scored.scores.completion.value).toBeLessThan(65);
    });

    it('scores redundant-rework 100 when B makes no changes and completion is high', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/models/analytics.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+export interface AnalyticsSummary { totalUsers: number; }',
              },
              {
                path: 'src/services/analytics.service.ts',
                changeType: 'added',
                linesAdded: 50,
                linesRemoved: 0,
                diff: '+export class AnalyticsService {}',
              },
              {
                path: 'tests/analytics.test.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: '+describe("analytics test", () => {})',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [],
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/models/analytics.ts' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/analytics.service.ts' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // Completion is high. B made no file changes and A has no tool call investigation trail to duplicate.
      // File rework = 0, investigation rework = 0 (A has no Read calls). Score = 100.
      expect(scored.scores['redundant-rework'].value).toBe(100);
    });

    it('scores redundant-rework 0 when B makes no changes and completion is low', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/models/analytics.ts',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+export interface UserAnalytics {}',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // Completion is 33 (1/3), B made no changes = failure
      expect(scored.scores['redundant-rework'].value).toBe(0);
    });

    it('penalizes investigation overlap in redundant-rework', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/models/analytics.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'src/services/analytics.service.ts' }, timestamp: '', durationMs: 100 },
            ],
            fileChanges: [
              { path: 'src/models/analytics.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              // B re-reads both files A investigated
              { toolName: 'Read', parameters: { file_path: 'src/models/analytics.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'src/services/analytics.service.ts' }, timestamp: '', durationMs: 100 },
            ],
            fileChanges: [
              { path: 'src/services/analytics.service.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // B re-read all of A's files (100% investigation overlap at 40% weight) → score < 100
      expect(scored.scores['redundant-rework'].value).toBeLessThan(100);
    });

    it('orientation-efficiency excludes coordination tool time', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            timing: {
              startTime: '2026-02-20T10:00:00Z',
              endTime: '2026-02-20T10:05:00Z',
              durationMs: 300000,
              timeToFirstActionMs: 120000, // 2 minutes — would score 60 with old logic
            },
            toolCalls: [
              // First 90s: coordination tools (should be excluded)
              {
                toolName: 'mcp__plugin_twining_twining__twining_assemble',
                parameters: {},
                timestamp: '2026-02-20T10:00:10Z',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'COORDINATION.md' },
                timestamp: '2026-02-20T10:00:30Z',
                durationMs: 100,
              },
              // First productive action at 20s — should score 100
              {
                toolName: 'Edit',
                parameters: { file_path: 'src/models/analytics.ts' },
                timestamp: '2026-02-20T10:00:20Z',
                durationMs: 100,
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // New multi-sub-score: speed(20s→10/30) + breadth(0/0 A files) + coord(2 coord reads→10/20) + exploration(0)
      // = 20
      expect(scored.scores['orientation-efficiency'].value).toBe(20);
      expect(scored.scores['orientation-efficiency'].justification).toContain('coord reads');
    });

    it('scores context-accuracy from tool calls when B has no diffs', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/models/analytics.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+export interface AnalyticsSummary {}',
              },
              {
                path: 'src/services/analytics.service.ts',
                changeType: 'added',
                linesAdded: 50,
                linesRemoved: 0,
                diff: '+export class AnalyticsService {}',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [],
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/models/analytics.ts' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/analytics.service.ts' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'tests/some-test.ts' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // B read A's output files — should get partial context-accuracy score
      expect(scored.scores['context-accuracy'].value).toBeGreaterThan(0);
    });

    it('gives partial completion when some components are missing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/models/analytics.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+export interface UserAnalytics {}',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      // New multi-sub-score: presence 1/3=10, substance(1 short line→~0),
      // test depth(0), file coverage(1 file→5/15), completion(0+0=0) = ~15
      expect(scored.scores.completion.value).toBeGreaterThan(8);
      expect(scored.scores.completion.value).toBeLessThan(25);
    });

    it('produces a composite score as weighted average of 4 dimensions', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/models/analytics.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+export interface AnalyticsSummary { totalUsers: number; }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            timing: {
              startTime: '2026-03-08T10:00:00Z',
              endTime: '2026-03-08T10:05:00Z',
              durationMs: 300000,
              timeToFirstActionMs: 20000,
            },
            fileChanges: [
              {
                path: 'src/services/analytics.service.ts',
                changeType: 'added',
                linesAdded: 50,
                linesRemoved: 0,
                diff: '+export class AnalyticsService {}',
              },
              {
                path: 'tests/analytics.test.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: '+describe("analytics test", () => {})',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONTEXT_RECOVERY_GROUND_TRUTH);

      expect(scored.composite).toBeGreaterThan(0);
      expect(scored.composite).toBeLessThanOrEqual(100);
      // Verify it's actually a weighted average of the 4 dimensions
      const expected =
        scored.scores['orientation-efficiency'].value * 0.25 +
        scored.scores['redundant-rework'].value * 0.25 +
        scored.scores.completion.value * 0.25 +
        scored.scores['context-accuracy'].value * 0.25;
      expect(scored.composite).toBeCloseTo(expected);
    });
  });

  describe('teardown()', () => {
    it('is idempotent', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      await scenario.teardown();
      await scenario.teardown(); // Should not throw
    });

    it('resets state so getAgentTasks throws', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      await scenario.teardown();
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });
  });
});

describe('CONTEXT_RECOVERY_GROUND_TRUTH', () => {
  it('has all required decisions', () => {
    const ids = CONTEXT_RECOVERY_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('analytics-models');
    expect(ids).toContain('analytics-service');
    expect(ids).toContain('analytics-tests');
  });

  it('each decision has expected patterns', () => {
    for (const decision of CONTEXT_RECOVERY_GROUND_TRUTH.decisions) {
      expect(decision.expectedPatterns.length).toBeGreaterThan(0);
    }
  });
});

describe('createContextRecoveryScenario', () => {
  it('returns a ContextRecoveryScenario instance', () => {
    const s = createContextRecoveryScenario();
    expect(s).toBeInstanceOf(ContextRecoveryScenario);
  });
});
