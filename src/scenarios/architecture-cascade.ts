/**
 * FR-SCN-002: Architecture Decision Cascade Scenario
 *
 * Agent A makes a significant architectural decision (event-driven vs. direct calls
 * for notification decoupling). Agents B and C independently build features that
 * should respect that decision.
 *
 * Task Flow:
 * 1. Agent A: Decouple notification system from order processing. Choose approach,
 *    implement, document the decision with rationale.
 * 2. Agent B: Add email notifications on order status change. Integrate with
 *    existing notification architecture.
 * 3. Agent C: Add webhook system for order events. Integrate with existing
 *    notification architecture.
 * B and C work in separate sequential sessions (not concurrent).
 *
 * Scoring Dimensions:
 * - Decision Propagation (0-100): Did B and C both discover and follow A's decision?
 * - Pattern Consistency (0-100): Do B and C use the same integration pattern?
 * - Decision Quality (0-100): Was A's decision well-reasoned?
 */

import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type { ScenarioMetadata, AgentTask, RawResults } from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest for the architecture-cascade scenario.
 *
 * The acceptable architectural patterns for decoupling notifications from
 * order processing are: event-driven (preferred) or observer pattern.
 * Direct function calls are the anti-pattern.
 */
export const ARCHITECTURE_CASCADE_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'architecture-cascade',
  description:
    'Expected outcome: Notification system decoupled from order processing via event-driven or observer pattern. Email notifications and webhooks both use the chosen pattern consistently.',
  decisions: [
    {
      id: 'decouple-notifications',
      description:
        'Agent A should decouple the notification system from order processing using an event-driven or observer pattern, not direct function calls.',
      affectedFiles: [
        'src/services/order.service.ts',
        'src/services/notification.service.ts',
        'src/events/event-bus.ts',
      ],
      expectedPatterns: [
        'EventEmitter',
        'eventBus',
        'event-bus',
        'EventBus',
        'subscribe',
        'publish',
        'emit',
        'on\\(',
        'addEventListener',
        'Observer',
      ],
      antiPatterns: [
        'notificationService\\.send.*direct',
        'import.*NotificationService.*from.*order',
      ],
    },
    {
      id: 'email-notification-integration',
      description:
        'Agent B should add email notifications that integrate with Agent A\'s chosen decoupling pattern (e.g., subscribe to order events, not call order service directly).',
      affectedFiles: [
        'src/services/notification.service.ts',
        'src/notifications/email.ts',
      ],
      expectedPatterns: [
        'email',
        'Email',
        'subscribe',
        'on\\(',
        'handler',
        'listener',
      ],
      antiPatterns: [
        'orderService\\..*notify',
        'import.*OrderService.*from.*email',
      ],
    },
    {
      id: 'webhook-integration',
      description:
        'Agent C should add a webhook system that integrates with Agent A\'s chosen pattern (e.g., subscribe to order events), consistent with how Agent B integrated.',
      affectedFiles: [
        'src/services/notification.service.ts',
        'src/notifications/webhook.ts',
      ],
      expectedPatterns: [
        'webhook',
        'Webhook',
        'subscribe',
        'on\\(',
        'handler',
        'listener',
        'http',
        'url',
      ],
      antiPatterns: [
        'orderService\\..*webhook',
        'import.*OrderService.*from.*webhook',
      ],
    },
  ],
  moduleDependencies: {
    'services/order.service': ['events/event-bus'],
    'services/notification.service': ['events/event-bus'],
    'notifications/email': ['services/notification.service', 'events/event-bus'],
    'notifications/webhook': ['services/notification.service', 'events/event-bus'],
  },
  baselineTestCoverage: 70,
};

/**
 * Agent A prompt: Decouple notification system from order processing.
 */
const AGENT_A_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

Your task: The notification system needs to be decoupled from the order processing module. Choose an approach, implement the decoupling, and document your architectural decision with rationale.

Specifically:
1. Examine how the order processing module currently triggers notifications (look at the OrderService and NotificationService).
2. Choose a decoupling approach (e.g., event-driven, observer pattern, message queue abstraction) and document WHY you chose it.
3. Implement the decoupling — the order module should no longer directly call the notification module.
4. Ensure existing functionality is preserved (orders still trigger notifications, just indirectly).
5. Write or update tests to cover the new decoupled architecture.
6. Document your decision clearly — the next developers need to understand your approach to build on it.

Important:
- This is an architectural decision that downstream developers will build on. Choose wisely and document thoroughly.
- Make sure the codebase compiles and tests pass when you're done.`;

/**
 * Agent B prompt: Add email notifications for order status changes.
 * Does NOT reference Agent A's specific decision — B must discover it.
 */
const AGENT_B_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

Your task: Add email notifications when an order status changes. Integrate with the existing notification architecture.

Specifically:
1. Understand the current notification architecture — look at how notifications are structured and triggered.
2. Implement email notifications that fire when an order's status changes (e.g., created, processing, shipped, delivered).
3. Create an email notification handler/service that formats and would send email notifications.
4. Integrate your email notifications with the existing notification patterns in the codebase.
5. Add tests for the email notification functionality.
6. Make sure the codebase compiles and all existing tests still pass.

Important:
- Build on the existing notification architecture — do NOT create a separate notification system.
- Respect the patterns and decisions already in the codebase.
- Make sure the codebase compiles and tests pass when you're done.`;

/**
 * Agent C prompt: Add webhook system for order events.
 * Does NOT reference Agent A's specific decision — C must discover it.
 */
const AGENT_C_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

Your task: Add a webhook system that fires on order events. Integrate with the existing notification architecture.

Specifically:
1. Understand the current notification architecture — look at how notifications are structured and triggered.
2. Implement a webhook system that fires HTTP callbacks when order events occur (e.g., order created, status changed).
3. Create a webhook registry where external URLs can be registered for specific event types.
4. Integrate your webhook system with the existing notification patterns in the codebase.
5. Add tests for the webhook functionality.
6. Make sure the codebase compiles and all existing tests still pass.

Important:
- Build on the existing notification architecture — do NOT create a separate event system.
- Respect the patterns and decisions already in the codebase.
- Make sure the codebase compiles and tests pass when you're done.`;

export class ArchitectureCascadeScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'architecture-cascade',
      description:
        'Agent A decouples notifications from orders. Agents B and C independently build email and webhook features. Measures decision propagation and pattern consistency.',
      estimatedDurationMinutes: 45,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 3,
      scoringDimensions: ['decisionPropagation', 'patternConsistency', 'decisionQuality'],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: AGENT_A_PROMPT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'architect',
      },
      {
        prompt: AGENT_B_PROMPT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'email-builder',
      },
      {
        prompt: AGENT_C_PROMPT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 2,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'webhook-builder',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return ARCHITECTURE_CASCADE_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'architecture-cascade',
      agentARoles: 'architect',
      agentBRole: 'email-builder',
      agentCRole: 'webhook-builder',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): Promise<ScoredResults> {
    const decisionPropagation = this.scoreDecisionPropagation(rawResults, groundTruth);
    const patternConsistency = this.scorePatternConsistency(rawResults);
    const decisionQuality = this.scoreDecisionQuality(rawResults, groundTruth);

    const scores: Record<string, DimensionScore> = {
      decisionPropagation,
      patternConsistency,
      decisionQuality,
    };

    // Composite: weighted average
    const composite =
      decisionPropagation.value * 0.4 +
      patternConsistency.value * 0.3 +
      decisionQuality.value * 0.3;

    return {
      runId: '',
      scenario: 'architecture-cascade',
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
   * Score decision propagation: Did B and C both discover and follow A's decision?
   *
   * 100 = both aligned with A's pattern.
   * 50 = one aligned.
   * 0 = neither aligned.
   */
  private scoreDecisionPropagation(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];
    const transcriptC = rawResults.transcripts[2];

    if (!transcriptA) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent A did not produce a transcript — no decision to propagate.',
      };
    }

    // Detect A's chosen pattern from its diffs
    const aDiffs = transcriptA.fileChanges.map((c) => c.diff ?? '').join('\n');
    const decouplingDecision = groundTruth.decisions.find(
      (d) => d.id === 'decouple-notifications',
    );
    if (!decouplingDecision) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'Ground truth missing decouple-notifications decision.',
      };
    }

    // Check which expected patterns A used
    const aPatterns = decouplingDecision.expectedPatterns.filter(
      (p) => new RegExp(p).test(aDiffs),
    );

    let bAligned = false;
    let cAligned = false;
    const details: string[] = [];

    // Check if B follows A's patterns
    if (transcriptB) {
      const bDiffs = transcriptB.fileChanges.map((c) => c.diff ?? '').join('\n');
      bAligned = aPatterns.some((p) => new RegExp(p).test(bDiffs));
      details.push(
        bAligned
          ? 'Agent B aligned with Agent A\'s pattern.'
          : 'Agent B did NOT follow Agent A\'s architectural pattern.',
      );
    } else {
      details.push('Agent B did not produce a transcript.');
    }

    // Check if C follows A's patterns
    if (transcriptC) {
      const cDiffs = transcriptC.fileChanges.map((c) => c.diff ?? '').join('\n');
      cAligned = aPatterns.some((p) => new RegExp(p).test(cDiffs));
      details.push(
        cAligned
          ? 'Agent C aligned with Agent A\'s pattern.'
          : 'Agent C did NOT follow Agent A\'s architectural pattern.',
      );
    } else {
      details.push('Agent C did not produce a transcript.');
    }

    let value: number;
    if (bAligned && cAligned) {
      value = 100;
    } else if (bAligned || cAligned) {
      value = 50;
    } else {
      value = 0;
    }

    return {
      value,
      confidence: aPatterns.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score pattern consistency: Do B and C use the same integration pattern?
   *
   * 100 = both use the same pattern (e.g., both use event subscription).
   * 0 = completely different integration approaches.
   */
  private scorePatternConsistency(rawResults: RawResults): DimensionScore {
    const transcriptB = rawResults.transcripts[1];
    const transcriptC = rawResults.transcripts[2];

    if (!transcriptB || !transcriptC) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Missing transcripts for Agent B or C — cannot compare patterns.',
      };
    }

    const bDiffs = transcriptB.fileChanges.map((c) => c.diff ?? '').join('\n');
    const cDiffs = transcriptC.fileChanges.map((c) => c.diff ?? '').join('\n');

    // Define integration patterns to look for
    const integrationPatterns: Record<string, RegExp> = {
      eventEmitter: /(?:EventEmitter|eventBus|EventBus|\.emit\(|\.on\(|subscribe|publish)/,
      observer: /(?:Observer|observe|notify|addObserver|removeObserver)/,
      directCall: /(?:notificationService\.send|orderService\.notify)/,
      callback: /(?:callback|onEvent|handler\()/,
    };

    const bPatterns: string[] = [];
    const cPatterns: string[] = [];

    for (const [name, regex] of Object.entries(integrationPatterns)) {
      if (regex.test(bDiffs)) bPatterns.push(name);
      if (regex.test(cDiffs)) cPatterns.push(name);
    }

    // Calculate overlap
    const bSet = new Set(bPatterns);
    const cSet = new Set(cPatterns);
    const intersection = bPatterns.filter((p) => cSet.has(p));
    const union = new Set([...bPatterns, ...cPatterns]);

    if (union.size === 0) {
      return {
        value: 50,
        confidence: 'low',
        method: 'automated',
        justification:
          'No recognizable integration patterns detected in either B or C. Cannot assess consistency.',
      };
    }

    const jaccardSimilarity = intersection.length / union.size;
    const value = Math.round(jaccardSimilarity * 100);

    return {
      value,
      confidence: bSet.size > 0 && cSet.size > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: `Agent B used patterns: [${bPatterns.join(', ')}]. Agent C used patterns: [${cPatterns.join(', ')}]. Overlap: ${intersection.length}/${union.size}.`,
    };
  }

  /**
   * Score decision quality: Was A's decision well-reasoned?
   *
   * Rubric-scored against ground truth:
   * - Did A choose an appropriate pattern (event-driven/observer)?
   * - Did A document the decision?
   * - Did A implement it correctly?
   */
  private scoreDecisionQuality(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptA = rawResults.transcripts[0];

    if (!transcriptA) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent A did not produce a transcript.',
      };
    }

    let score = 0;
    const details: string[] = [];

    const aDiffs = transcriptA.fileChanges.map((c) => c.diff ?? '').join('\n');
    const decouplingDecision = groundTruth.decisions.find(
      (d) => d.id === 'decouple-notifications',
    );

    if (!decouplingDecision) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'Ground truth missing decouple-notifications decision.',
      };
    }

    // Check: Did A use an expected pattern?
    const usedExpectedPattern = decouplingDecision.expectedPatterns.some(
      (p) => new RegExp(p).test(aDiffs),
    );
    if (usedExpectedPattern) {
      score += 40;
      details.push('Agent A chose an appropriate decoupling pattern.');
    } else {
      details.push('Agent A did not use a recognized decoupling pattern.');
    }

    // Check: Did A avoid anti-patterns?
    const usedAntiPattern = decouplingDecision.antiPatterns.some(
      (p) => new RegExp(p).test(aDiffs),
    );
    if (!usedAntiPattern) {
      score += 20;
      details.push('No anti-patterns detected.');
    } else {
      details.push('Agent A introduced anti-patterns in the decoupling.');
    }

    // Check: Did A document the decision? Look for markdown/doc/comment changes
    const docPatterns = /(?:\.md|decision|rationale|chose|because|approach|architecture)/i;
    const hasDocumentation = transcriptA.fileChanges.some(
      (c) => docPatterns.test(c.path) || docPatterns.test(c.diff ?? ''),
    );
    if (hasDocumentation) {
      score += 20;
      details.push('Agent A documented the decision.');
    } else {
      details.push('Agent A did not clearly document the decision.');
    }

    // Check: Did A actually make code changes?
    if (transcriptA.fileChanges.length > 0 && transcriptA.exitReason === 'completed') {
      score += 20;
      details.push('Agent A completed implementation.');
    } else {
      details.push('Agent A did not complete implementation.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  private extractMetrics(rawResults: RawResults) {
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let costUsd = 0;
    let wallTimeMs = 0;
    let numTurns = 0;
    let compactionCount = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    let maxContextUtilization = 0;
    const changedFiles = new Set<string>();

    for (const transcript of rawResults.transcripts) {
      totalTokens += transcript.tokenUsage.total;
      inputTokens += transcript.tokenUsage.input;
      outputTokens += transcript.tokenUsage.output;
      cacheReadTokens += transcript.tokenUsage.cacheRead;
      cacheCreationTokens += transcript.tokenUsage.cacheCreation;
      costUsd += transcript.tokenUsage.costUsd;
      wallTimeMs += transcript.timing.durationMs;
      numTurns += transcript.numTurns;
      compactionCount += transcript.compactionCount;
      if (transcript.contextWindowSize > 0) {
        const utilization = transcript.tokenUsage.total / transcript.contextWindowSize;
        maxContextUtilization = Math.max(maxContextUtilization, utilization);
      }
      for (const change of transcript.fileChanges) {
        linesAdded += change.linesAdded;
        linesRemoved += change.linesRemoved;
        changedFiles.add(change.path);
      }
    }

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
      wallTimeMs,
      agentSessions: rawResults.transcripts.length,
      numTurns,
      compactionCount,
      contextUtilization: maxContextUtilization,
      gitChurn: {
        linesAdded,
        linesRemoved,
        filesChanged: changedFiles.size,
        reverts: 0,
      },
      testsPass: 0,
      testsFail: 0,
      compiles: rawResults.allSessionsCompleted,
    };
  }
}

export function createArchitectureCascadeScenario(): ArchitectureCascadeScenario {
  return new ArchitectureCascadeScenario();
}
