/**
 * Conflict Resolution Scenario
 *
 * Two agents implement notifications with contradictory architectures
 * (event-driven vs direct calls). A third agent must detect the conflict,
 * choose the better approach, and unify the codebase.
 *
 * Scoring dimensions:
 * - Conflict Detection (30%): Does Agent C identify both patterns?
 * - Resolution Quality (40%): Is the architecture unified under one pattern?
 * - Decision Documentation (30%): Is the decision documented?
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

/** Timeout for Agents A and B: 10 minutes */
const AB_TIMEOUT_MS = 10 * 60 * 1000;

/** Timeout for Agent C (resolver): 15 minutes */
const C_TIMEOUT_MS = 15 * 60 * 1000;

/** Default max turns per agent session */
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest for the conflict-resolution scenario.
 */
export const CONFLICT_RESOLUTION_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'conflict-resolution',
  description:
    'Expected outcome: Two conflicting notification architectures (event-driven and direct calls) are detected and unified into a single consistent approach.',
  decisions: [
    {
      id: 'notification-architecture',
      description: 'Notification system architecture pattern',
      affectedFiles: [
        'src/services/notification.service.ts',
        'src/services/order.service.ts',
      ],
      expectedPatterns: [
        'EventBus|event-bus|emit|listener|subscribe',
        'notifyOrder|NotificationService',
      ],
      antiPatterns: [],
    },
    {
      id: 'conflict-resolved',
      description: 'Conflicting patterns unified into single approach',
      affectedFiles: [
        'src/services/notification.service.ts',
      ],
      expectedPatterns: [
        'notification',
      ],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'services/order.service': [
      'services/notification.service',
    ],
  },
  baselineTestCoverage: 80,
};

/**
 * Agent A prompt: Implement event-driven notification architecture.
 */
const AGENT_A_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Your task: Implement a notification system using an **event-driven architecture**.

1. Create an EventBus in src/events/event-bus.ts (if not already present, extend it)
2. Define notification event types in src/events/event-types.ts
3. Have the OrderService emit events when orders are created/updated instead of calling notification methods directly
4. Create a NotificationService in src/services/notification.service.ts that listens for these events
5. Add tests for the event-based notification flow

This is the preferred approach for decoupling services. Events allow services to communicate without direct dependencies.`;

/**
 * Agent B prompt: Implement direct service-to-service notification calls.
 */
const AGENT_B_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Your task: Implement a notification system using **direct service-to-service calls**.

1. Create a NotificationService in src/services/notification.service.ts that exposes methods like notifyOrderCreated(), notifyOrderUpdated()
2. Have the OrderService call NotificationService methods directly when orders are created/updated
3. Import and inject NotificationService as a dependency of OrderService
4. Add tests for the direct notification calls

This is the preferred approach for simplicity and debuggability. Direct calls are easier to trace and test than events.`;

/**
 * Agent C prompt: Resolve architectural conflict.
 */
const AGENT_C_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Review the notification system implementation in this codebase. Two previous developers may have made **conflicting architectural choices** about how services communicate for notifications.

Your task:
1. Identify any architectural conflicts in the notification approach
2. Evaluate both approaches (event-driven vs direct calls) in the context of this project
3. Choose the better approach with clear justification
4. Unify the codebase so it follows a single consistent notification architecture
5. Ensure all tests pass after unification
6. Document your decision and rationale (in code comments or coordination files)`;

export class ConflictResolutionScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'conflict-resolution',
      description:
        'Two agents implement notifications with contradictory architectures (event-driven vs direct calls). A third agent must detect the conflict, choose the better approach, and unify the codebase.',
      estimatedDurationMinutes: 45,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 3,
      scoringDimensions: ['conflict-detection', 'resolution-quality', 'decision-documentation'],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: AGENT_A_PROMPT,
        timeoutMs: AB_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'event-driven-implementer',
      },
      {
        prompt: AGENT_B_PROMPT,
        timeoutMs: AB_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'direct-call-implementer',
      },
      {
        prompt: AGENT_C_PROMPT,
        timeoutMs: C_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 2,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'resolver',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return CONFLICT_RESOLUTION_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'conflict-resolution',
      agentARole: 'event-driven-implementer',
      agentBRole: 'direct-call-implementer',
      agentCRole: 'resolver',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const conflictDetection = this.scoreConflictDetection(rawResults);

    let resolutionQuality: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, ARCHITECTURAL_COHERENCE_TEMPLATE, evalCtx);
      resolutionQuality = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      resolutionQuality = this.scoreResolutionQuality(rawResults);
    }

    const decisionDocumentation = this.scoreDecisionDocumentation(rawResults);

    const scores: Record<string, DimensionScore> = {
      'conflict-detection': conflictDetection,
      'resolution-quality': resolutionQuality,
      'decision-documentation': decisionDocumentation,
    };

    // Composite: weighted average
    const composite =
      conflictDetection.value * 0.3 +
      resolutionQuality.value * 0.4 +
      decisionDocumentation.value * 0.3;

    return {
      runId: '', // Set by the runner
      scenario: 'conflict-resolution',
      condition: '', // Set by the runner
      iteration: 0, // Set by the runner
      scores,
      metrics: this.extractMetrics(rawResults),
      composite,
    };
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Score conflict detection (30%): Check Agent C's transcript for mentions
   * of both patterns ("event" AND "direct call" or "service-to-service").
   * If both mentioned, high score. If only one, low.
   */
  private scoreConflictDetection(rawResults: RawResults): DimensionScore {
    const transcriptC = rawResults.transcripts[2];
    if (!transcriptC) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent C did not produce a transcript.',
      };
    }

    // Check Agent C's ADDED source code lines for pattern usage
    const cSourceDiffs = transcriptC.fileChanges
      .filter((c) => c.path.startsWith('src/') || c.path.startsWith('tests/'))
      .map((c) => c.diff ?? '')
      .join('\n');
    const cAddedLines = cSourceDiffs
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');
    const cRemovedLines = cSourceDiffs
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'))
      .join('\n');

    const eventPattern = /EventBus|eventBus|\.emit\(|\.on\(/i;
    const directPattern = /CallbackRegistry|statusChangeCallbacks|\.register\(|\.notify\(/i;

    // Did C remove one pattern from code? (evidence of active unification)
    const removedEvent = eventPattern.test(cRemovedLines);
    const removedDirect = directPattern.test(cRemovedLines);
    const addedEvent = eventPattern.test(cAddedLines);
    const addedDirect = directPattern.test(cAddedLines);

    let score: number;
    let justification: string;

    // Best case: C removed one pattern and kept/added the other → clear unification
    if ((removedEvent && !removedDirect && addedDirect) || (removedDirect && !removedEvent && addedEvent)) {
      score = 100;
      const kept = removedEvent ? 'direct-call' : 'event-driven';
      const removed = removedEvent ? 'event-driven' : 'direct-call';
      justification = `Agent C unified to ${kept} by removing ${removed} pattern from code.`;
    } else if (removedEvent || removedDirect) {
      score = 70;
      justification = 'Agent C removed at least one pattern — partial unification detected.';
    } else if (addedEvent || addedDirect) {
      score = 40;
      const mentioned = addedEvent ? 'event-driven' : 'direct-call';
      justification = `Agent C added ${mentioned} code but did not remove the alternative pattern.`;
    } else {
      score = 0;
      justification = 'Agent C did not modify architectural patterns in source code.';
    }

    return {
      value: score,
      confidence: cSourceDiffs.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification,
    };
  }

  /**
   * Score resolution quality (40%): Automated fallback when no LLM evaluator.
   * Checks whether the final codebase shows a unified notification pattern.
   */
  private scoreResolutionQuality(rawResults: RawResults): DimensionScore {
    const transcriptC = rawResults.transcripts[2];
    if (!transcriptC) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent C did not produce a transcript.',
      };
    }

    let score = 0;
    const details: string[] = [];

    // 1. Did Agent C modify notification source files? (25 pts)
    const notifFiles = transcriptC.fileChanges.filter(
      (c) => /notification|order\.service|event/i.test(c.path) && c.path.startsWith('src/'),
    );
    if (notifFiles.length >= 2) {
      score += 25;
      details.push(`Modified ${notifFiles.length} notification/service files.`);
    } else if (notifFiles.length === 1) {
      score += 10;
      details.push('Modified 1 notification/service file — limited unification scope.');
    } else {
      details.push('No notification/service files modified.');
    }

    // 2. Is the final code unified? Check if C's added lines show only ONE pattern. (35 pts)
    const cSourceAdded = transcriptC.fileChanges
      .filter((c) => c.path.startsWith('src/'))
      .map((c) => c.diff ?? '')
      .join('\n')
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');

    const eventInAdded = /EventBus|eventBus|\.emit\(|\.on\(/i.test(cSourceAdded);
    const directInAdded = /CallbackRegistry|statusChangeCallbacks|\.register\(|\.notify\(/i.test(cSourceAdded);

    if ((eventInAdded && !directInAdded) || (directInAdded && !eventInAdded)) {
      score += 35;
      const unified = eventInAdded ? 'event-driven' : 'direct-call';
      details.push(`Unified to ${unified} pattern.`);
    } else if (eventInAdded && directInAdded) {
      score += 10;
      details.push('Both patterns present in added code — not fully unified.');
    } else {
      details.push('No architectural pattern detected in added code.');
    }

    // 3. Did Agent C run tests successfully? (25 pts)
    const ranTests = transcriptC.toolCalls.some(
      (tc) =>
        tc.toolName === 'Bash' &&
        /(?:test|vitest|jest|npm\s+test)/i.test(JSON.stringify(tc.parameters)),
    );
    if (rawResults.allSessionsCompleted && ranTests) {
      score += 25;
      details.push('All sessions completed and Agent C ran tests.');
    } else if (rawResults.allSessionsCompleted) {
      score += 10;
      details.push('All sessions completed but Agent C did not run tests.');
    } else {
      details.push('Not all sessions completed.');
    }

    // 4. Agent C completed (15 pts)
    if (transcriptC.exitReason === 'completed') {
      score += 15;
      details.push('Completed.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score decision documentation (30%): Check for decision documentation in
   * coordination files (CLAUDE.md, COORDINATION.md, CONTEXT.md,
   * coordination/decisions.md, or Twining decisions).
   */
  private scoreDecisionDocumentation(rawResults: RawResults): DimensionScore {
    const transcriptC = rawResults.transcripts[2];
    if (!transcriptC) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent C did not produce a transcript.',
      };
    }

    const coordinationFilePatterns = [
      /CLAUDE\.md/i,
      /COORDINATION\.md/i,
      /CONTEXT\.md/i,
      /coordination\/decisions/i,
      /DECISIONS\.md/i,
      /ARCHITECTURE\.md/i,
      /ADR/i,
      /\.twining\/decisions\//i,
    ];

    const changedPaths = transcriptC.fileChanges.map((c) => c.path);
    const matchedCoordFiles = changedPaths.filter((p) =>
      coordinationFilePatterns.some((pat) => pat.test(p)),
    );

    // Also check tool calls for Twining decision tracking
    const twinToolCalls = transcriptC.toolCalls.filter(
      (tc) => /twining.*decide|twining.*decision/i.test(tc.toolName),
    );

    // Check for decision documentation in code comments within diffs
    const cDiffs = transcriptC.fileChanges.map((c) => c.diff ?? '').join('\n');
    const hasInlineDocumentation =
      /decision|rationale|chose|chosen|prefer|architectural choice/i.test(cDiffs);

    let score = 0;
    const details: string[] = [];

    if (matchedCoordFiles.length > 0) {
      score += 60;
      details.push(`Documented in coordination files: ${matchedCoordFiles.join(', ')}.`);
    }

    if (twinToolCalls.length > 0) {
      // Structured decision tools are equivalent to coordination files
      score += 60;
      details.push(`Used Twining decision tracking (${twinToolCalls.length} calls).`);
    }

    if (hasInlineDocumentation) {
      score += 30;
      details.push('Included decision rationale in code comments.');
    }

    if (score === 0) {
      details.push('No decision documentation found in coordination files, Twining, or code comments.');
    }

    return {
      value: Math.min(100, score),
      confidence: matchedCoordFiles.length > 0 || twinToolCalls.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }
}

/**
 * Factory function for the scenario registry.
 */
export function createConflictResolutionScenario(): ConflictResolutionScenario {
  return new ConflictResolutionScenario();
}
