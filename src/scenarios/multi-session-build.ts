/**
 * FR-SCN-004: Multi-Session Feature Build Scenario
 *
 * A feature (analytics dashboard) is built across 5 sequential agent sessions,
 * simulating a realistic multi-day development workflow.
 *
 * Task Flow:
 * 1. Session 1: Design and scaffold the API for a new analytics dashboard.
 * 2. Session 2: Implement the data aggregation service.
 * 3. Session 3: Add unit tests and fix discovered issues.
 * 4. Session 4: Implement API endpoint handlers.
 * 5. Session 5: Write integration tests, ensure everything works end-to-end.
 *
 * Scoring Dimensions:
 * - Architectural Drift (0-100): How much does final code diverge from Session 1 design?
 * - Cumulative Rework (0-100): Total code churn across sessions (inverse).
 * - Final Quality (0-100): Does it compile, pass tests, meet requirements?
 * - Total Token Cost (number): Sum of tokens across all sessions.
 * - Total Wall Time (seconds): Sum of session durations.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type { ScenarioMetadata, AgentTask, RawResults } from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';
import {
  buildEvaluationContextFromResults,
  runSingleEvaluation,
  ARCHITECTURAL_COHERENCE_TEMPLATE,
} from '../analyzer/llm-judge.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest for the multi-session build scenario.
 *
 * Defines the expected analytics dashboard components: route structure,
 * data models, aggregation service, endpoint handlers, and tests.
 */
export const MULTI_SESSION_BUILD_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'multi-session-build',
  description:
    'Expected outcome: Analytics dashboard API with routes, data models, aggregation service, endpoint handlers, and integration tests — all architecturally consistent with Session 1 design.',
  decisions: [
    {
      id: 'api-route-structure',
      description:
        'Session 1 should design a clear API route structure for analytics endpoints (e.g., /api/analytics/dashboard, /api/analytics/metrics).',
      affectedFiles: [
        'src/routes/analytics.ts',
        'src/routes/index.ts',
      ],
      expectedPatterns: [
        'analytics',
        'router',
        'route',
        '/api/',
        'dashboard',
        'metrics',
      ],
      antiPatterns: [],
    },
    {
      id: 'data-models',
      description:
        'Session 1 should define data models/interfaces for analytics data (e.g., DashboardData, MetricSummary, TimeSeriesPoint).',
      affectedFiles: [
        'src/models/analytics.ts',
        'src/types/analytics.ts',
      ],
      expectedPatterns: [
        'interface',
        'type',
        'Dashboard',
        'Metric',
        'Analytics',
      ],
      antiPatterns: [],
    },
    {
      id: 'aggregation-service',
      description:
        'Session 2 should implement a data aggregation service that follows the interfaces defined in Session 1.',
      affectedFiles: [
        'src/services/analytics.service.ts',
        'src/services/aggregation.service.ts',
      ],
      expectedPatterns: [
        'aggregate',
        'Aggregat',
        'service',
        'Service',
      ],
      antiPatterns: [],
    },
    {
      id: 'unit-tests',
      description:
        'Session 3 should add unit tests for the aggregation service.',
      affectedFiles: [
        'tests/analytics.test.ts',
        'tests/aggregation.test.ts',
      ],
      expectedPatterns: [
        'describe',
        'it\\(',
        'test\\(',
        'expect',
        'aggregat',
      ],
      antiPatterns: [],
    },
    {
      id: 'endpoint-handlers',
      description:
        'Session 4 should implement API endpoint handlers connecting routes to the aggregation service.',
      affectedFiles: [
        'src/routes/analytics.ts',
        'src/controllers/analytics.controller.ts',
        'src/handlers/analytics.ts',
      ],
      expectedPatterns: [
        'handler',
        'controller',
        'req',
        'res',
        'aggregat',
        'service',
      ],
      antiPatterns: [],
    },
    {
      id: 'integration-tests',
      description:
        'Session 5 should add integration tests for the full analytics pipeline.',
      affectedFiles: [
        'tests/integration/analytics.test.ts',
        'tests/analytics.integration.test.ts',
      ],
      expectedPatterns: [
        'integration',
        'end-to-end',
        'e2e',
        'request',
        'response',
        'pipeline',
      ],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'routes/analytics': ['controllers/analytics', 'services/analytics'],
    'controllers/analytics': ['services/analytics'],
    'services/analytics': ['models/analytics', 'utils/database'],
  },
  baselineTestCoverage: 60,
};

const SESSION_1_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). You'll be adding a new analytics feature. Follow existing patterns:
- \`src/services/\` — existing service classes (follow this pattern for your analytics service)
- \`src/models/\` — existing model/type definitions (put analytics types here)
- \`src/routes/\` or \`src/controllers/\` — existing route handlers (if present, follow their pattern)
- \`tests/\` — existing test files

Directory structure:
\`\`\`
src/
  models/        # Data models
  services/      # Business logic
  repositories/  # Data access layer
  utils/         # Shared utilities
tests/           # Test files
\`\`\`

Your task: Design and scaffold the API for a new analytics dashboard. Create the route structure, data models, and write a brief design doc.

Specifically:
1. Design the analytics dashboard API: decide on routes (e.g., GET /api/analytics/dashboard, GET /api/analytics/metrics/:type), request/response shapes, and data flow.
2. Create TypeScript interfaces/types for analytics data models (e.g., DashboardData, MetricSummary, TimeSeriesPoint) in \`src/models/\` or \`src/types/\`.
3. Scaffold the route files with stub handlers that return placeholder data.
4. Write a brief design document (DESIGN.md or inline comments) explaining:
   - The route structure and why
   - The data model design
   - How the aggregation service should work (for the next developer)
   - Any architectural decisions you made
5. Make sure the scaffolded code compiles.

Important:
- Focus on DESIGN over implementation — the next sessions will implement the actual logic.
- Create clear interfaces that downstream sessions can implement against.
- Document your decisions thoroughly — 4 more developers will build on your foundation.`;

const SESSION_2_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service. The previous session scaffolded an analytics feature. Check these locations:
- \`src/services/\` — for any analytics service stubs or interfaces
- \`src/models/\` or \`src/types/\` — for analytics data model definitions
- \`DESIGN.md\` — for the design document from the previous session
- \`src/routes/\` — for route scaffolding with stub handlers

Your task: Implement the data aggregation service for the analytics dashboard. Follow the design from Session 1.

Specifically:
1. Read \`DESIGN.md\` (if it exists) and check \`src/services/\` for the existing design and route scaffolding from the previous session.
2. Implement the data aggregation service that processes raw data into analytics summaries.
3. The service should conform to any interfaces or contracts defined in the design.
4. Implement key aggregation functions: time-series aggregation, metric summaries, and dashboard data composition.
5. Make sure the codebase compiles.

Important:
- Follow the existing design — do NOT redesign the API or change interfaces.
- Build on what's already there.
- Make sure the codebase compiles when you're done.`;

const SESSION_3_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service. Previous sessions created the analytics feature. Check these locations:
- \`src/services/\` — for the analytics/aggregation service implementation
- \`src/models/\` or \`src/types/\` — for analytics data model definitions
- \`tests/\` — for any existing test patterns to follow

Your task: Add unit tests for the aggregation service and fix any issues you discover.

Specifically:
1. Find the aggregation service implementation in \`src/services/\` from the previous session.
2. Write comprehensive unit tests covering:
   - Normal operation (valid inputs produce expected outputs)
   - Edge cases (empty data, single data point, large datasets)
   - Error conditions (invalid inputs, missing fields)
3. Run the tests and fix any bugs you discover in the aggregation service.
4. Ensure all tests pass and the codebase compiles.

Important:
- Test the existing implementation — don't rewrite the service.
- Fix bugs you find, but keep fixes minimal and targeted.
- Make sure all tests pass when you're done.`;

const SESSION_4_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service. Previous sessions created analytics routes, service, and tests. Check these locations:
- \`src/routes/\` — for route scaffolding with stub handlers (from Session 1)
- \`src/services/\` — for the aggregation service implementation (from Session 2)
- \`src/models/\` or \`src/types/\` — for analytics data model definitions
- \`tests/\` — for existing unit tests (from Session 3)

Your task: Implement the API endpoint handlers, connecting them to the aggregation service.

Specifically:
1. Find the route scaffolding in \`src/routes/\` (from Session 1) and the aggregation service in \`src/services/\` (from Session 2).
2. Replace stub/placeholder handlers with real implementations that call the aggregation service.
3. Add proper error handling, input validation, and response formatting.
4. Make sure all routes return the correct data shapes as defined in the data models.
5. Make sure the codebase compiles and existing tests still pass.

Important:
- Connect the existing routes to the existing service — don't restructure.
- Follow the patterns established in earlier sessions.
- Make sure the codebase compiles and tests pass when you're done.`;

const SESSION_5_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service. Previous sessions built the full analytics feature. Check these locations:
- \`src/routes/\` — API route handlers (connected in Session 4)
- \`src/services/\` — aggregation service implementation (Session 2)
- \`src/models/\` or \`src/types/\` — analytics data model definitions (Session 1)
- \`tests/\` — existing unit tests (Session 3)

Your task: Write integration tests for the full analytics pipeline and ensure everything works end-to-end.

Specifically:
1. Review the full analytics stack in \`src/\`: routes → handlers → aggregation service → data models.
2. Write integration tests that test the full pipeline from HTTP request to response.
3. Test key scenarios: fetching dashboard data, querying specific metrics, time-range filtering.
4. Test error scenarios: invalid parameters, missing data, unauthorized access.
5. Fix any integration issues you discover.
6. Run all tests (unit and integration) and ensure they pass.

Important:
- This is the final session — everything should work end-to-end.
- Fix integration issues but don't restructure — keep changes minimal.
- Make sure ALL tests (unit and integration) pass when you're done.`;

export class MultiSessionBuildScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'multi-session-build',
      description:
        'Analytics dashboard built across 5 sequential sessions. Measures architectural drift, cumulative rework, and final quality.',
      estimatedDurationMinutes: 75,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 5,
      scoringDimensions: [
        'architecturalDrift',
        'cumulativeRework',
        'finalQuality',
      ],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    const prompts = [
      SESSION_1_PROMPT,
      SESSION_2_PROMPT,
      SESSION_3_PROMPT,
      SESSION_4_PROMPT,
      SESSION_5_PROMPT,
    ];

    const roles = [
      'designer',
      'implementer',
      'tester',
      'integrator',
      'qa-engineer',
    ];

    return prompts.map((prompt, i) => ({
      prompt,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
      sequenceOrder: i,
      maxTurns: DEFAULT_MAX_TURNS,
      role: roles[i],
    }));
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return MULTI_SESSION_BUILD_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'multi-session-build',
      sessionCount: 5,
      feature: 'analytics-dashboard',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    let architecturalDrift: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, ARCHITECTURAL_COHERENCE_TEMPLATE, evalCtx);
      architecturalDrift = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      architecturalDrift = this.scoreArchitecturalDrift(rawResults, groundTruth);
    }
    const cumulativeRework = this.scoreCumulativeRework(rawResults);
    const finalQuality = this.scoreFinalQuality(rawResults, groundTruth);

    const scores: Record<string, DimensionScore> = {
      architecturalDrift,
      cumulativeRework,
      finalQuality,
    };

    const metrics = this.extractMetrics(rawResults);

    // Composite: weighted average
    const composite =
      architecturalDrift.value * 0.35 +
      cumulativeRework.value * 0.25 +
      finalQuality.value * 0.40;

    return {
      runId: '',
      scenario: 'multi-session-build',
      condition: '',
      iteration: 0,
      scores,
      metrics,
      composite,
    };
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Score architectural drift: How much does the final implementation
   * diverge from Session 1's design?
   *
   * Checks whether Session 1's design elements (routes, models, structure)
   * are still present and respected in the final code.
   */
  private scoreArchitecturalDrift(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const session1 = rawResults.transcripts[0];
    const lastSession = rawResults.transcripts[rawResults.transcripts.length - 1];

    if (!session1) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Session 1 did not produce a transcript — no design to drift from.',
      };
    }

    if (!lastSession) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Final session did not produce a transcript.',
      };
    }

    let score = 100;
    const details: string[] = [];

    // Check design-related ground truth decisions
    const designDecisions = groundTruth.decisions.filter(
      (d) => d.id === 'api-route-structure' || d.id === 'data-models',
    );

    // Files created by Session 1
    const session1Files = new Set(session1.fileChanges.map((c) => c.path));

    // Files in the final state (all sessions combined)
    const allFinalFiles = new Set<string>();
    for (const t of rawResults.transcripts) {
      for (const fc of t.fileChanges) {
        allFinalFiles.add(fc.path);
      }
    }

    // Check: Were Session 1's files preserved (not deleted/replaced)?
    let preservedFiles = 0;
    for (const f of session1Files) {
      if (allFinalFiles.has(f)) {
        preservedFiles++;
      }
    }

    if (session1Files.size > 0) {
      const preservationRatio = preservedFiles / session1Files.size;
      if (preservationRatio < 0.5) {
        score -= 30;
        details.push(
          `Only ${preservedFiles}/${session1Files.size} files from Session 1 survived. Significant structural drift.`,
        );
      } else {
        details.push(
          `${preservedFiles}/${session1Files.size} files from Session 1 preserved.`,
        );
      }
    }

    // Check: Do later sessions' diffs contain Session 1's design patterns?
    const laterChanges = rawResults.transcripts.slice(1).flatMap((t) => t.fileChanges);
    const laterDiffs = laterChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const hasMissingDiffs = laterChanges.some((c) => c.diff === undefined);

    if (hasMissingDiffs && laterDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
      };
    }

    for (const decision of designDecisions) {
      const patternsFound = decision.expectedPatterns.filter(
        (p) => new RegExp(p, 'i').test(laterDiffs),
      );
      if (patternsFound.length === 0 && decision.expectedPatterns.length > 0) {
        score -= 15;
        details.push(`Design element "${decision.id}" not found in later sessions.`);
      }
    }

    // Check: How many later sessions modified Session 1's files?
    let sessionsModifyingDesign = 0;
    for (let i = 1; i < rawResults.transcripts.length; i++) {
      const t = rawResults.transcripts[i]!;
      const modifiesSession1 = t.fileChanges.some(
        (fc) => session1Files.has(fc.path) && fc.linesRemoved > fc.linesAdded,
      );
      if (modifiesSession1) sessionsModifyingDesign++;
    }

    if (sessionsModifyingDesign > 2) {
      score -= 20;
      details.push(
        `${sessionsModifyingDesign} later sessions made net-negative changes to Session 1 files.`,
      );
    }

    return {
      value: Math.max(0, score),
      confidence: session1.fileChanges.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: details.length > 0
        ? details.join(' ')
        : 'Final implementation aligns well with Session 1 design.',
      dataQuality: hasMissingDiffs ? 'partial' : 'complete',
    };
  }

  /**
   * Score cumulative rework: Total code churn across sessions.
   *
   * Measures how much each session undoes or redoes previous work.
   * 100 = pure additive (each session only adds).
   * 0 = massive churn (more lines removed than added overall).
   */
  private scoreCumulativeRework(rawResults: RawResults): DimensionScore {
    let totalAdded = 0;
    let totalRemoved = 0;
    let crossSessionRework = 0;

    // Track files modified by each session
    const sessionFiles: Map<number, Set<string>> = new Map();

    for (let i = 0; i < rawResults.transcripts.length; i++) {
      const transcript = rawResults.transcripts[i]!;
      const files = new Set<string>();

      for (const fc of transcript.fileChanges) {
        totalAdded += fc.linesAdded;
        totalRemoved += fc.linesRemoved;
        files.add(fc.path);

        // Check if this file was modified by a previous session
        for (let j = 0; j < i; j++) {
          const prevFiles = sessionFiles.get(j);
          if (prevFiles?.has(fc.path)) {
            crossSessionRework += fc.linesRemoved;
            break;
          }
        }
      }

      sessionFiles.set(i, files);
    }

    if (totalAdded === 0) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'No code was added across all sessions.',
      };
    }

    // Rework ratio: cross-session removals as a fraction of total additions
    const reworkRatio = Math.min(1, crossSessionRework / totalAdded);
    const score = Math.round((1 - reworkRatio) * 100);

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification:
        `Total: +${totalAdded}/-${totalRemoved} lines across ${rawResults.transcripts.length} sessions. Cross-session rework: ${crossSessionRework} lines removed from previous sessions' files (${(reworkRatio * 100).toFixed(1)}% rework ratio).`,
    };
  }

  /**
   * Score final quality: Does the end result compile, pass tests, and
   * meet feature requirements?
   *
   * Checks completeness: did each session produce expected artifacts?
   */
  private scoreFinalQuality(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    let score = 0;
    const details: string[] = [];

    // Check: Did all 5 sessions complete?
    const completedSessions = rawResults.transcripts.filter(
      (t) => t.exitReason === 'completed' && t.fileChanges.length > 0,
    ).length;

    const expectedSessions = 5;
    const completionRatio = completedSessions / expectedSessions;
    score += Math.round(completionRatio * 30);
    details.push(`${completedSessions}/${expectedSessions} sessions completed with file changes.`);

    // Check: Were key artifacts produced?
    const allFiles = new Set<string>();
    for (const t of rawResults.transcripts) {
      for (const fc of t.fileChanges) {
        allFiles.add(fc.path);
      }
    }

    // Check for route files
    const hasRoutes = [...allFiles].some((f) => /route|router/i.test(f));
    if (hasRoutes) {
      score += 15;
      details.push('Route files present.');
    } else {
      details.push('No route files detected.');
    }

    // Check for service/aggregation files
    const hasService = [...allFiles].some(
      (f) => /service|aggregat/i.test(f),
    );
    if (hasService) {
      score += 15;
      details.push('Service/aggregation files present.');
    } else {
      details.push('No service files detected.');
    }

    // Check for test files
    const hasTests = [...allFiles].some((f) => /test|spec/i.test(f));
    if (hasTests) {
      score += 15;
      details.push('Test files present.');
    } else {
      details.push('No test files detected.');
    }

    // Check for model/type files
    const hasModels = [...allFiles].some(
      (f) => /model|type|interface/i.test(f),
    );
    if (hasModels) {
      score += 10;
      details.push('Model/type files present.');
    } else {
      details.push('No model files detected.');
    }

    // Check: All sessions completed without errors
    if (rawResults.allSessionsCompleted) {
      score += 15;
      details.push('All sessions completed without errors.');
    } else {
      details.push(`Errors encountered: ${rawResults.errors.length}.`);
    }

    return {
      value: Math.min(100, score),
      confidence: completedSessions >= 3 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  // extractMetrics is inherited from BaseScenario
}

export function createMultiSessionBuildScenario(): MultiSessionBuildScenario {
  return new MultiSessionBuildScenario();
}
