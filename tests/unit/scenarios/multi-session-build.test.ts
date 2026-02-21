import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MultiSessionBuildScenario,
  MULTI_SESSION_BUILD_GROUND_TRUTH,
  createMultiSessionBuildScenario,
} from '../../../src/scenarios/multi-session-build.js';
import type { WorkingDirectory } from '../../../src/types/target.js';
import type { ConditionContext } from '../../../src/types/condition.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';
import type { ScenarioRunner, RawResults } from '../../../src/types/scenario.js';

function makeWorkingDir(path = '/tmp/test-repo'): WorkingDirectory {
  return {
    path,
    gitDir: `${path}/.git`,
    cleanup: async () => {},
  };
}

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

function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'test-session',
    runId: 'test-run',
    scenario: 'multi-session-build',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 1000, output: 500, total: 1500 },
    timing: {
      startTime: '2026-02-20T10:00:00Z',
      endTime: '2026-02-20T10:10:00Z',
      durationMs: 600000,
      timeToFirstActionMs: 10000,
    },
    exitReason: 'completed',
    ...overrides,
  };
}

describe('MultiSessionBuildScenario', () => {
  let scenario: MultiSessionBuildScenario;

  beforeEach(() => {
    scenario = new MultiSessionBuildScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario metadata', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('multi-session-build');
      expect(meta.agentSessionCount).toBe(5);
      expect(meta.scoringDimensions).toEqual([
        'architecturalDrift',
        'cumulativeRework',
        'finalQuality',
      ]);
      expect(meta.excludeFromAll).toBe(false);
      expect(meta.estimatedDurationMinutes).toBe(75);
    });
  });

  describe('setup()', () => {
    it('creates scenario context with resolved prompts', async () => {
      const workDir = makeWorkingDir('/tmp/multi-build');
      const condCtx = makeConditionContext();

      const ctx = await scenario.setup(workDir, condCtx);

      expect(ctx.workingDir).toBe(workDir);
      expect(ctx.groundTruth).toBe(MULTI_SESSION_BUILD_GROUND_TRUTH);
      expect(ctx.metadata.scenario).toBe('multi-session-build');
      expect(ctx.metadata.sessionCount).toBe(5);
    });

    it('substitutes template variables in all 5 prompts', async () => {
      await scenario.setup(makeWorkingDir('/tmp/ms-12345'), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks).toHaveLength(5);

      for (let i = 0; i < 5; i++) {
        expect(tasks[i].prompt).toContain(`Agent ${i + 1} of 5`);
        expect(tasks[i].prompt).toContain('/tmp/ms-12345');
        expect(tasks[i].prompt).not.toContain('{{');
      }
    });
  });

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('returns 5 tasks in correct order with correct roles', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks).toHaveLength(5);
      expect(tasks[0].sequenceOrder).toBe(0);
      expect(tasks[4].sequenceOrder).toBe(4);

      expect(tasks[0].role).toBe('designer');
      expect(tasks[1].role).toBe('implementer');
      expect(tasks[2].role).toBe('tester');
      expect(tasks[3].role).toBe('integrator');
      expect(tasks[4].role).toBe('qa-engineer');
    });

    it('Session 1 prompt focuses on design', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].prompt).toContain('Design');
      expect(tasks[0].prompt).toContain('scaffold');
      expect(tasks[0].prompt).toContain('analytics dashboard');
      expect(tasks[0].prompt).toContain('data models');
    });

    it('each session receives only its task prompt (no summaries)', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      // Session 2+ should NOT contain summaries of previous sessions
      expect(tasks[1].prompt).not.toContain('Session 1 did');
      expect(tasks[2].prompt).not.toContain('Session 2 did');

      // But they should reference previous work generically
      expect(tasks[1].prompt).toContain('Follow the design from Session 1');
    });

    it('Session 5 prompt focuses on integration testing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[4].prompt).toContain('integration tests');
      expect(tasks[4].prompt).toContain('end-to-end');
    });
  });

  describe('execute()', () => {
    it('runs all 5 tasks sequentially', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const callOrder: number[] = [];
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          callOrder.push(task.sequenceOrder);
          return makeTranscript({
            taskIndex: task.sequenceOrder,
            fileChanges: [
              {
                path: `src/session-${task.sequenceOrder}.ts`,
                changeType: 'added',
                linesAdded: 20,
                linesRemoved: 0,
              },
            ],
          });
        },
      };

      const results = await scenario.execute(mockRunner);

      expect(callOrder).toEqual([0, 1, 2, 3, 4]);
      expect(results.transcripts).toHaveLength(5);
      expect(results.allSessionsCompleted).toBe(true);
    });
  });

  describe('score()', () => {
    it('scores well when sessions build additively without rework', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              { path: 'src/routes/analytics.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0 },
              { path: 'src/types/analytics.ts', changeType: 'added', linesAdded: 20, linesRemoved: 0, diff: '+interface DashboardData {\n+  metrics: MetricSummary[];\n+}' },
              { path: 'DESIGN.md', changeType: 'added', linesAdded: 15, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              { path: 'src/services/aggregation.service.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0, diff: '+class AggregationService {\n+  aggregate() {}\n+}' },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              { path: 'tests/aggregation.test.ts', changeType: 'added', linesAdded: 40, linesRemoved: 0, diff: '+describe("aggregation", () => { it("works", () => { expect(true); }); });' },
            ],
          }),
          makeTranscript({
            taskIndex: 3,
            fileChanges: [
              { path: 'src/routes/analytics.ts', changeType: 'modified', linesAdded: 25, linesRemoved: 5, diff: '+app.get("/api/analytics/dashboard", handler);\n+async function handler(req, res) { const service = new AggregationService(); }' },
            ],
          }),
          makeTranscript({
            taskIndex: 4,
            fileChanges: [
              { path: 'tests/integration/analytics.test.ts', changeType: 'added', linesAdded: 35, linesRemoved: 0, diff: '+describe("integration", () => { it("end-to-end pipeline", () => { request(app).get("/api/analytics"); }); });' },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, MULTI_SESSION_BUILD_GROUND_TRUTH);

      expect(scored.scores.architecturalDrift.value).toBeGreaterThanOrEqual(50);
      expect(scored.scores.cumulativeRework.value).toBeGreaterThanOrEqual(80);
      expect(scored.scores.finalQuality.value).toBeGreaterThanOrEqual(70);
      expect(scored.composite).toBeGreaterThan(50);
    });

    it('penalizes heavy rework across sessions', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              { path: 'src/routes/analytics.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              // Session 2 rewrites Session 1's file heavily
              { path: 'src/routes/analytics.ts', changeType: 'modified', linesAdded: 30, linesRemoved: 45 },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              { path: 'tests/test.ts', changeType: 'added', linesAdded: 20, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            taskIndex: 3,
            fileChanges: [
              { path: 'src/routes/analytics.ts', changeType: 'modified', linesAdded: 20, linesRemoved: 25 },
            ],
          }),
          makeTranscript({ taskIndex: 4 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, MULTI_SESSION_BUILD_GROUND_TRUTH);

      expect(scored.scores.cumulativeRework.value).toBeLessThan(50);
    });

    it('scores low final quality when sessions are incomplete', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [{ path: 'src/routes/analytics.ts', changeType: 'added', linesAdded: 10, linesRemoved: 0 }],
          }),
          makeTranscript({ taskIndex: 1, exitReason: 'timeout' }),
          makeTranscript({ taskIndex: 2, exitReason: 'error', error: 'Crashed' }),
          makeTranscript({ taskIndex: 3, exitReason: 'timeout' }),
          makeTranscript({ taskIndex: 4, exitReason: 'timeout' }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: ['Various failures'],
      };

      const scored = await scenario.score(rawResults, MULTI_SESSION_BUILD_GROUND_TRUTH);

      // Only 1 session completed with changes
      expect(scored.scores.finalQuality.value).toBeLessThan(50);
    });

    it('extracts metrics across all 5 sessions', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = Array.from({ length: 5 }, (_, i) =>
        makeTranscript({
          taskIndex: i,
          tokenUsage: { input: 1000, output: 500, total: 1500 },
          timing: { startTime: '', endTime: '', durationMs: 300000, timeToFirstActionMs: 5000 },
          fileChanges: [
            { path: `src/session-${i}.ts`, changeType: 'added', linesAdded: 20, linesRemoved: 0 },
          ],
        }),
      );

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, MULTI_SESSION_BUILD_GROUND_TRUTH);

      expect(scored.metrics.totalTokens).toBe(7500);
      expect(scored.metrics.wallTimeMs).toBe(1500000);
      expect(scored.metrics.agentSessions).toBe(5);
      expect(scored.metrics.gitChurn.linesAdded).toBe(100);
      expect(scored.metrics.gitChurn.filesChanged).toBe(5);
    });
  });

  describe('teardown()', () => {
    it('is idempotent', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      await scenario.teardown();
      await scenario.teardown();
    });

    it('resets state so getAgentTasks throws', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      await scenario.teardown();
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });
  });
});

describe('MULTI_SESSION_BUILD_GROUND_TRUTH', () => {
  it('has all required decisions', () => {
    const ids = MULTI_SESSION_BUILD_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('api-route-structure');
    expect(ids).toContain('data-models');
    expect(ids).toContain('aggregation-service');
    expect(ids).toContain('unit-tests');
    expect(ids).toContain('endpoint-handlers');
    expect(ids).toContain('integration-tests');
  });

  it('has 6 decisions matching 5 sessions (design splits into route + model)', () => {
    expect(MULTI_SESSION_BUILD_GROUND_TRUTH.decisions).toHaveLength(6);
  });
});

describe('createMultiSessionBuildScenario', () => {
  it('returns a MultiSessionBuildScenario instance', () => {
    const s = createMultiSessionBuildScenario();
    expect(s).toBeInstanceOf(MultiSessionBuildScenario);
  });
});
