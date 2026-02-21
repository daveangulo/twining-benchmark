import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { DataCollector } from '../../../src/runner/data-collector.js';
import type { AgentTranscript, CoordinationArtifacts, Condition } from '../../../src/types/index.js';

function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'sess-test-123',
    runId: 'run-test-456',
    scenario: 'test-scenario',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 100, output: 50, total: 150 },
    timing: {
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:01:00.000Z',
      durationMs: 60000,
      timeToFirstActionMs: 5000,
    },
    exitReason: 'completed',
    ...overrides,
  };
}

/** Create a mock condition for artifact collection */
function makeMockCondition(artifacts: CoordinationArtifacts): Condition {
  return {
    name: 'baseline',
    description: 'Test condition',
    setup: async () => ({
      agentConfig: {
        systemPrompt: '',
        mcpServers: {},
        allowedTools: [],
        permissionMode: 'acceptEdits' as const,
      },
      setupFiles: [],
      metadata: {},
    }),
    getAgentConfig: () => ({
      systemPrompt: '',
      mcpServers: {},
      allowedTools: [],
      permissionMode: 'acceptEdits' as const,
    }),
    collectArtifacts: async () => artifacts,
    teardown: async () => {},
  };
}

describe('DataCollector', () => {
  let tempDir: string;
  let outputDir: string;
  let repoDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'twining-bench-dc-test-'));
    outputDir = join(tempDir, 'output');
    repoDir = join(tempDir, 'repo');
    await mkdir(outputDir, { recursive: true });
    await mkdir(repoDir, { recursive: true });

    // Initialize a git repo for testing
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await writeFile(join(repoDir, 'initial.ts'), 'export const x = 1;\n', 'utf-8');
    await git.add('.');
    await git.commit('initial commit');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('captures pre-session git state', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });

    const hash = await collector.capturePreSessionGitState(repoDir);

    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns "initial" when no git commits exist', async () => {
    const emptyDir = join(tempDir, 'empty');
    await mkdir(emptyDir, { recursive: true });
    const git = simpleGit(emptyDir);
    await git.init();

    const collector = new DataCollector({ outputDir, runId: 'run-1' });
    const hash = await collector.capturePreSessionGitState(emptyDir);

    expect(hash).toBe('initial');
  });

  it('computes file changes from git diff', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });
    const beforeHash = await collector.capturePreSessionGitState(repoDir);

    // Make some changes
    await writeFile(join(repoDir, 'new-file.ts'), 'export const y = 2;\n', 'utf-8');
    const git = simpleGit(repoDir);
    await git.add('.');
    await git.commit('add new file');

    const changes = await collector.computeFileChanges(repoDir, beforeHash);

    expect(changes.length).toBeGreaterThan(0);
    const newFile = changes.find(c => c.path === 'new-file.ts');
    expect(newFile).toBeDefined();
    expect(newFile!.changeType).toBe('added');
    expect(newFile!.linesAdded).toBeGreaterThan(0);
  });

  it('gets full diff as string', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });
    const beforeHash = await collector.capturePreSessionGitState(repoDir);

    // Modify a file
    await writeFile(join(repoDir, 'initial.ts'), 'export const x = 42;\n', 'utf-8');
    const git = simpleGit(repoDir);
    await git.add('.');
    await git.commit('modify initial');

    const diff = await collector.getFullDiff(repoDir, beforeHash);

    expect(diff).toContain('initial.ts');
    expect(diff).toContain('-export const x = 1;');
    expect(diff).toContain('+export const x = 42;');
  });

  it('saves session data to structured directories', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });
    const transcript = makeTranscript();

    const condition = makeMockCondition({
      preSessionState: {},
      postSessionState: {},
      changes: [],
    });

    const beforeHash = await collector.capturePreSessionGitState(repoDir);
    const collected = await collector.enrichAndSave(transcript, repoDir, beforeHash, condition);

    // Check files were saved
    const sessionDir = join(outputDir, 'run-1', 'sessions', 'sess-test-123');
    const transcriptJson = await readFile(join(sessionDir, 'transcript.json'), 'utf-8');
    const parsed = JSON.parse(transcriptJson);
    expect(parsed.sessionId).toBe('sess-test-123');
    expect(parsed.runId).toBe('run-test-456');

    // Check diff was saved
    const diffContent = await readFile(join(sessionDir, 'git-diff.patch'), 'utf-8');
    expect(typeof diffContent).toBe('string');

    // Check artifacts were saved
    const artifactsJson = await readFile(join(sessionDir, 'coordination-artifacts.json'), 'utf-8');
    const artifacts = JSON.parse(artifactsJson);
    expect(artifacts.preSessionState).toEqual({});
    expect(artifacts.postSessionState).toEqual({});
  });

  it('saves and loads partial run state', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });

    await collector.savePartialRunState('run-1', [], {
      currentScenario: 'test',
      currentCondition: 'baseline',
      currentIteration: 0,
    });

    const state = await collector.loadPartialRunState('run-1');
    expect(state).not.toBeNull();
    expect(state!.completedSessionIds).toEqual([]);
  });

  it('returns null when loading non-existent run state', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });

    const state = await collector.loadPartialRunState('nonexistent-run');
    expect(state).toBeNull();
  });
});
