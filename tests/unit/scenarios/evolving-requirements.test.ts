import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EvolvingRequirementsScenario,
  EVOLVING_REQUIREMENTS_GROUND_TRUTH,
  createEvolvingRequirementsScenario,
} from '../../../src/scenarios/evolving-requirements.js';
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
    scenario: 'evolving-requirements',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0, total: 1500, costUsd: 0.01 },
    timing: {
      startTime: '2026-03-08T10:00:00Z',
      endTime: '2026-03-08T10:15:00Z',
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

describe('EvolvingRequirementsScenario', () => {
  let scenario: EvolvingRequirementsScenario;

  beforeEach(() => {
    scenario = new EvolvingRequirementsScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario name', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('evolving-requirements');
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
        'requirementAdaptation',
        'decisionEvolution',
        'backwardCompatibility',
        'integrationCompleteness',
      ]);
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

    it('tasks have correct sequence order', async () => {
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
      expect(tasks[0].role).toBe('initial-architect');
      expect(tasks[1].role).toBe('channel-extender');
      expect(tasks[2].role).toBe('requirements-changer');
      expect(tasks[3].role).toBe('auditor-finalizer');
    });

    it('session 3 prompt mentions priority routing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[2].prompt.toLowerCase()).toContain('priority');
      expect(tasks[2].prompt.toLowerCase()).toContain('urgent');
    });

    it('substitutes template variables in all prompts', async () => {
      const workDir = makeWorkingDir('/tmp/bench-evolving');
      await scenario.setup(workDir, makeConditionContext());
      const tasks = scenario.getAgentTasks();
      for (const task of tasks) {
        expect(task.prompt).toContain('/tmp/bench-evolving');
        expect(task.prompt).not.toContain('{{');
      }
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
  });

  describe('score() — requirementAdaptation', () => {
    it('scores high when session 3 creates a priority router with routing logic, channel mappings, and updates notification service', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/priority-router.ts',
                changeType: 'added',
                linesAdded: 60,
                linesRemoved: 0,
                diff: `+export class PriorityRouter {
+  route(notification: Notification) {
+    switch (notification.priority) {
+      case 'urgent': return this.smsService.send(notification);
+      case 'normal': return this.emailService.send(notification);
+      case 'low': return this.webhookService.send(notification);
+    }
+  }
+}`,
              },
              {
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 10,
                linesRemoved: 5,
                diff: `+import { PriorityRouter } from './priority-router';
+this.priorityRouter.route(notification);`,
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // Router file (15) + routing logic (15) + 3 channel mappings (50) + notification service updated (20) = 100
      expect(scored.scores.requirementAdaptation.value).toBe(100);
    });

    it('scores partially when priority router file exists but has no routing logic or channel mappings', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/priority-router.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: '+export class PriorityRouter { /* placeholder */ }',
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // Router file only (15), no routing logic, no channel mappings, no notification update
      expect(scored.scores.requirementAdaptation.value).toBe(15);
    });

    it('scores 0 when session 3 is missing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      expect(scored.scores.requirementAdaptation.value).toBe(0);
    });

    it('scores 0 when session 3 has no priority router or patterns', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/utils/helpers.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 2,
                diff: '+// minor comment update',
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      expect(scored.scores.requirementAdaptation.value).toBe(0);
    });

    it('gives partial credit when router has some but not all channel mappings', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/priority-router.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: `+export class PriorityRouter {
+  route(notification: Notification) {
+    if (notification.priority === 'urgent') return this.smsService.send(notification);
+  }
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

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // Router file (15) + routing logic (15) + 1/3 channel mapping (17) = 47
      expect(scored.scores.requirementAdaptation.value).toBeGreaterThan(30);
      expect(scored.scores.requirementAdaptation.value).toBeLessThan(60);
    });
  });

  describe('score() — decisionEvolution', () => {
    it('scores coordination tool calls in session 3 highly', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            toolCalls: [
              {
                toolName: 'twining_reconsider',
                parameters: { decision_id: 'some-id', reason: 'Priority routing invalidates broadcast' },
                timestamp: '',
                durationMs: 200,
              },
              {
                toolName: 'twining_decide',
                parameters: { summary: 'Use priority router instead of broadcast EventBus' },
                timestamp: '',
                durationMs: 200,
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // 60 points for coordination tool usage in session 3
      expect(scored.scores.decisionEvolution.value).toBeGreaterThanOrEqual(60);
    });

    it('scores session 4 early discovery of priority routing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({ taskIndex: 2 }), // No coordination tools — 0 pts
          makeTranscript({
            taskIndex: 3,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/priority-router.ts' },
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

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // 40 points for session 4 finding priority router early
      expect(scored.scores.decisionEvolution.value).toBeGreaterThanOrEqual(40);
    });
  });

  describe('score() — backwardCompatibility', () => {
    it('starts at 100 when no channel files are damaged', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/priority-router.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: '+export class PriorityRouter { route() {} }\n+// sms,SMS,webhook,Webhook',
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      expect(scored.scores.backwardCompatibility.value).toBe(100);
    });

    it('deducts points for large deletions in channel files', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/sms.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 80, // Large deletion
                diff: '-// removed sms channel handler entirely',
              },
              {
                path: 'src/services/webhook.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 70, // Large deletion
                diff: '-// removed webhook channel handler',
              },
            ],
          }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // Should deduct points for each large deletion (20 per file)
      expect(scored.scores.backwardCompatibility.value).toBeLessThan(100);
    });
  });

  describe('score() — integrationCompleteness', () => {
    it('scores high when session 4 has substantive audit, preferences, and integration tests', async () => {
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
                path: 'src/services/audit.service.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: `+export class AuditService {
+  private logs: AuditEntry[] = [];
+  log(notification: Notification) {
+    this.logs.push({ event: notification.type, timestamp: Date.now() });
+  }
+}`,
              },
              {
                path: 'src/services/notification-preferences.service.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: `+export class NotificationPreferencesService {
+  getPreferences(userId: string) {
+    return this.store.get(userId) ?? { channel: 'email' };
+  }
+  setPreference(userId: string, channel: string) {
+    this.store.set(userId, { channel, override: true });
+  }
+}`,
              },
              {
                path: 'tests/integration/notification-flow.test.ts',
                changeType: 'added',
                linesAdded: 60,
                linesRemoved: 0,
                diff: `+describe("integration test: notification flow", () => {
+  it("routes urgent to SMS", () => {
+    const result = router.route({ priority: 'urgent', message: 'test' });
+    expect(result.channel).toBe('sms');
+  });
+});`,
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // Audit: file (15) + logging logic (20) = 35
      // Preferences: file (15) + per-user logic (20) = 35
      // Tests: file (10) + assertions (10) + flow refs (10) = 30
      expect(scored.scores.integrationCompleteness.value).toBe(100);
    });

    it('scores low when files exist but lack substantive logic', async () => {
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
                path: 'src/services/audit.service.ts',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+export class AuditService { /* TODO */ }',
              },
              {
                path: 'src/services/notification-preferences.service.ts',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+export class NotificationPreferencesService { /* TODO */ }',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      // Audit file only (15) + Preferences file only (15) + no tests = 30
      expect(scored.scores.integrationCompleteness.value).toBe(30);
    });

    it('scores 0 when session 4 is missing', async () => {
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

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      expect(scored.scores.integrationCompleteness.value).toBe(0);
    });

    it('scores 0 when session 4 has no audit, preferences, or test files', async () => {
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
                path: 'src/services/notification.service.ts',
                changeType: 'modified',
                linesAdded: 3,
                linesRemoved: 1,
                diff: '+// minor cleanup',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      expect(scored.scores.integrationCompleteness.value).toBe(0);
    });
  });

  describe('score() — composite', () => {
    it('composite is a weighted average of 4 dimensions (0.30/0.25/0.25/0.20)', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({
            taskIndex: 2,
            fileChanges: [
              {
                path: 'src/services/priority-router.ts',
                changeType: 'added',
                linesAdded: 60,
                linesRemoved: 0,
                diff: `+export class PriorityRouter {
+  route(notification: Notification) {
+    switch (notification.priority) {
+      case 'urgent': return this.smsService.send(notification);
+      case 'normal': return this.emailService.send(notification);
+      case 'low': return this.webhookService.send(notification);
+    }
+  }
+}`,
              },
            ],
          }),
          makeTranscript({
            taskIndex: 3,
            fileChanges: [
              {
                path: 'src/services/audit.service.ts',
                changeType: 'added',
                linesAdded: 30,
                linesRemoved: 0,
                diff: `+export class AuditService {
+  log(notification: Notification) {
+    this.entries.push({ event: notification.type, timestamp: Date.now() });
+  }
+}`,
              },
              {
                path: 'src/services/notification-preferences.service.ts',
                changeType: 'added',
                linesAdded: 20,
                linesRemoved: 0,
                diff: `+export class NotificationPreferencesService {
+  getPreferences(userId: string) { return this.store.get(userId); }
+  setPreference(userId: string, channel: string) { this.store.set(userId, { channel, override: true }); }
+}`,
              },
              {
                path: 'tests/integration/flow.test.ts',
                changeType: 'added',
                linesAdded: 40,
                linesRemoved: 0,
                diff: `+describe("integration test: full notification flow", () => {
+  it("routes priority correctly", () => {
+    expect(router.route({ priority: 'urgent' }).channel).toBe('sms');
+  });
+});`,
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);

      const expected =
        scored.scores.requirementAdaptation.value * 0.30 +
        scored.scores.decisionEvolution.value * 0.25 +
        scored.scores.backwardCompatibility.value * 0.25 +
        scored.scores.integrationCompleteness.value * 0.20;

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

describe('EVOLVING_REQUIREMENTS_GROUND_TRUTH', () => {
  it('has the 4 required decisions', () => {
    const ids = EVOLVING_REQUIREMENTS_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('notification-pattern');
    expect(ids).toContain('additional-channels');
    expect(ids).toContain('priority-routing');
    expect(ids).toContain('audit-and-preferences');
  });

  it('each decision has at least one expected pattern', () => {
    for (const decision of EVOLVING_REQUIREMENTS_GROUND_TRUTH.decisions) {
      expect(decision.expectedPatterns.length).toBeGreaterThan(0);
    }
  });

  it('has the correct name', () => {
    expect(EVOLVING_REQUIREMENTS_GROUND_TRUTH.name).toBe('evolving-requirements');
  });
});

describe('createEvolvingRequirementsScenario', () => {
  it('returns an EvolvingRequirementsScenario instance', () => {
    const s = createEvolvingRequirementsScenario();
    expect(s).toBeInstanceOf(EvolvingRequirementsScenario);
  });
});
