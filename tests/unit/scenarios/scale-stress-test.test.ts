import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ScaleStressTestScenario,
  SCALE_STRESS_GROUND_TRUTH,
  DEFAULT_SCALE_CONFIG,
  createScaleStressTestScenario,
} from '../../../src/scenarios/scale-stress-test.js';
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
    scenario: 'scale-stress-test',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 1000, output: 500, total: 1500 },
    timing: {
      startTime: '2026-02-20T10:00:00Z',
      endTime: '2026-02-20T10:05:00Z',
      durationMs: 300000,
      timeToFirstActionMs: 10000,
    },
    exitReason: 'completed',
    ...overrides,
  };
}

describe('ScaleStressTestScenario', () => {
  let scenario: ScaleStressTestScenario;

  beforeEach(() => {
    scenario = new ScaleStressTestScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct metadata at scale factor 1', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('scale-stress-test');
      expect(meta.agentSessionCount).toBe(4); // 1 * 4
      expect(meta.excludeFromAll).toBe(true);
      expect(meta.scoringDimensions).toEqual([
        'coherenceDegradation',
        'orientationOverhead',
        'integrationSuccess',
      ]);
    });

    it('adjusts session count for higher scale factors', () => {
      scenario.setScaleFactor(3);
      const meta = scenario.getMetadata();
      expect(meta.agentSessionCount).toBe(12); // 3 * 4
    });

    it('rejects invalid scale factors', () => {
      expect(() => scenario.setScaleFactor(0)).toThrow('Scale factor must be 1-5');
      expect(() => scenario.setScaleFactor(6)).toThrow('Scale factor must be 1-5');
    });
  });

  describe('getScaleConfig()', () => {
    it('returns default config', () => {
      const config = scenario.getScaleConfig();
      expect(config.scaleFactor).toBe(1);
      expect(config.baseSessionCount).toBe(4);
      expect(config.baseRepoSize).toBe(2000);
    });

    it('returns updated config after setScaleFactor', () => {
      scenario.setScaleFactor(3);
      const config = scenario.getScaleConfig();
      expect(config.scaleFactor).toBe(3);
    });

    it('returns a copy (not reference)', () => {
      const config = scenario.getScaleConfig();
      config.scaleFactor = 99;
      expect(scenario.getScaleConfig().scaleFactor).toBe(1);
    });
  });

  describe('setup()', () => {
    it('creates scenario context with scale metadata', async () => {
      scenario.setScaleFactor(2);
      const ctx = await scenario.setup(makeWorkingDir(), makeConditionContext());

      expect(ctx.metadata.scenario).toBe('scale-stress-test');
      expect(ctx.metadata.scaleFactor).toBe(2);
      expect(ctx.metadata.sessionCount).toBe(8);
      expect(ctx.metadata.targetRepoSize).toBe(4000);
    });

    it('generates correct number of tasks at scale factor 1', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(4);
    });

    it('generates correct number of tasks at scale factor 3', async () => {
      scenario.setScaleFactor(3);
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(12);
    });

    it('substitutes template variables in all prompts', async () => {
      scenario.setScaleFactor(2);
      await scenario.setup(makeWorkingDir('/tmp/scale-repo'), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      for (const task of tasks) {
        expect(task.prompt).toContain('/tmp/scale-repo');
        expect(task.prompt).not.toContain('{{');
      }
    });
  });

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('last task is always integration-tester', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      const lastTask = tasks[tasks.length - 1];
      expect(lastTask.role).toBe('integration-tester');
      expect(lastTask.prompt).toContain('integration tests');
    });

    it('early tasks are component builders', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].role).toBe('component-builder-1');
      expect(tasks[0].prompt).toContain('component #1');
      expect(tasks[0].prompt).toContain('Design');
    });

    it('sequential order is correct', async () => {
      scenario.setScaleFactor(2);
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      for (let i = 0; i < tasks.length; i++) {
        expect(tasks[i].sequenceOrder).toBe(i);
      }
    });
  });

  describe('score()', () => {
    it('scores high coherence when patterns are consistent', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = Array.from({ length: 4 }, (_, i) =>
        makeTranscript({
          taskIndex: i,
          fileChanges: [
            {
              path: `src/components/component-${i + 1}.ts`,
              changeType: 'added',
              linesAdded: 30,
              linesRemoved: 0,
              diff: `+export interface Component${i + 1} {\n+  async process(): Promise<void> {}\n+}\n+export class Component${i + 1}Service implements Component${i + 1} {\n+  async process() {}\n+}`,
            },
          ],
        }),
      );

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, SCALE_STRESS_GROUND_TRUTH);

      expect(scored.scores.coherenceDegradation.value).toBeGreaterThanOrEqual(50);
    });

    it('measures orientation overhead from tool calls', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = Array.from({ length: 4 }, (_, i) =>
        makeTranscript({
          taskIndex: i,
          toolCalls: [
            // Orientation calls
            { toolName: 'Read', parameters: { file_path: 'README.md' }, timestamp: '', durationMs: 100 },
            { toolName: 'Grep', parameters: { pattern: 'component' }, timestamp: '', durationMs: 100 },
            // Production calls
            { toolName: 'Write', parameters: { file_path: `src/component-${i}.ts` }, timestamp: '', durationMs: 100 },
            { toolName: 'Edit', parameters: { file_path: `src/component-${i}.ts` }, timestamp: '', durationMs: 100 },
            { toolName: 'Bash', parameters: { command: 'npm test' }, timestamp: '', durationMs: 100 },
          ],
        }),
      );

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, SCALE_STRESS_GROUND_TRUTH);

      // 8 orientation calls out of 20 total = 40% overhead
      // Score should be 0 at 40%
      expect(scored.scores.orientationOverhead.value).toBeLessThanOrEqual(20);
    });

    it('scores high overhead when mostly reading', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = Array.from({ length: 4 }, (_, i) =>
        makeTranscript({
          taskIndex: i,
          toolCalls: [
            // All orientation, no production
            { toolName: 'Read', parameters: { file_path: 'a.ts' }, timestamp: '', durationMs: 100 },
            { toolName: 'Read', parameters: { file_path: 'b.ts' }, timestamp: '', durationMs: 100 },
            { toolName: 'Grep', parameters: { pattern: 'x' }, timestamp: '', durationMs: 100 },
            { toolName: 'Glob', parameters: { pattern: '*.ts' }, timestamp: '', durationMs: 100 },
          ],
        }),
      );

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, SCALE_STRESS_GROUND_TRUTH);

      // 100% orientation overhead = score 0
      expect(scored.scores.orientationOverhead.value).toBe(0);
    });

    it('scores integration success based on final session', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = [
        ...Array.from({ length: 3 }, (_, i) =>
          makeTranscript({ taskIndex: i }),
        ),
        makeTranscript({
          taskIndex: 3,
          fileChanges: [
            { path: 'tests/integration/all.test.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0 },
          ],
          toolCalls: [
            { toolName: 'Bash', parameters: { command: 'npx vitest' }, timestamp: '', durationMs: 5000 },
          ],
        }),
      ];

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, SCALE_STRESS_GROUND_TRUTH);

      // Final session completed + test files + ran tests + all completed
      expect(scored.scores.integrationSuccess.value).toBe(100);
    });

    it('handles empty transcripts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: ['All failed'],
      };

      const scored = await scenario.score(rawResults, SCALE_STRESS_GROUND_TRUTH);

      expect(scored.scores.coherenceDegradation.value).toBe(0);
      expect(scored.scores.integrationSuccess.value).toBe(0);
    });

    it('extracts correct metrics', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const transcripts = Array.from({ length: 4 }, (_, i) =>
        makeTranscript({
          taskIndex: i,
          tokenUsage: { input: 2000, output: 1000, total: 3000 },
          timing: { startTime: '', endTime: '', durationMs: 600000, timeToFirstActionMs: 5000 },
          fileChanges: [
            { path: `src/c${i}.ts`, changeType: 'added', linesAdded: 25, linesRemoved: 0 },
          ],
        }),
      );

      const rawResults: RawResults = {
        transcripts,
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, SCALE_STRESS_GROUND_TRUTH);

      expect(scored.metrics.totalTokens).toBe(12000);
      expect(scored.metrics.wallTimeMs).toBe(2400000);
      expect(scored.metrics.agentSessions).toBe(4);
      expect(scored.metrics.gitChurn.linesAdded).toBe(100);
      expect(scored.metrics.gitChurn.filesChanged).toBe(4);
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

describe('DEFAULT_SCALE_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_SCALE_CONFIG.scaleFactor).toBe(1);
    expect(DEFAULT_SCALE_CONFIG.baseSessionCount).toBe(4);
    expect(DEFAULT_SCALE_CONFIG.baseRepoSize).toBe(2000);
  });
});

describe('SCALE_STRESS_GROUND_TRUTH', () => {
  it('has required decisions', () => {
    const ids = SCALE_STRESS_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('component-integration');
    expect(ids).toContain('consistent-patterns');
    expect(ids).toContain('integration-tests');
  });
});

describe('createScaleStressTestScenario', () => {
  it('returns a ScaleStressTestScenario instance', () => {
    const s = createScaleStressTestScenario();
    expect(s).toBeInstanceOf(ScaleStressTestScenario);
  });

  it('accepts custom scale config', () => {
    const s = createScaleStressTestScenario({ scaleFactor: 3 });
    expect(s.getScaleConfig().scaleFactor).toBe(3);
  });
});
