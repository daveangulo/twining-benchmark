import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DecisionVolumeRecoveryScenario,
  DECISION_VOLUME_RECOVERY_GROUND_TRUTH,
  createDecisionVolumeRecoveryScenario,
} from '../../../src/scenarios/decision-volume-recovery.js';
import type { WorkingDirectory } from '../../../src/types/target.js';
import type { ConditionContext } from '../../../src/types/condition.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';
import type { RawResults } from '../../../src/types/scenario.js';

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
    scenario: 'decision-volume-recovery',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0, total: 1500, costUsd: 0.01 },
    timing: {
      startTime: '2026-03-13T10:00:00Z',
      endTime: '2026-03-13T10:15:00Z',
      durationMs: 900000,
      timeToFirstActionMs: 10000,
    },
    exitReason: 'completed',
    numTurns: 10,
    stopReason: 'success',
    contextWindowSize: 200000,
    compactionCount: 0,
    turnUsage: [],
    ...overrides,
  };
}

describe('DecisionVolumeRecoveryScenario', () => {
  let scenario: DecisionVolumeRecoveryScenario;

  beforeEach(() => {
    scenario = new DecisionVolumeRecoveryScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario name', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('decision-volume-recovery');
    });

    it('reports 4 agent sessions', () => {
      const meta = scenario.getMetadata();
      expect(meta.agentSessionCount).toBe(4);
    });

    it('is excluded from --scenario all (cost control)', () => {
      const meta = scenario.getMetadata();
      expect(meta.excludeFromAll).toBe(true);
    });

    it('targets service-with-dependency', () => {
      const meta = scenario.getMetadata();
      expect(meta.requiredTargetType).toBe('service-with-dependency');
    });

    it('has the correct 4 scoring dimensions', () => {
      const meta = scenario.getMetadata();
      expect(meta.scoringDimensions).toEqual([
        'decisionRecovery',
        'patternCompliance',
        'crossCuttingConsistency',
        'retrievalPrecision',
      ]);
    });

    it('has estimated duration of 60 minutes', () => {
      const meta = scenario.getMetadata();
      expect(meta.estimatedDurationMinutes).toBe(60);
    });
  });

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('returns exactly 4 tasks', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(4);
    });

    it('tasks have correct sequence order 0–3', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[0].sequenceOrder).toBe(0);
      expect(tasks[1].sequenceOrder).toBe(1);
      expect(tasks[2].sequenceOrder).toBe(2);
      expect(tasks[3].sequenceOrder).toBe(3);
    });

    it('tasks have correct roles', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[0].role).toBe('comprehensive-refactorer');
      expect(tasks[1].role).toBe('cache-builder');
      expect(tasks[2].role).toBe('order-feature-builder');
      expect(tasks[3].role).toBe('integration-tester');
    });

    it('all tasks have 15-minute timeout', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      for (const task of tasks) {
        expect(task.timeoutMs).toBe(15 * 60 * 1000);
      }
    });

    it('all tasks have 50 max turns', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      for (const task of tasks) {
        expect(task.maxTurns).toBe(50);
      }
    });

    it('session 1 prompt mentions six refactoring operations', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[0].prompt.toLowerCase()).toContain('refactor');
      expect(tasks[0].prompt).toContain('IUserRepository');
      expect(tasks[0].prompt).toContain('IOrderRepository');
    });

    it('session 2 prompt instructs agent to use coordination tools', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[1].prompt).toContain('twining_assemble');
    });

    it('substitutes template variables in all prompts', async () => {
      const workDir = makeWorkingDir('/tmp/bench-dvr');
      await scenario.setup(workDir, makeConditionContext());
      const tasks = scenario.getAgentTasks();
      for (const task of tasks) {
        expect(task.prompt).toContain('/tmp/bench-dvr');
        expect(task.prompt).not.toContain('{{');
      }
    });
  });

  describe('score() — decisionRecovery', () => {
    it('scores higher when agent B reads Agent A files in early phase', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // Scenario: B reads a relevant file early, plus uses coordination tool
      const rawResultsGood: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'twining_assemble',
                parameters: { task: 'add caching', scope: 'src/services/' },
                timestamp: '',
                durationMs: 300,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/user.service.ts' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/repositories/user.repository.ts' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
          makeTranscript({ taskIndex: 2 }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      // Scenario: B reads no relevant files and no coordination
      const rawResultsBad: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/utils/logger.ts' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'package.json' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
          makeTranscript({ taskIndex: 2 }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scoredGood = await scenario.score(rawResultsGood, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      const scoredBad = await scenario.score(rawResultsBad, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);

      expect(scoredGood.scores.decisionRecovery.value).toBeGreaterThan(
        scoredBad.scores.decisionRecovery.value,
      );
    });

    it('awards 40 points when coordination tool is used in early phase', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'twining_assemble',
                parameters: { task: 'add caching', scope: 'src/services/' },
                timestamp: '',
                durationMs: 300,
              },
            ],
          }),
          makeTranscript({ taskIndex: 2 }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      // B gets 40 pts for coordination call; C gets 0 (no transcript/tools). Avg = 20.
      expect(scored.scores.decisionRecovery.value).toBeGreaterThanOrEqual(20);
    });

    it('scores 0 when agents B and C are missing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [makeTranscript({ taskIndex: 0 })],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.decisionRecovery.value).toBe(0);
    });
  });

  describe('score() — patternCompliance', () => {
    it('scores 100 when both B and C use interfaces and error handling', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/services/user.service.ts',
                changeType: 'modified',
                linesAdded: 40,
                linesRemoved: 5,
                diff: `+import { IUserRepository } from '../repositories/user.repository.ts';
+try {
+  const user = await this.userRepo.findById(id);
+} catch (err: unknown) {
+  throw new Error('not found');
+}`,
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/order.service.ts',
                changeType: 'modified',
                linesAdded: 30,
                linesRemoved: 5,
                diff: `+import { IOrderRepository } from '../repositories/order.repository.ts';
+try {
+  await this.orderRepo.recordHistory(transition);
+} catch (err: unknown) {
+  throw new Error('history failed');
+}`,
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.patternCompliance.value).toBe(100);
    });

    it('scores 50 when only B complies', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/services/user.service.ts',
                changeType: 'modified',
                linesAdded: 20,
                linesRemoved: 2,
                diff: '+const repo: IUserRepository = this.userRepo;\n+try {} catch (e) { throw e; }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/order.service.ts',
                changeType: 'modified',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+// no interface or pattern used here',
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      // B = 100, C = 0 → avg 50
      expect(scored.scores.patternCompliance.value).toBe(50);
    });

    it('scores 0 when neither B nor C use interface or error handling', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/services/user.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 0,
                diff: '+// just a comment',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/order.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 0,
                diff: '+// just a comment',
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.patternCompliance.value).toBe(0);
    });
  });

  describe('score() — crossCuttingConsistency', () => {
    it('scores 100 when D creates integration tests covering both caching and order history', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({ taskIndex: 2 }),
          makeTranscript({
            taskIndex: 3,
            fileChanges: [
              {
                path: 'tests/integration/user-cache-order-history.test.ts',
                changeType: 'added',
                linesAdded: 80,
                linesRemoved: 0,
                diff: `+describe('integration', () => {
+  it('cache hit for findById', async () => { /* tests cache */ });
+  it('records order history transition', async () => { /* tests orderHistory */ });
+})`,
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.crossCuttingConsistency.value).toBe(100);
    });

    it('scores partial when D only covers caching but not order history', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({ taskIndex: 2 }),
          makeTranscript({
            taskIndex: 3,
            fileChanges: [
              {
                path: 'tests/integration/cache.test.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: '+describe("cache", () => { it("hits cache", () => {}); });',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.crossCuttingConsistency.value).toBeGreaterThan(0);
      expect(scored.scores.crossCuttingConsistency.value).toBeLessThan(100);
    });

    it('scores 0 when agent D is missing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({ taskIndex: 2 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.crossCuttingConsistency.value).toBe(0);
    });
  });

  describe('score() — retrievalPrecision', () => {
    it('scores 100 when all early reads by B and C are Agent A files', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/user.service.ts' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/repositories/user.repository.ts' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/order.service.ts' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/repositories/order.repository.ts' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.retrievalPrecision.value).toBe(100);
    });

    it('scores lower when agents read irrelevant files in early phase', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'README.md' },
                timestamp: '',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'package.json' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'tsconfig.json' },
                timestamp: '',
                durationMs: 100,
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);
      expect(scored.scores.retrievalPrecision.value).toBe(0);
    });
  });

  describe('score() — composite', () => {
    it('composite is weighted sum: 0.30 + 0.30 + 0.25 + 0.15', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'twining_assemble',
                parameters: { task: 'cache', scope: 'src/' },
                timestamp: '',
                durationMs: 200,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/user.service.ts' },
                timestamp: '',
                durationMs: 100,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/user.service.ts',
                changeType: 'modified',
                linesAdded: 30,
                linesRemoved: 2,
                diff: '+const repo: IUserRepository = this.repo;\n+try {} catch (e: unknown) { throw e; }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'twining_recent',
                parameters: {},
                timestamp: '',
                durationMs: 200,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/order.service.ts' },
                timestamp: '',
                durationMs: 100,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/order.service.ts',
                changeType: 'modified',
                linesAdded: 25,
                linesRemoved: 2,
                diff: '+const repo: IOrderRepository = this.repo;\n+try {} catch (e: unknown) { throw e; }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 3,
            fileChanges: [
              {
                path: 'tests/integration/full.test.ts',
                changeType: 'added',
                linesAdded: 70,
                linesRemoved: 0,
                diff: '+describe("integration", () => { it("cache hit", () => {}); it("order history transition", () => {}); })',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, DECISION_VOLUME_RECOVERY_GROUND_TRUTH);

      const expected =
        scored.scores.decisionRecovery.value * 0.30 +
        scored.scores.patternCompliance.value * 0.30 +
        scored.scores.crossCuttingConsistency.value * 0.25 +
        scored.scores.retrievalPrecision.value * 0.15;

      expect(scored.composite).toBeCloseTo(expected, 5);
      expect(scored.composite).toBeGreaterThan(0);
      expect(scored.composite).toBeLessThanOrEqual(100);
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

describe('DECISION_VOLUME_RECOVERY_GROUND_TRUTH', () => {
  it('has the 6 required decisions', () => {
    const ids = DECISION_VOLUME_RECOVERY_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('user-interface-extraction');
    expect(ids).toContain('order-interface-extraction');
    expect(ids).toContain('error-handling-normalization');
    expect(ids).toContain('input-validation');
    expect(ids).toContain('logging-standardization');
    expect(ids).toContain('caching-implementation');
  });

  it('each decision has at least one expected pattern', () => {
    for (const decision of DECISION_VOLUME_RECOVERY_GROUND_TRUTH.decisions) {
      expect(decision.expectedPatterns.length).toBeGreaterThan(0);
    }
  });

  it('has the correct name', () => {
    expect(DECISION_VOLUME_RECOVERY_GROUND_TRUTH.name).toBe('decision-volume-recovery');
  });
});

describe('createDecisionVolumeRecoveryScenario', () => {
  it('returns a DecisionVolumeRecoveryScenario instance', () => {
    const s = createDecisionVolumeRecoveryScenario();
    expect(s).toBeInstanceOf(DecisionVolumeRecoveryScenario);
  });
});
