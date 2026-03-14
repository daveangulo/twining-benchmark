/**
 * Decision Volume Recovery Scenario
 *
 * Four sessions testing recovery when prior work produces many decisions —
 * a "needle in a haystack" retrieval challenge. Session 1 performs six refactoring
 * operations across the codebase, generating a large number of coordination entries.
 * Sessions 2 and 3 must find the relevant decisions among the noise. Session 4
 * writes integration tests that prove both features follow session 1's patterns.
 *
 * Scoring dimensions:
 * - decisionRecovery (0.30): Did agents B and C orient to the right decisions early?
 * - patternCompliance (0.30): Did B and C actually follow the patterns A established?
 * - crossCuttingConsistency (0.25): Did agent D's tests cover both B and C's features?
 * - retrievalPrecision (0.15): Ratio of relevant to total early file reads for B and C.
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
 * Ground truth manifest for the decision-volume-recovery scenario.
 */
export const DECISION_VOLUME_RECOVERY_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'decision-volume-recovery',
  description:
    'Expected outcome: IUserRepository and IOrderRepository interfaces extracted, input validation in UserService, normalized error handling in OrderService, standardized logging, caching on UserService.findById/findByEmail, order history tracking in OrderService, and integration tests covering caching and order history.',
  decisions: [
    {
      id: 'user-interface-extraction',
      description: 'IUserRepository interface extracted from UserRepository',
      affectedFiles: ['src/repositories/user.repository.ts'],
      expectedPatterns: ['IUserRepository|interface'],
      antiPatterns: [],
    },
    {
      id: 'order-interface-extraction',
      description: 'IOrderRepository interface extracted from OrderRepository',
      affectedFiles: ['src/repositories/order.repository.ts'],
      expectedPatterns: ['IOrderRepository|interface'],
      antiPatterns: [],
    },
    {
      id: 'error-handling-normalization',
      description: 'Normalized error handling in OrderService',
      affectedFiles: ['src/services/order.service.ts'],
      expectedPatterns: ['try|catch|Error|throw'],
      antiPatterns: [],
    },
    {
      id: 'input-validation',
      description: 'Input validation added to UserService',
      affectedFiles: ['src/services/user.service.ts'],
      expectedPatterns: ['valid|validation|validate'],
      antiPatterns: [],
    },
    {
      id: 'logging-standardization',
      description: 'Logging standardized across all services',
      affectedFiles: ['src/services/'],
      expectedPatterns: ['log|Logger|logger'],
      antiPatterns: [],
    },
    {
      id: 'caching-implementation',
      description: 'Caching added to UserService.findById and UserService.findByEmail',
      affectedFiles: ['src/services/user.service.ts'],
      expectedPatterns: ['cache|Cache'],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'services/user.service': ['repositories/user.repository'],
    'services/order.service': ['repositories/order.repository'],
  },
  baselineTestCoverage: 70,
};

/**
 * Files that Agent A (session 1) will modify — used for retrieval precision scoring.
 */
const AGENT_A_AFFECTED_FILES = [
  'src/repositories/user.repository.ts',
  'src/repositories/order.repository.ts',
  'src/services/order.service.ts',
  'src/services/user.service.ts',
  'src/services/',
];

/**
 * Session 1 — Comprehensive refactorer: 6 refactoring operations.
 */
const SESSION_1_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Your task: Perform six refactoring operations across the codebase. For every decision you make, document it using coordination tools (twining_decide, twining_post) with full rationale.

Refactoring operations:
1. Extract an IUserRepository interface from UserRepository (src/repositories/user.repository.ts)
2. Extract an IOrderRepository interface from OrderRepository (src/repositories/order.repository.ts)
3. Add input validation to UserService (src/services/user.service.ts) — validate required fields before processing
4. Normalize error handling in OrderService (src/services/order.service.ts) — consistent try/catch/throw with typed errors
5. Standardize logging across all services — use a consistent Logger pattern throughout src/services/
6. Update all existing tests to reflect these changes

For EACH operation:
- Document the decision with twining_decide (what you did, why, what the pattern is)
- Note any patterns that downstream agents must follow

The goal is to produce a rich decision log. Later agents must find the relevant decisions among many. Be thorough and precise in your documentation.`;

/**
 * Session 2 — Cache builder: add caching to UserService using session 1's patterns.
 */
const SESSION_2_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

A previous developer performed six refactoring operations: interface extraction (IUserRepository, IOrderRepository), input validation, error handling normalization, logging standardization, and test updates.

Your task: Add caching to UserService.findById() and UserService.findByEmail().

Before writing any code:
1. Use coordination tools (twining_assemble, twining_recent, twining_query) to find the relevant decisions from the previous agent.
2. Read the files that Agent A modified: src/services/user.service.ts, src/repositories/user.repository.ts
3. Identify the interface pattern (IUserRepository), error handling pattern, and logging pattern you must follow.

Implementation requirements:
- Cache must use the IUserRepository interface (not the concrete class)
- Error handling must follow the normalized pattern from the refactoring session
- Logging must use the standardized Logger pattern
- Add unit tests for the caching behavior

You MUST respect all patterns established in the refactoring session. Do not introduce new error-handling or logging styles.`;

/**
 * Session 3 — Order feature builder: add order history tracking.
 */
const SESSION_3_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

A previous developer performed six refactoring operations, and another agent added caching to UserService.

Your task: Add order history tracking to OrderService — record status transitions with timestamps.

Before writing any code:
1. Use coordination tools (twining_assemble, twining_recent, twining_query) to find the relevant decisions from the refactoring session.
2. Read the files that Agent A modified: src/services/order.service.ts, src/repositories/order.repository.ts
3. Identify the interface pattern (IOrderRepository), error handling pattern, and logging pattern you must follow.

Implementation requirements:
- Order history tracking must use the IOrderRepository interface (not the concrete class)
- Each status transition must be recorded with a timestamp
- Error handling must follow the normalized pattern from the refactoring session
- Logging must use the standardized Logger pattern
- Add unit tests for the history tracking behavior

You MUST respect all patterns established in the refactoring session. Do not introduce new error-handling or logging styles.`;

/**
 * Session 4 — Integration tester: write integration tests covering both B and C's features.
 */
const SESSION_4_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Three previous agents have worked on this codebase:
- Agent A: performed six refactoring operations (interface extraction, validation, error handling, logging)
- Agent B: added caching to UserService.findById() and UserService.findByEmail()
- Agent C: added order history tracking to OrderService

Your task: Write integration tests that verify both features work correctly and follow Agent A's patterns.

Before writing any code:
1. Read the current state of src/services/user.service.ts and src/services/order.service.ts
2. Understand the caching implementation from Agent B
3. Understand the order history implementation from Agent C
4. Check the patterns established by Agent A (interface usage, error handling, logging)

Integration tests must:
1. Exercise the caching behavior (findById cache hit/miss, findByEmail cache hit/miss)
2. Exercise the order history tracking (status transitions recorded with timestamps)
3. Verify both features use IUserRepository / IOrderRepository interfaces
4. Verify both features use the standardized error handling and logging patterns
5. Test interactions: e.g., a cached user retrieval followed by an order history lookup

Place tests in a tests/integration/ directory. Ensure all existing unit tests still pass.`;

export class DecisionVolumeRecoveryScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'decision-volume-recovery',
      description:
        'Four-session needle-in-a-haystack scenario. Session 1 generates many decisions via six refactoring ops. Sessions 2 and 3 must recover the relevant ones. Measures retrieval precision, pattern compliance, and cross-session integration.',
      estimatedDurationMinutes: 60,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 4,
      scoringDimensions: [
        'decisionRecovery',
        'patternCompliance',
        'crossCuttingConsistency',
        'retrievalPrecision',
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
        role: 'comprehensive-refactorer',
      },
      {
        prompt: SESSION_2_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'cache-builder',
      },
      {
        prompt: SESSION_3_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 2,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'order-feature-builder',
      },
      {
        prompt: SESSION_4_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 3,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'integration-tester',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return DECISION_VOLUME_RECOVERY_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'decision-volume-recovery',
      session1Role: 'comprehensive-refactorer',
      session2Role: 'cache-builder',
      session3Role: 'order-feature-builder',
      session4Role: 'integration-tester',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const decisionRecovery = this.scoreDecisionRecovery(rawResults);
    const patternCompliance = this.scorePatternCompliance(rawResults);
    const crossCuttingConsistency = this.scoreCrossCuttingConsistency(rawResults);
    const retrievalPrecision = this.scoreRetrievalPrecision(rawResults);

    const scores: Record<string, DimensionScore> = {
      decisionRecovery,
      patternCompliance,
      crossCuttingConsistency,
      retrievalPrecision,
    };

    const composite =
      decisionRecovery.value * 0.30 +
      patternCompliance.value * 0.30 +
      crossCuttingConsistency.value * 0.25 +
      retrievalPrecision.value * 0.15;

    const result: ScoredResults = {
      runId: '',
      scenario: 'decision-volume-recovery',
      condition: '',
      iteration: 0,
      scores,
      metrics: this.extractMetrics(rawResults),
      composite,
    };

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

    return result;
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Return the first N% of tool calls from a transcript.
   */
  private earlyToolCalls(rawResults: RawResults, sessionIndex: number, fraction = 0.30) {
    const transcript = rawResults.transcripts[sessionIndex];
    if (!transcript) return [];
    const total = transcript.toolCalls.length;
    const window = Math.max(1, Math.ceil(total * fraction));
    return transcript.toolCalls.slice(0, window);
  }

  /**
   * Check whether a tool call reads one of Agent A's affected files.
   */
  private isRelevantFileRead(toolCall: { toolName: string; parameters: unknown }): boolean {
    const params = toolCall.parameters as Record<string, unknown>;
    const filePath =
      typeof params['file_path'] === 'string'
        ? params['file_path']
        : typeof params['path'] === 'string'
          ? params['path']
          : '';

    return AGENT_A_AFFECTED_FILES.some((affected) => filePath.includes(affected));
  }

  /**
   * Check whether a tool call is a coordination tool call.
   */
  private isCoordinationCall(toolCall: { toolName: string }): boolean {
    return /twining_assemble|twining_recent|twining_query/i.test(toolCall.toolName);
  }

  /**
   * Score decision recovery (weight 0.30).
   *
   * For agents B (index 1) and C (index 2), check the first 30% of tool calls for:
   * (a) File reads of Agent A's modified files — worth 60 points
   * (b) Coordination tool calls (twining_assemble, twining_recent, twining_query) — worth 40 points
   *
   * Each agent is scored independently; the dimension score is the average.
   */
  private scoreDecisionRecovery(rawResults: RawResults): DimensionScore {
    const details: string[] = [];
    const agentScores: number[] = [];

    for (const [idx, label] of [[1, 'B (cache-builder)'], [2, 'C (order-feature-builder)']] as [number, string][]) {
      const transcript = rawResults.transcripts[idx];
      if (!transcript) {
        details.push(`Agent ${label} transcript missing.`);
        agentScores.push(0);
        continue;
      }

      const earlyCalls = this.earlyToolCalls(rawResults, idx);
      const totalEarly = earlyCalls.length;

      // Coordination calls — binary: at least one = 40 pts
      const coordCalls = earlyCalls.filter((tc) => this.isCoordinationCall(tc));
      const coordScore = coordCalls.length > 0 ? 40 : 0;

      // Relevant file reads in early window
      const relevantReads = earlyCalls.filter((tc) => this.isRelevantFileRead(tc));
      const relevantScore = totalEarly > 0
        ? Math.round((relevantReads.length / totalEarly) * 60)
        : 0;

      const agentScore = Math.min(100, relevantScore + coordScore);
      agentScores.push(agentScore);

      details.push(
        `Agent ${label}: ${relevantReads.length}/${totalEarly} early reads relevant (${relevantScore} pts), ${coordCalls.length} coordination call(s) (${coordScore} pts) → ${agentScore}/100.`,
      );
    }

    const avgScore = agentScores.length > 0
      ? Math.round(agentScores.reduce((a, b) => a + b, 0) / agentScores.length)
      : 0;

    return {
      value: avgScore,
      confidence: rawResults.transcripts.length >= 3 ? 'high' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score pattern compliance (weight 0.30).
   *
   * Check B's diffs for IUserRepository and error handling patterns.
   * Check C's diffs for IOrderRepository and error handling patterns.
   * Each agent: 50 pts for interface usage, 50 pts for error handling patterns.
   */
  private scorePatternCompliance(rawResults: RawResults): DimensionScore {
    const details: string[] = [];
    const agentScores: number[] = [];

    // Agent B (cache-builder): must use IUserRepository and error handling
    const transcriptB = rawResults.transcripts[1];
    if (!transcriptB) {
      details.push('Agent B transcript missing — cannot score pattern compliance.');
      agentScores.push(0);
    } else {
      const contentB = transcriptB.fileChanges
        .map((c) => (c.diff ?? '') + '\n' + c.path)
        .join('\n');

      let scoreB = 0;
      if (/IUserRepository/i.test(contentB)) {
        scoreB += 50;
        details.push('Agent B uses IUserRepository interface.');
      } else {
        details.push('Agent B missing IUserRepository usage.');
      }
      if (/try|catch|Error|throw/i.test(contentB)) {
        scoreB += 50;
        details.push('Agent B follows error handling pattern.');
      } else {
        details.push('Agent B missing error handling pattern.');
      }
      agentScores.push(scoreB);
    }

    // Agent C (order-feature-builder): must use IOrderRepository and error handling
    const transcriptC = rawResults.transcripts[2];
    if (!transcriptC) {
      details.push('Agent C transcript missing — cannot score pattern compliance.');
      agentScores.push(0);
    } else {
      const contentC = transcriptC.fileChanges
        .map((c) => (c.diff ?? '') + '\n' + c.path)
        .join('\n');

      let scoreC = 0;
      if (/IOrderRepository/i.test(contentC)) {
        scoreC += 50;
        details.push('Agent C uses IOrderRepository interface.');
      } else {
        details.push('Agent C missing IOrderRepository usage.');
      }
      if (/try|catch|Error|throw/i.test(contentC)) {
        scoreC += 50;
        details.push('Agent C follows error handling pattern.');
      } else {
        details.push('Agent C missing error handling pattern.');
      }
      agentScores.push(scoreC);
    }

    const avgScore = agentScores.length > 0
      ? Math.round(agentScores.reduce((a, b) => a + b, 0) / agentScores.length)
      : 0;

    return {
      value: avgScore,
      confidence: rawResults.transcripts.length >= 3 ? 'high' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score cross-cutting consistency (weight 0.25).
   *
   * Check Agent D's test files for:
   * - Imports from B's caching code (cache|Cache in test imports/content)
   * - Imports from C's order history code (history|History|transition|Transition in test imports/content)
   * - Presence of test files in tests/integration/ directory
   */
  private scoreCrossCuttingConsistency(rawResults: RawResults): DimensionScore {
    const transcriptD = rawResults.transcripts[3];
    if (!transcriptD) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent D (integration-tester) transcript is missing.',
      };
    }

    const details: string[] = [];
    let score = 0;

    // Check for integration test files
    const testFiles = transcriptD.fileChanges.filter(
      (c) => /tests?\/integration|\.test\.|\.spec\./i.test(c.path),
    );
    if (testFiles.length > 0) {
      score += 34;
      details.push(`Agent D created ${testFiles.length} test file(s).`);
    } else {
      details.push('Agent D did not create integration test files.');
    }

    const contentD = transcriptD.fileChanges
      .map((c) => (c.diff ?? '') + '\n' + c.path)
      .join('\n');

    // Check for caching coverage (Agent B's work)
    if (/cache|Cache/i.test(contentD)) {
      score += 33;
      details.push('Agent D tests cover caching (Agent B).');
    } else {
      details.push('Agent D tests do not appear to cover caching.');
    }

    // Check for order history coverage (Agent C's work)
    if (/history|History|transition|Transition|orderHistory|order.history/i.test(contentD)) {
      score += 33;
      details.push('Agent D tests cover order history (Agent C).');
    } else {
      details.push('Agent D tests do not appear to cover order history.');
    }

    return {
      value: Math.min(100, score),
      confidence: contentD.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score retrieval precision (weight 0.15).
   *
   * Ratio of relevant file reads to total file reads in the first 30% of tool calls
   * for agents B and C. "Relevant" means files that Agent A modified.
   *
   * Only file reads are counted (tool calls with file_path or path parameter).
   */
  private scoreRetrievalPrecision(rawResults: RawResults): DimensionScore {
    const details: string[] = [];
    const agentPrecisions: number[] = [];

    for (const [idx, label] of [[1, 'B'], [2, 'C']] as [number, string][]) {
      const earlyCalls = this.earlyToolCalls(rawResults, idx);

      // Filter to only file-reading tool calls
      const fileReads = earlyCalls.filter((tc) => {
        const params = tc.parameters as Record<string, unknown>;
        return (
          typeof params['file_path'] === 'string' || typeof params['path'] === 'string'
        );
      });

      if (fileReads.length === 0) {
        details.push(`Agent ${label}: no file reads in early phase.`);
        agentPrecisions.push(0);
        continue;
      }

      const relevantReads = fileReads.filter((tc) => this.isRelevantFileRead(tc));
      const precision = Math.round((relevantReads.length / fileReads.length) * 100);
      agentPrecisions.push(precision);
      details.push(
        `Agent ${label}: ${relevantReads.length}/${fileReads.length} early file reads were relevant (${precision}% precision).`,
      );
    }

    const avgPrecision = agentPrecisions.length > 0
      ? Math.round(agentPrecisions.reduce((a, b) => a + b, 0) / agentPrecisions.length)
      : 0;

    return {
      value: avgPrecision,
      confidence: rawResults.transcripts.length >= 3 ? 'high' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }
}

/**
 * Factory function for the scenario registry.
 */
export function createDecisionVolumeRecoveryScenario(): DecisionVolumeRecoveryScenario {
  return new DecisionVolumeRecoveryScenario();
}
