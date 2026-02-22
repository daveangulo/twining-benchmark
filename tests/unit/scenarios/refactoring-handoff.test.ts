import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RefactoringHandoffScenario,
  REFACTORING_HANDOFF_GROUND_TRUTH,
  createRefactoringHandoffScenario,
} from '../../../src/scenarios/refactoring-handoff.js';
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
    scenario: 'refactoring-handoff',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0, total: 1500, costUsd: 0.01 },
    timing: {
      startTime: '2026-02-20T10:00:00Z',
      endTime: '2026-02-20T10:05:00Z',
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

describe('RefactoringHandoffScenario', () => {
  let scenario: RefactoringHandoffScenario;

  beforeEach(() => {
    scenario = new RefactoringHandoffScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario metadata', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('refactoring-handoff');
      expect(meta.agentSessionCount).toBe(2);
      expect(meta.scoringDimensions).toEqual(['consistency', 'rework', 'completion']);
      expect(meta.excludeFromAll).toBe(false);
      expect(meta.requiredTargetType).toBe('service-with-dependency');
    });
  });

  describe('setup()', () => {
    it('creates scenario context with resolved prompts', async () => {
      const workDir = makeWorkingDir('/tmp/my-repo');
      const condCtx = makeConditionContext();

      const ctx = await scenario.setup(workDir, condCtx);

      expect(ctx.workingDir).toBe(workDir);
      expect(ctx.conditionContext).toBe(condCtx);
      expect(ctx.groundTruth).toBe(REFACTORING_HANDOFF_GROUND_TRUTH);
      expect(ctx.metadata.scenario).toBe('refactoring-handoff');
    });

    it('substitutes template variables in agent prompts', async () => {
      const workDir = makeWorkingDir('/tmp/bench-12345');
      await scenario.setup(workDir, makeConditionContext());

      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(2);

      // Agent A (index 0) should have agent_number=1
      expect(tasks[0].prompt).toContain('Agent 1 of 2');
      expect(tasks[0].prompt).toContain('/tmp/bench-12345');
      expect(tasks[0].prompt).not.toContain('{{');

      // Agent B (index 1) should have agent_number=2
      expect(tasks[1].prompt).toContain('Agent 2 of 2');
      expect(tasks[1].prompt).toContain('/tmp/bench-12345');
      expect(tasks[1].prompt).not.toContain('{{');
    });
  });

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('returns 2 tasks in correct order', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].sequenceOrder).toBe(0);
      expect(tasks[1].sequenceOrder).toBe(1);
      expect(tasks[0].role).toBe('refactorer');
      expect(tasks[1].role).toBe('extender');
    });

    it('Agent A prompt contains key instructions', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].prompt).toContain('IUserRepository');
      expect(tasks[0].prompt).toContain('repository pattern');
      expect(tasks[0].prompt).toContain('Document');
    });

    it('Agent B prompt contains key instructions', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[1].prompt).toContain('caching layer');
      expect(tasks[1].prompt).toContain('existing architecture');
    });

    it('prompts are identical across conditions (only tools differ)', async () => {
      const scenario2 = new RefactoringHandoffScenario();
      const workDir = makeWorkingDir();

      await scenario.setup(workDir, makeConditionContext());
      await scenario2.setup(workDir, {
        ...makeConditionContext(),
        metadata: { conditionName: 'full-twining' },
      });

      const tasks1 = scenario.getAgentTasks();
      const tasks2 = scenario2.getAgentTasks();

      expect(tasks1[0].prompt).toBe(tasks2[0].prompt);
      expect(tasks1[1].prompt).toBe(tasks2[1].prompt);

      await scenario2.teardown();
    });
  });

  describe('execute()', () => {
    it('throws if called before setup', async () => {
      const mockRunner: ScenarioRunner = {
        runAgentTask: async () => makeTranscript(),
      };
      await expect(scenario.execute(mockRunner)).rejects.toThrow('not set up');
    });

    it('runs all tasks sequentially and collects transcripts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const callOrder: number[] = [];
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          callOrder.push(task.sequenceOrder);
          return makeTranscript({
            taskIndex: task.sequenceOrder,
            fileChanges: [
              {
                path: 'src/test.ts',
                changeType: 'modified',
                linesAdded: 10,
                linesRemoved: 2,
              },
            ],
          });
        },
      };

      const results = await scenario.execute(mockRunner);

      expect(callOrder).toEqual([0, 1]);
      expect(results.transcripts).toHaveLength(2);
      expect(results.allSessionsCompleted).toBe(true);
      expect(results.errors).toEqual([]);
    });

    it('handles task failures gracefully', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      let callCount = 0;
      const mockRunner: ScenarioRunner = {
        runAgentTask: async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Agent crashed');
          }
          return makeTranscript({ taskIndex: 1 });
        },
      };

      const results = await scenario.execute(mockRunner);

      expect(results.transcripts).toHaveLength(1); // Only the successful one
      expect(results.allSessionsCompleted).toBe(false);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0]).toContain('Agent crashed');
    });

    it('records timeout exit reason', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) =>
          makeTranscript({
            taskIndex: task.sequenceOrder,
            exitReason: 'timeout',
            error: 'Session timed out',
          }),
      };

      const results = await scenario.execute(mockRunner);

      expect(results.allSessionsCompleted).toBe(false);
      expect(results.errors).toHaveLength(2);
    });
  });

  describe('score()', () => {
    it('scores perfect run with full marks', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/repositories/user.repository.ts',
                changeType: 'modified',
                linesAdded: 20,
                linesRemoved: 5,
                diff: '+export interface IUserRepository {\n+  findById(id: string): User | undefined;\n+}\n+export class UserRepository extends BaseRepository<User> implements IUserRepository {',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/repositories/cached-user.repository.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: '+import { IUserRepository } from "./user.repository";\n+export class CachedUserRepository implements IUserRepository {\n+  private cache = new Map();\n',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, REFACTORING_HANDOFF_GROUND_TRUTH);

      expect(scored.scores.consistency.value).toBeGreaterThanOrEqual(70);
      expect(scored.scores.rework.value).toBe(100); // B didn't touch A's files
      expect(scored.scores.completion.value).toBe(100);
      expect(scored.composite).toBeGreaterThan(0);
    });

    it('penalizes when Agent B rewrites Agent A code', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/repositories/user.repository.ts',
                changeType: 'modified',
                linesAdded: 30,
                linesRemoved: 5,
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/repositories/user.repository.ts',
                changeType: 'modified',
                linesAdded: 15,
                linesRemoved: 25, // Removed most of A's additions
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, REFACTORING_HANDOFF_GROUND_TRUTH);

      expect(scored.scores.rework.value).toBeLessThan(50);
      expect(scored.scores.rework.justification).toContain('removed');
    });

    it('gives zero completion score when no transcripts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: ['All agents failed'],
      };

      const scored = await scenario.score(rawResults, REFACTORING_HANDOFF_GROUND_TRUTH);

      expect(scored.scores.completion.value).toBe(0);
    });

    it('gives partial completion for timeout with file changes', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            exitReason: 'completed',
            fileChanges: [
              {
                path: 'src/test.ts',
                changeType: 'modified',
                linesAdded: 10,
                linesRemoved: 2,
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            exitReason: 'timeout',
            fileChanges: [
              {
                path: 'src/other.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 1,
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, REFACTORING_HANDOFF_GROUND_TRUTH);

      // Agent A completed (50) + Agent B timed out with changes (25) = 75
      expect(scored.scores.completion.value).toBe(75);
    });

    it('extracts correct metrics from transcripts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            tokenUsage: { input: 2000, output: 1000, cacheRead: 0, cacheCreation: 0, total: 3000, costUsd: 0.02 },
            timing: {
              startTime: '2026-02-20T10:00:00Z',
              endTime: '2026-02-20T10:05:00Z',
              durationMs: 300000,
              timeToFirstActionMs: 5000,
            },
            fileChanges: [
              { path: 'a.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 3 },
              { path: 'b.ts', changeType: 'added', linesAdded: 20, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            tokenUsage: { input: 1500, output: 800, cacheRead: 0, cacheCreation: 0, total: 2300, costUsd: 0.015 },
            timing: {
              startTime: '2026-02-20T10:05:00Z',
              endTime: '2026-02-20T10:08:00Z',
              durationMs: 180000,
              timeToFirstActionMs: 8000,
            },
            fileChanges: [
              { path: 'b.ts', changeType: 'modified', linesAdded: 5, linesRemoved: 2 },
              { path: 'c.ts', changeType: 'added', linesAdded: 15, linesRemoved: 0 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, REFACTORING_HANDOFF_GROUND_TRUTH);

      expect(scored.metrics.totalTokens).toBe(5300);
      expect(scored.metrics.inputTokens).toBe(3500);
      expect(scored.metrics.outputTokens).toBe(1800);
      expect(scored.metrics.cacheReadTokens).toBe(0);
      expect(scored.metrics.costUsd).toBeCloseTo(0.035);
      expect(scored.metrics.wallTimeMs).toBe(480000);
      expect(scored.metrics.agentSessions).toBe(2);
      expect(scored.metrics.numTurns).toBe(10);
      expect(scored.metrics.compactionCount).toBe(0);
      expect(scored.metrics.gitChurn.linesAdded).toBe(50);
      expect(scored.metrics.gitChurn.linesRemoved).toBe(5);
      expect(scored.metrics.gitChurn.filesChanged).toBe(3); // a.ts, b.ts, c.ts
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

describe('REFACTORING_HANDOFF_GROUND_TRUTH', () => {
  it('has all required decisions', () => {
    const ids = REFACTORING_HANDOFF_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('extract-iuser-repository');
    expect(ids).toContain('preserve-repository-pattern');
    expect(ids).toContain('caching-via-interface');
  });

  it('each decision has expected and anti patterns', () => {
    for (const decision of REFACTORING_HANDOFF_GROUND_TRUTH.decisions) {
      expect(decision.expectedPatterns.length).toBeGreaterThan(0);
      expect(decision.antiPatterns.length).toBeGreaterThan(0);
      expect(decision.affectedFiles.length).toBeGreaterThan(0);
    }
  });
});

describe('createRefactoringHandoffScenario', () => {
  it('returns a RefactoringHandoffScenario instance', () => {
    const s = createRefactoringHandoffScenario();
    expect(s).toBeInstanceOf(RefactoringHandoffScenario);
  });
});
