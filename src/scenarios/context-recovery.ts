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

/** Agent A timeout: 3 minutes (intentionally short to ensure genuinely incomplete work) */
const AGENT_A_TIMEOUT_MS = 3 * 60 * 1000;

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
    const completion = this.scoreCompletion(rawResults, groundTruth);
    const redundantRework = this.scoreRedundantRework(rawResults, completion);

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

    // Find time to first PRODUCTIVE action (file edit/write/bash), not coordination reads.
    // Coordination tool calls (twining_*, reading coordination files) are context-gathering,
    // not wasted time — they should not penalize the orientation score.
    const coordinationPattern = /twining_|coordination|context|handoff|investigation|finding|note/i;

    let firstProductiveMs: number | null = null;
    for (const tc of transcriptB.toolCalls) {
      // Skip coordination tool calls
      if (coordinationPattern.test(tc.toolName)) continue;
      // Skip reads of coordination files
      if (tc.toolName === 'Read') {
        const fp = tc.parameters['file_path'] as string | undefined;
        if (fp && coordinationPattern.test(fp)) continue;
      }
      // First non-coordination tool call = first productive action
      if (tc.toolName === 'Edit' || tc.toolName === 'Write' || tc.toolName === 'Bash') {
        // Use tool timestamp relative to session start if available
        if (tc.timestamp && transcriptB.timing.startTime) {
          firstProductiveMs = new Date(tc.timestamp).getTime() - new Date(transcriptB.timing.startTime).getTime();
        }
        break;
      }
    }

    // Fall back to timeToFirstActionMs if we couldn't compute productive time
    const effectiveTime = firstProductiveMs ?? transcriptB.timing.timeToFirstActionMs;

    // Linear scaling: 0s → 100, 120s → 0 (continuous, no step cliffs)
    const effectiveSec = effectiveTime / 1000;
    const score = Math.round(Math.max(0, Math.min(100, 100 - (effectiveSec / 120) * 100)));

    return {
      value: score,
      confidence: 'high',
      method: 'automated',
      justification: `Agent B's time to first productive action: ${effectiveSec.toFixed(1)}s (coordination time excluded). Linear: 0s=100, 120s=0.`,
    };
  }

  /**
   * Score redundant rework: Did Agent B modify files that Agent A already completed?
   *
   * Score = 100 - (overlapping files / total B files * 100).
   */
  private scoreRedundantRework(rawResults: RawResults, completion: DimensionScore): DimensionScore {
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

    // Measure TWO kinds of rework: file-level and investigation-level
    const aFiles = new Set(transcriptA.fileChanges.map((c) => c.path));
    const bFiles = transcriptB.fileChanges.map((c) => c.path);

    // Investigation overlap: did B re-read files A already investigated?
    const aReadFiles = new Set<string>();
    for (const tc of transcriptA.toolCalls) {
      if (tc.toolName === 'Read' || tc.toolName === 'Edit') {
        const fp = tc.parameters['file_path'] as string | undefined;
        if (fp) {
          const basename = fp.split('/').pop() ?? fp;
          aReadFiles.add(basename);
        }
      }
    }

    let bOverlapReads = 0;
    let bTotalReads = 0;
    for (const tc of transcriptB.toolCalls) {
      if (tc.toolName === 'Read') {
        bTotalReads++;
        const fp = tc.parameters['file_path'] as string | undefined;
        if (fp) {
          const basename = fp.split('/').pop() ?? fp;
          if (aReadFiles.has(basename)) bOverlapReads++;
        }
      }
    }

    if (bFiles.length === 0 && bTotalReads === 0) {
      // B did nothing at all
      if (completion.value >= 67) {
        // Completion is high — but did B even verify? Check if B made any tool calls
        const bHasAnyAction = transcriptB.toolCalls.length > 0;
        return {
          value: bHasAnyAction ? 75 : 50,
          confidence: 'medium',
          method: 'automated',
          justification: bHasAnyAction
            ? 'Agent B verified A\'s work was complete without redundant file changes.'
            : 'Agent B made no tool calls — passive, not actively coordinating.',
        };
      }
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification:
          'Agent B made no file changes and completion is low — B failed to complete the task.',
      };
    }

    // Combine file rework and investigation rework
    const fileOverlapping = bFiles.filter((f) => aFiles.has(f)).length;
    const fileReworkRatio = bFiles.length > 0 ? fileOverlapping / bFiles.length : 0;
    const investigationReworkRatio = bTotalReads > 0 && aReadFiles.size > 0
      ? bOverlapReads / bTotalReads
      : 0;

    // Weighted: file rework (60%) + investigation rework (40%)
    const combinedRework = fileReworkRatio * 0.6 + investigationReworkRatio * 0.4;
    const score = Math.round((1 - combinedRework) * 100);

    const details: string[] = [];
    if (fileOverlapping > 0) {
      details.push(`Agent B modified ${fileOverlapping} of ${bFiles.length} files A had already changed.`);
    }
    if (bOverlapReads > 0) {
      details.push(`Agent B re-read ${bOverlapReads} of ${bTotalReads} files A had already investigated.`);
    }
    if (details.length === 0) {
      details.push('Agent B did not duplicate A\'s work.');
    }

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score completion: Check if all 3 components exist in final codebase.
   *
   * Pattern match models, service, and tests in the combined file changes.
   */
  private scoreCompletion(rawResults: RawResults, groundTruth: ArchitecturalManifest): DimensionScore {
    const details: string[] = [];
    let componentScore = 0;

    // Check for each expected component in source files only (not docs/coordination)
    const sourceDiffs = rawResults.transcripts
      .flatMap((t) => t.fileChanges.filter((c) => c.path.startsWith('src/') || c.path.startsWith('tests/')))
      .map((c) => c.diff)
      .filter((d): d is string => d !== undefined)
      .join('\n');

    for (const decision of groundTruth.decisions) {
      const hasMatch = decision.expectedPatterns.some(
        (pattern) => new RegExp(pattern, 'i').test(sourceDiffs),
      );
      if (hasMatch) {
        componentScore += 1;
        details.push(`${decision.id}: found`);
      } else {
        details.push(`${decision.id}: missing`);
      }
    }

    const componentRatio = componentScore / Math.max(groundTruth.decisions.length, 1);

    // Check if agents ran tests and completed
    const completionBonus = rawResults.allSessionsCompleted ? 15 : 0;
    const lastTranscript = rawResults.transcripts[rawResults.transcripts.length - 1];
    const ranTests = lastTranscript?.toolCalls.some(
      (tc) =>
        tc.toolName === 'Bash' &&
        /(?:test|vitest|jest|npm\s+test)/i.test(JSON.stringify(tc.parameters)),
    ) ?? false;
    const testsBonus = ranTests ? 15 : 0;

    // Component presence (70%) + all sessions completed (15%) + ran tests (15%)
    const score = Math.round(componentRatio * 70 + completionBonus + testsBonus);

    return {
      value: Math.min(100, score),
      confidence: sourceDiffs.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: `${componentScore}/${groundTruth.decisions.length} components found (${Math.round(componentRatio * 70)}/70). Completed: ${completionBonus}/15. Tests: ${testsBonus}/15. ${details.join('; ')}.`,
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

    // Collect A's output files for reference
    const aOutputFiles = new Set(transcriptA.fileChanges.map((c) => c.path));

    // Assess B's context accuracy from tool calls (Read operations + coordination tools)
    let score = 0;
    const details: string[] = [];

    // Signal 1: Did B read A's output files? (up to 40 points)
    const bReadFiles = new Set<string>();
    for (const tc of transcriptB.toolCalls) {
      if (tc.toolName === 'Read') {
        const filePath = tc.parameters['file_path'] as string | undefined;
        if (filePath) bReadFiles.add(filePath);
      }
    }

    let readAOutputCount = 0;
    for (const bFile of bReadFiles) {
      for (const aFile of aOutputFiles) {
        // Match by basename since paths may differ across sessions
        if (bFile.endsWith(aFile) || aFile.endsWith(bFile) ||
            bFile.split('/').pop() === aFile.split('/').pop()) {
          readAOutputCount++;
          break;
        }
      }
    }

    if (aOutputFiles.size > 0 && readAOutputCount > 0) {
      const readRatio = Math.min(1, readAOutputCount / aOutputFiles.size);
      const readScore = Math.round(readRatio * 40);
      score += readScore;
      details.push(`Agent B read ${readAOutputCount} of ${aOutputFiles.size} files A modified.`);
    } else if (aOutputFiles.size === 0) {
      score += 20; // Baseline — A didn't produce files to read
      details.push('Agent A did not produce output files.');
    } else {
      details.push('Agent B did not read any of A\'s output files.');
    }

    // Signal 2: Did B use coordination tools? (up to 30 points)
    const bUsesCoordinationTools = transcriptB.toolCalls.some((tc) =>
      /twining_assemble|twining_read|twining_acknowledge|twining_recent|twining_query/.test(
        tc.toolName,
      ),
    );
    const bReadsCoordinationFiles = transcriptB.toolCalls.some((tc) => {
      const fp = tc.parameters['file_path'] as string | undefined;
      return fp && /(?:note|finding|investigation|context|coordination|handoff)/i.test(fp);
    });

    if (bUsesCoordinationTools) {
      score += 30;
      details.push('Agent B used coordination tools to recover prior context.');
    } else if (bReadsCoordinationFiles) {
      score += 20;
      details.push('Agent B checked coordination/notes files.');
    }

    // Signal 3: Diff-based pattern matching (up to 30 points) — only when diffs exist
    if (bDiffs.length > 0) {
      let patternScore = 30;
      const patternIssues: string[] = [];

      for (const decision of groundTruth.decisions) {
        const hasExpected = decision.expectedPatterns.some(
          (pattern) => new RegExp(pattern, 'i').test(bDiffs),
        );
        if (!hasExpected) {
          patternScore -= 10;
          patternIssues.push(`missing patterns for ${decision.id}`);
        }

        const hasAntiPattern = decision.antiPatterns.some(
          (pattern) => new RegExp(pattern).test(bDiffs),
        );
        if (hasAntiPattern) {
          patternScore -= 15;
          patternIssues.push(`anti-pattern for ${decision.id}`);
        }
      }

      score += Math.max(0, patternScore);
      if (patternIssues.length > 0) {
        details.push(`Diff issues: ${patternIssues.join('; ')}.`);
      } else {
        details.push('Agent B\'s diffs match expected patterns.');
      }
    } else {
      // B made no file changes — check if systematic review happened
      const totalBToolCalls = transcriptB.toolCalls.length;
      const earlyReadCalls = transcriptB.toolCalls
        .slice(0, Math.max(1, Math.floor(totalBToolCalls * 0.3)))
        .filter((tc) => tc.toolName === 'Read').length;

      if (earlyReadCalls >= 2) {
        score += 15;
        details.push('Agent B performed systematic code review in early tool calls.');
      } else {
        details.push('No diff data and limited review activity from Agent B.');
      }
    }

    // Signal 4: Warning heeding — did B respect warnings from A?
    const aWarningCalls = transcriptA.toolCalls.filter((tc) =>
      /twining.*post/.test(tc.toolName) &&
      (tc.parameters?.entry_type === 'warning' ||
       /warning|do not|don't|avoid|never/i.test(String(tc.parameters?.summary ?? ''))),
    );

    if (aWarningCalls.length > 0) {
      const warnedFiles = new Set<string>();
      for (const wc of aWarningCalls) {
        const text = String(wc.parameters?.summary ?? '') + ' ' + String(wc.parameters?.detail ?? '');
        const fileMatches = text.match(/[\w/.-]+\.\w{1,4}/g) ?? [];
        for (const fm of fileMatches) warnedFiles.add(fm);
      }

      const bModifiedFiles = new Set(transcriptB.fileChanges.map((c) => c.path));
      let violated = false;
      for (const wf of warnedFiles) {
        for (const bf of bModifiedFiles) {
          if (bf.includes(wf) || wf.includes(bf.split('/').pop() ?? '')) {
            violated = true;
            break;
          }
        }
        if (violated) break;
      }

      if (violated) {
        score = Math.max(0, score - 15);
        details.push('Agent B ignored warnings from Agent A and modified warned-about files (-15 pts).');
      } else if (warnedFiles.size > 0) {
        score = Math.min(100, score + 5);
        details.push('Agent B heeded warnings from Agent A (+5 pts).');
      }
    }

    return {
      value: Math.min(100, Math.max(0, score)),
      confidence: bDiffs.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }
}

/**
 * Factory function for the scenario registry.
 */
export function createContextRecoveryScenario(): ContextRecoveryScenario {
  return new ContextRecoveryScenario();
}
