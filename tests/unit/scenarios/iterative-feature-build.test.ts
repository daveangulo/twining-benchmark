import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  IterativeFeatureBuildScenario,
  ITERATIVE_FEATURE_BUILD_GROUND_TRUTH,
  createIterativeFeatureBuildScenario,
} from '../../../src/scenarios/iterative-feature-build.js';
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
    scenario: 'iterative-feature-build',
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

/** Build a full 5-transcript RawResults with optional per-session overrides. */
function makeFullResults(overrides: Partial<AgentTranscript>[] = []): RawResults {
  const transcripts = Array.from({ length: 5 }, (_, i) =>
    makeTranscript({ taskIndex: i, ...(overrides[i] ?? {}) }),
  );
  return {
    transcripts,
    finalWorkingDir: '/tmp/test',
    allSessionsCompleted: true,
    errors: [],
  };
}

describe('IterativeFeatureBuildScenario', () => {
  let scenario: IterativeFeatureBuildScenario;

  beforeEach(() => {
    scenario = new IterativeFeatureBuildScenario();
  });

  afterEach(async () => {
    await scenario.teardown();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('getMetadata()', () => {
    it('returns correct scenario name', () => {
      const meta = scenario.getMetadata();
      expect(meta.name).toBe('iterative-feature-build');
    });

    it('reports 5 agent sessions', () => {
      const meta = scenario.getMetadata();
      expect(meta.agentSessionCount).toBe(5);
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
        'architecturalDrift',
        'layerIntegrity',
        'decisionAccumulation',
        'integrationCompleteness',
      ]);
    });

    it('has an estimated duration of 75 minutes', () => {
      const meta = scenario.getMetadata();
      expect(meta.estimatedDurationMinutes).toBe(75);
    });
  });

  // ── Agent tasks ───────────────────────────────────────────────────────────

  describe('getAgentTasks()', () => {
    it('throws if called before setup', () => {
      expect(() => scenario.getAgentTasks()).toThrow('not set up');
    });

    it('returns exactly 5 tasks', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks).toHaveLength(5);
    });

    it('tasks have correct sequence orders (0-4)', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      for (let i = 0; i < 5; i++) {
        expect(tasks[i].sequenceOrder).toBe(i);
      }
    });

    it('tasks have correct roles', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[0].role).toBe('data-modeler');
      expect(tasks[1].role).toBe('repository-builder');
      expect(tasks[2].role).toBe('service-builder');
      expect(tasks[3].role).toBe('controller-builder');
      expect(tasks[4].role).toBe('integration-builder');
    });

    it('session 1 prompt mentions analytics models', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[0].prompt.toLowerCase()).toContain('analytics');
      expect(tasks[0].prompt).toContain('AnalyticsSummary');
    });

    it('session 5 prompt mentions audit logging and rate limiting', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());
      const tasks = scenario.getAgentTasks();
      expect(tasks[4].prompt.toLowerCase()).toContain('audit');
      expect(tasks[4].prompt.toLowerCase()).toContain('rate limit');
    });

    it('substitutes template variables in all prompts', async () => {
      const workDir = makeWorkingDir('/tmp/bench-iterative');
      await scenario.setup(workDir, makeConditionContext());
      const tasks = scenario.getAgentTasks();
      for (const task of tasks) {
        expect(task.prompt).toContain('/tmp/bench-iterative');
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

  // ── architecturalDrift ────────────────────────────────────────────────────

  describe('score() — architecturalDrift', () => {
    it('scores high when session 5 imports analytics models and service with all type names', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults = makeFullResults([
        {
          // Session 1: defines the model types
          fileChanges: [
            {
              path: 'src/models/analytics.ts',
              changeType: 'added',
              linesAdded: 60,
              linesRemoved: 0,
              diff: `+export interface AnalyticsSummary { totalEvents: number; uniqueUsers: number; }
+export interface UserAnalytics { userId: string; events: number; }
+export interface TrendPoint { timestamp: Date; value: number; label: string; }
+export interface DashboardConfig { timeRange: string; granularity: string; }`,
            },
          ],
        },
        {}, // Session 2
        {}, // Session 3
        {}, // Session 4
        {
          // Session 5: imports from models and service, uses model types
          fileChanges: [
            {
              path: 'tests/integration/analytics.integration.test.ts',
              changeType: 'added',
              linesAdded: 80,
              linesRemoved: 0,
              diff: `+import { AnalyticsService } from '../services/analytics.service';
+import type { AnalyticsSummary, UserAnalytics, TrendPoint } from '../models/analytics';
+describe('Analytics integration', () => {
+  it('returns AnalyticsSummary', async () => { const result: AnalyticsSummary = await service.computeSummary(range); });
+  it('returns UserAnalytics', async () => { const result: UserAnalytics = await service.getUserAnalytics(userId); });
+  it('returns TrendPoint[]', async () => { const result: TrendPoint[] = await service.generateTrends(metric, range); });
+});`,
            },
          ],
        },
      ]);

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      // Imports models (30) + imports service (30) + 3/3 type names (30) = 90+
      expect(scored.scores.architecturalDrift.value).toBeGreaterThanOrEqual(80);
    });

    it('scores 0 when session 5 is missing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({ taskIndex: 2 }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      expect(scored.scores.architecturalDrift.value).toBe(0);
    });

    it('penalises when later sessions redefine analytics model types', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults = makeFullResults([
        {}, // Session 1 — no file changes (no model definitions tracked)
        {
          // Session 2 redefines model types (anti-pattern)
          fileChanges: [
            {
              path: 'src/repositories/analytics.repository.ts',
              changeType: 'added',
              linesAdded: 30,
              linesRemoved: 0,
              diff: '+export interface AnalyticsSummary { redefined: true; }\n+export class AnalyticsRepository {}',
            },
          ],
        },
        {}, // Session 3
        {}, // Session 4
        {
          // Session 5: imports from service (30 pts) + uses type names
          fileChanges: [
            {
              path: 'tests/analytics.integration.test.ts',
              changeType: 'added',
              linesAdded: 20,
              linesRemoved: 0,
              diff: '+import { AnalyticsService } from "../services/analytics.service";\n+const s: AnalyticsSummary = {};',
            },
          ],
        },
      ]);

      const baseResults = makeFullResults([
        {}, // Session 1
        {}, // Session 2 — no redefines
        {}, // Session 3
        {}, // Session 4
        {
          fileChanges: [
            {
              path: 'tests/analytics.integration.test.ts',
              changeType: 'added',
              linesAdded: 20,
              linesRemoved: 0,
              diff: '+import { AnalyticsService } from "../services/analytics.service";\n+const s: AnalyticsSummary = {};',
            },
          ],
        },
      ]);

      const scoredWithRedefine = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      await scenario.teardown();
      scenario = new IterativeFeatureBuildScenario();
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const scoredWithoutRedefine = await scenario.score(baseResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      // Redefinition penalty should make the score lower
      expect(scoredWithRedefine.scores.architecturalDrift.value).toBeLessThanOrEqual(
        scoredWithoutRedefine.scores.architecturalDrift.value,
      );
    });
  });

  // ── layerIntegrity ────────────────────────────────────────────────────────

  describe('score() — layerIntegrity', () => {
    it('scores 100 when all layers import from their direct dependencies', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults = makeFullResults([
        {}, // Session 1 — models (no imports from other analytics layers needed)
        {
          // Session 2 (repository) imports from models
          fileChanges: [
            {
              path: 'src/repositories/analytics.repository.ts',
              changeType: 'added',
              linesAdded: 50,
              linesRemoved: 0,
              diff: `+import type { AnalyticsSummary, UserAnalytics } from '../models/analytics';
+export class AnalyticsRepository { async findByDateRange() {} }`,
            },
          ],
        },
        {
          // Session 3 (service) imports from repository
          fileChanges: [
            {
              path: 'src/services/analytics.service.ts',
              changeType: 'added',
              linesAdded: 60,
              linesRemoved: 0,
              diff: `+import { AnalyticsRepository } from '../repositories/analytics.repository';
+export class AnalyticsService { constructor(private repo: AnalyticsRepository) {} }`,
            },
          ],
        },
        {
          // Session 4 (controller) imports from service only
          fileChanges: [
            {
              path: 'src/controllers/analytics.controller.ts',
              changeType: 'added',
              linesAdded: 40,
              linesRemoved: 0,
              diff: `+import { AnalyticsService } from '../services/analytics.service';
+export function getSummary(service: AnalyticsService) {}`,
            },
          ],
        },
        {
          // Session 5 (integration) imports from service
          fileChanges: [
            {
              path: 'tests/integration/analytics.test.ts',
              changeType: 'added',
              linesAdded: 30,
              linesRemoved: 0,
              diff: `+import { AnalyticsService } from '../../services/analytics.service';
+describe('analytics', () => { it('works', () => {}) });`,
            },
          ],
        },
      ]);

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      expect(scored.scores.layerIntegrity.value).toBe(100);
    });

    it('deducts points when controller imports directly from repository', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults = makeFullResults([
        {},
        {
          fileChanges: [
            {
              path: 'src/repositories/analytics.repository.ts',
              changeType: 'added',
              linesAdded: 40,
              linesRemoved: 0,
              diff: `+import type { AnalyticsSummary } from '../models/analytics';
+export class AnalyticsRepository {}`,
            },
          ],
        },
        {
          fileChanges: [
            {
              path: 'src/services/analytics.service.ts',
              changeType: 'added',
              linesAdded: 40,
              linesRemoved: 0,
              diff: `+import { AnalyticsRepository } from '../repositories/analytics.repository';
+export class AnalyticsService { constructor(private repo: AnalyticsRepository) {} }`,
            },
          ],
        },
        {
          // Controller bypasses service and imports directly from repository — violation
          fileChanges: [
            {
              path: 'src/controllers/analytics.controller.ts',
              changeType: 'added',
              linesAdded: 30,
              linesRemoved: 0,
              diff: `+import { AnalyticsRepository } from '../repositories/analytics.repository';
+export function getSummary(repo: AnalyticsRepository) {}`,
            },
          ],
        },
        {},
      ]);

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      // Should deduct for cross-layer violation (controller → repository)
      expect(scored.scores.layerIntegrity.value).toBeLessThan(100);
    });
  });

  // ── decisionAccumulation ──────────────────────────────────────────────────

  describe('score() — decisionAccumulation', () => {
    it('scores high when sessions 2-5 use coordination tools and read prior files early', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // 10 tool calls per session so early window = ceil(10 * 0.30) = 3.
      // The first 3 calls include the coordination tool and the prior-file read.
      const makeSessionWithEarlyOrientation = (priorFile: string, sessionIdx: number) =>
        makeTranscript({
          taskIndex: sessionIdx,
          toolCalls: [
            // Early (index 0): coordination tool call
            {
              toolName: 'twining_assemble',
              parameters: { task: 'build next layer', scope: 'src/analytics/' },
              timestamp: '',
              durationMs: 300,
            },
            // Early (index 1): read prior layer file
            {
              toolName: 'Read',
              parameters: { file_path: priorFile },
              timestamp: '',
              durationMs: 100,
            },
            // Early (index 2): another read
            {
              toolName: 'Read',
              parameters: { file_path: 'src/README.md' },
              timestamp: '',
              durationMs: 80,
            },
            // Later tool calls (indexes 3-9, outside early window)
            ...Array.from({ length: 7 }, (_, i) => ({
              toolName: 'Write',
              parameters: { file_path: `src/new-file-${i}.ts` },
              timestamp: '',
              durationMs: 200,
            })),
          ],
        });

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }), // Session 1
          makeSessionWithEarlyOrientation('src/models/analytics.ts', 1),
          makeSessionWithEarlyOrientation('src/repositories/analytics.repository.ts', 2),
          makeSessionWithEarlyOrientation('src/services/analytics.service.ts', 3),
          makeSessionWithEarlyOrientation('src/controllers/analytics.controller.ts', 4),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      // All 4 follow-on sessions used coordination tools + read prior files = 100
      expect(scored.scores.decisionAccumulation.value).toBe(100);
    });

    it('scores 0 when sessions 2-5 have no tool calls', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults = makeFullResults(); // All empty toolCalls

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      expect(scored.scores.decisionAccumulation.value).toBe(0);
    });

    it('scores partially when only coordination tools are used but no prior file reads', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const makeSessionWithCoordOnly = (sessionIdx: number) =>
        makeTranscript({
          taskIndex: sessionIdx,
          toolCalls: [
            {
              toolName: 'twining_recent',
              parameters: { scope: 'src/' },
              timestamp: '',
              durationMs: 200,
            },
            {
              toolName: 'Write',
              parameters: { file_path: 'src/new-file.ts' },
              timestamp: '',
              durationMs: 200,
            },
          ],
        });

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeSessionWithCoordOnly(1),
          makeSessionWithCoordOnly(2),
          makeSessionWithCoordOnly(3),
          makeSessionWithCoordOnly(4),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: true,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      // 50% (coordination tools only, no prior file reads)
      expect(scored.scores.decisionAccumulation.value).toBe(50);
    });
  });

  // ── integrationCompleteness ───────────────────────────────────────────────

  describe('score() — integrationCompleteness', () => {
    it('scores 100 when session 5 has integration tests, audit, and rate limiting', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults = makeFullResults([
        {}, {}, {}, {},
        {
          fileChanges: [
            {
              path: 'tests/integration/analytics.integration.test.ts',
              changeType: 'added',
              linesAdded: 80,
              linesRemoved: 0,
              diff: `+import { AnalyticsService } from '../../src/services/analytics.service';
+describe('analytics integration', () => {
+  it('audits requests', () => { auditLog.record(query); });
+  it('applies rate limiting', () => { expect(rateLimit.check(userId)).toBe(true); });
+});`,
            },
            {
              path: 'src/middleware/audit.ts',
              changeType: 'added',
              linesAdded: 30,
              linesRemoved: 0,
              diff: '+export function auditLog(query: string) { console.log("audit", query); }',
            },
            {
              path: 'src/middleware/rate-limit.ts',
              changeType: 'added',
              linesAdded: 25,
              linesRemoved: 0,
              diff: '+export function rateLimit(userId: string) { /* throttle */ }',
            },
          ],
        },
      ]);

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      expect(scored.scores.integrationCompleteness.value).toBe(100);
    });

    it('scores 0 when session 5 is missing', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults: RawResults = {
        transcripts: [
          makeTranscript({ taskIndex: 0 }),
          makeTranscript({ taskIndex: 1 }),
          makeTranscript({ taskIndex: 2 }),
          makeTranscript({ taskIndex: 3 }),
        ],
        finalWorkingDir: '/tmp/test',
        allSessionsCompleted: false,
        errors: [],
      };

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      expect(scored.scores.integrationCompleteness.value).toBe(0);
    });

    it('scores partially when only audit logging is present', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      const rawResults = makeFullResults([
        {}, {}, {}, {},
        {
          fileChanges: [
            {
              path: 'src/middleware/audit-log.ts',
              changeType: 'added',
              linesAdded: 20,
              linesRemoved: 0,
              diff: '+export function auditLog(query: string) { console.log(query); }',
            },
            // Missing integration tests and rate limiting
          ],
        },
      ]);

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      // 1/3 = 33
      expect(scored.scores.integrationCompleteness.value).toBe(33);
    });
  });

  // ── Composite score ────────────────────────────────────────────────────────

  describe('score() — composite', () => {
    it('composite is a weighted average: architecturalDrift*0.30 + layerIntegrity*0.25 + decisionAccumulation*0.25 + integrationCompleteness*0.20', async () => {
      await scenario.setup(makeWorkingDir(), makeConditionContext());

      // Use a result set with known partial scores
      const rawResults = makeFullResults([
        {
          fileChanges: [
            {
              path: 'src/models/analytics.ts',
              changeType: 'added',
              linesAdded: 40,
              linesRemoved: 0,
              diff: '+export interface AnalyticsSummary {}\n+export interface UserAnalytics {}\n+export interface TrendPoint {}',
            },
          ],
        },
        {
          fileChanges: [
            {
              path: 'src/repositories/analytics.repository.ts',
              changeType: 'added',
              linesAdded: 40,
              linesRemoved: 0,
              diff: "+import type { AnalyticsSummary } from '../models/analytics';\n+export class AnalyticsRepository {}",
            },
          ],
        },
        {
          fileChanges: [
            {
              path: 'src/services/analytics.service.ts',
              changeType: 'added',
              linesAdded: 50,
              linesRemoved: 0,
              diff: "+import { AnalyticsRepository } from '../repositories/analytics.repository';\n+export class AnalyticsService { constructor(private repo: AnalyticsRepository) {} }",
            },
          ],
        },
        {
          fileChanges: [
            {
              path: 'src/controllers/analytics.controller.ts',
              changeType: 'added',
              linesAdded: 30,
              linesRemoved: 0,
              diff: "+import { AnalyticsService } from '../services/analytics.service';\n+export function getSummary() {}",
            },
          ],
        },
        {
          fileChanges: [
            {
              path: 'tests/integration/analytics.test.ts',
              changeType: 'added',
              linesAdded: 60,
              linesRemoved: 0,
              diff: "+import { AnalyticsService } from '../../services/analytics.service';\n+import type { AnalyticsSummary, UserAnalytics, TrendPoint } from '../../models/analytics';\n+describe('analytics integration', () => { it('works', () => {}); });\n+// auditLog(query); rateLimit(userId);",
            },
          ],
        },
      ]);

      const scored = await scenario.score(rawResults, ITERATIVE_FEATURE_BUILD_GROUND_TRUTH);

      const expected =
        scored.scores.architecturalDrift.value * 0.30 +
        scored.scores.layerIntegrity.value * 0.25 +
        scored.scores.decisionAccumulation.value * 0.25 +
        scored.scores.integrationCompleteness.value * 0.20;

      expect(scored.composite).toBeCloseTo(expected, 5);
      expect(scored.composite).toBeGreaterThan(0);
      expect(scored.composite).toBeLessThanOrEqual(100);
    });
  });

  // ── Teardown ───────────────────────────────────────────────────────────────

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

// ── Ground truth ─────────────────────────────────────────────────────────────

describe('ITERATIVE_FEATURE_BUILD_GROUND_TRUTH', () => {
  it('has the 4 required decisions', () => {
    const ids = ITERATIVE_FEATURE_BUILD_GROUND_TRUTH.decisions.map((d) => d.id);
    expect(ids).toContain('analytics-models');
    expect(ids).toContain('analytics-repository');
    expect(ids).toContain('analytics-service');
    expect(ids).toContain('analytics-controller');
  });

  it('each decision has at least one expected pattern', () => {
    for (const decision of ITERATIVE_FEATURE_BUILD_GROUND_TRUTH.decisions) {
      expect(decision.expectedPatterns.length).toBeGreaterThan(0);
    }
  });

  it('has the correct name', () => {
    expect(ITERATIVE_FEATURE_BUILD_GROUND_TRUTH.name).toBe('iterative-feature-build');
  });
});

// ── Factory function ──────────────────────────────────────────────────────────

describe('createIterativeFeatureBuildScenario', () => {
  it('returns an IterativeFeatureBuildScenario instance', () => {
    const s = createIterativeFeatureBuildScenario();
    expect(s).toBeInstanceOf(IterativeFeatureBuildScenario);
  });
});
