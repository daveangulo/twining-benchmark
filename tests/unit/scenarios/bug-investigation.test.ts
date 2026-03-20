import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BugInvestigationScenario,
  BUG_INVESTIGATION_GROUND_TRUTH,
  createBugInvestigationScenario,
} from '../../../src/scenarios/bug-investigation.js';
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
    scenario: 'bug-investigation',
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

describe('BugInvestigationScenario', () => {
  let scenario: BugInvestigationScenario;

  beforeEach(() => {
    scenario = new BugInvestigationScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  describe('getMetadata()', () => {
    it('returns correct scenario metadata', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('bug-investigation');
      expect(meta.agentSessionCount).toBe(2);
      expect(meta.scoringDimensions).toEqual([
        'contextRecovery',
        'redundantInvestigation',
        'resolution',
        'timeToResolution',
      ]);
      expect(meta.excludeFromAll).toBe(false);
    });
  });

  describe('setup()', () => {
    it('creates scenario context', async () => {
      const workDir = makeWorkingDir('/tmp/bug-repo');
      const condCtx = makeConditionContext();

      const ctx = await scenario.setup(workDir, condCtx);

      expect(ctx.workingDir).toBe(workDir);
      expect(ctx.groundTruth).toBe(BUG_INVESTIGATION_GROUND_TRUTH);
      expect(ctx.metadata.scenario).toBe('bug-investigation');
      expect(ctx.metadata.bugLocation).toBe('src/services/search.service.ts');
    });

    it('substitutes template variables in prompts', async () => {
      await scenario.setup(makeWorkingDir('/tmp/bug-12345'), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].prompt).toContain('Agent 1 of 2');
      expect(tasks[0].prompt).toContain('/tmp/bug-12345');
      expect(tasks[1].prompt).toContain('Agent 2 of 2');

      for (const task of tasks) {
        expect(task.prompt).not.toContain('{{');
      }
    });
  });

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('returns 2 tasks with correct roles and timeouts', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].role).toBe('investigator');
      expect(tasks[1].role).toBe('fixer');

      // Agent A has shorter timeout (5 minutes)
      expect(tasks[0].timeoutMs).toBe(5 * 60 * 1000);
      // Agent B has standard timeout (15 minutes)
      expect(tasks[1].timeoutMs).toBe(15 * 60 * 1000);
    });

    it('Agent A prompt contains investigation instructions', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[0].prompt).toContain('duplicates');
      expect(tasks[0].prompt).toContain('page 2');
      expect(tasks[0].prompt).toContain('Investigate');
    });

    it('Agent B prompt references continuing investigation', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[1].prompt).toContain('Continue');
      expect(tasks[1].prompt).toContain('regression test');
      expect(tasks[1].prompt).toContain('previous developer');
    });

    it('Agent B prompt does not leak the bug location or fix', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();

      expect(tasks[1].prompt).not.toContain('pagination.ts');
      expect(tasks[1].prompt).not.toContain('off-by-one');
      expect(tasks[1].prompt).not.toContain('offset calculation');
    });
  });

  describe('score()', () => {
    it('scores good context recovery when B reads A investigation files early', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            exitReason: 'timeout',
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/search.service.ts' },
                timestamp: '2026-02-20T10:00:00Z',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/utils/pagination.ts' },
                timestamp: '2026-02-20T10:01:00Z',
                durationMs: 100,
              },
            ],
            fileChanges: [
              {
                path: 'INVESTIGATION.md',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
              },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'INVESTIGATION.md' },
                timestamp: '2026-02-20T10:05:00Z',
                durationMs: 100,
              },
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/search.service.ts' },
                timestamp: '2026-02-20T10:05:30Z',
                durationMs: 100,
              },
              {
                toolName: 'Edit',
                parameters: { file_path: 'src/services/search.service.ts' },
                timestamp: '2026-02-20T10:06:00Z',
                durationMs: 100,
              },
              {
                toolName: 'Write',
                parameters: { file_path: 'tests/pagination.test.ts' },
                timestamp: '2026-02-20T10:07:00Z',
                durationMs: 100,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/search.service.ts',
                changeType: 'modified',
                linesAdded: 5,
                linesRemoved: 3,
                diff: '+const offset = (page - 1) * pageSize;\n-const offset = (page - 1) * pageSize - 1;',
              },
              {
                path: 'tests/pagination.test.ts',
                changeType: 'added',
                linesAdded: 20,
                linesRemoved: 0,
                diff: '+describe("pagination", () => {\n+  it("page 2 has no duplicates", () => {\n+    expect(paginate(data, 2, 10)).not.toContain(duplicate);\n+  });\n+});',
              },
            ],
            timing: {
              startTime: '2026-02-20T10:05:00Z',
              endTime: '2026-02-20T10:07:00Z',
              durationMs: 120000, // 2 minutes
              timeToFirstActionMs: 30000,
            },
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false, // A timed out
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Context recovery should be good (B reads investigation notes early)
      expect(scored.scores.contextRecovery.value).toBeGreaterThanOrEqual(40);

      // Resolution should be good (fix + test)
      expect(scored.scores.resolution.value).toBeGreaterThanOrEqual(60);

      // Time-to-resolution should be excellent (2 minutes)
      expect(scored.scores.timeToResolution.value).toBe(100);
    });

    it('penalizes redundant investigation when B restarts from scratch', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            exitReason: 'timeout',
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'src/utils/pagination.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'src/routes/search.ts' }, timestamp: '', durationMs: 100 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              // B reads all the same files A read
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'src/utils/pagination.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'src/routes/search.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Edit', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Redundant investigation should be low (B re-read all A's files)
      expect(scored.scores.redundantInvestigation.value).toBe(0);
    });

    it('scores good redundancy when B reads different files', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            exitReason: 'timeout',
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'src/utils/pagination.ts' }, timestamp: '', durationMs: 100 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              // B reads completely different files
              { toolName: 'Read', parameters: { file_path: 'NOTES.md' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'tests/search.test.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Edit', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Should score well — B didn't re-read A's files
      expect(scored.scores.redundantInvestigation.value).toBe(100);
    });

    it('normalizes file paths for redundant investigation scoring across temp dirs', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            exitReason: 'timeout',
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: '/tmp/twining-bench-abc123/src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: '/tmp/twining-bench-abc123/src/utils/pagination.ts' }, timestamp: '', durationMs: 100 },
            ],
          }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              // B reads same files but with different temp-dir prefix
              { toolName: 'Read', parameters: { file_path: '/tmp/twining-bench-def456/src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: '/tmp/twining-bench-def456/src/utils/pagination.ts' }, timestamp: '', durationMs: 100 },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // After normalization, B re-read all A's files = 0% unique investigation
      expect(scored.scores.redundantInvestigation.value).toBe(0);
    });

    it('gives zero resolution when B makes no changes', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout' }),
          makeTranscript({ taskIndex: 1, fileChanges: [] }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      expect(scored.scores.resolution.value).toBe(0);
    });

    it('scores 15 when B investigates the bug file but does not modify it', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout' }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/search.service.ts' },
                timestamp: '2026-02-20T10:05:00Z',
                durationMs: 100,
              },
            ],
            fileChanges: [],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      expect(scored.scores.resolution.value).toBe(15);
    });

    it('scores 50 when B fixes the bug but adds no regression test', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout' }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              {
                toolName: 'Read',
                parameters: { file_path: 'src/services/search.service.ts' },
                timestamp: '2026-02-20T10:05:00Z',
                durationMs: 100,
              },
            ],
            fileChanges: [
              {
                path: 'src/services/search.service.ts',
                changeType: 'modified',
                linesAdded: 2,
                linesRemoved: 2,
                diff: '-const offset = (page - 1) * pageSize - 1;\n+const offset = (page - 1) * pageSize;',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      expect(scored.scores.resolution.value).toBe(50);
    });

    it('scores time-to-resolution based on B duration', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // Fast resolution (2 min)
      const fastResult: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout' }),
          makeTranscript({
            taskIndex: 1,
            timing: { startTime: '', endTime: '', durationMs: 120000, timeToFirstActionMs: 5000 },
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      // Slow resolution (12 min)
      const slowResult: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout' }),
          makeTranscript({
            taskIndex: 1,
            timing: { startTime: '', endTime: '', durationMs: 720000, timeToFirstActionMs: 5000 },
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const fastScored = await scenario.score(fastResult, BUG_INVESTIGATION_GROUND_TRUTH);
      const slowScored = await scenario.score(slowResult, BUG_INVESTIGATION_GROUND_TRUTH);

      expect(fastScored.scores.timeToResolution.value).toBe(100);
      expect(slowScored.scores.timeToResolution.value).toBeLessThan(50);
    });

    it('scores 50 when Agent A already fixed bug and Agent B verifies', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // Use the ground truth affected file: src/services/search.service.ts
      const rawResults: RawResults = {
        transcripts: [
          // Agent A fixed the bug and added tests
          makeTranscript({
            taskIndex: 0,
            exitReason: 'completed',
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Edit', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
            ],
            fileChanges: [
              {
                path: 'src/services/search.service.ts',
                changeType: 'modified',
                linesAdded: 1,
                linesRemoved: 1,
                diff: '-const offset = (page - 1) * pageSize - 1;\n+const offset = (page - 1) * pageSize;',
              },
              {
                path: 'tests/services/search.service.test.ts',
                changeType: 'modified',
                linesAdded: 15,
                linesRemoved: 0,
                diff: '+it("page 2 has no duplicates", () => {',
              },
            ],
          }),
          // Agent B investigates the bug file and determines fix is complete
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
              { toolName: 'Read', parameters: { file_path: 'tests/services/search.service.test.ts' }, timestamp: '', durationMs: 100 },
            ],
            fileChanges: [], // No changes — correctly verified fix is done
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Agent B investigated the bug file and correctly determined no modification needed
      expect(scored.scores.resolution.value).toBe(50);
      expect(scored.scores.resolution.justification).toContain('already fixed');
    });

    it('penalizes redundant re-fix when Agent A already fixed the bug', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          // Agent A already fixed the bug
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              {
                path: 'src/services/search.service.ts',
                changeType: 'modified',
                linesAdded: 1,
                linesRemoved: 1,
                diff: '-const offset = (page - 1) * pageSize - 1;\n+const offset = (page - 1) * pageSize;',
              },
            ],
          }),
          // Agent B re-fixes the already-fixed bug — coordination failure
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
            ],
            fileChanges: [
              {
                path: 'src/services/search.service.ts',
                changeType: 'modified',
                linesAdded: 1,
                linesRemoved: 1,
                diff: '-const offset = (page - 1) * pageSize - 1;\n+const offset = (page - 1) * pageSize;',
              },
              {
                path: 'tests/pagination.test.ts',
                changeType: 'added',
                linesAdded: 10,
                linesRemoved: 0,
                diff: '+it("no duplicates on page 2")',
              },
            ],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Redundant re-fix should score much lower than verifying (50) or a genuine fix (85)
      expect(scored.scores.resolution.value).toBe(20);
      expect(scored.scores.resolution.justification).toContain('redundantly');
    });

    it('scores 0 when Agent A fixed but Agent B did not investigate', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            fileChanges: [
              { path: 'src/services/search.service.ts', changeType: 'modified', linesAdded: 1, linesRemoved: 1 },
            ],
          }),
          // Agent B does nothing relevant
          makeTranscript({ taskIndex: 1, toolCalls: [], fileChanges: [] }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Agent B didn't even look — still 0 even though A fixed it
      expect(scored.scores.resolution.value).toBe(0);
    });

    it('scores 15 when Agent A did NOT fix but Agent B only investigated', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // Agent A did NOT modify the bug file
      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout', fileChanges: [] }),
          makeTranscript({
            taskIndex: 1,
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
            ],
            fileChanges: [],
          }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Agent A didn't fix it, so B investigating without modifying is still just 15
      expect(scored.scores.resolution.value).toBe(15);
    });

    it('scores redundantInvestigation 0 when B reads nothing and makes no changes', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({
            taskIndex: 0,
            exitReason: 'timeout',
            toolCalls: [
              { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
            ],
          }),
          // B does absolutely nothing
          makeTranscript({ taskIndex: 1, toolCalls: [], fileChanges: [] }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      // Doing nothing is not efficient investigation — score 0, not 100
      expect(scored.scores.redundantInvestigation.value).toBe(0);
    });

    it('graduates coordination bonus: tools+files > tools-only > files-only', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // Agent with both tools and file reads
      const bothResult: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout', toolCalls: [
            { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
          ] }),
          makeTranscript({ taskIndex: 1, toolCalls: [
            { toolName: 'mcp__plugin_twining_twining__twining_assemble', parameters: {}, timestamp: '', durationMs: 100 },
            { toolName: 'Read', parameters: { file_path: 'INVESTIGATION.md' }, timestamp: '', durationMs: 100 },
          ] }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      // Agent with tools only
      const toolsOnlyResult: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0, exitReason: 'timeout', toolCalls: [
            { toolName: 'Read', parameters: { file_path: 'src/services/search.service.ts' }, timestamp: '', durationMs: 100 },
          ] }),
          makeTranscript({ taskIndex: 1, toolCalls: [
            { toolName: 'mcp__plugin_twining_twining__twining_assemble', parameters: {}, timestamp: '', durationMs: 100 },
          ] }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const bothScored = await scenario.score(bothResult, BUG_INVESTIGATION_GROUND_TRUTH);
      const toolsScored = await scenario.score(toolsOnlyResult, BUG_INVESTIGATION_GROUND_TRUTH);

      expect(bothScored.scores.contextRecovery.value).toBeGreaterThan(toolsScored.scores.contextRecovery.value);
    });

    it('handles empty transcripts array', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: ['All agents failed'],
      };

      const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);

      expect(scored.scores.contextRecovery.value).toBe(0);
      expect(scored.scores.resolution.value).toBe(0);
    });
  });

  describe('teardown()', () => {
    it('is idempotent', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      await scenario.teardown();
      await scenario.teardown();
    });
  });
});

describe('BUG_INVESTIGATION_GROUND_TRUTH', () => {
  it('has all required decisions', () => {
    const ids = BUG_INVESTIGATION_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('pagination-bug-location');
    expect(ids).toContain('pagination-bug-fix');
    expect(ids).toContain('regression-test');
  });

  it('describes the off-by-one pagination bug', () => {
    expect(BUG_INVESTIGATION_GROUND_TRUTH.description).toContain('pagination');
    expect(BUG_INVESTIGATION_GROUND_TRUTH.description).toContain('off-by-one');
  });
});

describe('createBugInvestigationScenario', () => {
  it('returns a BugInvestigationScenario instance', () => {
    const s = createBugInvestigationScenario();
    expect(s).toBeInstanceOf(BugInvestigationScenario);
  });
});
