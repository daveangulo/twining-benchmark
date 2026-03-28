import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConflictResolutionScenario,
  CONFLICT_RESOLUTION_GROUND_TRUTH,
  createConflictResolutionScenario,
} from '../../../src/scenarios/conflict-resolution.js';
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
    scenario: 'conflict-resolution',
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

describe('ConflictResolutionScenario', () => {
  let scenario: ConflictResolutionScenario;

  beforeEach(() => {
    scenario = new ConflictResolutionScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario metadata', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('conflict-resolution');
      expect(meta.agentSessionCount).toBe(3);
      expect(meta.scoringDimensions).toEqual([
        'conflict-detection',
        'resolution-quality',
        'decision-documentation',
      ]);
      expect(meta.excludeFromAll).toBe(false);
      expect(meta.requiredTargetType).toBe('service-with-dependency');
      expect(meta.estimatedDurationMinutes).toBe(45);
    });
  });

  describe('setup() and getAgentTasks()', () => {
    it('produces 3 agent tasks', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(3);
    });

    it('substitutes template variables in agent prompts', async () => {
      const workDir = makeWorkingDir('/tmp/bench-99999');
      await scenario.setup(workDir, makeConditionContext());

      const tasks = scenario.getAgentTasks();
      for (const task of tasks) {
        expect(task.prompt).toContain('/tmp/bench-99999');
        expect(task.prompt).not.toContain('{{');
      }
    });

    it('first two agents have contradictory preferences', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      // Agent A: event-driven
      expect(tasks[0].prompt).toContain('event-driven');
      expect(tasks[0].prompt).toContain('EventBus');
      expect(tasks[0].role).toBe('event-driven-implementer');

      // Agent B: direct calls
      expect(tasks[1].prompt).toContain('direct service-to-service calls');
      expect(tasks[1].prompt).toContain('notifyOrderCreated');
      expect(tasks[1].role).toBe('direct-call-implementer');
    });

    it('third agent is the resolver', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[2].prompt).toContain('conflicting architectural choices');
      expect(tasks[2].prompt).toContain('Unify the codebase');
      expect(tasks[2].role).toBe('resolver');
    });

    it('Agent C has a longer timeout than A and B', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].timeoutMs).toBe(10 * 60 * 1000);
      expect(tasks[1].timeoutMs).toBe(10 * 60 * 1000);
      expect(tasks[2].timeoutMs).toBe(15 * 60 * 1000);
    });

    it('tasks are in correct sequential order', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].sequenceOrder).toBe(0);
      expect(tasks[1].sequenceOrder).toBe(1);
      expect(tasks[2].sequenceOrder).toBe(2);
    });
  });

  describe('score()', () => {
    it('scores high conflict detection when Agent C mentions both patterns', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/events/event-bus.ts' },
                result: 'event-driven bus with emit and subscribe',
                durationMs: 100,
                turnIndex: 0,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/notification.service.ts' },
                result: 'direct call pattern with service-to-service invocation',
                durationMs: 100,
                turnIndex: 1,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 20,
                linesRemoved: 15,
                diff: '-import { EventBus } from "../events/event-bus";\n-    this.eventBus.emit("orderCreated", order);\n+import { CallbackRegistry } from "../callbacks/registry";\n+    this.callbackRegistry.register("orderCreated", handler);',
              },
              {
                path: 'COORDINATION.md',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+## Architectural Decision\n+Chose direct-call over event-driven for rationale...',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      expect(scored.scores['conflict-detection'].value).toBe(100);
      expect(scored.scores['conflict-detection'].justification).toContain('unified');
    });

    it('scores low conflict detection when Agent C mentions only one pattern', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/events/event-bus.ts' },
                result: 'found the event-driven pattern with emit and subscribe',
                durationMs: 100,
                turnIndex: 0,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 0,
                diff: '+import { EventBus } from "../events/event-bus";\n+    this.eventBus.emit("orderCreated", order);',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      expect(scored.scores['conflict-detection'].value).toBe(40);
    });

    it('scores zero conflict detection when Agent C has no transcript', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: ['Agent C failed'],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      expect(scored.scores['conflict-detection'].value).toBe(0);
    });

    it('scores decision documentation from coordination files', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'COORDINATION.md',
                changeType: 'added',
                linesAdded: 15,
                linesRemoved: 0,
                diff: '+# Decision: unified notification architecture',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      expect(scored.scores['decision-documentation'].value).toBeGreaterThanOrEqual(60);
    });

    it('scores zero decision documentation when no docs found', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 10,
                linesRemoved: 5,
                diff: '+// just some code change',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      expect(scored.scores['decision-documentation'].value).toBe(0);
    });

    it('scores decision documentation for Twining decide tool calls', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'mcp__plugin_twining_twining__twining_decide',
                parameters: { summary: 'Use event-driven architecture' },
                timestamp: '2026-02-20T10:10:00Z',
                durationMs: 100,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 10,
                linesRemoved: 5,
                diff: '+// unified notification approach',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      // Twining decide tool should earn 60 points (equal to coordination files)
      expect(scored.scores['decision-documentation'].value).toBeGreaterThanOrEqual(60);
    });

    it('scores decision documentation for .twining/decisions/ file changes', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: '.twining/decisions/01ABC123.json',
                changeType: 'added',
                linesAdded: 20,
                linesRemoved: 0,
                diff: '+{"summary": "Use event-driven architecture"}',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      // .twining/decisions/ files should count as coordination files (+60)
      expect(scored.scores['decision-documentation'].value).toBeGreaterThanOrEqual(60);
    });

    it('Twining decide + inline docs scores same as COORDINATION.md + inline docs', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // Twining approach: twining_decide + inline comments
      const twiningResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'mcp__plugin_twining_twining__twining_decide',
                parameters: { summary: 'Unified notification' },
                timestamp: '',
                durationMs: 100,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 3,
                diff: '+// Decision: use event-driven notification pattern for decoupling',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      // File approach: COORDINATION.md + inline comments
      const fileResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'COORDINATION.md',
                changeType: 'added',
                linesAdded: 15,
                linesRemoved: 0,
                diff: '+# Decision: unified notification architecture',
              },
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 3,
                diff: '+// Decision: use event-driven notification pattern for decoupling',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const twiningScored = await scenario.score(twiningResults, CONFLICT_RESOLUTION_GROUND_TRUTH);
      const fileScored = await scenario.score(fileResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      // Both approaches should score the same on decision-documentation
      expect(twiningScored.scores['decision-documentation'].value).toBe(
        fileScored.scores['decision-documentation'].value,
      );
    });

    it('computes weighted composite score', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: {},
                result: 'event-driven emit subscribe direct call service-to-service',
                durationMs: 100,
                turnIndex: 0,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 20,
                linesRemoved: 10,
                diff: '+notification unified approach',
              },
              {
                path: 'COORDINATION.md',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+decision rationale for architecture',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, CONFLICT_RESOLUTION_GROUND_TRUTH);

      // Composite = 0.3 * conflict-detection + 0.4 * resolution-quality + 0.3 * decision-documentation
      const expected =
        scored.scores['conflict-detection'].value * 0.3 +
        scored.scores['resolution-quality'].value * 0.4 +
        scored.scores['decision-documentation'].value * 0.3;

      expect(scored.composite).toBeCloseTo(expected, 1);
    });
  });

  describe('teardown()', () => {
    it('is idempotent', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      await scenario.teardown();
      await scenario.teardown(); // Should not throw
    });
  });
});

describe('CONFLICT_RESOLUTION_GROUND_TRUTH', () => {
  it('has the expected decisions', () => {
    const ids = CONFLICT_RESOLUTION_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('notification-architecture');
    expect(ids).toContain('conflict-resolved');
  });
});

describe('createConflictResolutionScenario', () => {
  it('returns a ConflictResolutionScenario instance', () => {
    const s = createConflictResolutionScenario();
    expect(s).toBeInstanceOf(ConflictResolutionScenario);
  });
});
