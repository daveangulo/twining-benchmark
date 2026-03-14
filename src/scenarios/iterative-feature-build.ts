/**
 * Iterative Feature Build Scenario
 *
 * Five sessions where each agent adds a layer to an analytics feature.
 * Session 1 creates models, session 2 builds the repository, session 3
 * implements the service, session 4 exposes a controller, and session 5
 * adds audit logging, rate limiting, and integration tests.
 *
 * Later agents must understand all prior architectural decisions to
 * maintain consistency across layers.
 *
 * Scoring dimensions:
 * - architecturalDrift (0.30): Does session 5 import from analytics models/service?
 *   Do session 1 type names appear in session 5 test imports?
 * - layerIntegrity (0.25): Do layers import only from their direct dependencies?
 *   Penalise cross-layer violations (controller→repository, controller→models).
 * - decisionAccumulation (0.25): Do sessions 2-5 use coordination tools and
 *   read prior sessions' output files in the early phase (first 30% of tool calls)?
 * - integrationCompleteness (0.20): Does session 5 include test files importing
 *   from analytics controller/service plus audit and rate-limiting patterns?
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type { ScenarioMetadata, AgentTask, RawResults } from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';

/** Default timeout for all sessions: 15 minutes */
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

/** Default max turns per session */
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest for the iterative-feature-build scenario.
 */
export const ITERATIVE_FEATURE_BUILD_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'iterative-feature-build',
  description:
    'Expected outcome: analytics models, repository, service, controller, and full integration with audit logging, rate limiting, and tests.',
  decisions: [
    {
      id: 'analytics-models',
      description: 'TypeScript models for analytics dashboard',
      affectedFiles: ['src/models/analytics.ts'],
      expectedPatterns: ['AnalyticsSummary|UserAnalytics|TrendPoint'],
      antiPatterns: [],
    },
    {
      id: 'analytics-repository',
      description: 'AnalyticsRepository extending BaseRepository with aggregation and time-range queries',
      affectedFiles: ['src/repositories/analytics.repository.ts'],
      expectedPatterns: ['AnalyticsRepository', 'BaseRepository|extends'],
      antiPatterns: [],
    },
    {
      id: 'analytics-service',
      description: 'AnalyticsService with business logic — summaries, trends, cache aggregations',
      affectedFiles: ['src/services/analytics.service.ts'],
      expectedPatterns: ['AnalyticsService', 'constructor'],
      antiPatterns: [],
    },
    {
      id: 'analytics-controller',
      description: 'Controller functions exposing the analytics service with validation and error handling',
      affectedFiles: ['src/controllers/analytics.controller.ts'],
      expectedPatterns: ['analytics|Analytics'],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'controllers/analytics.controller': ['services/analytics.service'],
    'services/analytics.service': ['repositories/analytics.repository'],
    'repositories/analytics.repository': ['models/analytics'],
  },
  baselineTestCoverage: 70,
};

/**
 * Session 1 — Data modeler: create TypeScript analytics models.
 */
const SESSION_1_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Your task: Create TypeScript models for an analytics dashboard feature.

1. Create src/models/analytics.ts with the following interfaces/types:
   - AnalyticsSummary — aggregate metrics for a time period (e.g., totalEvents, uniqueUsers, avgResponseTime)
   - UserAnalytics — per-user breakdown (userId, events, sessions, lastSeen)
   - TrendPoint — a single data point in a time series (timestamp, value, label)
   - DashboardConfig — configuration for the analytics dashboard (timeRange, granularity, filters)

2. Follow existing model patterns from src/models/ (look at what's there before writing).
3. Export all types/interfaces. Use TypeScript best practices (readonly where appropriate).
4. Add JSDoc comments to each exported type.

Do NOT implement any repository, service, or controller yet — models only.`;

/**
 * Session 2 — Repository builder: implement the analytics repository.
 */
const SESSION_2_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

A previous developer created TypeScript analytics models in src/models/analytics.ts.

Your task: Implement an AnalyticsRepository.

1. Read src/models/analytics.ts and existing repository patterns (src/repositories/) before writing.
2. Create src/repositories/analytics.repository.ts with an AnalyticsRepository class that:
   - Extends BaseRepository (or follows the same pattern as existing repositories)
   - Implements aggregation queries (e.g., getAggregatedMetrics, getUserSummaries)
   - Supports time-range filtering (e.g., findByDateRange(start: Date, end: Date))
   - Supports user-scoped analytics (e.g., findByUserId(userId: string))
3. Import and use the models from src/models/analytics.ts.
4. Add at least one unit test for the repository.

Do NOT implement the service or controller yet — repository only.`;

/**
 * Session 3 — Service builder: implement the analytics service.
 */
const SESSION_3_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Two previous agents built:
- src/models/analytics.ts (data models)
- src/repositories/analytics.repository.ts (data access layer)

Your task: Implement an AnalyticsService with business logic.

1. Read the existing models and repository before writing any code.
2. Create src/services/analytics.service.ts with an AnalyticsService class that:
   - Accepts the AnalyticsRepository via constructor (dependency injection)
   - Implements computeSummary(timeRange) — computes aggregated analytics summary
   - Implements generateTrends(metric, timeRange) — produces TrendPoint[] time series
   - Implements cacheAggregations(config) — caches expensive aggregations
   - Follows existing service patterns (error handling, DI via constructor)
3. Import from models and repository.
4. Add unit tests.

Do NOT implement the controller yet — service only.`;

/**
 * Session 4 — Controller builder: expose the analytics service via controller functions.
 */
const SESSION_4_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Three previous agents built:
- src/models/analytics.ts (data models)
- src/repositories/analytics.repository.ts (repository layer)
- src/services/analytics.service.ts (service layer)

Your task: Implement controller functions for the analytics feature.

1. Read all three prior files to understand the full stack before writing.
2. Create src/controllers/analytics.controller.ts with controller functions that:
   - Import and use AnalyticsService (NOT the repository directly)
   - Expose getSummary, getTrends, getDashboard endpoint handlers
   - Validate input parameters (time ranges, user IDs)
   - Handle errors and return appropriate HTTP-style responses
3. Follow existing controller patterns in src/controllers/.
4. Add unit tests for the controller functions.

Do NOT skip reading the prior layers — the controller must use the exact types from models.ts.`;

/**
 * Session 5 — Integration builder: audit logging, rate limiting, integration tests.
 */
const SESSION_5_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Four previous agents built a full analytics stack:
- src/models/analytics.ts (data models: AnalyticsSummary, UserAnalytics, TrendPoint, DashboardConfig)
- src/repositories/analytics.repository.ts (AnalyticsRepository)
- src/services/analytics.service.ts (AnalyticsService)
- src/controllers/analytics.controller.ts (controller functions)

Your task: Add cross-cutting concerns and integration tests.

1. Read ALL four prior files before writing anything.
2. Add audit logging for analytics queries:
   - Log every analytics request with userId, query type, timestamp, and response size
   - Follow any existing audit logging patterns in the codebase
3. Add rate limiting for analytics endpoints:
   - Implement or integrate rate limiting that restricts analytics query frequency per user
4. Write integration tests that exercise the full analytics stack:
   - Tests should import from the analytics controller and/or service
   - Tests must use the model types (AnalyticsSummary, UserAnalytics, TrendPoint)
   - Cover the happy path and at least one error/edge case
5. Ensure all existing unit tests still pass.

The integration tests MUST import from the analytics layers built by the previous agents.`;

export class IterativeFeatureBuildScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'iterative-feature-build',
      description:
        'Five-session scenario where each agent adds a layer to an analytics feature (models → repository → service → controller → integration). Later agents must understand all prior architectural decisions to maintain consistency.',
      estimatedDurationMinutes: 75,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 5,
      scoringDimensions: [
        'architecturalDrift',
        'layerIntegrity',
        'decisionAccumulation',
        'integrationCompleteness',
      ],
      excludeFromAll: true,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: SESSION_1_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'data-modeler',
      },
      {
        prompt: SESSION_2_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'repository-builder',
      },
      {
        prompt: SESSION_3_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 2,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'service-builder',
      },
      {
        prompt: SESSION_4_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 3,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'controller-builder',
      },
      {
        prompt: SESSION_5_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 4,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'integration-builder',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return ITERATIVE_FEATURE_BUILD_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'iterative-feature-build',
      session1Role: 'data-modeler',
      session2Role: 'repository-builder',
      session3Role: 'service-builder',
      session4Role: 'controller-builder',
      session5Role: 'integration-builder',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const architecturalDrift = this.scoreArchitecturalDrift(rawResults, groundTruth);
    const layerIntegrity = this.scoreLayerIntegrity(rawResults);
    const decisionAccumulation = this.scoreDecisionAccumulation(rawResults);
    const integrationCompleteness = this.scoreIntegrationCompleteness(rawResults);

    const scores: Record<string, DimensionScore> = {
      architecturalDrift,
      layerIntegrity,
      decisionAccumulation,
      integrationCompleteness,
    };

    const composite =
      architecturalDrift.value * 0.30 +
      layerIntegrity.value * 0.25 +
      decisionAccumulation.value * 0.25 +
      integrationCompleteness.value * 0.20;

    const result: ScoredResults = {
      runId: '',
      scenario: 'iterative-feature-build',
      condition: '',
      iteration: 0,
      scores,
      metrics: this.extractMetrics(rawResults),
      composite,
    };

    // Optional: coordination lift
    if (evaluatorClient) {
      const lift = await this.computeCoordinationLift(
        rawResults,
        groundTruth,
        composite,
        evaluatorClient,
      );
      if (lift) {
        result.standaloneScores = lift.standaloneScores;
        result.coordinationLift = lift.coordinationLift;
      }
    }

    return result;
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Score architectural drift (weight 0.30).
   *
   * Checks session 5's diffs for imports from analytics models and service.
   * Checks that session 1's model type names appear in session 5 test imports.
   * Penalises if models are redefined (duplicate type declarations) in later sessions.
   */
  private scoreArchitecturalDrift(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcript5 = rawResults.transcripts[4];
    const transcript1 = rawResults.transcripts[0];

    if (!transcript5) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Session 5 (integration-builder) transcript is missing.',
      };
    }

    const diffs5 = transcript5.fileChanges
      .map((c) => c.diff)
      .filter((d): d is string => d !== undefined)
      .join('\n');
    const files5 = transcript5.fileChanges.map((c) => c.path).join('\n');
    const content5 = diffs5 + '\n' + files5;

    const details: string[] = [];
    let score = 0;

    // Check session 5 imports from analytics models (up to 30 points)
    const importsModels = /from.*analytics|from.*models\/analytics|analytics\.ts/i.test(content5);
    if (importsModels) {
      score += 30;
      details.push('Session 5 imports from analytics models.');
    } else {
      details.push('Session 5 does not import from analytics models.');
    }

    // Check session 5 imports from analytics service (up to 30 points)
    const importsService = /from.*analytics\.service|analytics\.service\.ts|AnalyticsService/i.test(content5);
    if (importsService) {
      score += 30;
      details.push('Session 5 imports from analytics service.');
    } else {
      details.push('Session 5 does not import from analytics service.');
    }

    // Check that model type names from session 1 appear in session 5 (up to 30 points)
    // Session 1 should have created: AnalyticsSummary, UserAnalytics, TrendPoint
    const modelTypes = ['AnalyticsSummary', 'UserAnalytics', 'TrendPoint'];
    let typeCount = 0;

    // Check session 1 for what types were defined
    const content1 = transcript1
      ? transcript1.fileChanges.map((c) => (c.diff ?? '') + c.path).join('\n')
      : '';

    for (const typeName of modelTypes) {
      const definedInSession1 = new RegExp(typeName).test(content1);
      const usedInSession5 = new RegExp(typeName).test(content5);
      if (usedInSession5) {
        typeCount++;
        details.push(
          definedInSession1
            ? `Model type '${typeName}' from session 1 used correctly in session 5.`
            : `Model type '${typeName}' used in session 5 (session 1 definition not confirmed).`,
        );
      } else {
        details.push(`Model type '${typeName}' not found in session 5 output.`);
      }
    }

    score += Math.round((typeCount / modelTypes.length) * 30);

    // Penalty: models redefined in later sessions (sessions 2-5) — deduct up to 10 points
    const modelTypePattern = /export\s+(interface|type)\s+(AnalyticsSummary|UserAnalytics|TrendPoint|DashboardConfig)/;
    for (let i = 1; i < Math.min(rawResults.transcripts.length, 5); i++) {
      const t = rawResults.transcripts[i];
      if (!t) continue;
      const laterContent = t.fileChanges
        .filter((c) => !c.path.includes('models/analytics'))
        .map((c) => c.diff ?? '')
        .join('\n');
      if (modelTypePattern.test(laterContent)) {
        score = Math.max(0, score - 10);
        details.push(`Session ${i + 1} appears to redefine analytics model types — penalised.`);
      }
    }

    return {
      value: Math.min(100, Math.max(0, score)),
      confidence: diffs5.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score layer integrity (weight 0.25).
   *
   * For sessions 2-5, verify correct import directions:
   * - Session 2 (repository) → imports from models
   * - Session 3 (service) → imports from repository (and models)
   * - Session 4 (controller) → imports from service (NOT directly from repository or models)
   * - Session 5 (integration) → imports from controller and/or service
   *
   * Penalise cross-layer imports (controller→repository, controller→models directly).
   */
  private scoreLayerIntegrity(rawResults: RawResults): DimensionScore {
    const details: string[] = [];
    let score = 100;

    // Session 2: repository should import from models
    const transcript2 = rawResults.transcripts[1];
    if (transcript2) {
      const content2 = transcript2.fileChanges.map((c) => (c.diff ?? '') + c.path).join('\n');
      if (/from.*models\/analytics|from.*analytics\.ts|AnalyticsSummary|UserAnalytics|TrendPoint/i.test(content2)) {
        details.push('Session 2 (repository) imports from models — correct.');
      } else {
        score -= 10;
        details.push('Session 2 (repository) does not import from analytics models.');
      }
    }

    // Session 3: service should import from repository
    const transcript3 = rawResults.transcripts[2];
    if (transcript3) {
      const content3 = transcript3.fileChanges.map((c) => (c.diff ?? '') + c.path).join('\n');
      if (/from.*analytics\.repository|AnalyticsRepository/i.test(content3)) {
        details.push('Session 3 (service) imports from repository — correct.');
      } else {
        score -= 15;
        details.push('Session 3 (service) does not import from analytics repository — layer violation.');
      }
    }

    // Session 4: controller should import from service, NOT directly from repository or raw models
    const transcript4 = rawResults.transcripts[3];
    if (transcript4) {
      const content4 = transcript4.fileChanges
        .filter((c) => c.path.includes('controller'))
        .map((c) => c.diff ?? '')
        .join('\n');

      if (/from.*analytics\.service|AnalyticsService/i.test(content4)) {
        details.push('Session 4 (controller) imports from service — correct.');
      } else {
        score -= 15;
        details.push('Session 4 (controller) does not import from analytics service — layer violation.');
      }

      // Cross-layer violation: controller importing directly from repository
      if (/from.*analytics\.repository|AnalyticsRepository/i.test(content4)) {
        score -= 20;
        details.push('Session 4 (controller) imports directly from repository — cross-layer violation.');
      }

      // Cross-layer violation: controller importing directly from models (bypass service)
      if (/from.*models\/analytics/i.test(content4)) {
        score -= 10;
        details.push('Session 4 (controller) imports directly from models — bypasses service layer.');
      }
    }

    // Session 5: integration layer should import from controller and/or service
    const transcript5 = rawResults.transcripts[4];
    if (transcript5) {
      const content5 = transcript5.fileChanges.map((c) => (c.diff ?? '') + c.path).join('\n');
      if (
        /from.*analytics\.controller|from.*analytics\.service|AnalyticsService/i.test(content5)
      ) {
        details.push('Session 5 (integration) imports from controller/service — correct.');
      } else {
        score -= 10;
        details.push('Session 5 (integration) does not import from analytics controller or service.');
      }
    }

    if (details.length === 0) {
      details.push('No layer integrity data available (transcripts missing).');
      score = 0;
    }

    return {
      value: Math.max(0, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score decision accumulation (weight 0.25).
   *
   * For sessions 2-5, measure how well each agent understands prior work:
   * 1. Count coordination tool calls (twining_assemble, twining_recent, twining_decide, twining_post)
   *    in the early phase (first 30% of tool calls).
   * 2. Count reads of prior sessions' output files in the early phase.
   *
   * Higher = better early orientation and coordination.
   */
  private scoreDecisionAccumulation(rawResults: RawResults): DimensionScore {
    const details: string[] = [];

    // Prior output files (files each subsequent session should read)
    const priorOutputsBySession: Record<number, string[]> = {
      1: ['src/models/analytics', 'analytics.ts'],
      2: ['src/repositories/analytics', 'analytics.repository'],
      3: ['src/services/analytics', 'analytics.service'],
      4: ['src/controllers/analytics', 'analytics.controller'],
    };

    const coordinationToolPattern =
      /twining_assemble|twining_recent|twining_decide|twining_post/i;

    let totalPoints = 0;
    let maxPoints = 0;
    const sessionCount = Math.min(rawResults.transcripts.length, 5);

    for (let sessionIdx = 1; sessionIdx < sessionCount; sessionIdx++) {
      const transcript = rawResults.transcripts[sessionIdx];
      if (!transcript) continue;

      const totalCalls = transcript.toolCalls.length;
      if (totalCalls === 0) {
        details.push(`Session ${sessionIdx + 1}: no tool calls recorded.`);
        maxPoints += 20;
        continue;
      }

      const earlyWindow = Math.max(1, Math.ceil(totalCalls * 0.30));
      const earlyToolCalls = transcript.toolCalls.slice(0, earlyWindow);

      maxPoints += 20; // 10 for coordination tools + 10 for prior file reads

      // Signal 1: coordination tool calls in early window (up to 10 points)
      const coordCallCount = earlyToolCalls.filter((tc) =>
        coordinationToolPattern.test(tc.toolName),
      ).length;

      if (coordCallCount > 0) {
        totalPoints += 10;
        details.push(
          `Session ${sessionIdx + 1}: ${coordCallCount} coordination tool call(s) in early phase.`,
        );
      } else {
        details.push(`Session ${sessionIdx + 1}: no coordination tools used in early phase.`);
      }

      // Signal 2: reads of prior sessions' output files in early window (up to 10 points)
      const priorFiles = priorOutputsBySession[sessionIdx] ?? [];
      const earlyContent = earlyToolCalls.map((tc) => JSON.stringify(tc.parameters)).join('\n');
      const readsPriorFiles = priorFiles.some((f) => new RegExp(f, 'i').test(earlyContent));

      if (readsPriorFiles) {
        totalPoints += 10;
        details.push(`Session ${sessionIdx + 1}: reads prior layer files early — good orientation.`);
      } else {
        details.push(
          `Session ${sessionIdx + 1}: no early reads of prior layer files (${priorFiles[0] ?? 'n/a'}).`,
        );
      }
    }

    const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score integration completeness (weight 0.20).
   *
   * Checks session 5's output for:
   * - Test files importing from analytics controller or service
   * - Audit logging patterns
   * - Rate limiting patterns
   */
  private scoreIntegrationCompleteness(rawResults: RawResults): DimensionScore {
    const transcript5 = rawResults.transcripts[4];
    if (!transcript5) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Session 5 (integration-builder) transcript is missing.',
      };
    }

    const content5 = transcript5.fileChanges
      .map((c) => (c.diff ?? '') + c.path)
      .join('\n');

    const details: string[] = [];
    let found = 0;
    const total = 3;

    // Check: integration test files importing from analytics controller/service
    const hasIntegrationTests =
      /integration.?test|describe.*analytics|it\(.*analytics/i.test(content5) &&
      /from.*analytics\.controller|from.*analytics\.service|AnalyticsService|analytics\.controller/i.test(
        content5,
      );

    if (hasIntegrationTests) {
      found++;
      details.push('Integration tests importing from analytics controller/service found.');
    } else {
      details.push('Integration tests referencing analytics controller/service missing.');
    }

    // Check: audit logging patterns
    const hasAudit =
      /audit|AuditLog|auditLog|audit_log|logRequest|logQuery/i.test(content5);
    if (hasAudit) {
      found++;
      details.push('Audit logging patterns found.');
    } else {
      details.push('Audit logging patterns missing from session 5.');
    }

    // Check: rate limiting patterns
    const hasRateLimit =
      /rate.?limit|rateLimit|RateLimit|throttle|Throttle/i.test(content5);
    if (hasRateLimit) {
      found++;
      details.push('Rate limiting patterns found.');
    } else {
      details.push('Rate limiting patterns missing from session 5.');
    }

    const score = Math.round((found / total) * 100);

    return {
      value: score,
      confidence: content5.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: `${found}/${total} integration completeness checks passed. ${details.join(' ')}`,
    };
  }
}

/**
 * Factory function for the scenario registry.
 */
export function createIterativeFeatureBuildScenario(): IterativeFeatureBuildScenario {
  return new IterativeFeatureBuildScenario();
}
