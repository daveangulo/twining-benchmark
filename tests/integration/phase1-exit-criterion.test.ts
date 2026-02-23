import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ScoredResults } from '../../src/types/index.js';

// Mock the agent session manager before importing orchestrator
vi.mock('../../src/runner/agent-session.js', () => {
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
          sessionId: `sess-${task.sequenceOrder}-${Math.random().toString(36).slice(2, 8)}`,
          runId: this.runId,
          scenario: this.scenario,
          condition: this.condition,
          taskIndex: task.sequenceOrder,
          prompt: task.prompt,
          toolCalls: [
            { toolName: 'Edit', parameters: {}, timestamp: new Date().toISOString(), durationMs: 100 },
          ],
          fileChanges: [
            { path: 'src/test.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 3 },
          ],
          tokenUsage: { input: 1000, output: 400, cacheRead: 0, cacheCreation: 0, total: 1400, costUsd: 0.009 },
          timing: {
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 8000,
            timeToFirstActionMs: 3000,
          },
          exitReason: 'completed',
          numTurns: 3,
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
const { RunOrchestrator } = await import('../../src/runner/orchestrator.js');
import { SyntheticRepoTarget } from '../../src/targets/synthetic-repo/index.js';
import { BaselineCondition } from '../../src/conditions/baseline.js';
import { createRefactoringHandoffScenario } from '../../src/scenarios/refactoring-handoff.js';
import { ResultsStore } from '../../src/results/store.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';

describe('Phase 1 Exit Criterion: end-to-end CLI execution', () => {
  let tempDir: string;
  let outputDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'twining-bench-phase1-'));
    outputDir = join(tempDir, 'benchmark-results');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('completes end-to-end run with real target, condition, scenario, and results store', async () => {
    const target = new SyntheticRepoTarget();
    const condition = new BaselineCondition();
    const scenario = createRefactoringHandoffScenario();
    const resultsStore = new ResultsStore(outputDir);

    const config = {
      ...DEFAULT_CONFIG,
      outputDirectory: outputDir,
      retryCount: 0,
    };

    const orchestrator = new RunOrchestrator({
      config,
      scenarios: [scenario],
      conditions: [condition],
      target,
      resultsStore,
      runsPerPair: 1,
    });

    const result = await orchestrator.run();
    const runId = result.runMetadata.id;

    // Run completes successfully
    expect(result.runMetadata.status).toBe('completed');
    expect(result.iterations).toHaveLength(1);

    // metadata.json exists in results store
    const metadataPath = join(outputDir, runId, 'metadata.json');
    const metadataRaw = await readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(metadataRaw);
    expect(metadata.id).toBe(runId);
    expect(metadata.status).toBe('completed');

    // Scored results file exists
    const scoresDir = join(outputDir, runId, 'scores');
    const scoreFiles = await readdir(scoresDir);
    expect(scoreFiles.length).toBeGreaterThan(0);

    // Parse and validate the scored results
    const scoreRaw = await readFile(join(scoresDir, scoreFiles[0]!), 'utf-8');
    const scored: ScoredResults = JSON.parse(scoreRaw);
    expect(scored.runId).toBe(runId);
    expect(scored.scenario).toBe('refactoring-handoff');
    expect(scored.condition).toBe('baseline');
    expect(scored.iteration).toBe(0);
    expect(scored.composite).toBeGreaterThanOrEqual(0);
    expect(scored.composite).toBeLessThanOrEqual(100);

    // Transcript files exist in raw/
    const rawDir = join(outputDir, runId, 'raw');
    const transcriptFiles = await readdir(rawDir);
    expect(transcriptFiles.length).toBeGreaterThan(0);
    expect(transcriptFiles.every(f => f.endsWith('.json'))).toBe(true);
  }, 120_000); // Allow up to 2 minutes for target setup (npm install)
});
