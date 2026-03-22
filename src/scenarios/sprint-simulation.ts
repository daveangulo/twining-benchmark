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

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
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
   * Checks:
   * 1. Did session 8 flag the email-only assumption? (+30)
   * 2. Did session 9 read coordination context before modifying preferences? (+20)
   * 3. Did session 9 update the preferences model to support multi-channel? (+30)
   * 4. Did session 9 document the decision change? (+20)
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

    // 1. Did session 8 flag the email-only assumption? (+30)
    const s8Text = [
      ...session8.toolCalls.map((tc) => JSON.stringify(tc.parameters)),
      ...session8.fileChanges.map((c) => c.diff ?? ''),
    ].join('\n').toLowerCase();

    const flaggedAssumption =
      /email.?only.*assumption|assumption.*email|preference.*need.*update|no longer.*email.?only/i.test(s8Text) ||
      session8.toolCalls.some((tc) =>
        /twining.*post|twining.*decide/.test(tc.toolName) &&
        /assumption|email.?only|preference.*change|channel/i.test(JSON.stringify(tc.parameters)),
      );

    if (flaggedAssumption) {
      score += 30;
      details.push('Session 8 flagged the email-only assumption change.');
    } else {
      details.push('Session 8 did NOT flag the assumption change.');
    }

    // 2. Did session 9 read coordination context before modifying? (+20)
    const s9EarlyTools = session9.toolCalls.slice(0, Math.floor(session9.toolCalls.length * 0.3));
    const s9ReadsContext = s9EarlyTools.some((tc) =>
      /twining_assemble|twining_read|twining_recent|twining_query/.test(tc.toolName) ||
      (tc.toolName === 'Read' && /COORDINATION|CONTEXT|DESIGN|DECISIONS|\.twining/i.test(
        String(tc.parameters?.file_path ?? ''),
      )),
    );

    if (s9ReadsContext) {
      score += 20;
      details.push('Session 9 checked coordination context before modifying preferences.');
    } else {
      details.push('Session 9 did not check coordination context first.');
    }

    // 3. Did session 9 update preferences for multi-channel? (+30)
    const s9Diffs = session9.fileChanges.map((c) => c.diff ?? '').join('\n');
    const s9Files = session9.fileChanges.map((c) => c.path).join(' ');

    const updatedPreferences =
      /preference/i.test(s9Files) &&
      /sms|SMS|channel|channels|multi/i.test(s9Diffs);

    if (updatedPreferences) {
      score += 30;
      details.push('Session 9 updated preferences model for multi-channel support.');
    } else {
      details.push('Session 9 did NOT update preferences for multi-channel.');
    }

    // 4. Did session 9 document the decision change? (+20)
    const s9DocumentedChange = session9.toolCalls.some((tc) =>
      /twining.*decide|twining.*post/.test(tc.toolName) &&
      /sms|channel|preference|assumption|override|supersede/i.test(JSON.stringify(tc.parameters)),
    ) || session9.fileChanges.some((c) =>
      /COORDINATION|DESIGN|DECISIONS|CONTEXT/i.test(c.path),
    );

    if (s9DocumentedChange) {
      score += 20;
      details.push('Session 9 documented the decision change.');
    } else {
      details.push('Session 9 did NOT document the decision change.');
    }

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score cumulative rework: How much code from earlier sessions gets deleted
   * or rewritten in later sessions?
   *
   * Combines file-level rework and investigation overlap, measured at
   * checkpoints to produce a decay curve.
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

    // Track all files each session added lines to
    const cumulativeFiles = new Map<string, number>(); // path → lines added
    let totalReworkedLines = 0;
    let totalAddedLines = 0;

    for (let i = 0; i < transcripts.length; i++) {
      const t = transcripts[i];
      if (!t) continue;

      for (const fc of t.fileChanges) {
        // Lines removed from files created/modified by earlier sessions = rework
        if (i > 0 && cumulativeFiles.has(fc.path)) {
          totalReworkedLines += fc.linesRemoved;
        }

        // Track cumulative additions
        const prev = cumulativeFiles.get(fc.path) ?? 0;
        cumulativeFiles.set(fc.path, prev + fc.linesAdded);
        totalAddedLines += fc.linesAdded;
      }
    }

    if (totalAddedLines === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No code was added across all sessions.',
      };
    }

    const reworkRatio = Math.min(1, totalReworkedLines / totalAddedLines);
    // Steeper curve: 5% rework = 85, 10% = 70, 20% = 40, 30% = 10
    const reworkScore = Math.max(0, Math.round(100 * Math.pow(1 - reworkRatio, 3)));

    // Track file overlap between non-consecutive sessions
    const fileFirstSeen = new Map<string, number>();
    let crossSessionOverlap = 0;
    for (let i = 0; i < transcripts.length; i++) {
      const t = transcripts[i];
      if (!t) continue;
      for (const fc of t.fileChanges) {
        const firstSeen = fileFirstSeen.get(fc.path);
        if (firstSeen !== undefined && firstSeen < i - 1) {
          // File modified by a non-adjacent session — coordination needed
          crossSessionOverlap++;
        }
        if (firstSeen === undefined) {
          fileFirstSeen.set(fc.path, i);
        }
      }
    }
    // Penalize cross-session overlap (each overlap reduces score by 2 points)
    const overlapPenalty = Math.min(20, crossSessionOverlap * 2);
    const score = Math.max(0, reworkScore - overlapPenalty);

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification: `${totalReworkedLines} lines reworked out of ${totalAddedLines} total lines added across ${transcripts.length} sessions. Rework ratio: ${(reworkRatio * 100).toFixed(1)}%. Cross-session file overlap: ${crossSessionOverlap} (penalty: ${overlapPenalty}).`,
    };
  }

  /**
   * Score context recovery: Do later sessions (8-12) efficiently pick up
   * context from earlier sessions without re-investigating?
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
      if (!t) continue;
      checkedSessions++;

      const sessionNum = i + 8;
      let sessionScore = 0;

      // Did this session use coordination tools early?
      const earlyTools = t.toolCalls.slice(0, Math.max(1, Math.floor(t.toolCalls.length * 0.3)));
      const usedCoordTools = earlyTools.some((tc) =>
        /twining_assemble|twining_read|twining_recent|twining_query|twining_why/.test(tc.toolName),
      );
      const readCoordFiles = earlyTools.some((tc) =>
        tc.toolName === 'Read' &&
        /COORDINATION|CONTEXT|DESIGN|DECISIONS|\.twining/i.test(String(tc.parameters?.file_path ?? '')),
      );

      if (usedCoordTools) {
        sessionScore = 100;
      } else if (readCoordFiles) {
        sessionScore = 80;
      } else {
        // Check if session read any files from earlier sessions before writing
        const firstWriteIdx = t.toolCalls.findIndex((tc) =>
          /^(Write|Edit)$/i.test(tc.toolName),
        );
        const preWriteReads = (firstWriteIdx >= 0
          ? t.toolCalls.slice(0, firstWriteIdx)
          : t.toolCalls
        ).filter((tc) => tc.toolName === 'Read').length;

        sessionScore = Math.min(70, preWriteReads * 10);
      }

      totalScore += sessionScore;
      if (sessionScore < 70) {
        details.push(`Session ${sessionNum}: low context recovery (${sessionScore}).`);
      }
    }

    const score = checkedSessions > 0 ? Math.round(totalScore / checkedSessions) : 0;

    return {
      value: score,
      confidence: checkedSessions >= 3 ? 'medium' : 'low',
      method: 'automated',
      justification: details.length > 0
        ? `Average context recovery across sessions 8-12: ${score}. ${details.join(' ')}`
        : `All ${checkedSessions} later sessions recovered context effectively (avg: ${score}).`,
    };
  }

  /**
   * Automated final quality scoring when no LLM evaluator is available.
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

    // Check if tests pass (look for test run in last session)
    const ranTests = lastSession.toolCalls.some((tc) =>
      tc.toolName === 'Bash' &&
      /npm test|vitest|jest/i.test(String(tc.parameters?.command ?? '')),
    );
    if (ranTests) {
      score += 30;
      details.push('Final session ran tests.');
    }

    // Check final state has all expected components
    const allFiles = new Set<string>();
    for (const t of rawResults.transcripts) {
      for (const fc of t.fileChanges) {
        allFiles.add(fc.path);
      }
    }

    // Check for key ground truth components
    const expectedComponents = [
      { id: 'notification-service', pattern: /notification.*service/i },
      { id: 'email-adapter', pattern: /email.*adapter|adapter.*email/i },
      { id: 'sms-adapter', pattern: /sms.*adapter|adapter.*sms/i },
      { id: 'webhook-adapter', pattern: /webhook.*adapter|adapter.*webhook/i },
      { id: 'preferences', pattern: /preference/i },
      { id: 'history', pattern: /history|log.*notification|notification.*log/i },
      { id: 'tests', pattern: /test/i },
    ];

    let componentsFound = 0;
    for (const comp of expectedComponents) {
      const found = [...allFiles].some((f) => comp.pattern.test(f));
      if (found) componentsFound++;
    }

    const componentScore = Math.round((componentsFound / expectedComponents.length) * 50);
    score += componentScore;
    details.push(`${componentsFound}/${expectedComponents.length} expected components present.`);

    // Check for multi-channel support in final state
    const allDiffs = rawResults.transcripts.flatMap((t) =>
      t.fileChanges.map((c) => c.diff ?? ''),
    ).join('\n');

    if (/sms|SMS/.test(allDiffs) && /email|Email/.test(allDiffs) && /webhook|Webhook/.test(allDiffs)) {
      score += 20;
      details.push('Multi-channel support (email + SMS + webhook) present.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }
}

export function createSprintSimulationScenario(): SprintSimulationScenario {
  return new SprintSimulationScenario();
}
