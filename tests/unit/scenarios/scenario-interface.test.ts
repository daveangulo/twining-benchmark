import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BaseScenario,
  substitutePromptTemplate,
  type PromptTemplateVars,
} from '../../../src/scenarios/scenario.interface.js';
import type { ScenarioMetadata, AgentTask, RawResults, ScenarioRunner } from '../../../src/types/scenario.js';
import type { WorkingDirectory, ArchitecturalManifest } from '../../../src/types/target.js';
import type { ConditionContext } from '../../../src/types/condition.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';
import type { ScoredResults } from '../../../src/types/results.js';
import type Anthropic from '@anthropic-ai/sdk';

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

/** Create a mock transcript for testing. */
function makeTranscript(taskIndex: number, overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: `session-${taskIndex}`,
    runId: 'test-run',
    scenario: 'refactoring-handoff',
    condition: 'baseline',
    taskIndex,
    prompt: `Task ${taskIndex} prompt`,
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150, costUsd: 0.001 },
    timing: {
      startTime: '2026-03-08T10:00:00Z',
      endTime: '2026-03-08T10:01:00Z',
      durationMs: 60000,
      timeToFirstActionMs: 5000,
    },
    exitReason: 'completed',
    numTurns: 3,
    stopReason: 'success',
    contextWindowSize: 200000,
    compactionCount: 0,
    turnUsage: [],
    ...overrides,
  };
}

/**
 * Concrete test scenario with configurable executionMode.
 */
class TestScenario extends BaseScenario {
  private mode: 'sequential' | 'parallel' | undefined;
  private taskCount: number;

  constructor(mode?: 'sequential' | 'parallel', taskCount = 3) {
    super();
    this.mode = mode;
    this.taskCount = taskCount;
  }

  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'refactoring-handoff',
      description: 'Test scenario',
      estimatedDurationMinutes: 5,
      requiredTargetType: 'typescript',
      agentSessionCount: this.taskCount,
      scoringDimensions: ['completion'],
      excludeFromAll: false,
      executionMode: this.mode,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return Array.from({ length: this.taskCount }, (_, i) => ({
      prompt: `Task {{agent_number}} of {{total_agents}}`,
      timeoutMs: 60000,
      requiredCapabilities: ['Read'],
      sequenceOrder: i,
      maxTurns: 10,
    }));
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return {
      components: [],
      dependencies: [],
      patterns: [],
      testLocations: [],
    };
  }

  protected async doSetup(): Promise<Record<string, unknown>> {
    return {};
  }

  protected async doScore(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
    _evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    return {
      runId: 'test-run',
      scenario: 'refactoring-handoff',
      condition: 'baseline',
      iteration: 0,
      scores: {},
      composite: 100,
      metrics: this.extractMetrics(rawResults),
    };
  }

  protected async doTeardown(): Promise<void> {}
}

describe('substitutePromptTemplate', () => {
  const baseVars: PromptTemplateVars = {
    repo_path: '/tmp/test-repo',
    agent_number: '1',
    total_agents: '2',
    scenario_name: 'refactoring-handoff',
  };

  it('replaces all known template variables', () => {
    const template =
      'Working at {{repo_path}} as Agent {{agent_number}} of {{total_agents}} on {{scenario_name}}.';
    const result = substitutePromptTemplate(template, baseVars);
    expect(result).toBe(
      'Working at /tmp/test-repo as Agent 1 of 2 on refactoring-handoff.',
    );
  });

  it('leaves unknown variables unchanged', () => {
    const template = 'Unknown: {{unknown_var}} and known: {{repo_path}}.';
    const result = substitutePromptTemplate(template, baseVars);
    expect(result).toBe('Unknown: {{unknown_var}} and known: /tmp/test-repo.');
  });

  it('handles empty template', () => {
    const result = substitutePromptTemplate('', baseVars);
    expect(result).toBe('');
  });

  it('handles template with no variables', () => {
    const result = substitutePromptTemplate('No variables here.', baseVars);
    expect(result).toBe('No variables here.');
  });

  it('handles multiple occurrences of the same variable', () => {
    const template = '{{repo_path}} and again {{repo_path}}.';
    const result = substitutePromptTemplate(template, baseVars);
    expect(result).toBe('/tmp/test-repo and again /tmp/test-repo.');
  });

  it('handles custom variables via index signature', () => {
    const vars: PromptTemplateVars = {
      ...baseVars,
      custom_key: 'custom_value',
    };
    const template = '{{custom_key}} at {{repo_path}}.';
    const result = substitutePromptTemplate(template, vars);
    expect(result).toBe('custom_value at /tmp/test-repo.');
  });

  it('does not replace partial matches or malformed syntax', () => {
    const template = '{repo_path} and {{ repo_path }} and {{repo_path.';
    const result = substitutePromptTemplate(template, baseVars);
    // None of these should be replaced
    expect(result).toBe('{repo_path} and {{ repo_path }} and {{repo_path.');
  });
});

describe('BaseScenario execution modes', () => {
  describe('sequential execution (default)', () => {
    let scenario: TestScenario;

    beforeEach(async () => {
      scenario = new TestScenario(undefined, 3);
      await scenario.setup(makeWorkingDir(), makeConditionContext());
    });

    afterEach(async () => {
      await scenario.teardown();
    });

    it('executes tasks sequentially by default', async () => {
      const executionOrder: number[] = [];
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          executionOrder.push(task.sequenceOrder);
          return makeTranscript(task.sequenceOrder);
        },
      };

      const results = await scenario.execute(mockRunner);
      expect(results.transcripts).toHaveLength(3);
      expect(results.allSessionsCompleted).toBe(true);
      expect(results.errors).toHaveLength(0);
      expect(executionOrder).toEqual([0, 1, 2]);
    });

    it('executes tasks sequentially when executionMode is "sequential"', async () => {
      const seqScenario = new TestScenario('sequential', 3);
      await seqScenario.setup(makeWorkingDir(), makeConditionContext());

      const executionOrder: number[] = [];
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          executionOrder.push(task.sequenceOrder);
          return makeTranscript(task.sequenceOrder);
        },
      };

      const results = await seqScenario.execute(mockRunner);
      expect(results.transcripts).toHaveLength(3);
      expect(results.allSessionsCompleted).toBe(true);
      expect(executionOrder).toEqual([0, 1, 2]);

      await seqScenario.teardown();
    });
  });

  describe('parallel execution mode', () => {
    let scenario: TestScenario;

    beforeEach(async () => {
      scenario = new TestScenario('parallel', 3);
      await scenario.setup(makeWorkingDir(), makeConditionContext());
    });

    afterEach(async () => {
      await scenario.teardown();
    });

    it('executes tasks via Promise.allSettled when executionMode is parallel', async () => {
      const startTimes: number[] = [];
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          return makeTranscript(task.sequenceOrder);
        },
      };

      const results = await scenario.execute(mockRunner);
      expect(results.transcripts).toHaveLength(3);
      expect(results.allSessionsCompleted).toBe(true);
      expect(results.errors).toHaveLength(0);

      // All tasks should start nearly simultaneously (within 30ms of each other)
      // In sequential mode, they would be ~50ms apart
      const maxGap = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxGap).toBeLessThan(30);
    });

    it('handles failed tasks in parallel mode', async () => {
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          if (task.sequenceOrder === 1) {
            throw new Error('Task 1 exploded');
          }
          return makeTranscript(task.sequenceOrder);
        },
      };

      const results = await scenario.execute(mockRunner);
      expect(results.transcripts).toHaveLength(3);
      expect(results.allSessionsCompleted).toBe(false);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0]).toContain('Task 1 failed: Task 1 exploded');

      // The failed task should have a placeholder transcript
      const failedTranscript = results.transcripts[1]!;
      expect(failedTranscript.sessionId).toBe('error-1');
      expect(failedTranscript.exitReason).toBe('error');
      expect(failedTranscript.error).toBe('Task 1 exploded');

      // Other transcripts should be successful
      expect(results.transcripts[0]!.exitReason).toBe('completed');
      expect(results.transcripts[2]!.exitReason).toBe('completed');
    });

    it('marks allSessionsCompleted false when a task has error exitReason', async () => {
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          if (task.sequenceOrder === 2) {
            return makeTranscript(task.sequenceOrder, {
              exitReason: 'error',
              error: 'Something went wrong',
            });
          }
          return makeTranscript(task.sequenceOrder);
        },
      };

      const results = await scenario.execute(mockRunner);
      expect(results.transcripts).toHaveLength(3);
      expect(results.allSessionsCompleted).toBe(false);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0]).toContain('Task 2: Something went wrong');
    });

    it('handles all tasks failing in parallel mode', async () => {
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => {
          throw new Error(`Task ${task.sequenceOrder} failed`);
        },
      };

      const results = await scenario.execute(mockRunner);
      expect(results.transcripts).toHaveLength(3);
      expect(results.allSessionsCompleted).toBe(false);
      expect(results.errors).toHaveLength(3);

      // All transcripts should be placeholders
      for (const transcript of results.transcripts) {
        expect(transcript.exitReason).toBe('error');
        expect(transcript.sessionId).toMatch(/^error-/);
      }
    });

    it('sets finalWorkingDir from context', async () => {
      const mockRunner: ScenarioRunner = {
        runAgentTask: async (task) => makeTranscript(task.sequenceOrder),
      };

      const results = await scenario.execute(mockRunner);
      expect(results.finalWorkingDir).toBe('/tmp/test-repo');
    });
  });
});
