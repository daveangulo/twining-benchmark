import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ArchitectureCascadeScenario,
  ARCHITECTURE_CASCADE_GROUND_TRUTH,
  createArchitectureCascadeScenario,
} from '../../../src/scenarios/architecture-cascade.js';
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
    scenario: 'architecture-cascade',
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

describe('ArchitectureCascadeScenario', () => {
  let scenario: ArchitectureCascadeScenario;

  beforeEach(() => {
    scenario = new ArchitectureCascadeScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario metadata', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('architecture-cascade');
      expect(meta.agentSessionCount).toBe(3);
      expect(meta.scoringDimensions).toEqual([
        'decisionPropagation',
        'patternConsistency',
        'decisionQuality',
      ]);
      expect(meta.excludeFromAll).toBe(false);
    });
  });

  describe('setup()', () => {
    it('creates scenario context with resolved prompts', async () => {
      const workDir = makeWorkingDir('/tmp/cascade-repo');
      const condCtx = makeConditionContext();

      const ctx = await scenario.setup(workDir, condCtx);

      expect(ctx.workingDir).toBe(workDir);
      expect(ctx.conditionContext).toBe(condCtx);
      expect(ctx.groundTruth).toBe(ARCHITECTURE_CASCADE_GROUND_TRUTH);
      expect(ctx.metadata.scenario).toBe('architecture-cascade');
    });

    it('substitutes template variables in agent prompts', async () => {
      const workDir = makeWorkingDir('/tmp/cascade-12345');
      await scenario.setup(workDir, makeConditionContext());

      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(3);

      expect(tasks[0].prompt).toContain('Agent 1 of 3');
      expect(tasks[0].prompt).toContain('/tmp/cascade-12345');
      expect(tasks[1].prompt).toContain('Agent 2 of 3');
      expect(tasks[2].prompt).toContain('Agent 3 of 3');

      // No unresolved template variables
      for (const task of tasks) {
        expect(task.prompt).not.toContain('{{');
      }
    });
  });

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('returns 3 tasks in correct order', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks).toHaveLength(3);
      expect(tasks[0].sequenceOrder).toBe(0);
      expect(tasks[1].sequenceOrder).toBe(1);
      expect(tasks[2].sequenceOrder).toBe(2);
      expect(tasks[0].role).toBe('architect');
      expect(tasks[1].role).toBe('email-builder');
      expect(tasks[2].role).toBe('webhook-builder');
    });

    it('Agent A prompt contains architectural decision instructions', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].prompt).toContain('notification system');
      expect(tasks[0].prompt).toContain('ONE approach');
      expect(tasks[0].prompt).toContain('EventBus');
      expect(tasks[0].prompt).toContain('CallbackRegistry');
    });

    it('Agent B and C prompts do NOT reference specific pattern choice', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      // B and C must discover A's decision — prompts should not mention EventBus or CallbackRegistry
      expect(tasks[1].prompt).not.toContain('EventBus');
      expect(tasks[1].prompt).not.toContain('CallbackRegistry');
      expect(tasks[2].prompt).not.toContain('EventBus');
      expect(tasks[2].prompt).not.toContain('CallbackRegistry');

      // But they should mention integrating with existing architecture
      expect(tasks[1].prompt).toContain('existing notification architecture');
      expect(tasks[2].prompt).toContain('existing notification architecture');
    });
  });

  describe('execute()', () => {
    it('runs all 3 tasks sequentially', async () => {
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

      expect(callOrder).toEqual([0, 1, 2]);
      expect(results.transcripts).toHaveLength(3);
      expect(results.allSessionsCompleted).toBe(true);
    });
  });

  describe('score()', () => {
    it('scores full propagation when B and C follow A pattern', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/events/event-bus.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+import { EventEmitter } from "events";\n+export class EventBus extends EventEmitter {\n+  publish(event: string, data: any) { this.emit(event, data); }\n+  subscribe(event: string, handler: Function) { this.on(event, handler); }\n+}',
              },
              {
                path: 'DECISIONS.md',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+# Decision: Event-driven decoupling\n+## Rationale: Chose event-driven approach because...',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/notifications/email.ts',
                changeType: 'added',
                linesAdded: 25,
                linesRemoved: 0,
                diff: '+import { EventBus } from "../events/event-bus";\n+eventBus.subscribe("order.status", handleEmail);\n+function handleEmail(data) { /* send email */ }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/notifications/webhook.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+import { EventBus } from "../events/event-bus";\n+eventBus.subscribe("order.status", fireWebhook);\n+function fireWebhook(data) { /* HTTP callback */ }',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ARCHITECTURE_CASCADE_GROUND_TRUTH);

      expect(scored.scores.decisionPropagation.value).toBe(100);
      expect(scored.scores.patternConsistency.value).toBeGreaterThanOrEqual(50);
      expect(scored.scores.decisionQuality.value).toBeGreaterThanOrEqual(60);
      expect(scored.composite).toBeGreaterThan(0);
    });

    it('scores partial propagation when only B follows', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/events/event-bus.ts',
                changeType: 'added',
                linesAdded: 20,
                linesRemoved: 0,
                diff: '+export class EventBus { emit(e: string) {} subscribe(e: string, h: Function) {} }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/notifications/email.ts',
                changeType: 'added',
                linesAdded: 15,
                linesRemoved: 0,
                diff: '+eventBus.subscribe("order", handleEmail);',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/notifications/webhook.ts',
                changeType: 'added',
                linesAdded: 15,
                linesRemoved: 0,
                diff: '+function directCall() { orderService.notify("webhook"); }',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ARCHITECTURE_CASCADE_GROUND_TRUTH);

      expect(scored.scores.decisionPropagation.value).toBe(50);
    });

    it('scores zero propagation when neither B nor C follow', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/events/event-bus.ts',
                changeType: 'added',
                linesAdded: 20,
                linesRemoved: 0,
                diff: '+export class EventBus { emit() {} subscribe() {} }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            fileChanges: [
              {
                path: 'src/notifications/email.ts',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+function sendEmailDirect() { notificationService.send("email"); }',
              },
            ],
          }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/notifications/webhook.ts',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+function sendWebhookDirect() { notificationService.send("webhook"); }',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ARCHITECTURE_CASCADE_GROUND_TRUTH);

      expect(scored.scores.decisionPropagation.value).toBe(0);
    });

    it('handles missing transcripts gracefully', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: ['All agents failed'],
      };

      const scored = await scenario.score(rawResults, ARCHITECTURE_CASCADE_GROUND_TRUTH);

      expect(scored.scores.decisionPropagation.value).toBe(0);
      expect(scored.scores.decisionQuality.value).toBe(0);
    });

    it('extracts correct metrics from transcripts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            tokenUsage: { input: 2000, output: 1000, cacheRead: 0, cacheCreation: 0, total: 3000, costUsd: 0.02 },
            timing: { startTime: '', endTime: '', durationMs: 300000, timeToFirstActionMs: 5000 },
            fileChanges: [
              { path: 'a.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 3 },
            ],
          }),
          makeTranscript({
            tokenUsage: { input: 1500, output: 800, cacheRead: 0, cacheCreation: 0, total: 2300, costUsd: 0.015 },
            timing: { startTime: '', endTime: '', durationMs: 200000, timeToFirstActionMs: 3000 },
            fileChanges: [
              { path: 'b.ts', changeType: 'added', linesAdded: 20, linesRemoved: 0 },
            ],
          }),
          makeTranscript({
            tokenUsage: { input: 1800, output: 900, cacheRead: 0, cacheCreation: 0, total: 2700, costUsd: 0.018 },
            timing: { startTime: '', endTime: '', durationMs: 250000, timeToFirstActionMs: 4000 },
            fileChanges: [
              { path: 'c.ts', changeType: 'added', linesAdded: 15, linesRemoved: 0 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ARCHITECTURE_CASCADE_GROUND_TRUTH);

      expect(scored.metrics.totalTokens).toBe(8000);
      expect(scored.metrics.wallTimeMs).toBe(750000);
      expect(scored.metrics.agentSessions).toBe(3);
      expect(scored.metrics.gitChurn.linesAdded).toBe(45);
      expect(scored.metrics.gitChurn.filesChanged).toBe(3);
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

describe('ARCHITECTURE_CASCADE_GROUND_TRUTH', () => {
  it('has all required decisions', () => {
    const ids = ARCHITECTURE_CASCADE_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('decouple-notifications');
    expect(ids).toContain('email-notification-integration');
    expect(ids).toContain('webhook-integration');
  });

  it('each decision has expected patterns', () => {
    for (const decision of ARCHITECTURE_CASCADE_GROUND_TRUTH.decisions) {
      expect(decision.expectedPatterns.length).toBeGreaterThan(0);
      expect(decision.affectedFiles.length).toBeGreaterThan(0);
    }
  });

  it('accepts both EventBus and CallbackRegistry patterns', () => {
    const decoupleDecision = ARCHITECTURE_CASCADE_GROUND_TRUTH.decisions.find(
      (d) => d.id === 'decouple-notifications',
    )!;

    // EventBus patterns
    expect(decoupleDecision.expectedPatterns).toContain('EventBus');
    expect(decoupleDecision.expectedPatterns).toContain('emit');
    expect(decoupleDecision.expectedPatterns).toContain('subscribe');

    // CallbackRegistry patterns
    expect(decoupleDecision.expectedPatterns).toContain('CallbackRegistry');
    expect(decoupleDecision.expectedPatterns).toContain('register');
    expect(decoupleDecision.expectedPatterns).toContain('notify');
  });
});

describe('createArchitectureCascadeScenario', () => {
  it('returns an ArchitectureCascadeScenario instance', () => {
    const s = createArchitectureCascadeScenario();
    expect(s).toBeInstanceOf(ArchitectureCascadeScenario);
  });
});
