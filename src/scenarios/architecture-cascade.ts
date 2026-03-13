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

import type Anthropic from '@anthropic-ai/sdk';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type { ScenarioMetadata, AgentTask, RawResults } from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';
import {
  buildEvaluationContextFromResults,
  runSingleEvaluation,
  DECISION_CONSISTENCY_TEMPLATE,
} from '../analyzer/llm-judge.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest for the architecture-cascade scenario.
 *
 * The acceptable architectural patterns are: event-driven (EventBus) OR
 * direct callbacks (CallbackRegistry). Either is valid, but the codebase
 * must use ONE consistently. Mixing patterns is the anti-pattern.
 */
export const ARCHITECTURE_CASCADE_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'architecture-cascade',
  description:
    'Expected outcome: Notification system uses ONE consistent pattern (EventBus OR CallbackRegistry). Email notifications and webhooks both use the chosen pattern consistently.',
  decisions: [
    {
      id: 'decouple-notifications',
      description:
        'Agent A should unify the notification system to use ONE pattern consistently (EventBus or CallbackRegistry), not a mix of both.',
      affectedFiles: [
        'src/services/order.service.ts',
        'src/services/notification.service.ts',
        'src/events/event-bus.ts',
        'src/utils/callback-registry.ts',
      ],
      expectedPatterns: [
        'EventEmitter',
        'eventBus',
        'event-bus',
        'EventBus',
        'CallbackRegistry',
        'callbackRegistry',
        'callback-registry',
        'subscribe',
        'publish',
        'emit',
        'on\\(',
        'register',
        'notify',
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
        'Agent B should add email notifications that integrate with Agent A\'s chosen pattern (EventBus or CallbackRegistry), not call order service directly.',
      affectedFiles: [
        'src/services/notification.service.ts',
        'src/notifications/email.ts',
      ],
      expectedPatterns: [
        'email',
        'Email',
        'subscribe',
        'on\\(',
        'register',
        'handler',
        'listener',
        'callback',
      ],
      antiPatterns: [
        'orderService\\..*notify',
        'import.*OrderService.*from.*email',
      ],
    },
    {
      id: 'webhook-integration',
      description:
        'Agent C should add a webhook system that integrates with Agent A\'s chosen pattern, consistent with how Agent B integrated.',
      affectedFiles: [
        'src/services/notification.service.ts',
        'src/notifications/webhook.ts',
      ],
      expectedPatterns: [
        'webhook',
        'Webhook',
        'subscribe',
        'on\\(',
        'register',
        'handler',
        'listener',
        'callback',
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
    'services/order.service': ['events/event-bus', 'utils/callback-registry'],
    'services/notification.service': ['events/event-bus', 'utils/callback-registry'],
    'notifications/email': ['services/notification.service', 'events/event-bus', 'utils/callback-registry'],
    'notifications/webhook': ['services/notification.service', 'events/event-bus', 'utils/callback-registry'],
  },
  baselineTestCoverage: 70,
};

/**
 * Agent A prompt: Decouple notification system from order processing.
 */
const AGENT_A_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). Key files for your task:
- \`src/services/order.service.ts\` — OrderService (uses mixed notification patterns)
- \`src/services/notification.service.ts\` — NotificationService (uses two different patterns)
- \`src/events/event-bus.ts\` — EventBus class (event-driven pattern)
- \`src/utils/callback-registry.ts\` — CallbackRegistry class (direct callback pattern)
- \`src/events/event-types.ts\` — Event type definitions
- \`tests/\` — existing test files

Directory structure:
\`\`\`
src/
  events/        # Event bus and event types
  models/        # Data models
  services/      # Business logic (order, notification)
  utils/         # Shared utilities (callback registry)
tests/           # Test files
\`\`\`

Your task: The codebase currently uses a mix of event-driven (EventBus) and direct callback (CallbackRegistry) patterns for the notification system. This inconsistency makes it hard for other developers to know which pattern to use. Choose ONE approach for the notification system, refactor to use it consistently, and document your decision with rationale.

Specifically:
1. Examine \`src/services/order.service.ts\`, \`src/services/notification.service.ts\`, \`src/events/event-bus.ts\`, and \`src/utils/callback-registry.ts\` to understand the current mixed patterns.
2. Choose ONE pattern (EventBus OR CallbackRegistry) and document WHY you chose it over the alternative.
3. Refactor the notification system to use your chosen pattern consistently for ALL notification triggers.
4. Ensure existing functionality is preserved (orders still trigger notifications).
5. Write or update tests to cover the unified architecture.
6. Document your decision clearly — the next developers need to understand your approach to build on it.

Important:
- This is an architectural decision that downstream developers will build on. Choose wisely and document thoroughly.
- The key question is EventBus vs CallbackRegistry — each has trade-offs. Make a clear choice.
- Make sure the codebase compiles and tests pass when you're done.`;

/**
 * Agent B prompt: Add email notifications for order status changes.
 * Does NOT reference Agent A's specific decision — B must discover it.
 */
const AGENT_B_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). Key files for your task:
- \`src/services/order.service.ts\` — OrderService (triggers notifications on order events)
- \`src/services/notification.service.ts\` — NotificationService (handles notification dispatch)
- \`src/events/\` — Event system
- \`src/utils/\` — Shared utilities
- \`tests/\` — existing test files

Directory structure:
\`\`\`
src/
  events/        # Event system
  models/        # Data models
  notifications/ # (you may create this for email handler)
  services/      # Business logic
  utils/         # Shared utilities
tests/           # Test files
\`\`\`

Your task: Add email notifications when an order status changes. Integrate with the existing notification architecture.

Specifically:
1. Review \`src/services/notification.service.ts\` and related files to understand the current notification architecture and patterns.
2. Implement email notifications that fire when an order's status changes (e.g., created, processing, shipped, delivered).
3. Create an email notification handler/service that formats and would send email notifications.
4. Integrate your email notifications with the existing notification patterns — use the same approach the codebase already uses.
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

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). Key files for your task:
- \`src/services/order.service.ts\` — OrderService (triggers notifications on order events)
- \`src/services/notification.service.ts\` — NotificationService (handles notification dispatch)
- \`src/events/\` — Event system
- \`src/utils/\` — Shared utilities
- \`tests/\` — existing test files

Directory structure:
\`\`\`
src/
  events/        # Event system
  models/        # Data models
  notifications/ # (may contain email handler from previous agent)
  services/      # Business logic
  utils/         # Shared utilities
tests/           # Test files
\`\`\`

Your task: Add a webhook system that fires on order events. Integrate with the existing notification architecture.

Specifically:
1. Review \`src/services/notification.service.ts\` and related files to understand the current notification architecture and patterns.
2. Implement a webhook system that fires HTTP callbacks when order events occur (e.g., order created, status changed).
3. Create a webhook registry where external URLs can be registered for specific event types.
4. Integrate your webhook system with the existing notification patterns — use the same approach the codebase already uses.
5. Add tests for the webhook functionality.
6. Make sure the codebase compiles and all existing tests still pass.

Important:
- Build on the existing notification architecture — do NOT create a separate event system.
- Respect the patterns and decisions already in the codebase.
- Make sure the codebase compiles and tests pass when you're done.`;

/**
 * Two mutually exclusive pattern groups for detecting A's architectural choice.
 * Used by scoreDecisionPropagation to determine WHICH pattern A chose,
 * then verify B/C followed that specific choice (not just any pattern).
 */
const EVENT_BUS_PATTERNS = [
  /EventBus/,
  /eventBus/,
  /EventEmitter/,
  /\.emit\(/,
  /\.on\(/,
  /subscribe/,
  /publish/,
];

const CALLBACK_REGISTRY_PATTERNS = [
  /CallbackRegistry/,
  /callbackRegistry/,
  /statusChangeCallbacks/,
  /\.register\(/,
  /\.notify\(/,
];

/** Coordination tool names that indicate intentional decision discovery. */
const COORDINATION_TOOLS = [
  'twining_assemble',
  'twining_why',
  'twining_query',
  'twining_search_decisions',
  'twining_read',
  'twining_recent',
  'mcp__plugin_twining_twining__twining_assemble',
  'mcp__plugin_twining_twining__twining_why',
  'mcp__plugin_twining_twining__twining_query',
  'mcp__plugin_twining_twining__twining_search_decisions',
  'mcp__plugin_twining_twining__twining_read',
  'mcp__plugin_twining_twining__twining_recent',
];

export class ArchitectureCascadeScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'architecture-cascade',
      description:
        'Agent A decouples notifications from orders. Agents B and C independently build email and webhook features. Measures decision propagation and pattern consistency.',
      estimatedDurationMinutes: 45,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 3,
      scoringDimensions: ['decisionPropagation', 'decisionDiscovery', 'patternConsistency', 'decisionQuality'],
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
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const decisionPropagation = this.scoreDecisionPropagation(rawResults, groundTruth);
    const decisionDiscovery = this.scoreDecisionDiscovery(rawResults);
    const patternConsistency = this.scorePatternConsistency(rawResults);
    let decisionQuality: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, DECISION_CONSISTENCY_TEMPLATE, evalCtx);
      decisionQuality = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      decisionQuality = this.scoreDecisionQuality(rawResults, groundTruth);
    }

    const scores: Record<string, DimensionScore> = {
      decisionPropagation,
      decisionDiscovery,
      patternConsistency,
      decisionQuality,
    };

    // Composite: weighted average
    const composite =
      decisionPropagation.value * 0.3 +
      decisionDiscovery.value * 0.2 +
      patternConsistency.value * 0.25 +
      decisionQuality.value * 0.25;

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
   * Detect which architectural pattern group (EventBus vs CallbackRegistry)
   * is dominant in a diff string.
   *
   * Returns 'eventbus' | 'callback' | 'mixed' | 'none'.
   */
  private detectPatternChoice(diffs: string): 'eventbus' | 'callback' | 'mixed' | 'none' {
    const ebMatches = EVENT_BUS_PATTERNS.filter((r) => r.test(diffs)).length;
    const cbMatches = CALLBACK_REGISTRY_PATTERNS.filter((r) => r.test(diffs)).length;

    if (ebMatches === 0 && cbMatches === 0) return 'none';
    if (ebMatches > 0 && cbMatches === 0) return 'eventbus';
    if (cbMatches > 0 && ebMatches === 0) return 'callback';
    // Both present — whichever has more matches wins, tie = mixed
    if (ebMatches > cbMatches) return 'eventbus';
    if (cbMatches > ebMatches) return 'callback';
    return 'mixed';
  }

  /**
   * Score decision propagation: Did B and C both follow A's SPECIFIC pattern choice?
   *
   * Detects whether A chose EventBus or CallbackRegistry, then checks if B and C
   * used that same pattern group. Using the alternative pattern is NOT alignment.
   *
   * 100 = both aligned with A's specific choice.
   * 50 = one aligned.
   * 0 = neither aligned (or used the wrong pattern).
   */
  private scoreDecisionPropagation(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
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

    const aDiffs = transcriptA.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const aHasMissingDiffs = transcriptA.fileChanges.some((c) => c.diff === undefined);

    if (aHasMissingDiffs && aDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
      };
    }

    // Detect A's specific pattern choice
    const aChoice = this.detectPatternChoice(aDiffs);

    if (aChoice === 'none') {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'Could not detect Agent A\'s architectural pattern choice from diffs.',
        dataQuality: aHasMissingDiffs ? 'partial' : 'complete',
      };
    }

    if (aChoice === 'mixed') {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'Agent A used a mix of EventBus and CallbackRegistry — did not make a clear choice.',
        dataQuality: aHasMissingDiffs ? 'partial' : 'complete',
      };
    }

    const aChoiceLabel = aChoice === 'eventbus' ? 'EventBus' : 'CallbackRegistry';
    let bAligned = false;
    let cAligned = false;
    let anyMissingDiffs = aHasMissingDiffs;
    const details: string[] = [`Agent A chose ${aChoiceLabel}.`];

    // Check if B follows A's specific pattern choice
    if (transcriptB) {
      const bDiffs = transcriptB.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
      const bHasMissingDiffs = transcriptB.fileChanges.some((c) => c.diff === undefined);
      if (bHasMissingDiffs) anyMissingDiffs = true;
      if (bHasMissingDiffs && bDiffs.length === 0) {
        details.push('Agent B has no diff data.');
      } else {
        const bChoice = this.detectPatternChoice(bDiffs);
        bAligned = bChoice === aChoice;
        if (bAligned) {
          details.push(`Agent B followed ${aChoiceLabel}.`);
        } else if (bChoice === 'none') {
          details.push('Agent B did not use a recognizable pattern.');
        } else {
          const bLabel = bChoice === 'eventbus' ? 'EventBus' : bChoice === 'callback' ? 'CallbackRegistry' : 'mixed patterns';
          details.push(`Agent B used ${bLabel} instead of ${aChoiceLabel}.`);
        }
      }
    } else {
      details.push('Agent B did not produce a transcript.');
    }

    // Check if C follows A's specific pattern choice
    if (transcriptC) {
      const cDiffs = transcriptC.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
      const cHasMissingDiffs = transcriptC.fileChanges.some((c) => c.diff === undefined);
      if (cHasMissingDiffs) anyMissingDiffs = true;
      if (cHasMissingDiffs && cDiffs.length === 0) {
        details.push('Agent C has no diff data.');
      } else {
        const cChoice = this.detectPatternChoice(cDiffs);
        cAligned = cChoice === aChoice;
        if (cAligned) {
          details.push(`Agent C followed ${aChoiceLabel}.`);
        } else if (cChoice === 'none') {
          details.push('Agent C did not use a recognizable pattern.');
        } else {
          const cLabel = cChoice === 'eventbus' ? 'EventBus' : cChoice === 'callback' ? 'CallbackRegistry' : 'mixed patterns';
          details.push(`Agent C used ${cLabel} instead of ${aChoiceLabel}.`);
        }
      }
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
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
      dataQuality: anyMissingDiffs ? (aDiffs.length > 0 ? 'partial' : 'missing') : 'complete',
    };
  }

  /**
   * Score decision discovery: Did B and C discover A's work before building?
   *
   * Two sub-scores per agent (B and C), averaged:
   * 1. File reads (25 pts): Did the agent read files A modified BEFORE its first write?
   * 2. Coordination tools (25 pts): Did the agent use Twining tools to discover A's decisions?
   *
   * Total: 0-100 (sum of B's and C's sub-scores).
   */
  private scoreDecisionDiscovery(rawResults: RawResults): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];
    const transcriptC = rawResults.transcripts[2];

    if (!transcriptA) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent A did not produce a transcript — nothing to discover.',
      };
    }

    // Files A modified (normalized to relative paths)
    const aModifiedFiles = new Set(
      transcriptA.fileChanges.map((c) => c.path.replace(/^\/+/, '')),
    );

    if (aModifiedFiles.size === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'Agent A made no file changes — nothing to discover.',
      };
    }

    const details: string[] = [];
    let totalScore = 0;

    for (const [label, transcript] of [['B', transcriptB], ['C', transcriptC]] as const) {
      if (!transcript) {
        details.push(`Agent ${label} did not produce a transcript.`);
        continue;
      }

      // Find the index of first write/edit tool call
      const firstWriteIdx = transcript.toolCalls.findIndex((tc) =>
        /^(Write|Edit|write|edit|mcp.*write|mcp.*edit)$/i.test(tc.toolName) ||
        tc.toolName === 'Bash', // Bash can also write files
      );

      // Tool calls before first write (or all calls if no writes)
      const earlyToolCalls = firstWriteIdx >= 0
        ? transcript.toolCalls.slice(0, firstWriteIdx)
        : transcript.toolCalls;

      // Sub-score 1: Did agent read A's modified files before writing?
      const readFiles = new Set<string>();
      for (const tc of earlyToolCalls) {
        if (/^(Read|read|mcp.*read_file)$/i.test(tc.toolName)) {
          const filePath = String(tc.parameters?.file_path ?? tc.parameters?.path ?? '');
          // Normalize: extract relative path from absolute
          const normalized = filePath.replace(/.*?(?:src\/|tests\/|\.\/)/i, '');
          readFiles.add(normalized);
        }
      }

      // Count how many of A's files this agent read before writing
      let aFilesRead = 0;
      for (const aFile of aModifiedFiles) {
        const aNormalized = aFile.replace(/.*?(?:src\/|tests\/|\.\/)/i, '');
        for (const readFile of readFiles) {
          if (readFile.includes(aNormalized) || aNormalized.includes(readFile)) {
            aFilesRead++;
            break;
          }
        }
      }

      const fileReadScore = Math.round((aFilesRead / aModifiedFiles.size) * 25);

      // Sub-score 2: Did agent use coordination tools?
      const coordToolCalls = earlyToolCalls.filter((tc) =>
        COORDINATION_TOOLS.some((ct) => tc.toolName.includes(ct)),
      );
      // 25 pts if any coordination tool used, scaled: 1 call = 15, 2+ = 25
      const coordScore = coordToolCalls.length === 0 ? 0
        : coordToolCalls.length === 1 ? 15
        : 25;

      const agentScore = fileReadScore + coordScore;
      totalScore += agentScore;

      details.push(
        `Agent ${label}: read ${aFilesRead}/${aModifiedFiles.size} of A's files before writing (${fileReadScore} pts), ` +
        `${coordToolCalls.length} coordination tool calls (${coordScore} pts).`,
      );
    }

    return {
      value: totalScore,
      confidence: 'medium',
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

    const bDiffs = transcriptB.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const bHasMissingDiffs = transcriptB.fileChanges.some((c) => c.diff === undefined);
    const cDiffs = transcriptC.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const cHasMissingDiffs = transcriptC.fileChanges.some((c) => c.diff === undefined);
    const hasMissingDiffs = bHasMissingDiffs || cHasMissingDiffs;

    if (hasMissingDiffs && bDiffs.length === 0 && cDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
      };
    }

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
        dataQuality: hasMissingDiffs ? 'partial' : 'complete',
      };
    }

    const jaccardSimilarity = intersection.length / union.size;
    const value = Math.round(jaccardSimilarity * 100);

    return {
      value,
      confidence: bSet.size > 0 && cSet.size > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: `Agent B used patterns: [${bPatterns.join(', ')}]. Agent C used patterns: [${cPatterns.join(', ')}]. Overlap: ${intersection.length}/${union.size}.`,
      dataQuality: hasMissingDiffs ? 'partial' : 'complete',
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

    const aDiffs = transcriptA.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const hasMissingDiffs = transcriptA.fileChanges.some((c) => c.diff === undefined);
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

    if (hasMissingDiffs && aDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
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
      dataQuality: hasMissingDiffs ? 'partial' : 'complete',
    };
  }

  // extractMetrics is inherited from BaseScenario
}

export function createArchitectureCascadeScenario(): ArchitectureCascadeScenario {
  return new ArchitectureCascadeScenario();
}
