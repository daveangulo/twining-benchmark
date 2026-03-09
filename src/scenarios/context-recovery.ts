/**
 * Context Recovery Scenario
 *
 * Agent A works on a substantial analytics API task, then gets interrupted
 * (shorter timeout). Agent B must orient to A's partial work and complete it.
 *
 * Scoring dimensions:
 * - Orientation Efficiency (0-100): How quickly Agent B starts productive work.
 * - Redundant Rework (0-100): Inverse of files B rewrites that A already completed.
 * - Completion (0-100): Are all 3 components present (models, service, tests)?
 * - Context Accuracy (0-100): Does B correctly build on A's architectural choices?
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

/** Agent A timeout: 8 minutes (intentionally short to simulate interruption) */
const AGENT_A_TIMEOUT_MS = 8 * 60 * 1000;

/** Agent B timeout: 15 minutes */
const AGENT_B_TIMEOUT_MS = 15 * 60 * 1000;

/** Default max turns per agent session */
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest for the context-recovery scenario.
 */
export const CONTEXT_RECOVERY_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'context-recovery',
  description:
    'Expected outcome: Analytics models (AnalyticsSummary, UserAnalytics, TrendPoint), AnalyticsService with getSummary/getUserAnalytics/getTrends, and tests for all service methods.',
  decisions: [
    {
      id: 'analytics-models',
      description: 'Analytics data models',
      affectedFiles: ['src/models/analytics.ts'],
      expectedPatterns: ['AnalyticsSummary|UserAnalytics|TrendPoint'],
      antiPatterns: [],
    },
    {
      id: 'analytics-service',
      description: 'Analytics service implementation',
      affectedFiles: ['src/services/analytics.service.ts'],
      expectedPatterns: ['AnalyticsService|analytics\\.service'],
      antiPatterns: [],
    },
    {
      id: 'analytics-tests',
      description: 'Analytics test coverage',
      affectedFiles: ['tests/analytics.test.ts'],
      expectedPatterns: ['analytics.*test|test.*analytics'],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'services/analytics.service': [
      'models/analytics',
      'repositories/user.repository',
      'repositories/order.repository',
    ],
  },
  baselineTestCoverage: 70,
};

/**
 * Agent A prompt: Original developer building the analytics API.
 */
const AGENT_A_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Your task: Design and implement an analytics dashboard API.

1. Create analytics models in src/models/analytics.ts:
   - AnalyticsSummary (totalUsers, totalOrders, revenue, activeUsers)
   - UserAnalytics (userId, orderCount, totalSpent, lastActive)
   - TrendPoint (timestamp, metric, value)

2. Create an AnalyticsService in src/services/analytics.service.ts:
   - getSummary() — aggregate stats from UserRepository and OrderRepository
   - getUserAnalytics(userId) — per-user analytics
   - getTrends(metric, startDate, endDate) — time-series data

3. Add tests for the analytics service

Follow the existing repository and service patterns. Use dependency injection via constructor parameters.`;

/**
 * Agent B prompt: Recovery agent completing interrupted work.
 */
const AGENT_B_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

A previous developer was building an analytics dashboard API but their session was interrupted. They may have left partial work.

Your task:
1. Review the current state of the codebase to understand what was already implemented
2. Check src/models/, src/services/, and tests/ for any analytics-related work
3. Complete any remaining work to deliver the full analytics API:
   - Models: AnalyticsSummary, UserAnalytics, TrendPoint
   - Service: AnalyticsService with getSummary(), getUserAnalytics(), getTrends()
   - Tests for all service methods
4. Do NOT redo work that is already complete and correct
5. Ensure all tests pass

Important: Understand what exists before writing new code. Avoid duplicating completed work.`;

export class ContextRecoveryScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'context-recovery',
      description:
        'Agent A works on analytics API, gets interrupted mid-task. Agent B recovers context and completes the work. Measures orientation efficiency and redundant rework.',
      estimatedDurationMinutes: 30,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 2,
      scoringDimensions: ['orientation-efficiency', 'redundant-rework', 'completion', 'context-accuracy'],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: AGENT_A_PROMPT,
        timeoutMs: AGENT_A_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'original-developer',
      },
      {
        prompt: AGENT_B_PROMPT,
        timeoutMs: AGENT_B_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'recovery-agent',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return CONTEXT_RECOVERY_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'context-recovery',
      agentARole: 'original-developer',
      agentBRole: 'recovery-agent',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const orientationEfficiency = this.scoreOrientationEfficiency(rawResults);
    const redundantRework = this.scoreRedundantRework(rawResults);
    const completion = this.scoreCompletion(rawResults, groundTruth);

    let contextAccuracy: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, ARCHITECTURAL_COHERENCE_TEMPLATE, evalCtx);
      contextAccuracy = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      contextAccuracy = this.scoreContextAccuracyAutomated(rawResults, groundTruth);
    }

    const scores: Record<string, DimensionScore> = {
      'orientation-efficiency': orientationEfficiency,
      'redundant-rework': redundantRework,
      completion,
      'context-accuracy': contextAccuracy,
    };

    // Composite: equal 25% weights
    const composite =
      orientationEfficiency.value * 0.25 +
      redundantRework.value * 0.25 +
      completion.value * 0.25 +
      contextAccuracy.value * 0.25;

    return {
      runId: '',
      scenario: 'context-recovery',
      condition: '',
      iteration: 0,
      scores,
      metrics: this.extractMetrics(rawResults),
      composite,
    };
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Score orientation efficiency: How quickly Agent B starts productive work.
   *
   * Uses Agent B's timeToFirstActionMs from transcript timing.
   * Lower is better: < 30s = 100, < 60s = 80, < 120s = 60, < 180s = 40, else 20.
   */
  private scoreOrientationEfficiency(rawResults: RawResults): DimensionScore {
    const transcriptB = rawResults.transcripts[1];
    if (!transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent B did not produce a transcript.',
      };
    }

    const timeToFirstAction = transcriptB.timing.timeToFirstActionMs;
    let score: number;
    if (timeToFirstAction < 30000) {
      score = 100;
    } else if (timeToFirstAction < 60000) {
      score = 80;
    } else if (timeToFirstAction < 120000) {
      score = 60;
    } else if (timeToFirstAction < 180000) {
      score = 40;
    } else {
      score = 20;
    }

    return {
      value: score,
      confidence: 'high',
      method: 'automated',
      justification: `Agent B's time to first action: ${(timeToFirstAction / 1000).toFixed(1)}s. Score: ${score}.`,
    };
  }

  /**
   * Score redundant rework: Did Agent B modify files that Agent A already completed?
   *
   * Score = 100 - (overlapping files / total B files * 100).
   */
  private scoreRedundantRework(rawResults: RawResults): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];

    if (!transcriptA || !transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Missing transcripts — cannot measure redundant rework.',
      };
    }

    const aFiles = new Set(transcriptA.fileChanges.map((c) => c.path));
    const bFiles = transcriptB.fileChanges.map((c) => c.path);

    if (bFiles.length === 0) {
      return {
        value: 100,
        confidence: 'low',
        method: 'automated',
        justification: 'Agent B made no file changes, so no rework is possible.',
      };
    }

    const overlapping = bFiles.filter((f) => aFiles.has(f)).length;
    const reworkRatio = overlapping / bFiles.length;
    const score = Math.round(100 - reworkRatio * 100);

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification:
        overlapping === 0
          ? 'Agent B did not modify any files that Agent A had already changed.'
          : `Agent B modified ${overlapping} of ${bFiles.length} files that Agent A had already changed. Rework ratio: ${(reworkRatio * 100).toFixed(1)}%.`,
    };
  }

  /**
   * Score completion: Check if all 3 components exist in final codebase.
   *
   * Pattern match models, service, and tests in the combined file changes.
   */
  private scoreCompletion(rawResults: RawResults, groundTruth: ArchitecturalManifest): DimensionScore {
    // Gather all file paths from all transcripts
    const allFiles = rawResults.transcripts.flatMap((t) => t.fileChanges.map((c) => c.path));
    const allDiffs = rawResults.transcripts
      .flatMap((t) => t.fileChanges.map((c) => c.diff))
      .filter((d): d is string => d !== undefined)
      .join('\n');

    const allContent = allFiles.join('\n') + '\n' + allDiffs;

    let found = 0;
    const details: string[] = [];

    for (const decision of groundTruth.decisions) {
      const hasMatch = decision.expectedPatterns.some(
        (pattern) => new RegExp(pattern, 'i').test(allContent),
      );
      if (hasMatch) {
        found++;
        details.push(`${decision.id}: found`);
      } else {
        details.push(`${decision.id}: missing`);
      }
    }

    const score = Math.round((found / groundTruth.decisions.length) * 100);

    return {
      value: score,
      confidence: allDiffs.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: `${found}/${groundTruth.decisions.length} components found. ${details.join('; ')}.`,
    };
  }

  /**
   * Automated fallback for context accuracy when no LLM judge is available.
   *
   * Checks if Agent B's changes reference patterns from Agent A's work,
   * indicating B understood and built on A's architecture.
   */
  private scoreContextAccuracyAutomated(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];

    if (!transcriptA || !transcriptB) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'Missing transcripts — cannot assess context accuracy.',
      };
    }

    const bDiffs = transcriptB.fileChanges
      .map((c) => c.diff)
      .filter((d): d is string => d !== undefined)
      .join('\n');

    if (bDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available from Agent B for context accuracy scoring.',
        dataQuality: 'missing',
      };
    }

    let score = 100;
    const issues: string[] = [];

    // Check if B uses patterns from the ground truth
    for (const decision of groundTruth.decisions) {
      const hasExpected = decision.expectedPatterns.some(
        (pattern) => new RegExp(pattern, 'i').test(bDiffs),
      );

      if (!hasExpected) {
        score -= 15;
        issues.push(`Agent B did not reference expected patterns for ${decision.id}`);
      }

      const hasAntiPattern = decision.antiPatterns.some(
        (pattern) => new RegExp(pattern).test(bDiffs),
      );

      if (hasAntiPattern) {
        score -= 20;
        issues.push(`Agent B introduced anti-pattern for ${decision.id}`);
      }
    }

    return {
      value: Math.max(0, score),
      confidence: 'medium',
      method: 'automated',
      justification:
        issues.length > 0
          ? `Context accuracy issues: ${issues.join('; ')}`
          : 'Agent B correctly built on Agent A\'s architectural choices.',
    };
  }
}

/**
 * Factory function for the scenario registry.
 */
export function createContextRecoveryScenario(): ContextRecoveryScenario {
  return new ContextRecoveryScenario();
}
