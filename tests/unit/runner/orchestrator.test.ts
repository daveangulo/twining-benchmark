import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import type { ProgressUpdate } from '../../../src/runner/orchestrator.js';
import type {
  BenchmarkConfig,
  Scenario,
  ScenarioMetadata,
  Condition,
  ConditionContext,
  AgentTask,
  AgentConfiguration,
  CoordinationArtifacts,
  WorkingDirectory,
  ArchitecturalManifest,
  ScoredResults,
} from '../../../src/types/index.js';
import type { ITestTarget, ValidationResult } from '../../../src/targets/target.interface.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';
import { ResultsStore } from '../../../src/results/store.js';

// Mock the agent session manager module before importing orchestrator
vi.mock('../../../src/runner/agent-session.js', () => {
  return {
    AgentSessionManager: class MockAgentSessionManager {
      private runId: string;
      private scenario: string;
      private condition: string;

      constructor(options: { runId: string; scenario: string; condition: string }) {
        this.runId = options.runId;
        this.scenario = options.scenario;
        this.condition = options.condition;
      }

      async executeTask(task: { prompt: string; sequenceOrder: number }) {
        return {
          sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`,
          runId: this.runId,
          scenario: this.scenario,
          condition: this.condition,
          taskIndex: task.sequenceOrder,
          prompt: task.prompt,
          toolCalls: [
            { toolName: 'Edit', parameters: {}, timestamp: new Date().toISOString(), durationMs: 100 },
          ],
          fileChanges: [
            { path: 'test.ts', changeType: 'modified', linesAdded: 5, linesRemoved: 2 },
          ],
          tokenUsage: { input: 500, output: 200, cacheRead: 0, cacheCreation: 0, total: 700, costUsd: 0 },
          timing: {
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 5000,
            timeToFirstActionMs: 2000,
          },
          exitReason: 'completed',
          numTurns: 1,
          stopReason: 'success',
          contextWindowSize: 200000,
          compactionCount: 0,
          turnUsage: [],
        };
      }
    },
  };
});

// Import after mock setup
const { RunOrchestrator } = await import('../../../src/runner/orchestrator.js');

function makeConfig(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return {
    ...DEFAULT_CONFIG,
    outputDirectory: '/tmp/test-output',
    retryCount: 0,
    ...overrides,
  };
}

async function makeMockTargetWorkingDir(tempDir: string): Promise<WorkingDirectory> {
  const dir = join(tempDir, `target-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await writeFile(join(dir, 'index.ts'), 'export const app = {};', 'utf-8');
  await git.add('.');
  await git.commit('initial');
  return {
    path: dir,
    gitDir: join(dir, '.git'),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function makeMockTarget(tempDir: string): ITestTarget {
  return {
    name: 'test-target',
    async setup(): Promise<WorkingDirectory> {
      return makeMockTargetWorkingDir(tempDir);
    },
    async validate(): Promise<ValidationResult> {
      return { valid: true, errors: [], warnings: [] };
    },
    getGroundTruth(): ArchitecturalManifest {
      return {
        name: 'test-target',
        description: 'Test',
        decisions: [],
        moduleDependencies: {},
        baselineTestCoverage: 0,
      };
    },
    async reset() {},
    async teardown() {},
  };
}

function makeMockCondition(): Condition {
  let isSetUp = false;
  return {
    name: 'baseline',
    description: 'Test baseline condition',
    async setup(_workingDir: string): Promise<ConditionContext> {
      isSetUp = true;
      return {
        agentConfig: {
          systemPrompt: '',
          mcpServers: {},
          allowedTools: ['Read', 'Edit', 'Bash'],
          permissionMode: 'acceptEdits',
        },
        setupFiles: [],
        metadata: {},
      };
    },
    getAgentConfig(): AgentConfiguration {
      if (!isSetUp) throw new Error('Not set up');
      return {
        systemPrompt: '',
        mcpServers: {},
        allowedTools: ['Read', 'Edit', 'Bash'],
        permissionMode: 'acceptEdits',
      };
    },
    async collectArtifacts(): Promise<CoordinationArtifacts> {
      return { preSessionState: {}, postSessionState: {}, changes: [] };
    },
    async teardown() { isSetUp = false; },
  };
}

function makeMockScenario(): Scenario {
  const metadata: ScenarioMetadata = {
    name: 'refactoring-handoff',
    description: 'Test scenario',
    estimatedDurationMinutes: 5,
    requiredTargetType: 'synthetic',
    agentSessionCount: 2,
    scoringDimensions: ['consistency'],
    excludeFromAll: false,
  };

  const tasks: AgentTask[] = [
    { prompt: 'Task 1', timeoutMs: 30000, requiredCapabilities: [], sequenceOrder: 0, maxTurns: 5 },
    { prompt: 'Task 2', timeoutMs: 30000, requiredCapabilities: [], sequenceOrder: 1, maxTurns: 5 },
  ];

  return {
    getMetadata: () => metadata,
    setup: async () => ({
      workingDir: { path: '/tmp', gitDir: '/tmp/.git', cleanup: async () => {} },
      conditionContext: {
        agentConfig: { systemPrompt: '', mcpServers: {}, allowedTools: [], permissionMode: 'acceptEdits' as const },
        setupFiles: [],
        metadata: {},
      },
      groundTruth: { name: 'test', description: 'test', decisions: [], moduleDependencies: {}, baselineTestCoverage: 0 },
      metadata: {},
    }),
    getAgentTasks: () => tasks,
    execute: async () => ({ transcripts: [], finalWorkingDir: '/tmp', allSessionsCompleted: true, errors: [] }),
    score: async () => ({
      runId: 'run-test', scenario: 'refactoring-handoff', condition: 'baseline', iteration: 0,
      scores: {},
      metrics: { totalTokens: 700, inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, wallTimeMs: 5000, agentSessions: 2, numTurns: 2, compactionCount: 0, contextUtilization: 0, gitChurn: { linesAdded: 10, linesRemoved: 5, filesChanged: 2, reverts: 0 }, testsPass: 5, testsFail: 0, compiles: true },
      composite: 85,
    }),
    teardown: async () => {},
  };
}

describe('RunOrchestrator', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'twining-bench-orch-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('executes a benchmark run with correct iteration structure', async () => {
    const outputDir = join(tempDir, 'results');

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [makeMockScenario()],
      conditions: [makeMockCondition()],
      target: makeMockTarget(tempDir),
      runsPerPair: 1,
    });

    const result = await orchestrator.run();

    expect(result.runMetadata.status).toBe('completed');
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]!.scenario).toBe('refactoring-handoff');
    expect(result.iterations[0]!.condition).toBe('baseline');
    expect(result.iterations[0]!.sessions).toHaveLength(2);
    expect(result.runMetadata.duration).toBeGreaterThan(0);
    // Scoring should produce results
    expect(result.iterations[0]!.scoredResults).toBeDefined();
    expect(result.iterations[0]!.scoredResults!.composite).toBe(85);
  });

  it('emits progress updates during execution', async () => {
    const outputDir = join(tempDir, 'results');
    const progressUpdates: ProgressUpdate[] = [];

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [makeMockScenario()],
      conditions: [makeMockCondition()],
      target: makeMockTarget(tempDir),
      runsPerPair: 1,
      onProgress: (update) => progressUpdates.push(update),
    });

    await orchestrator.run();

    const types = progressUpdates.map(u => u.type);
    expect(types).toContain('run-start');
    expect(types).toContain('session-start');
    expect(types).toContain('session-complete');
    expect(types).toContain('iteration-complete');
    expect(types).toContain('run-complete');
  });

  it('handles multiple runs per pair', async () => {
    const outputDir = join(tempDir, 'results');

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [makeMockScenario()],
      conditions: [makeMockCondition()],
      target: makeMockTarget(tempDir),
      runsPerPair: 3,
    });

    const result = await orchestrator.run();

    expect(result.iterations).toHaveLength(3);
    expect(result.iterations[0]!.iteration).toBe(0);
    expect(result.iterations[1]!.iteration).toBe(1);
    expect(result.iterations[2]!.iteration).toBe(2);
  });

  it('generates unique run IDs', async () => {
    const outputDir = join(tempDir, 'results');

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [makeMockScenario()],
      conditions: [makeMockCondition()],
      target: makeMockTarget(tempDir),
      runsPerPair: 1,
    });

    const result = await orchestrator.run();

    expect(result.runMetadata.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('captures environment information', async () => {
    const outputDir = join(tempDir, 'results');

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [makeMockScenario()],
      conditions: [makeMockCondition()],
      target: makeMockTarget(tempDir),
      runsPerPair: 1,
    });

    const result = await orchestrator.run();

    expect(result.runMetadata.environment.nodeVersion).toBe(process.version);
    expect(result.runMetadata.environment.platform).toBe(process.platform);
  });

  it('sets status to partial when interrupted mid-run', async () => {
    const outputDir = join(tempDir, 'results');

    let setupCount = 0;
    const failingTarget: ITestTarget = {
      name: 'failing-target',
      async setup() {
        setupCount++;
        if (setupCount > 1) throw new Error('Target setup failed');
        return makeMockTargetWorkingDir(tempDir);
      },
      async validate() { return { valid: true, errors: [], warnings: [] }; },
      getGroundTruth() {
        return { name: 'test', description: 'test', decisions: [], moduleDependencies: {}, baselineTestCoverage: 0 };
      },
      async reset() {},
      async teardown() {},
    };

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [makeMockScenario()],
      conditions: [makeMockCondition()],
      target: failingTarget,
      runsPerPair: 2,
    });

    const result = await orchestrator.run();

    expect(result.runMetadata.status).toBe('partial');
    expect(result.iterations).toHaveLength(1);
  });

  it('handles scoring failure gracefully', async () => {
    const outputDir = join(tempDir, 'results');

    const failingScenario = makeMockScenario();
    failingScenario.score = async () => {
      throw new Error('Scoring engine crashed');
    };

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [failingScenario],
      conditions: [makeMockCondition()],
      target: makeMockTarget(tempDir),
      runsPerPair: 1,
    });

    const result = await orchestrator.run();

    expect(result.runMetadata.status).toBe('completed');
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]!.scoredResults).toBeUndefined();
    expect(result.iterations[0]!.errors).toContain('Scoring failed: Scoring engine crashed');
  });

  it('persists results via ResultsStore when provided', async () => {
    const outputDir = join(tempDir, 'store-results');
    const resultsStore = new ResultsStore(outputDir);

    const initRunSpy = vi.spyOn(resultsStore, 'initRun');
    const saveScoresSpy = vi.spyOn(resultsStore, 'saveScores');
    const saveTranscriptSpy = vi.spyOn(resultsStore, 'saveTranscript');
    const updateMetadataSpy = vi.spyOn(resultsStore, 'updateMetadata');

    const orchestrator = new RunOrchestrator({
      config: makeConfig({ outputDirectory: outputDir }),
      scenarios: [makeMockScenario()],
      conditions: [makeMockCondition()],
      target: makeMockTarget(tempDir),
      resultsStore,
      runsPerPair: 1,
    });

    const result = await orchestrator.run();

    expect(result.runMetadata.status).toBe('completed');
    expect(initRunSpy).toHaveBeenCalledOnce();
    expect(saveScoresSpy).toHaveBeenCalledOnce();
    // 2 sessions → 2 transcript saves
    expect(saveTranscriptSpy).toHaveBeenCalledTimes(2);
    expect(updateMetadataSpy).toHaveBeenCalledOnce();
  });
});
