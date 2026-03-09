import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConcurrentAgentsScenario,
  CONCURRENT_AGENTS_GROUND_TRUTH,
  createConcurrentAgentsScenario,
} from '../../../src/scenarios/concurrent-agents.js';
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
    scenario: 'concurrent-agents',
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

describe('ConcurrentAgentsScenario', () => {
  let scenario: ConcurrentAgentsScenario;

  beforeEach(() => {
    scenario = new ConcurrentAgentsScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct metadata with 4 agents and parallel mode', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('concurrent-agents');
      expect(meta.agentSessionCount).toBe(4);
      expect(meta.excludeFromAll).toBe(false);
      expect(meta.scoringDimensions).toEqual([
        'merge-conflicts',
        'architectural-consistency',
        'completion',
      ]);
    });

    it('is not excluded from --scenario all', () => {
      const meta = scenario.getMetadata();
      expect(meta.excludeFromAll).toBe(false);
    });
  });

  describe('setup() and getAgentTasks()', () => {
    it('produces 4 tasks (3 workers + 1 merge)', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(4);
    });

    it('first 3 tasks have different roles', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      const roles = tasks.slice(0, 3).map(t => t.role);
      expect(roles).toContain('caching');
      expect(roles).toContain('audit-logging');
      expect(roles).toContain('validation');
      // All roles are unique
      expect(new Set(roles).size).toBe(3);
    });

    it('4th task is the merge agent', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      const mergeTask = tasks[3]!;
      expect(mergeTask.role).toBe('merge-agent');
      expect(mergeTask.prompt).toContain('conflicts');
    });

    it('first 3 tasks have 10 min timeout, 4th has 15 min', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      for (let i = 0; i < 3; i++) {
        expect(tasks[i]!.timeoutMs).toBe(10 * 60 * 1000);
      }
      expect(tasks[3]!.timeoutMs).toBe(15 * 60 * 1000);
    });

    it('substitutes template variables in all prompts', async () => {
      await scenario.setup(makeWorkingDir('/tmp/concurrent-repo'), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      for (const task of tasks) {
        expect(task.prompt).toContain('/tmp/concurrent-repo');
        expect(task.prompt).not.toContain('{{');
      }
    });

    it('throws if getAgentTasks called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });
  });

  describe('execute()', () => {
    it('runs first 3 tasks via Promise.allSettled then 4th sequentially', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const callOrder: number[] = [];
      const runner: ScenarioRunner = {
        runAgentTask: async (task) => {
          callOrder.push(task.sequenceOrder);
          return makeTranscript({ taskIndex: task.sequenceOrder });
        },
      };

      const result = await scenario.execute(runner);

      expect(result.transcripts).toHaveLength(4);
      expect(result.allSessionsCompleted).toBe(true);
      expect(result.errors).toHaveLength(0);
      // Merge agent (sequenceOrder 3) should be called last
      expect(callOrder[callOrder.length - 1]).toBe(3);
    });

    it('handles parallel task failures gracefully', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const runner: ScenarioRunner = {
        runAgentTask: async (task) => {
          if (task.sequenceOrder === 1) {
            throw new Error('Agent B crashed');
          }
          return makeTranscript({ taskIndex: task.sequenceOrder });
        },
      };

      const result = await scenario.execute(runner);

      expect(result.transcripts).toHaveLength(4);
      expect(result.allSessionsCompleted).toBe(false);
      expect(result.errors).toContain('Task 1 failed: Agent B crashed');
    });

    it('handles merge task failure gracefully', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const runner: ScenarioRunner = {
        runAgentTask: async (task) => {
          if (task.sequenceOrder === 3) {
            throw new Error('Merge agent crashed');
          }
          return makeTranscript({ taskIndex: task.sequenceOrder });
        },
      };

      const result = await scenario.execute(runner);

      expect(result.transcripts).toHaveLength(4);
      expect(result.allSessionsCompleted).toBe(false);
      expect(result.errors.some(e => e.includes('Merge task failed'))).toBe(true);
    });

    it('throws if called before setup', async () => {
      const runner: ScenarioRunner = {
        runAgentTask: async () => makeTranscript(),
      };
      await expect(scenario.execute(runner)).rejects.toThrow('not set up');
    });
  });

  describe('score()', () => {
    it('scores high when all features present and merge agent resolves conflicts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = [
        // Worker A: caching
        makeTranscript({
          taskIndex: 0,
          fileChanges: [
            { path: 'src/services/cache.service.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0, diff: '+export class CacheService {\n+  constructor() {}\n+  async get() {}\n+}' },
          ],
        }),
        // Worker B: audit
        makeTranscript({
          taskIndex: 1,
          fileChanges: [
            { path: 'src/services/audit.service.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0, diff: '+export class AuditService {\n+  constructor() {}\n+  async log() {}\n+}' },
          ],
        }),
        // Worker C: validation
        makeTranscript({
          taskIndex: 2,
          fileChanges: [
            { path: 'src/utils/validation.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0, diff: '+export class ValidationError extends Error {}\n+export function validate() {}' },
          ],
        }),
        // Merge agent
        makeTranscript({
          taskIndex: 3,
          fileChanges: [
            { path: 'src/services/user.service.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 5, diff: '+// integrated caching, audit, validation' },
          ],
          toolCalls: [
            { toolName: 'Bash', parameters: { command: 'npm test' }, timestamp: '', durationMs: 5000 },
          ],
        }),
      ];

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONCURRENT_AGENTS_GROUND_TRUTH);

      expect(scored.scores['merge-conflicts']!.value).toBeGreaterThan(0);
      expect(scored.scores.completion!.value).toBe(100);
      expect(scored.composite).toBeGreaterThan(0);
    });

    it('scores low completion when features are missing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = [
        makeTranscript({ taskIndex: 0, fileChanges: [] }),
        makeTranscript({ taskIndex: 1, fileChanges: [] }),
        makeTranscript({ taskIndex: 2, fileChanges: [] }),
        makeTranscript({ taskIndex: 3, fileChanges: [] }),
      ];

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONCURRENT_AGENTS_GROUND_TRUTH);
      expect(scored.scores.completion!.value).toBe(0);
    });

    it('handles empty transcripts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: ['All failed'],
      };

      const scored = await scenario.score(rawResults, CONCURRENT_AGENTS_GROUND_TRUTH);
      expect(scored.scores['merge-conflicts']!.value).toBe(0);
      expect(scored.scores.completion!.value).toBe(0);
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

describe('CONCURRENT_AGENTS_GROUND_TRUTH', () => {
  it('has required decisions', () => {
    const ids = CONCURRENT_AGENTS_GROUND_TRUTH.decisions.map(d => d.id);
    expect(ids).toContain('caching');
    expect(ids).toContain('audit');
    expect(ids).toContain('validation');
  });
});

describe('createConcurrentAgentsScenario', () => {
  it('returns a ConcurrentAgentsScenario instance', () => {
    const s = createConcurrentAgentsScenario();
    expect(s).toBeInstanceOf(ConcurrentAgentsScenario);
  });
});
