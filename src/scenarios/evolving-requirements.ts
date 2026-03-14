/**
 * Evolving Requirements Scenario
 *
 * Four sessions where requirements change mid-stream and prior decisions must
 * be reconsidered. Session 1 establishes an EventBus notification pattern.
 * Session 2 extends it with SMS and webhook channels. Session 3 introduces a
 * breaking requirement change: priority-based routing. Session 4 audits,
 * finalises, and verifies integration.
 *
 * Scoring dimensions:
 * - requirementAdaptation (0.30): Did session 3 actually implement priority routing?
 * - decisionEvolution (0.25): Did session 3 use coordination tools to reconsider
 *   prior decisions? Did session 4 discover priority routing early?
 * - backwardCompatibility (0.25): Did the refactor preserve existing channel handlers?
 * - integrationCompleteness (0.20): Are audit service, preferences service, and
 *   integration tests present after session 4?
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
 * Ground truth manifest for the evolving-requirements scenario.
 */
export const EVOLVING_REQUIREMENTS_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'evolving-requirements',
  description:
    'Expected outcome: EventBus-based notification pattern, SMS/webhook channels, priority router (urgent→SMS, normal→email, low→webhook), audit service, preferences service, and integration tests.',
  decisions: [
    {
      id: 'notification-pattern',
      description: 'EventBus usage in notification service',
      affectedFiles: ['src/services/notification.service.ts'],
      expectedPatterns: ['EventBus|eventBus|event_bus'],
      antiPatterns: [],
    },
    {
      id: 'additional-channels',
      description: 'SMS and webhook channel handlers using EventBus',
      affectedFiles: [
        'src/services/sms.service.ts',
        'src/services/sms-notification.service.ts',
        'src/handlers/sms',
        'src/services/webhook.service.ts',
        'src/services/webhook-notification.service.ts',
        'src/handlers/webhook',
      ],
      expectedPatterns: ['sms|SMS|Sms', 'webhook|Webhook'],
      antiPatterns: [],
    },
    {
      id: 'priority-routing',
      description: 'Priority router with urgent/normal/low routing patterns',
      affectedFiles: [
        'src/services/priority-router.ts',
        'src/services/notification-router.ts',
        'src/utils/priority-router.ts',
      ],
      expectedPatterns: [
        'priorityRout|priority.?router|PriorityRout',
        'urgent|URGENT',
        'normal|NORMAL',
      ],
      antiPatterns: [],
    },
    {
      id: 'audit-and-preferences',
      description: 'Audit service and notification preferences service',
      affectedFiles: [
        'src/services/audit.service.ts',
        'src/services/audit-log.service.ts',
        'src/services/notification-preferences.service.ts',
        'src/services/preferences.service.ts',
      ],
      expectedPatterns: ['AuditService|auditService|audit.service', 'Preferences|preferences'],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'services/notification.service': ['utils/event-bus', 'services/priority-router'],
    'services/priority-router': ['services/sms.service', 'services/webhook.service'],
  },
  baselineTestCoverage: 70,
};

/**
 * Session 1 — Initial architect: implement email notifications via EventBus.
 */
const SESSION_1_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Your task: Implement an email notification system using the EventBus pattern.

1. Create or extend src/services/notification.service.ts:
   - Use an EventBus (publish/subscribe) pattern for dispatching notifications
   - Implement an email channel handler that listens to the EventBus
   - Events should carry: type, recipient, subject, body

2. Create src/utils/event-bus.ts (if it does not already exist):
   - Simple in-process EventBus with subscribe(event, handler) and publish(event, data)

3. Add at least one unit test for the notification service

Keep the design extensible — additional channel types will be added later.
Follow existing repository patterns and use dependency injection via constructor parameters.`;

/**
 * Session 2 — Channel extender: add SMS and webhook channels.
 */
const SESSION_2_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

A previous developer implemented email notifications using an EventBus pattern in src/services/notification.service.ts.

Your task: Extend the notification system with SMS and webhook channels.

1. Review the existing notification service and EventBus implementation before writing any code.
2. Add an SMS channel handler that subscribes to the EventBus.
3. Add a webhook channel handler that subscribes to the EventBus.
4. Both new handlers must follow the same EventBus subscription pattern already in place.
5. Add tests for the new channel handlers.

Do NOT redesign the EventBus or the notification service — extend, do not replace.`;

/**
 * Session 3 — Requirements changer: refactor for priority-based routing.
 */
const SESSION_3_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

IMPORTANT: The product requirements have changed. The stakeholder now requires priority-based routing:
  - urgent notifications → SMS channel
  - normal notifications → email channel
  - low-priority notifications → webhook channel

The existing system (EventBus with email, SMS, webhook channels) must be refactored to support this routing.

Your task:
1. Read the current codebase thoroughly before making changes.
2. If you use coordination or knowledge tools, reconsider any prior decisions that are now invalidated by the new routing requirement.
3. Create a priority router (e.g., src/services/priority-router.ts) that:
   - Accepts a notification with a priority field (urgent | normal | low)
   - Routes to the appropriate channel handler
4. Update the notification service to use the priority router.
5. Preserve the existing channel handlers (SMS, email, webhook) — they are still used.
6. Update tests to cover the routing logic.

Acknowledge that this requirement change invalidates the simple broadcast approach.`;

/**
 * Session 4 — Auditor/finaliser: add audit logging, preferences, integration tests.
 */
const SESSION_4_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on the TaskFlow Pro project at {{repo_path}}.

Three previous agents have built a notification system with EventBus, multi-channel support, and priority-based routing.

Your task:
1. Read the current codebase to understand all components before writing anything.
2. Verify that priority-based routing is present (urgent→SMS, normal→email, low→webhook).
3. Add an audit logging service (e.g., src/services/audit.service.ts) that records every notification dispatched.
4. Add a notification preferences service (e.g., src/services/notification-preferences.service.ts) that allows per-user channel preferences to override the priority router.
5. Write integration tests that exercise the full notification flow: priority routing → channel selection → audit log entry.
6. Ensure all existing unit tests still pass.`;

export class EvolvingRequirementsScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'evolving-requirements',
      description:
        'Four-session scenario where requirements change mid-stream. Session 3 introduces priority routing, invalidating prior decisions. Measures requirement adaptation, decision evolution, backward compatibility, and integration completeness.',
      estimatedDurationMinutes: 60,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 4,
      scoringDimensions: [
        'requirementAdaptation',
        'decisionEvolution',
        'backwardCompatibility',
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
        role: 'initial-architect',
      },
      {
        prompt: SESSION_2_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'channel-extender',
      },
      {
        prompt: SESSION_3_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 2,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'requirements-changer',
      },
      {
        prompt: SESSION_4_PROMPT,
        timeoutMs: SESSION_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 3,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'auditor-finalizer',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return EVOLVING_REQUIREMENTS_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'evolving-requirements',
      session1Role: 'initial-architect',
      session2Role: 'channel-extender',
      session3Role: 'requirements-changer',
      session4Role: 'auditor-finalizer',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const requirementAdaptation = this.scoreRequirementAdaptation(rawResults);
    const decisionEvolution = this.scoreDecisionEvolution(rawResults);
    const backwardCompatibility = this.scoreBackwardCompatibility(rawResults, groundTruth);
    const integrationCompleteness = this.scoreIntegrationCompleteness(rawResults, groundTruth);

    const scores: Record<string, DimensionScore> = {
      requirementAdaptation,
      decisionEvolution,
      backwardCompatibility,
      integrationCompleteness,
    };

    const composite =
      requirementAdaptation.value * 0.30 +
      decisionEvolution.value * 0.25 +
      backwardCompatibility.value * 0.25 +
      integrationCompleteness.value * 0.20;

    const result: ScoredResults = {
      runId: '',
      scenario: 'evolving-requirements',
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
   * Score requirement adaptation (weight 0.30).
   *
   * Checks session 3's diffs for priority router creation and priority patterns
   * (urgent, normal, low). Higher score = better adaptation to the new requirement.
   */
  private scoreRequirementAdaptation(rawResults: RawResults): DimensionScore {
    const transcript3 = rawResults.transcripts[2];
    if (!transcript3) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Session 3 (requirements-changer) transcript is missing.',
      };
    }

    const diffs3 = transcript3.fileChanges
      .map((c) => c.diff)
      .filter((d): d is string => d !== undefined)
      .join('\n');

    const files3 = transcript3.fileChanges.map((c) => c.path).join('\n');
    const content = diffs3 + '\n' + files3;

    const details: string[] = [];
    let score = 0;

    // Check for priority router creation (up to 50 points)
    const hasPriorityRouter = /priorityRout|priority.?router|PriorityRout/i.test(content);
    if (hasPriorityRouter) {
      score += 50;
      details.push('Priority router created.');
    } else {
      details.push('Priority router not found in session 3 output.');
    }

    // Check for routing patterns: urgent, normal, low (up to 50 points, ~16.7 each)
    const patterns: Array<[string, RegExp]> = [
      ['urgent', /urgent|URGENT/],
      ['normal', /normal|NORMAL/],
      ['low', /\blow\b|LOW/],
    ];

    let patternCount = 0;
    for (const [label, re] of patterns) {
      if (re.test(content)) {
        patternCount++;
        details.push(`Priority pattern '${label}' found.`);
      } else {
        details.push(`Priority pattern '${label}' missing.`);
      }
    }

    score += Math.round((patternCount / patterns.length) * 50);

    return {
      value: Math.min(100, score),
      confidence: diffs3.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score decision evolution (weight 0.25).
   *
   * Two signals:
   * 1. Session 3 used coordination tool calls (reconsider/decide/assemble) — worth 60 pts.
   * 2. Session 4 discovered priority routing in its early tool calls — worth 40 pts.
   */
  private scoreDecisionEvolution(rawResults: RawResults): DimensionScore {
    const transcript3 = rawResults.transcripts[2];
    const transcript4 = rawResults.transcripts[3];
    const details: string[] = [];
    let score = 0;

    // Signal 1: Session 3 coordination tool calls (60 points)
    if (transcript3) {
      const coordinationCalls = transcript3.toolCalls.filter((tc) =>
        /twining_reconsider|twining_decide|twining_assemble|twining_override|twining_post/i.test(
          tc.toolName,
        ),
      );
      if (coordinationCalls.length > 0) {
        score += 60;
        details.push(
          `Session 3 used ${coordinationCalls.length} coordination tool call(s) to evolve decisions.`,
        );
      } else {
        details.push('Session 3 did not use coordination tools to reconsider prior decisions.');
      }
    } else {
      details.push('Session 3 transcript missing.');
    }

    // Signal 2: Session 4 discovered priority routing early (40 points)
    if (transcript4) {
      const totalCalls = transcript4.toolCalls.length;
      const earlyWindow = Math.max(1, Math.ceil(totalCalls * 0.30));
      const earlyContent = transcript4.toolCalls
        .slice(0, earlyWindow)
        .map((tc) => JSON.stringify(tc.parameters))
        .join('\n');

      const foundPriorityEarly = /priorityRout|priority.?router|urgent|URGENT/i.test(earlyContent);
      if (foundPriorityEarly) {
        score += 40;
        details.push('Session 4 discovered priority routing in its early tool calls.');
      } else {
        details.push('Session 4 did not discover priority routing in early tool calls.');
      }
    } else {
      details.push('Session 4 transcript missing.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score backward compatibility (weight 0.25).
   *
   * Start at 100. Deduct for large deletions in channel files or presence of
   * anti-patterns that indicate the channel handlers were removed or rewritten
   * from scratch.
   */
  private scoreBackwardCompatibility(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    // Gather session 3 and 4 changes (the refactoring sessions)
    const refactorTranscripts = rawResults.transcripts.slice(2);
    if (refactorTranscripts.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No refactoring session transcripts found.',
      };
    }

    let score = 100;
    const details: string[] = [];

    // Channel-related file patterns — these are the files that should be preserved
    const channelFilePattern = /sms|webhook|email|channel/i;

    for (const transcript of refactorTranscripts) {
      for (const change of transcript.fileChanges) {
        if (!channelFilePattern.test(change.path)) continue;

        // Large deletion in a channel file is suspicious (possible rewrite)
        if (change.linesRemoved > 50) {
          score -= 20;
          details.push(
            `Large deletion (${change.linesRemoved} lines) in channel file: ${change.path}.`,
          );
        }

        // Check diff for anti-patterns
        if (change.diff) {
          const removedEventBus = /^-.*eventBus|^-.*EventBus|^-.*subscribe/m.test(change.diff);
          if (removedEventBus) {
            score -= 15;
            details.push(`EventBus subscription removed in ${change.path} — may break channels.`);
          }
        }
      }
    }

    // Also verify the additional-channels patterns still appear in total output
    const additionalChannelsDecision = groundTruth.decisions.find(
      (d) => d.id === 'additional-channels',
    );
    if (additionalChannelsDecision) {
      const allContent = rawResults.transcripts
        .flatMap((t) => t.fileChanges)
        .map((c) => (c.diff ?? '') + c.path)
        .join('\n');

      for (const pattern of additionalChannelsDecision.expectedPatterns) {
        if (!new RegExp(pattern, 'i').test(allContent)) {
          score -= 15;
          details.push(`Channel pattern '${pattern}' absent after refactor — may be lost.`);
        }
      }
    }

    if (details.length === 0) {
      details.push('No backward-compatibility issues detected in channel files.');
    }

    return {
      value: Math.max(0, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score integration completeness (weight 0.20).
   *
   * Checks session 4's output for:
   * - audit service creation
   * - preferences service creation
   * - integration test patterns
   */
  private scoreIntegrationCompleteness(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcript4 = rawResults.transcripts[3];
    if (!transcript4) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Session 4 (auditor-finalizer) transcript is missing.',
      };
    }

    const content4 =
      transcript4.fileChanges.map((c) => (c.diff ?? '') + c.path).join('\n') +
      '\n' +
      transcript4.fileChanges.map((c) => c.path).join('\n');

    const details: string[] = [];
    let found = 0;
    const total = 3;

    // Check audit service
    if (/AuditService|auditService|audit.service|audit\.log/i.test(content4)) {
      found++;
      details.push('Audit service found.');
    } else {
      details.push('Audit service missing from session 4.');
    }

    // Check preferences service
    if (/Preferences|preferences|PreferencesService/i.test(content4)) {
      found++;
      details.push('Preferences service found.');
    } else {
      details.push('Preferences service missing from session 4.');
    }

    // Check integration tests
    if (/integration.?test|describe.*integration|it\(.*flow|it\(.*end.to.end/i.test(content4)) {
      found++;
      details.push('Integration tests found.');
    } else {
      details.push('Integration tests missing from session 4.');
    }

    const score = Math.round((found / total) * 100);

    // Also check audit-and-preferences ground truth decision
    const auditDecision = groundTruth.decisions.find((d) => d.id === 'audit-and-preferences');
    if (auditDecision) {
      // Already checked above — just use the score
    }

    return {
      value: score,
      confidence: content4.length > 0 ? 'high' : 'medium',
      method: 'automated',
      justification: `${found}/${total} integration completeness checks passed. ${details.join(' ')}`,
    };
  }
}

/**
 * Factory function for the scenario registry.
 */
export function createEvolvingRequirementsScenario(): EvolvingRequirementsScenario {
  return new EvolvingRequirementsScenario();
}
