/**
 * Sprint Simulation Scenario
 *
 * Simulates a 2-week sprint with 12 sequential sessions from 3 engineer personas.
 * Heterogeneous tasks (features, bug fixes, refactoring, requirement changes) build
 * on a shared codebase with accumulated decisions and cross-feature interference.
 *
 * Key differentiator: Session 8 introduces a requirement change that invalidates
 * an assumption from Session 3, testing whether coordination tools help agents
 * detect and adapt to changed assumptions.
 *
 * Task Flow:
 *  1. Alice: Design notification system (event-driven vs direct calls)
 *  2. Alice: Implement notification service + email adapter
 *  3. Bob:   Add user notification preferences (assumes email-only)
 *  4. Bob:   Fix pagination bug in user listing
 *  5. Carol: Extract shared validation logic into validators
 *  6. Alice: Add webhook notification adapter
 *  7. Bob:   Add notification history/audit log
 *  8. Carol: REQUIREMENT CHANGE — product says add SMS notifications
 *  9. Alice: Adapt preferences for multi-channel (must reconsider session 3)
 * 10. Bob:   Fix notification delivery ordering issue
 * 11. Carol: Integration tests for full notification pipeline
 * 12. Alice: Final review, fix issues, ensure consistency
 *
 * Scoring Dimensions:
 * - Decision Consistency (25%): Do later sessions respect earlier decisions?
 * - Assumption Handling (25%): Does session 9 reconsider session 3 after change?
 * - Cumulative Rework (20%): Total code churn across sessions (inverse).
 * - Context Recovery (15%): Do later engineers recover context efficiently?
 * - Final Quality (15%): Compiles, tests pass, consistent architecture.
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

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;

export const SPRINT_SIMULATION_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'sprint-simulation',
  description:
    'Expected outcome: Notification system with email + SMS + webhook adapters, user preferences supporting multi-channel, notification history, shared validation, all architecturally consistent.',
  decisions: [
    {
      id: 'notification-architecture',
      description: 'Session 1 chooses event-driven or direct-call notification pattern.',
      affectedFiles: [
        'src/services/notification.service.ts',
        'src/events/notification.events.ts',
        'src/events/event-bus.ts',
      ],
      expectedPatterns: [
        'EventBus|event-bus|emit|listener|subscribe|notify',
        'NotificationService|notification.*service',
      ],
      antiPatterns: [],
    },
    {
      id: 'email-adapter',
      description: 'Session 2 implements email notification adapter.',
      affectedFiles: [
        'src/adapters/email.adapter.ts',
        'src/services/notification.service.ts',
      ],
      expectedPatterns: [
        'email|Email',
        'adapter|Adapter',
        'send|deliver',
      ],
      antiPatterns: [],
    },
    {
      id: 'user-preferences',
      description: 'Session 3 adds user notification preferences (initially email-only).',
      affectedFiles: [
        'src/models/user-preferences.ts',
        'src/services/preferences.service.ts',
      ],
      expectedPatterns: [
        'preference|Preference',
        'notification.*setting|channel',
      ],
      antiPatterns: [],
    },
    {
      id: 'pagination-fix',
      description: 'Session 4 fixes pagination bug.',
      affectedFiles: [
        'src/utils/pagination.ts',
        'src/services/user.service.ts',
      ],
      expectedPatterns: [
        'offset|page|paginate',
      ],
      antiPatterns: [
        'offset\\s*-\\s*1',
      ],
    },
    {
      id: 'shared-validation',
      description: 'Session 5 extracts validation into shared validators.',
      affectedFiles: [
        'src/validators/',
        'src/services/',
      ],
      expectedPatterns: [
        'validat|Validat',
      ],
      antiPatterns: [],
    },
    {
      id: 'webhook-adapter',
      description: 'Session 6 adds webhook adapter following session 1 architecture.',
      affectedFiles: [
        'src/adapters/webhook.adapter.ts',
      ],
      expectedPatterns: [
        'webhook|Webhook',
        'adapter|Adapter',
      ],
      antiPatterns: [],
    },
    {
      id: 'notification-history',
      description: 'Session 7 adds notification audit log.',
      affectedFiles: [
        'src/services/notification-history.service.ts',
        'src/models/notification-log.ts',
      ],
      expectedPatterns: [
        'history|log|audit',
        'notification',
      ],
      antiPatterns: [],
    },
    {
      id: 'sms-requirement',
      description: 'Session 8 introduces SMS notification requirement.',
      affectedFiles: [
        'src/adapters/sms.adapter.ts',
      ],
      expectedPatterns: [
        'sms|SMS',
        'adapter|Adapter',
      ],
      antiPatterns: [],
    },
    {
      id: 'multi-channel-preferences',
      description: 'Session 9 updates preferences for multi-channel (email + SMS).',
      affectedFiles: [
        'src/models/user-preferences.ts',
        'src/services/preferences.service.ts',
      ],
      expectedPatterns: [
        'sms|SMS',
        'channel|channels',
        'preference|Preference',
      ],
      antiPatterns: [
        'email.*only|emailOnly',
      ],
    },
    {
      id: 'integration-tests',
      description: 'Session 11 adds integration tests.',
      affectedFiles: [
        'tests/integration/',
        'tests/notification.integration.test.ts',
      ],
      expectedPatterns: [
        'integration|e2e|end-to-end',
        'notification',
        'email|sms|webhook',
      ],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'services/notification': ['adapters/email', 'adapters/webhook', 'adapters/sms', 'events/event-bus'],
    'services/preferences': ['models/user-preferences'],
    'services/notification-history': ['models/notification-log'],
    'adapters/email': ['services/notification'],
    'adapters/webhook': ['services/notification'],
    'adapters/sms': ['services/notification'],
  },
  baselineTestCoverage: 60,
};

// --- Agent prompts ---

const CODEBASE_ORIENTATION = `## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files).

Directory structure:
\`\`\`
src/
  models/        # Data models and interfaces
  services/      # Business logic layer
  repositories/  # Data access layer
  utils/         # Shared utilities (database, logger, pagination)
  events/        # Event definitions (if using event-driven pattern)
  adapters/      # External service adapters (email, webhook, etc.)
  validators/    # Validation logic
  config/        # Configuration
tests/           # Test files mirroring src/ structure
\`\`\``;

const SESSION_PROMPTS: Array<{ prompt: string; role: string; engineer: string }> = [
  // Session 1: Alice — Design notification system
  {
    role: 'architect',
    engineer: 'Alice',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Design and implement the foundation of a notification system.

Specifically:
1. Choose an architecture for notifications: event-driven (EventBus with subscribers) OR direct service calls. Commit to ONE approach.
2. Define the notification service interface and core types (NotificationType, NotificationPayload, etc.) in src/services/ and src/models/.
3. Implement the base notification service with the chosen architecture.
4. Create an email notification adapter in src/adapters/email.adapter.ts (stub is fine, but interface must be real).
5. Document your architectural decision — the pattern you chose, why, and what constraints it imposes.
6. Make sure the codebase compiles.

Important:
- Pick ONE pattern (event-driven OR direct calls) and commit to it. Do not mix approaches.
- Define clear interfaces that other developers will implement against.
- Document constraints: e.g., "All adapters must implement NotificationAdapter interface" or "All notifications must go through EventBus.emit()".
- 11 more developers will build on your foundation.`,
  },
  // Session 2: Alice — Implement email adapter
  {
    role: 'implementer',
    engineer: 'Alice',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Implement the email notification adapter fully.

Specifically:
1. Check the existing notification architecture from the previous session (check src/services/, src/adapters/, src/events/, and any design docs).
2. Implement the email adapter with real logic: template rendering, recipient resolution, send method.
3. Wire the email adapter into the notification service following the established pattern.
4. Add basic unit tests for the email adapter.
5. Make sure the codebase compiles and tests pass.

Important:
- Follow the architecture from Session 1 exactly — do not change the notification pattern.
- The email adapter must conform to whatever adapter interface was defined.`,
  },
  // Session 3: Bob — User notification preferences (assumes email-only)
  {
    role: 'feature-developer',
    engineer: 'Bob',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Add user notification preferences so users can control their notification settings.

Specifically:
1. Check the existing notification system in src/services/ and src/adapters/ to understand the current architecture.
2. Create a user preferences model in src/models/user-preferences.ts with notification settings.
3. Implement a preferences service in src/services/preferences.service.ts.
4. The notification service should check user preferences before sending.
5. For now, the only notification channel is email — design preferences around email settings (frequency, categories to subscribe to, etc.).
6. Add tests for the preferences service.
7. Make sure the codebase compiles and tests pass.

Important:
- Currently email is the only notification channel. Design preferences for email settings.
- Follow the existing notification architecture — don't restructure it.
- Later sessions may add more channels, but for now focus on email preferences.`,
  },
  // Session 4: Bob — Fix pagination bug
  {
    role: 'bug-fixer',
    engineer: 'Bob',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Fix a pagination bug in the user listing endpoint.

Users report seeing duplicate items when navigating to page 2 of search results.

Specifically:
1. Check for any investigation notes or coordination context left by previous developers.
2. Investigate the pagination logic in src/utils/pagination.ts and src/services/user.service.ts.
3. The bug is likely an off-by-one error in the offset calculation.
4. Fix the bug with a minimal, targeted change.
5. Add a regression test that specifically catches this bug.
6. Make sure all existing tests still pass.

Important:
- Don't refactor unrelated code — keep the fix minimal.
- Add a regression test that would fail against the original buggy code.`,
  },
  // Session 5: Carol — Extract shared validation
  {
    role: 'refactorer',
    engineer: 'Carol',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Extract validation logic from service classes into dedicated validator modules.

Specifically:
1. Review the services in src/services/ to identify inline validation logic.
2. Create a src/validators/ directory with validator modules for each service that has inline validation.
3. Validators should be pure functions — no side effects, no database calls.
4. Update services to call validators instead of doing inline validation.
5. Add tests for the new validators.
6. Make sure all existing tests still pass after the refactoring.

Important:
- This is a refactoring — existing behavior must not change.
- Validators should be reusable across services.
- Follow existing code style and patterns.`,
  },
  // Session 6: Alice — Webhook adapter
  {
    role: 'implementer',
    engineer: 'Alice',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Add a webhook notification adapter to the notification system.

Specifically:
1. Review the existing notification architecture and email adapter in src/adapters/ and src/services/.
2. Implement a webhook adapter in src/adapters/webhook.adapter.ts that follows the same pattern as the email adapter.
3. The webhook adapter should: accept a URL, format the notification payload as JSON, and POST it.
4. Register the webhook adapter with the notification service.
5. Add unit tests for the webhook adapter.
6. Make sure the codebase compiles and all tests pass.

Important:
- Follow the SAME adapter pattern established for email — same interface, same registration approach.
- The webhook adapter must be consistent with the existing architecture.`,
  },
  // Session 7: Bob — Notification history
  {
    role: 'feature-developer',
    engineer: 'Bob',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Add notification history tracking so sent notifications are logged.

Specifically:
1. Review the notification service to understand how notifications are sent.
2. Create a notification log model in src/models/notification-log.ts.
3. Implement a notification history service in src/services/notification-history.service.ts.
4. Integrate with the notification service — every sent notification should be logged.
5. Add a way to query notification history (by user, by type, by date range).
6. Add tests for the history service.
7. Make sure the codebase compiles and all tests pass.

Important:
- Integrate with the existing notification flow — don't bypass it.
- The history should capture: recipient, channel, type, timestamp, delivery status.`,
  },
  // Session 8: Carol — REQUIREMENT CHANGE (SMS notifications)
  {
    role: 'requirement-changer',
    engineer: 'Carol',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

IMPORTANT CONTEXT: Product team has decided to add SMS notifications. This is a new requirement — the notification system was originally designed for email only, and user preferences were built assuming email-only channels.

Your task: Add SMS notification support and flag any assumptions that need updating.

Specifically:
1. Review the existing notification architecture, adapters, and user preferences.
2. Implement an SMS adapter in src/adapters/sms.adapter.ts following the existing adapter pattern.
3. Register the SMS adapter with the notification service.
4. IMPORTANT: The user preferences model (from Session 3) assumed email-only. Flag this — the preferences need to be updated to support multiple channels. Document what needs to change.
5. If the previous developer recorded any decisions about "email-only" preferences, note that this assumption has changed.
6. Add tests for the SMS adapter.
7. Make sure the codebase compiles and all tests pass.

Important:
- Follow the existing adapter pattern exactly.
- Do NOT rewrite user preferences yourself — flag it for the next developer. Document what changed and why.
- Make it clear that the "email-only" assumption from the preferences design is no longer valid.`,
  },
  // Session 9: Alice — Adapt preferences for multi-channel
  {
    role: 'adapter',
    engineer: 'Alice',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Update user notification preferences to support multiple channels (email + SMS + webhook).

Specifically:
1. Check coordination context — the previous session (Session 8) added SMS support and flagged that user preferences need updating.
2. Review the current user preferences model and service from Session 3.
3. The original preferences assumed email-only. This assumption is no longer valid — SMS was added in Session 8.
4. Refactor the preferences model to support per-channel settings (email, SMS, webhook).
5. Update the preferences service to handle multi-channel preferences.
6. Update the notification service to check per-channel preferences before sending.
7. Update tests to cover multi-channel scenarios.
8. Make sure the codebase compiles and all tests pass.

Important:
- This is a conscious decision change — the email-only assumption from Session 3 is explicitly invalidated.
- Preserve backward compatibility where possible (existing email preferences should still work).
- Document the decision change and why.`,
  },
  // Session 10: Bob — Fix notification ordering
  {
    role: 'bug-fixer',
    engineer: 'Bob',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Fix a notification delivery ordering issue.

Users report that notifications sometimes arrive out of order — e.g., a "payment confirmed" notification arrives before the "order placed" notification.

Specifically:
1. Check for any prior coordination context about the notification architecture.
2. Investigate the notification service and how it dispatches to adapters.
3. The issue is likely in how concurrent notifications are handled — check if there's a queue or if notifications fire-and-forget.
4. Fix the ordering issue while maintaining the existing architecture.
5. Add a test that verifies notification ordering.
6. Make sure all tests pass.

Important:
- Understand the notification architecture before making changes — check decisions from Session 1.
- Keep the fix minimal — don't restructure the notification system.`,
  },
  // Session 11: Carol — Integration tests
  {
    role: 'qa-engineer',
    engineer: 'Carol',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Write integration tests for the full notification pipeline.

Specifically:
1. Review the full notification stack: service → adapters (email, SMS, webhook) → preferences → history.
2. Write integration tests that test end-to-end notification delivery through each channel.
3. Test scenarios:
   - Send email notification to user with email preferences enabled
   - Send SMS notification to user with SMS preferences enabled
   - Send webhook notification
   - Verify notifications are logged in history
   - Verify user preferences are respected (disabled channel = no notification)
   - Verify notification ordering
4. Fix any integration issues you discover.
5. Run ALL tests (unit + integration) and ensure they pass.

Important:
- Test the full pipeline, not individual components — those have unit tests already.
- If you find bugs, fix them but keep fixes minimal.`,
  },
  // Session 12: Alice — Final review and cleanup
  {
    role: 'reviewer',
    engineer: 'Alice',
    prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${CODEBASE_ORIENTATION}

Your task: Final review and cleanup of the notification system.

Specifically:
1. Review the full notification system built across 11 previous sessions.
2. Check architectural consistency — all adapters follow the same pattern, preferences support all channels, history captures all notifications.
3. Check for any remaining issues: compilation errors, failing tests, TODO comments, inconsistencies.
4. Fix any issues you find.
5. Ensure the codebase compiles and ALL tests pass.
6. Write a brief summary of the system architecture and any known limitations.

Important:
- This is the final session — everything should work.
- Focus on consistency and correctness, not new features.
- If you find architectural inconsistencies between sessions, fix them to follow the original design.`,
  },
];

export class SprintSimulationScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'sprint-simulation',
      description:
        'Simulates a 2-week sprint: 12 sessions, 3 engineers, heterogeneous tasks including a mid-sprint requirement change. Measures decision consistency, assumption handling, rework, context recovery, and final quality.',
      estimatedDurationMinutes: 180,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 12,
      scoringDimensions: [
        'decisionConsistency',
        'assumptionHandling',
        'cumulativeRework',
        'contextRecovery',
        'finalQuality',
      ],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return SESSION_PROMPTS.map((sp, i) => ({
      prompt: sp.prompt,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
      sequenceOrder: i,
      maxTurns: DEFAULT_MAX_TURNS,
      role: sp.role,
    }));
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return SPRINT_SIMULATION_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'sprint-simulation',
      sessionCount: 12,
      engineers: ['Alice', 'Bob', 'Carol'],
      requirementChangeSession: 8,
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    // Guard: if most sessions failed (0 tool calls), the iteration is invalid —
    // score 0 rather than producing misleading results (e.g., cumulativeRework=100
    // because no code changed).
    const workingSessions = rawResults.transcripts.filter((t) => t.toolCalls.length > 0);
    if (workingSessions.length < rawResults.transcripts.length * 0.5) {
      const failMsg = `${rawResults.transcripts.length - workingSessions.length}/${rawResults.transcripts.length} sessions failed (0 tool calls) — iteration invalid.`;
      const zeroScore: DimensionScore = { value: 0, confidence: 'high', method: 'automated', justification: failMsg };
      return {
        runId: '',
        scenario: 'sprint-simulation',
        condition: '',
        iteration: 0,
        scores: {
          decisionConsistency: zeroScore,
          assumptionHandling: zeroScore,
          cumulativeRework: zeroScore,
          contextRecovery: zeroScore,
          finalQuality: zeroScore,
        },
        metrics: this.extractMetrics(rawResults),
        composite: 0,
      };
    }

    const decisionConsistency = this.scoreDecisionConsistency(rawResults, groundTruth);
    const assumptionHandling = this.scoreAssumptionHandling(rawResults);
    const cumulativeRework = this.scoreCumulativeRework(rawResults);
    const contextRecovery = this.scoreContextRecovery(rawResults);

    let finalQuality: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, ARCHITECTURAL_COHERENCE_TEMPLATE, evalCtx);
      finalQuality = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      finalQuality = this.scoreFinalQualityAutomated(rawResults, groundTruth);
    }

    const scores: Record<string, DimensionScore> = {
      decisionConsistency,
      assumptionHandling,
      cumulativeRework,
      contextRecovery,
      finalQuality,
    };

    const composite =
      decisionConsistency.value * 0.25 +
      assumptionHandling.value * 0.25 +
      cumulativeRework.value * 0.20 +
      contextRecovery.value * 0.15 +
      finalQuality.value * 0.15;

    return {
      runId: '',
      scenario: 'sprint-simulation',
      condition: '',
      iteration: 0,
      scores,
      metrics: this.extractMetrics(rawResults),
      composite,
    };
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup
  }

  /**
   * Score decision consistency: Do sessions 6, 9, 10, 12 follow the notification
   * architecture established in session 1?
   *
   * Measures at 3 checkpoints (sessions 4, 8, 12) to produce a decay curve.
   */
  private scoreDecisionConsistency(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const session1 = rawResults.transcripts[0];
    if (!session1) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Session 1 did not produce a transcript.',
      };
    }

    // Detect which notification pattern Session 1 chose
    const s1Diffs = session1.fileChanges.map((c) => c.diff ?? '').join('\n').toLowerCase();
    const usesEventBus = /event[\s-]?bus|emit|listener|subscribe|pub[\s-]?sub/i.test(s1Diffs);
    const usesDirectCalls = /direct.*call|inject.*service|notification.*service\./i.test(s1Diffs);

    if (!usesEventBus && !usesDirectCalls) {
      return {
        value: 50,
        confidence: 'low',
        method: 'automated',
        justification: 'Could not detect notification pattern from Session 1 diffs.',
      };
    }

    const chosenPattern = usesEventBus ? 'event-driven' : 'direct-calls';
    const patternRegex = usesEventBus
      ? /event[\s-]?bus|\.emit\(|\.on\(|subscribe|listener/i
      : /notification.*service|service\.notify|service\.send/i;

    // Check adapter sessions (2, 6, 8) for pattern consistency
    const adapterSessions = [1, 5, 7]; // 0-indexed: sessions 2, 6, 8
    let consistentCount = 0;
    let checkedCount = 0;
    const details: string[] = [];

    for (const idx of adapterSessions) {
      const t = rawResults.transcripts[idx];
      if (!t) continue;
      checkedCount++;

      const diffs = t.fileChanges
        .filter((c) => !/.twining|COORDINATION|CONTEXT|coordination/i.test(c.path))
        .map((c) => c.diff ?? '').join('\n');
      if (patternRegex.test(diffs)) {
        consistentCount++;
      } else {
        details.push(`Session ${idx + 1} did not follow ${chosenPattern} pattern.`);
      }
    }

    // Also check sessions 9-12 for consistency
    for (let idx = 8; idx < Math.min(12, rawResults.transcripts.length); idx++) {
      const t = rawResults.transcripts[idx];
      if (!t) continue;
      checkedCount++;

      const diffs = t.fileChanges
        .filter((c) => !/.twining|COORDINATION|CONTEXT|coordination/i.test(c.path))
        .map((c) => c.diff ?? '').join('\n');
      if (diffs.length > 0 && patternRegex.test(diffs)) {
        consistentCount++;
      } else if (diffs.length > 0) {
        details.push(`Session ${idx + 1} did not follow ${chosenPattern} pattern.`);
      } else {
        // No diffs — doesn't count against
        checkedCount--;
      }
    }

    const score = checkedCount > 0 ? Math.round((consistentCount / checkedCount) * 100) : 50;

    return {
      value: score,
      confidence: checkedCount >= 3 ? 'medium' : 'low',
      method: 'automated',
      justification: details.length > 0
        ? `Pattern: ${chosenPattern}. ${consistentCount}/${checkedCount} sessions consistent. ${details.join(' ')}`
        : `Pattern: ${chosenPattern}. All ${checkedCount} checked sessions followed it consistently.`,
    };
  }

  /**
   * Score assumption handling: Does session 9 correctly handle the requirement
   * change from session 8?
   *
   * Outcome-only checks (no process/tool-usage credit):
   * 1. Did session 8's code surface the assumption change? (+30)
   * 2. Did session 9 update the preferences model for multi-channel? (+35)
   * 3. Did session 9 implement multi-channel routing end-to-end? (+35)
   */
  private scoreAssumptionHandling(rawResults: RawResults): DimensionScore {
    const session8 = rawResults.transcripts[7]; // 0-indexed
    const session9 = rawResults.transcripts[8];

    if (!session8 || !session9) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Sessions 8 or 9 did not produce transcripts.',
      };
    }

    let score = 0;
    const details: string[] = [];

    // --- Session 8: Did it IDENTIFY the assumption conflict? (+40) ---
    // Session 8's task is "add SMS support and flag assumptions that need updating."
    // A good response explicitly calls out that preferences were built for email-only.
    // We check tool call output text AND diffs for explicit assumption language.
    const s8Diffs = session8.fileChanges
      .filter((c) => !/.twining|COORDINATION|CONTEXT/i.test(c.path))
      .map((c) => c.diff ?? '').join('\n');
    const s8ToolText = session8.toolCalls
      .map((tc) => JSON.stringify(tc.parameters)).join('\n');
    const s8Combined = s8Diffs + '\n' + s8ToolText;

    // Strong signal: explicit mention of the assumption conflict
    const explicitAssumptionFlag =
      /assum.*email.?only|email.?only.*assum|preferences?.*(need|require|must).*(updat|chang|refactor|extend)|single.?channel.*assum|hardcoded.*email/i.test(s8Combined);
    // Weak signal: just mentions preferences need work alongside SMS
    const weakAssumptionFlag =
      /preference.*multi|preference.*sms|preference.*channel|update.*preference/i.test(s8Combined) &&
      !explicitAssumptionFlag;

    if (explicitAssumptionFlag) {
      score += 40;
      details.push('Session 8 explicitly flagged the email-only assumption.');
    } else if (weakAssumptionFlag) {
      score += 15;
      details.push('Session 8 mentioned preference updates but did not explicitly flag the assumption conflict.');
    } else {
      details.push('Session 8 did NOT flag any assumption about email-only design.');
    }

    // --- Session 9: Did it RESTRUCTURE preferences for multi-channel? (+35) ---
    // Not just "does the diff mention SMS" but did the preferences model actually
    // change from email-centric to channel-generic?
    const s9PrefDiffs = session9.fileChanges
      .filter((c) => /preference/i.test(c.path) && !/.twining|COORDINATION|CONTEXT/i.test(c.path))
      .map((c) => c.diff ?? '').join('\n');
    const s9AllDiffs = session9.fileChanges
      .filter((c) => !/.twining|COORDINATION|CONTEXT/i.test(c.path))
      .map((c) => c.diff ?? '').join('\n');

    // Strong: preferences model changed to support channel types (not just email fields)
    const prefRestructured =
      /channel.*type|NotificationChannel|ChannelPreference|channels?\s*[.:=]\s*\[|Map<.*channel/i.test(s9PrefDiffs) &&
      s9PrefDiffs.length > 100; // must be a substantive change, not a comment
    // Weak: preferences file touched but only minor additions
    const prefTouched = s9PrefDiffs.length > 20 && /sms|channel/i.test(s9PrefDiffs);

    if (prefRestructured) {
      score += 35;
      details.push('Session 9 restructured preferences model for multi-channel.');
    } else if (prefTouched) {
      score += 15;
      details.push('Session 9 touched preferences but did not restructure for multi-channel.');
    } else {
      details.push('Session 9 did NOT update preferences model.');
    }

    // --- Session 9: End-to-end multi-channel routing? (+25) ---
    // Check for channel dispatch logic that actually routes based on preference
    const hasPreferenceBasedRouting =
      /preference.*channel|channel.*preference|getPreferred|channelFor/i.test(s9AllDiffs) &&
      /switch|if.*channel|forEach.*channel|map.*channel/i.test(s9AllDiffs);
    const hasBasicMultiChannel =
      /sms/i.test(s9AllDiffs) && /webhook|push|slack/i.test(s9AllDiffs);

    if (hasPreferenceBasedRouting) {
      score += 25;
      details.push('Session 9 implemented preference-based channel routing.');
    } else if (hasBasicMultiChannel) {
      score += 10;
      details.push('Session 9 added multiple channels but without preference-based routing.');
    } else {
      details.push('Session 9 did NOT implement multi-channel routing.');
    }

    return {
      value: score,
      confidence: score > 50 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score cumulative rework: How much code from earlier sessions gets deleted
   * or rewritten in later sessions?
   *
   * Uses file-level rework ratio only. No cross-session overlap penalty —
   * coordination enables informed cross-file modification, which should not
   * be penalized. Trivial lines (imports, braces, comments) are excluded
   * to focus on substantive rework.
   */
  private scoreCumulativeRework(rawResults: RawResults): DimensionScore {
    const transcripts = rawResults.transcripts;
    if (transcripts.length < 2) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Fewer than 2 sessions completed.',
      };
    }

    // Filter trivial lines that are commonly reorganized, not "reworked"
    const isTrivialLine = (path: string, line: string): boolean =>
      /^\s*$/.test(line) ||           // blank
      /^\s*[{}]\s*$/.test(line) ||    // lone braces
      /^\s*import\s/.test(line) ||    // import statements
      /^\s*\/\//.test(line) ||        // comments
      /^\s*\*/.test(line) ||          // JSDoc lines
      /\.twining\/|COORDINATION|CONTEXT\.md|DECISIONS|DESIGN/i.test(path); // coordination artifacts

    // Track all files each session added lines to
    const cumulativeFiles = new Map<string, number>(); // path → substantive lines added
    let totalReworkedLines = 0;
    let totalAddedLines = 0;

    for (let i = 0; i < transcripts.length; i++) {
      const t = transcripts[i];
      if (!t) continue;

      for (const fc of t.fileChanges) {
        // Count substantive lines from diff content when available
        const diff = fc.diff ?? '';
        const addedLines = diff.split('\n')
          .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
          .map((line) => line.slice(1))
          .filter((line) => !isTrivialLine(fc.path, line));
        const removedLines = diff.split('\n')
          .filter((line) => line.startsWith('-') && !line.startsWith('---'))
          .map((line) => line.slice(1))
          .filter((line) => !isTrivialLine(fc.path, line));

        // Lines removed from files created/modified by earlier sessions = rework
        if (i > 0 && cumulativeFiles.has(fc.path)) {
          totalReworkedLines += removedLines.length;
        }

        // Track cumulative additions
        const prev = cumulativeFiles.get(fc.path) ?? 0;
        cumulativeFiles.set(fc.path, prev + addedLines.length);
        totalAddedLines += addedLines.length;
      }
    }

    if (totalAddedLines === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No substantive code was added across all sessions.',
      };
    }

    const reworkRatio = Math.min(1, totalReworkedLines / totalAddedLines);
    // Linear with 6x amplifier: spreads well in 0-5% range
    // 0% → 100, 1% → 94, 2% → 88, 3% → 82, 5% → 70, 10% → 40
    const score = Math.max(0, Math.round(100 - reworkRatio * 600));

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification: `${totalReworkedLines} substantive lines reworked out of ${totalAddedLines} substantive lines added across ${transcripts.length} sessions. Rework ratio: ${(reworkRatio * 100).toFixed(1)}%.`,
    };
  }

  /**
   * Score context recovery: Do later sessions (8-12) efficiently pick up
   * context from earlier sessions without wasteful re-investigation?
   *
   * Combines process signal (did the session consult coordination context?)
   * with outcome signal (how efficiently did it get to productive work?).
   *
   * Per-session score (0-100):
   * - Coordination consultation (0-40): used coord tools/files before writing
   * - Efficiency ratio (0-35): fraction of tool calls that are productive (Write/Edit/Bash)
   *   vs. exploratory (Read/Glob/Grep). Higher = session already knew where to work.
   * - Time-to-first-write (0-25): how early in the session was the first Write/Edit?
   *   Earlier = recovered context faster.
   */
  private scoreContextRecovery(rawResults: RawResults): DimensionScore {
    // Focus on sessions 8-12 (the "second half" of the sprint)
    const laterSessions = rawResults.transcripts.slice(7);
    if (laterSessions.length === 0) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'No later sessions (8-12) completed.',
      };
    }

    let totalScore = 0;
    let checkedSessions = 0;
    const details: string[] = [];

    for (let i = 0; i < laterSessions.length; i++) {
      const t = laterSessions[i];
      if (!t || t.toolCalls.length === 0) continue;
      checkedSessions++;

      const sessionNum = i + 8;

      // --- Process signal (0-40): did session consult coordination context early? ---
      const earlyTools = t.toolCalls.slice(0, Math.max(1, Math.floor(t.toolCalls.length * 0.3)));

      const usedCoordTools = earlyTools.some((tc) =>
        /twining_assemble|twining_read|twining_recent|twining_query|twining_why/.test(tc.toolName),
      );
      const readCoordFiles = earlyTools.some((tc) =>
        tc.toolName === 'Read' &&
        /COORDINATION|CONTEXT|DESIGN|DECISIONS|\.twining/i.test(String(tc.parameters?.file_path ?? '')),
      );

      let processScore: number;
      if (usedCoordTools) {
        processScore = 40;
      } else if (readCoordFiles) {
        processScore = 30;
      } else {
        // Check pre-write reads as fallback
        const firstWriteIdx = t.toolCalls.findIndex((tc) =>
          /^(Write|Edit)$/i.test(tc.toolName),
        );
        const preWriteReads = (firstWriteIdx >= 0
          ? t.toolCalls.slice(0, firstWriteIdx)
          : t.toolCalls
        ).filter((tc) => tc.toolName === 'Read').length;
        processScore = Math.min(20, preWriteReads * 5);
      }

      // --- Outcome signal: efficiency ratio (0-35) ---
      // Productive calls: Write, Edit, Bash (actual work)
      // Exploratory calls: Read, Glob, Grep, ToolSearch (investigation)
      const productiveCalls = t.toolCalls.filter((tc) =>
        /^(Write|Edit|Bash)$/i.test(tc.toolName),
      ).length;
      const exploratoryCalls = t.toolCalls.filter((tc) =>
        /^(Read|Glob|Grep|ToolSearch)$/i.test(tc.toolName),
      ).length;
      const totalRelevant = productiveCalls + exploratoryCalls;

      // A well-informed session spends more time producing than exploring
      // Target: ~50% productive = good recovery (baseline with no context tends lower)
      const productiveRatio = totalRelevant > 0 ? productiveCalls / totalRelevant : 0;
      // Scale: 0% productive → 0, 30% → 18, 50% → 30, 70%+ → 35
      const efficiencyScore = Math.min(35, Math.round(productiveRatio * 50));

      // --- Outcome signal: time-to-first-write (0-25) ---
      const firstWriteIdx = t.toolCalls.findIndex((tc) =>
        /^(Write|Edit)$/i.test(tc.toolName),
      );
      let firstWriteScore: number;
      if (firstWriteIdx < 0) {
        firstWriteScore = 0; // Never wrote anything
      } else {
        // Fraction of session spent before first write (lower = better)
        const fractionBeforeWrite = firstWriteIdx / t.toolCalls.length;
        // 0% before write → 25, 20% → 20, 50% → 12.5, 80% → 5
        firstWriteScore = Math.round(25 * (1 - fractionBeforeWrite));
      }

      const sessionScore = processScore + efficiencyScore + firstWriteScore;
      totalScore += sessionScore;
      if (sessionScore < 60) {
        details.push(`Session ${sessionNum}: ${sessionScore} (process:${processScore} efficiency:${efficiencyScore} ttfw:${firstWriteScore}).`);
      }
    }

    const score = checkedSessions > 0 ? Math.round(totalScore / checkedSessions) : 0;

    return {
      value: score,
      confidence: checkedSessions >= 3 ? 'medium' : 'low',
      method: 'automated',
      justification: details.length > 0
        ? `Avg context recovery: ${score}. ${details.join(' ')}`
        : `All ${checkedSessions} later sessions recovered context effectively (avg: ${score}).`,
    };
  }

  /**
   * Automated final quality scoring when no LLM evaluator is available.
   *
   * Uses real test results (from rawResults.testResults) when available,
   * plus structural checks for component completeness and architecture consistency.
   *
   * Breakdown (100 pts):
   * - Compilation: 0-20 (binary)
   * - Test pass rate: 0-30 (proportional)
   * - Component completeness: 0-25 (per-component with diff verification)
   * - Architecture consistency: 0-15 (adapters follow same interface pattern)
   * - Multi-channel integration: 0-10 (channels wired into preferences)
   */
  private scoreFinalQualityAutomated(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const lastSession = rawResults.transcripts[rawResults.transcripts.length - 1];
    if (!lastSession) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Final session did not produce a transcript.',
      };
    }

    let score = 0;
    const details: string[] = [];

    // Collect all files and diffs across sessions
    const allFiles = new Set<string>();
    const allDiffs: string[] = [];
    for (const t of rawResults.transcripts) {
      for (const fc of t.fileChanges) {
        allFiles.add(fc.path);
        if (fc.diff) allDiffs.push(fc.diff);
      }
    }
    const combinedDiffs = allDiffs.join('\n');

    // 1. Compilation (0-15)
    if (rawResults.testResults) {
      if (rawResults.testResults.compiles) {
        score += 15;
        details.push('Compiles.');
      } else {
        details.push('Does NOT compile.');
      }
    } else {
      const ranTsc = lastSession.toolCalls.some((tc) =>
        tc.toolName === 'Bash' &&
        /tsc|npm run build|npm test/i.test(String(tc.parameters?.command ?? '')),
      );
      if (ranTsc) {
        score += 8;
        details.push('Final session ran build/tests (compilation unverified).');
      }
    }

    // 2. Test pass rate (0-20)
    if (rawResults.testResults) {
      const { pass, fail } = rawResults.testResults;
      const total = pass + fail;
      if (total > 0) {
        const passRate = pass / total;
        const testScore = Math.round(passRate * 20);
        score += testScore;
        details.push(`Tests: ${pass}/${total} pass (${Math.round(passRate * 100)}%).`);
      } else {
        details.push('No tests found.');
      }
    } else {
      const ranTests = lastSession.toolCalls.some((tc) =>
        tc.toolName === 'Bash' &&
        /npm test|vitest|jest/i.test(String(tc.parameters?.command ?? '')),
      );
      if (ranTests) {
        score += 7;
        details.push('Final session ran tests (results unavailable).');
      }
    }

    // 3. Component completeness (0-20)
    const expectedComponents = [
      { id: 'notification-service', filePattern: /notification.*service/i, diffPattern: /class\s+\w*Notification\w*Service|notification.*service/i },
      { id: 'email-adapter', filePattern: /email.*adapter|adapter.*email/i, diffPattern: /class\s+\w*Email\w*Adapter|implements\s+\w*Adapter/i },
      { id: 'sms-adapter', filePattern: /sms.*adapter|adapter.*sms/i, diffPattern: /class\s+\w*Sms\w*Adapter|class\s+\w*SMS\w*Adapter/i },
      { id: 'webhook-adapter', filePattern: /webhook.*adapter|adapter.*webhook/i, diffPattern: /class\s+\w*Webhook\w*Adapter/i },
      { id: 'preferences', filePattern: /preference/i, diffPattern: /class\s+\w*Preference|interface\s+\w*Preference|channel/i },
    ];

    let componentsFound = 0;
    for (const comp of expectedComponents) {
      const fileExists = [...allFiles].some((f) => comp.filePattern.test(f));
      const hasDiffEvidence = comp.diffPattern.test(combinedDiffs);
      if (fileExists && hasDiffEvidence) {
        componentsFound++;
      }
    }
    const componentScore = Math.round((componentsFound / expectedComponents.length) * 20);
    score += componentScore;
    details.push(`${componentsFound}/${expectedComponents.length} components verified in code.`);

    // 4. Architecture consistency (0-15) — do adapters follow the same interface?
    const adapterDiffs = allDiffs.filter((d) => /adapter/i.test(d)).join('\n');
    const implementsMatch = adapterDiffs.match(/implements\s+(\w+)/gi) ?? [];
    const interfaceNames = implementsMatch.map((m) => m.replace(/implements\s+/i, ''));
    const uniqueInterfaces = new Set(interfaceNames);

    if (interfaceNames.length >= 2 && uniqueInterfaces.size === 1) {
      score += 15;
      details.push(`Adapters share interface: ${[...uniqueInterfaces][0]}.`);
    } else if (interfaceNames.length >= 2 && uniqueInterfaces.size <= 2) {
      score += 8;
      details.push(`Adapters use ${uniqueInterfaces.size} different interfaces.`);
    } else if (interfaceNames.length >= 1) {
      score += 4;
      details.push('Only one adapter implements an interface.');
    } else {
      details.push('No adapter interface pattern detected.');
    }

    // 5. Test coverage depth (0-15) — test files per component
    const testFiles = [...allFiles].filter((f) => /test/i.test(f) && !/.twining|COORDINATION|CONTEXT/i.test(f));
    const componentTestPatterns = [
      { id: 'notification', pattern: /notification/i },
      { id: 'email-adapter', pattern: /email/i },
      { id: 'sms-adapter', pattern: /sms/i },
      { id: 'webhook-adapter', pattern: /webhook/i },
      { id: 'preferences', pattern: /preference/i },
      { id: 'validation', pattern: /validat/i },
      { id: 'pagination', pattern: /paginat/i },
    ];
    let testedComponents = 0;
    for (const comp of componentTestPatterns) {
      if (testFiles.some((f) => comp.pattern.test(f))) {
        testedComponents++;
      }
    }
    const coverageRatio = componentTestPatterns.length > 0 ? testedComponents / componentTestPatterns.length : 0;
    const coverageScore = Math.round(coverageRatio * 15);
    score += coverageScore;
    details.push(`${testedComponents}/${componentTestPatterns.length} components have test files.`);

    // 6. API surface consistency (0-15) — naming and export patterns
    const serviceFiles = [...allFiles].filter((f) => /service/i.test(f) && /^src\//i.test(f));
    const adapterFiles = [...allFiles].filter((f) => /adapter/i.test(f) && /^src\//i.test(f));

    const consistentServiceNaming = serviceFiles.length > 0 &&
      serviceFiles.every((f) => /\.service\.(ts|js)$/i.test(f));
    const consistentAdapterNaming = adapterFiles.length > 0 &&
      adapterFiles.every((f) => /\.adapter\.(ts|js)$/i.test(f));

    const hasExportedTypes = /export\s+(interface|type)\s+\w+/i.test(combinedDiffs);
    const adapterMethods = adapterDiffs.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g) ?? [];
    const methodNames = adapterMethods.map((m) => m.match(/(\w+)\s*\(/)?.[1]).filter(Boolean);
    const hasSendMethod = methodNames.filter((n) => /^send$/i.test(n!)).length;

    let apiScore = 0;
    if (consistentServiceNaming) apiScore += 4;
    if (consistentAdapterNaming) apiScore += 4;
    if (hasExportedTypes) apiScore += 4;
    if (hasSendMethod >= 2) apiScore += 3;
    score += apiScore;
    details.push(`API consistency: ${apiScore}/15 (naming=${consistentServiceNaming && consistentAdapterNaming ? 'consistent' : 'mixed'}, types=${hasExportedTypes ? 'exported' : 'implicit'}, methods=${hasSendMethod >= 2 ? 'consistent' : 'varied'}).`);

    return {
      value: Math.min(100, score),
      confidence: rawResults.testResults ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }
}

export function createSprintSimulationScenario(): SprintSimulationScenario {
  return new SprintSimulationScenario();
}
