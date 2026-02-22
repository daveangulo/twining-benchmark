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
    tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150, costUsd: 0 },
    timing: {
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:01:00.000Z',
      durationMs: 60000,
      timeToFirstActionMs: 5000,
    },
    exitReason: 'completed',
    numTurns: 1,
    stopReason: 'success',
    contextWindowSize: 200000,
    compactionCount: 0,
    turnUsage: [],
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
    await git.addConfig('commit.gpgsign', 'false');
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

  it('filters infrastructure paths from fileChanges into infrastructureFileChanges', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });
    const transcript = makeTranscript();
    const condition = makeMockCondition({
      preSessionState: {},
      postSessionState: {},
      changes: [],
    });

    const beforeHash = await collector.capturePreSessionGitState(repoDir);

    // Create both code files and infrastructure files
    await writeFile(join(repoDir, 'src-file.ts'), 'export const a = 1;\n', 'utf-8');
    await mkdir(join(repoDir, '.twining'), { recursive: true });
    await writeFile(join(repoDir, '.twining', 'state.json'), '{}', 'utf-8');
    await mkdir(join(repoDir, 'node_modules', '.vite'), { recursive: true });
    await writeFile(join(repoDir, 'node_modules', '.vite', 'cache.json'), '{}', 'utf-8');

    const git = simpleGit(repoDir);
    await git.add('.');
    await git.commit('add code and infra files');

    const collected = await collector.enrichAndSave(transcript, repoDir, beforeHash, condition);

    // Code file should be in fileChanges
    const codeFiles = collected.transcript.fileChanges;
    expect(codeFiles.some(fc => fc.path === 'src-file.ts')).toBe(true);
    expect(codeFiles.some(fc => fc.path.startsWith('.twining/'))).toBe(false);
    expect(codeFiles.some(fc => fc.path.startsWith('node_modules/'))).toBe(false);

    // Infrastructure files should be in infrastructureFileChanges
    const infraFiles = collected.transcript.infrastructureFileChanges ?? [];
    expect(infraFiles.some(fc => fc.path.startsWith('.twining/'))).toBe(true);
    expect(infraFiles.some(fc => fc.path.startsWith('node_modules/'))).toBe(true);
  });

  it('commitSessionSnapshot creates a new commit and returns its hash', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });

    // Make a change in the working directory
    await writeFile(join(repoDir, 'session-work.ts'), 'export const s = 1;\n', 'utf-8');

    const hash = await collector.commitSessionSnapshot(repoDir, 'sess-1');

    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    // Verify the commit message
    const git = simpleGit(repoDir);
    const log = await git.log({ maxCount: 1 });
    expect(log.latest?.message).toContain('session sess-1 checkpoint');
  });

  it('session 2 diff only shows session 2 changes after checkpoint', async () => {
    const collector = new DataCollector({ outputDir, runId: 'run-1' });

    // Session 1: create a file
    const hash1 = await collector.capturePreSessionGitState(repoDir);
    await writeFile(join(repoDir, 'session1.ts'), 'export const s1 = 1;\n', 'utf-8');

    const git = simpleGit(repoDir);
    await git.add('.');
    await git.commit('session 1 work');

    // Checkpoint between sessions
    await collector.commitSessionSnapshot(repoDir, 'sess-1');

    // Session 2: create a different file
    const hash2 = await collector.capturePreSessionGitState(repoDir);
    await writeFile(join(repoDir, 'session2.ts'), 'export const s2 = 2;\n', 'utf-8');
    await git.add('.');
    await git.commit('session 2 work');

    const session2Changes = await collector.computeFileChanges(repoDir, hash2);

    // Session 2 should only see session2.ts, not session1.ts
    expect(session2Changes.some(fc => fc.path === 'session2.ts')).toBe(true);
    expect(session2Changes.some(fc => fc.path === 'session1.ts')).toBe(false);
  });
});
