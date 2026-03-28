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
import type { AgentTranscript, FileChange } from '../types/transcript.js';
import { BaseScenario } from './scenario.interface.js';
import { computeContinuationIndex } from '../analyzer/work-leverage.js';
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
   * Detect which architectural pattern Agent A chose by scanning transcript tool calls.
   *
   * Used as a fallback when diff-based detection returns 'none' (e.g., when A records
   * the decision via Twining coordination tools rather than in code changes).
   *
   * Returns 'eventbus' | 'callback' | 'mixed' | 'none'.
   */
  private detectPatternFromTranscript(transcript: AgentTranscript): 'eventbus' | 'callback' | 'mixed' | 'none' {
    const relevantCalls = transcript.toolCalls.filter(
      (tc) => tc.toolName.includes('twining_decide') || tc.toolName.includes('twining_post'),
    );

    if (relevantCalls.length === 0) return 'none';

    const combinedText = relevantCalls
      .map((tc) => {
        const { summary, rationale, detail, context } = tc.parameters as Record<string, unknown>;
        return [summary, rationale, detail, context]
          .filter((v): v is string => typeof v === 'string')
          .join('\n');
      })
      .join('\n');

    return this.detectPatternChoice(combinedText);
  }

  /**
   * Score how strongly a diff aligns with a specific pattern choice.
   *
   * Returns a strength score 0-3:
   * - 0: no signals for this pattern
   * - 1: weak signal (only generic terms like subscribe/register that appear in many contexts)
   * - 2: moderate signal (pattern-specific class names like EventBus/CallbackRegistry)
   * - 3: strong signal (imports or instantiation of the pattern-specific class)
   */
  private measurePatternStrength(diffs: string, pattern: 'eventbus' | 'callback'): number {
    if (pattern === 'eventbus') {
      // Strong: import/instantiation of EventBus/EventEmitter class
      const strong = /(?:import\s+.*EventBus|new\s+EventBus|new\s+EventEmitter|extends\s+EventEmitter)/.test(diffs);
      // Moderate: class/instance name reference (EventBus, eventBus, EventEmitter)
      const moderate = /(?:EventBus|eventBus|EventEmitter)/.test(diffs);
      // Weak: generic terms that could appear in any event-related code
      const weak = /(?:\.emit\(|\.on\(|subscribe|publish)/.test(diffs);

      if (strong) return 3;
      if (moderate) return 2;
      if (weak) return 1;
      return 0;
    } else {
      // Strong: import/instantiation of CallbackRegistry class
      const strong = /(?:import\s+.*CallbackRegistry|new\s+CallbackRegistry)/.test(diffs);
      // Moderate: class/instance name reference
      const moderate = /(?:CallbackRegistry|callbackRegistry|statusChangeCallbacks)/.test(diffs);
      // Weak: generic terms
      const weak = /(?:\.register\(|\.notify\()/.test(diffs);

      if (strong) return 3;
      if (moderate) return 2;
      if (weak) return 1;
      return 0;
    }
  }

  /**
   * Filter fileChanges to source code files only (src/ and tests/ TypeScript).
   * Excludes documentation and coordination files (CLAUDE.md, COORDINATION.md,
   * ARCHITECTURE_DECISION.md, .twining/, coordination/) whose text can contain
   * pattern keywords that skew architectural pattern detection.
   */
  private filterToSourceFiles(fileChanges: FileChange[]): FileChange[] {
    return fileChanges.filter((c) =>
      (c.path.startsWith('src/') || c.path.startsWith('tests/')) && c.path.endsWith('.ts'),
    );
  }

  /**
   * Check whether an agent's diff ONLY uses the added lines (new code) for pattern
   * detection, filtering out context/removed lines to avoid false positives from
   * pre-existing code.
   */
  private extractAddedLines(diff: string): string {
    return diff
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');
  }

  /**
   * Score decision propagation: Did B and C both follow A's SPECIFIC pattern choice?
   *
   * Detects whether A chose EventBus or CallbackRegistry, then checks if B and C
   * used that same pattern group. Uses strength-based matching to avoid false positives
   * from generic terms like "subscribe" or "register" appearing in unrelated code.
   *
   * Scoring (per agent B/C, 50 pts each):
   * - 50: strong alignment (imports/instantiates A's chosen pattern class)
   * - 35: moderate alignment (references pattern class name)
   * - 15: weak alignment (only generic terms that match the pattern)
   * - 0: no alignment or used the wrong pattern
   *
   * Penalties:
   * - Using the WRONG pattern (the one A rejected) subtracts points
   * - Mixed usage (both patterns) gets reduced credit
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

    const aSourceFiles = this.filterToSourceFiles(transcriptA.fileChanges);
    const aDiffs = aSourceFiles.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const aHasMissingDiffs = aSourceFiles.some((c) => c.diff === undefined);

    if (aHasMissingDiffs && aDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
      };
    }

    // Detect A's specific pattern choice from added lines in source files only —
    // removed lines (e.g. deleting CallbackRegistry usage) indicate
    // the REJECTED pattern, not the chosen one.
    const aAddedLines = this.extractAddedLines(aDiffs);
    let aChoice = this.detectPatternChoice(aAddedLines);

    // Fallback: if diffs don't reveal a pattern, check Twining tool call parameters
    if (aChoice === 'none') {
      aChoice = this.detectPatternFromTranscript(transcriptA);
    }

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
    const alternatePattern = aChoice === 'eventbus' ? 'callback' : 'eventbus';
    let anyMissingDiffs = aHasMissingDiffs;
    const details: string[] = [`Agent A chose ${aChoiceLabel}.`];
    let totalScore = 0;

    // Score each follower agent (B and C), 50 points max each
    for (const [label, transcript] of [['B', transcriptB], ['C', transcriptC]] as const) {
      if (!transcript) {
        details.push(`Agent ${label} did not produce a transcript.`);
        continue;
      }

      const agentSourceFiles = this.filterToSourceFiles(transcript.fileChanges);
      const agentDiffs = agentSourceFiles.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
      const agentHasMissingDiffs = agentSourceFiles.some((c) => c.diff === undefined);
      if (agentHasMissingDiffs) anyMissingDiffs = true;

      if (agentHasMissingDiffs && agentDiffs.length === 0) {
        details.push(`Agent ${label} has no diff data.`);
        continue;
      }

      // Use only added lines to avoid matching pre-existing code in diff context
      const addedLines = this.extractAddedLines(agentDiffs);

      const correctStrength = this.measurePatternStrength(addedLines, aChoice);
      const wrongStrength = this.measurePatternStrength(addedLines, alternatePattern);

      let agentScore: number;
      if (correctStrength === 0 && wrongStrength === 0) {
        agentScore = 0;
        details.push(`Agent ${label} did not use a recognizable pattern.`);
      } else if (wrongStrength > correctStrength) {
        // Used the WRONG pattern more strongly than the correct one
        agentScore = 0;
        const wrongLabel = alternatePattern === 'eventbus' ? 'EventBus' : 'CallbackRegistry';
        details.push(`Agent ${label} used ${wrongLabel} instead of ${aChoiceLabel}.`);
      } else if (correctStrength > 0 && wrongStrength > 0) {
        // Mixed: used both, but correct pattern is dominant
        // Give partial credit scaled down
        const strengthScores: Record<number, number> = { 3: 25, 2: 15, 1: 5 };
        agentScore = strengthScores[correctStrength] ?? 0;
        details.push(`Agent ${label} used ${aChoiceLabel} but also mixed in the alternative pattern (${agentScore}/50).`);
      } else {
        // Pure correct pattern usage, score by strength
        const strengthScores: Record<number, number> = { 3: 50, 2: 35, 1: 15 };
        agentScore = strengthScores[correctStrength] ?? 0;
        details.push(`Agent ${label} followed ${aChoiceLabel} (strength ${correctStrength}/3, ${agentScore}/50).`);
      }

      totalScore += agentScore;
    }

    return {
      value: totalScore,
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

      // Sub-score 2: Does this agent's code reference A's new symbols? (continuation index)
      // Measures whether B/C built on A's abstractions from code artifacts, not process.
      const contIdx = computeContinuationIndex(transcriptA, transcript);
      const contScore = Math.round(contIdx * 25);

      const agentScore = fileReadScore + contScore;
      totalScore += agentScore;

      details.push(
        `Agent ${label}: read ${aFilesRead}/${aModifiedFiles.size} of A's files before writing (${fileReadScore} pts), ` +
        `continuation index ${(contIdx * 100).toFixed(0)}% (${contScore} pts).`,
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
   * Score decision quality: Was A's decision well-reasoned and well-implemented?
   *
   * Five rubric dimensions with graduated scoring:
   *
   * 1. Clear pattern choice (0/10/25): Did A commit to ONE pattern exclusively?
   *    - 25: Only one pattern group found in added lines (clear choice)
   *    - 10: One dominant but some traces of the other (mostly unified)
   *    - 0: Mixed equally or no recognizable pattern
   *
   * 2. Anti-pattern avoidance (0/15): Did A avoid tight coupling?
   *
   * 3. Decision documentation (0/5/10/20): How thoroughly did A document?
   *    - 20: Dedicated doc file (.md) with rationale keywords (why/because/trade-off)
   *    - 10: Dedicated doc file without rationale, or rationale in code comments only
   *    - 5: Only generic comments mentioning the decision
   *    - 0: No documentation found
   *
   * 4. Implementation scope (0/5/10/20): Did A actually refactor the codebase?
   *    - 20: Modified 3+ relevant files (broad refactor)
   *    - 10: Modified 2 relevant files
   *    - 5: Modified 1 relevant file
   *    - 0: No relevant files modified
   *
   * 5. Removal of old pattern (0/10/20): Did A clean up the rejected pattern?
   *    - 20: Added lines of chosen pattern AND removed lines of rejected pattern
   *    - 10: Only added chosen pattern (may have left old code in place)
   *    - 0: No evidence of cleanup
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

    const aSourceFiles = this.filterToSourceFiles(transcriptA.fileChanges);
    const aDiffs = aSourceFiles.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const hasMissingDiffs = aSourceFiles.some((c) => c.diff === undefined);
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

    // Extract added and removed lines separately for more precise analysis
    const addedLines = this.extractAddedLines(aDiffs);
    const removedLines = aDiffs
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'))
      .join('\n');

    // Dimension 1: Clear pattern choice (0/10/25)
    const ebStrength = this.measurePatternStrength(addedLines, 'eventbus');
    const cbStrength = this.measurePatternStrength(addedLines, 'callback');

    if ((ebStrength > 0 && cbStrength === 0) || (cbStrength > 0 && ebStrength === 0)) {
      score += 25;
      const chosenLabel = ebStrength > 0 ? 'EventBus' : 'CallbackRegistry';
      details.push(`Clear pattern choice: ${chosenLabel} only (25/25).`);
    } else if (ebStrength > 0 && cbStrength > 0 && Math.abs(ebStrength - cbStrength) >= 2) {
      score += 10;
      details.push(`Mostly unified pattern but traces of both (10/25).`);
    } else if (ebStrength > 0 && cbStrength > 0) {
      details.push(`Mixed patterns without clear dominance (0/25).`);
    } else {
      details.push(`No recognizable decoupling pattern in added code (0/25).`);
    }

    // Dimension 2: Anti-pattern avoidance (0/15)
    const usedAntiPattern = decouplingDecision.antiPatterns.some(
      (p) => new RegExp(p).test(addedLines),
    );
    if (!usedAntiPattern) {
      score += 15;
      details.push('No anti-patterns detected (15/15).');
    } else {
      details.push('Anti-patterns found in added code (0/15).');
    }

    // Dimension 3: Decision documentation (0/5/10/20)
    const docFiles = transcriptA.fileChanges.filter((c) => /\.md$/i.test(c.path));
    const hasDocFile = docFiles.length > 0;
    const docDiffs = docFiles.map((c) => c.diff ?? '').join('\n');
    const hasRationale = /(?:because|trade-?off|advantage|disadvantage|chose.*over|prefer.*over|reason|rationale)/i.test(docDiffs);
    const hasRationaleInCode = /(?:because|trade-?off|chose.*over|prefer.*over|rationale)/i.test(addedLines);

    if (hasDocFile && hasRationale) {
      score += 20;
      details.push('Documented decision with rationale in dedicated file (20/20).');
    } else if (hasDocFile || hasRationaleInCode) {
      score += 10;
      details.push(`${hasDocFile ? 'Doc file without rationale' : 'Rationale in code comments only'} (10/20).`);
    } else if (/(?:decision|architecture|approach)/i.test(addedLines)) {
      score += 5;
      details.push('Generic decision mention without rationale (5/20).');
    } else {
      details.push('No decision documentation found (0/20).');
    }

    // Dimension 4: Implementation scope (0/5/10/20)
    const relevantFilePaths = decouplingDecision.affectedFiles;
    const modifiedRelevantFiles = transcriptA.fileChanges.filter((c) =>
      relevantFilePaths.some((rf) => c.path.includes(rf.replace(/^src\//, ''))),
    );
    const relevantCount = modifiedRelevantFiles.length;

    if (relevantCount >= 3) {
      score += 20;
      details.push(`Modified ${relevantCount} relevant files — broad refactor (20/20).`);
    } else if (relevantCount === 2) {
      score += 10;
      details.push(`Modified ${relevantCount} relevant files — partial refactor (10/20).`);
    } else if (relevantCount === 1) {
      score += 5;
      details.push(`Modified ${relevantCount} relevant file — minimal refactor (5/20).`);
    } else {
      details.push('No relevant architectural files modified (0/20).');
    }

    // Dimension 5: Removal of old pattern (0/10/20)
    // Did A remove lines containing the rejected pattern?
    const chosenPattern = ebStrength >= cbStrength ? 'eventbus' : 'callback';
    const rejectedPattern = chosenPattern === 'eventbus' ? 'callback' : 'eventbus';
    const removedRejectedStrength = this.measurePatternStrength(removedLines, rejectedPattern);
    const addedChosenStrength = this.measurePatternStrength(addedLines, chosenPattern);

    if (addedChosenStrength > 0 && removedRejectedStrength > 0) {
      score += 20;
      details.push('Removed old pattern code and added new — full cleanup (20/20).');
    } else if (addedChosenStrength > 0) {
      score += 10;
      details.push('Added chosen pattern but did not remove old pattern code (10/20).');
    } else {
      details.push('No evidence of pattern cleanup (0/20).');
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
