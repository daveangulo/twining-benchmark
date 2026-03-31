# Benchmark Harness Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix scorer measurement bugs, add coordinationLift metric, and add 3 long-horizon scenarios to the Twining benchmark harness.

**Architecture:** Changes are in 3 independent areas: (1) fix existing scorers in architecture-cascade and bug-investigation, (2) add standalone quality scoring to BaseScenario + llm-judge for coordinationLift, (3) add 3 new scenario files following the existing BaseScenario pattern. All scenarios use the existing synthetic repo fixture.

**Tech Stack:** TypeScript, Vitest, Anthropic SDK (for LLM judge)

**Spec:** `docs/superpowers/specs/2026-03-13-benchmark-harness-improvements-design.md`

---

## Chunk 1: Scorer Fixes

### Task 1: Fix `decisionPropagation` scorer transcript fallback

**Files:**
- Modify: `src/scenarios/architecture-cascade.ts:413-477`
- Modify: `tests/unit/scenarios/architecture-cascade.test.ts`

- [ ] **Step 1: Write the failing test for transcript-based pattern detection**

Add to `tests/unit/scenarios/architecture-cascade.test.ts`:

```ts
describe('scoreDecisionPropagation with transcript fallback', () => {
  it('detects EventBus pattern from twining_decide tool calls when diffs have no pattern', async () => {
    await scenario.setup(makeWorkingDir(), makeConditionContext());

    // Agent A: no pattern in diffs, but twining_decide mentions EventBus
    const transcriptA = makeTranscript({
      taskIndex: 0,
      fileChanges: [{ path: 'src/events/event-bus.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 0 }],
      toolCalls: [{
        toolName: 'mcp__plugin_twining_twining__twining_decide',
        parameters: {
          summary: 'Unify notification system on EventBus pattern',
          rationale: 'EventBus provides better decoupling than CallbackRegistry',
          scope: 'src/events/',
        },
        timestamp: '2026-03-01T00:00:00Z',
        durationMs: 100,
      }],
    });

    // Agent B: uses EventBus pattern
    const transcriptB = makeTranscript({
      taskIndex: 1,
      fileChanges: [{
        path: 'src/notifications/email.ts',
        changeType: 'added',
        linesAdded: 50,
        linesRemoved: 0,
        diff: '+ import { EventBus } from "../events/event-bus";\n+ EventBus.subscribe("order.status"',
      }],
    });

    // Agent C: uses EventBus pattern
    const transcriptC = makeTranscript({
      taskIndex: 2,
      fileChanges: [{
        path: 'src/notifications/webhook.ts',
        changeType: 'added',
        linesAdded: 50,
        linesRemoved: 0,
        diff: '+ import { EventBus } from "../events/event-bus";\n+ EventBus.subscribe("order"',
      }],
    });

    const rawResults: RawResults = {
      transcripts: [transcriptA, transcriptB, transcriptC],
      finalWorkingDir: '/tmp/test-repo',
      allSessionsCompleted: true,
      errors: [],
    };

    const scored = await scenario.score(rawResults, ARCHITECTURE_CASCADE_GROUND_TRUTH);
    // Should detect EventBus from transcript, not return 0
    expect(scored.scores.decisionPropagation.value).toBeGreaterThan(0);
  });

  it('returns none when neither diffs nor transcript reveal a pattern', async () => {
    await scenario.setup(makeWorkingDir(), makeConditionContext());

    const transcriptA = makeTranscript({
      taskIndex: 0,
      fileChanges: [{ path: 'src/index.ts', changeType: 'modified', linesAdded: 1, linesRemoved: 0 }],
      toolCalls: [{
        toolName: 'mcp__plugin_twining_twining__twining_decide',
        parameters: {
          summary: 'Refactored the notification system',
          rationale: 'Improved code organization',
          scope: 'src/',
        },
        timestamp: '2026-03-01T00:00:00Z',
        durationMs: 100,
      }],
    });
    const transcriptB = makeTranscript({ taskIndex: 1 });
    const transcriptC = makeTranscript({ taskIndex: 2 });

    const rawResults: RawResults = {
      transcripts: [transcriptA, transcriptB, transcriptC],
      finalWorkingDir: '/tmp/test-repo',
      allSessionsCompleted: true,
      errors: [],
    };

    const scored = await scenario.score(rawResults, ARCHITECTURE_CASCADE_GROUND_TRUTH);
    expect(scored.scores.decisionPropagation.value).toBe(0);
    expect(scored.scores.decisionPropagation.confidence).toBe('low');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scenarios/architecture-cascade.test.ts --reporter verbose 2>&1 | tail -20`
Expected: FAIL — the new test expects `> 0` but current code returns 0 when diffs have no pattern.

- [ ] **Step 3: Add `detectPatternFromTranscript()` method to `ArchitectureCascadeScenario`**

Add this method to `src/scenarios/architecture-cascade.ts` after the existing `detectPatternChoice()` method:

```ts
/**
 * Detect architectural pattern choice from transcript tool calls.
 * Fallback for when git diffs don't contain pattern keywords
 * (e.g., when the agent records decisions in Twining rather than code comments).
 */
private detectPatternFromTranscript(
  transcript: AgentTranscript,
): 'eventbus' | 'callback' | 'mixed' | 'none' {
  const coordinationToolCalls = transcript.toolCalls.filter(
    (tc) => tc.toolName.includes('twining_decide') || tc.toolName.includes('twining_post'),
  );

  if (coordinationToolCalls.length === 0) return 'none';

  // Extract text from coordination tool parameters
  const texts: string[] = [];
  for (const tc of coordinationToolCalls) {
    const params = tc.parameters;
    if (typeof params.summary === 'string') texts.push(params.summary);
    if (typeof params.rationale === 'string') texts.push(params.rationale);
    if (typeof params.detail === 'string') texts.push(params.detail);
    if (typeof params.context === 'string') texts.push(params.context);
  }

  const combinedText = texts.join('\n');
  return this.detectPatternChoice(combinedText);
}
```

Import `AgentTranscript` type at the top of the file (add to existing import from `'../types/scenario.js'` or add new import from `'../types/transcript.js'`).

- [ ] **Step 4: Wire fallback into `scoreDecisionPropagation()`**

In `src/scenarios/architecture-cascade.ts`, in `scoreDecisionPropagation()`, after line ~467 where `aChoice === 'none'` is checked, add a fallback before returning 0:

Replace the block:
```ts
if (aChoice === 'none') {
  return {
    value: 0,
    confidence: 'low',
    method: 'automated',
    justification: 'Could not detect Agent A\'s architectural pattern choice from diffs.',
    dataQuality: aHasMissingDiffs ? 'partial' : 'complete',
  };
}
```

With:
```ts
if (aChoice === 'none') {
  // Fallback: check transcript tool calls (e.g., twining_decide parameters)
  const transcriptChoice = this.detectPatternFromTranscript(transcriptA);
  if (transcriptChoice === 'none' || transcriptChoice === 'mixed') {
    return {
      value: 0,
      confidence: 'low',
      method: 'automated',
      justification: aChoice === 'none' && transcriptChoice === 'none'
        ? 'Could not detect Agent A\'s architectural pattern choice from diffs or coordination tool calls.'
        : 'Agent A used a mix of EventBus and CallbackRegistry — did not make a clear choice.',
      dataQuality: aHasMissingDiffs ? 'partial' : 'complete',
    };
  }
  // Use transcript-detected pattern
  aChoice = transcriptChoice;
}
```

Note: `aChoice` must be changed from `const` to `let` at its declaration (~line 467).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/scenarios/architecture-cascade.test.ts --reporter verbose 2>&1 | tail -30`
Expected: All tests PASS, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios/architecture-cascade.ts tests/unit/scenarios/architecture-cascade.test.ts
git commit -m "fix: decisionPropagation scorer falls back to transcript tool calls when diffs lack pattern"
```

---

### Task 2: Smooth bug-investigation resolution scoring

**Files:**
- Modify: `src/scenarios/bug-investigation.ts:472-553`
- Modify: `tests/unit/scenarios/bug-investigation.test.ts`

- [ ] **Step 1: Write failing tests for the new partial-credit gradient**

Add to `tests/unit/scenarios/bug-investigation.test.ts`:

```ts
describe('resolution scoring gradient', () => {
  it('awards 15 for investigating bug file without modifying it', async () => {
    await scenario.setup(makeWorkingDir(), makeConditionContext());

    // Agent B reads the bug file but doesn't modify it
    const transcriptA = makeTranscript({ taskIndex: 0 });
    const transcriptB = makeTranscript({
      taskIndex: 1,
      fileChanges: [], // no file changes
      toolCalls: [{
        toolName: 'Read',
        parameters: { file_path: '/tmp/test-repo/src/utils/pagination.ts' },
        timestamp: '2026-03-01T00:00:00Z',
        durationMs: 50,
      }],
    });

    const rawResults: RawResults = {
      transcripts: [transcriptA, transcriptB],
      finalWorkingDir: '/tmp/test-repo',
      allSessionsCompleted: true,
      errors: [],
    };

    const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);
    expect(scored.scores.resolution.value).toBe(15);
  });

  it('awards 50 for fixing the bug without regression test', async () => {
    await scenario.setup(makeWorkingDir(), makeConditionContext());

    const transcriptA = makeTranscript({ taskIndex: 0 });
    const transcriptB = makeTranscript({
      taskIndex: 1,
      fileChanges: [{
        path: 'src/utils/pagination.ts',
        changeType: 'modified',
        linesAdded: 3,
        linesRemoved: 2,
        diff: '- const offset = (page - 1) * pageSize - 1;\n+ const offset = (page - 1) * pageSize;',
      }],
    });

    const rawResults: RawResults = {
      transcripts: [transcriptA, transcriptB],
      finalWorkingDir: '/tmp/test-repo',
      allSessionsCompleted: true,
      errors: [],
    };

    const scored = await scenario.score(rawResults, BUG_INVESTIGATION_GROUND_TRUTH);
    expect(scored.scores.resolution.value).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/scenarios/bug-investigation.test.ts --reporter verbose 2>&1 | tail -20`
Expected: FAIL — current scorer doesn't check tool calls for investigation credit or separate fix-without-test score.

- [ ] **Step 3: Rewrite `scoreResolution()` with partial credit gradient**

Replace the `scoreResolution()` method in `src/scenarios/bug-investigation.ts` with:

```ts
private scoreResolution(
  rawResults: RawResults,
  groundTruth: ArchitecturalManifest,
): DimensionScore {
  const transcriptB = rawResults.transcripts[1];

  if (!transcriptB) {
    return {
      value: 0,
      confidence: 'high',
      method: 'automated',
      justification: 'Agent B did not produce a transcript.',
    };
  }

  const bDiffs = transcriptB.fileChanges
    .map((c) => c.diff)
    .filter((d): d is string => d !== undefined)
    .join('\n');
  const hasMissingDiffs = transcriptB.fileChanges.some((c) => c.diff === undefined);
  const bFiles = transcriptB.fileChanges.map((c) => c.path);

  if (hasMissingDiffs && bDiffs.length === 0) {
    return {
      value: 0,
      confidence: 'low',
      method: 'automated',
      justification: 'No diff data available for scoring — git enrichment may have failed.',
      dataQuality: 'missing',
    };
  }

  const bugFix = groundTruth.decisions.find((d) => d.id === 'pagination-bug-fix');
  const regressionDecision = groundTruth.decisions.find((d) => d.id === 'regression-test');

  const details: string[] = [];

  // Check: Did B investigate the bug file (read it in tool calls)?
  const bugFilePatterns = bugFix?.affectedFiles ?? [];
  const investigatedBugFile = transcriptB.toolCalls.some((tc) => {
    if (tc.toolName !== 'Read' && tc.toolName !== 'Grep') return false;
    const filePath = String(tc.parameters.file_path ?? tc.parameters.path ?? '');
    return bugFilePatterns.some((f) => filePath.includes(f) || f.includes(filePath));
  });

  // Check: Was the bug file modified?
  const modifiedBugFile = bugFix
    ? bugFix.affectedFiles.some((f) => bFiles.some((bf) => bf.includes(f) || f.includes(bf)))
    : false;

  // Check: Does the fix match expected patterns?
  const hasFixPattern = bugFix
    ? bugFix.expectedPatterns.some((p) => new RegExp(p).test(bDiffs))
    : false;

  // Check: No anti-patterns in fix
  const hasAntiPattern = bugFix
    ? bugFix.antiPatterns.some((p) => new RegExp(p).test(bDiffs))
    : false;

  // Check: Was a regression test added?
  const hasTestFile = regressionDecision
    ? bFiles.some((f) => /test|spec/i.test(f))
    : false;

  // Gradient scoring:
  // 0:   No investigation, no changes
  // 15:  Investigated correct file but didn't modify it
  // 30:  Modified correct file but fix is wrong/incomplete
  // 50:  Fixed the bug (pattern match) but no regression test
  // 70:  Fixed + regression test
  // 85:  Fixed + regression test + no anti-patterns
  // 100: Fixed + regression test + no anti-patterns (ceiling)
  let score: number;

  if (!investigatedBugFile && !modifiedBugFile) {
    score = 0;
    details.push('Agent B did not investigate or modify the bug file.');
  } else if (investigatedBugFile && !modifiedBugFile) {
    score = 15;
    details.push('Agent B investigated the bug file but did not modify it.');
  } else if (modifiedBugFile && !hasFixPattern) {
    score = 30;
    details.push('Agent B modified the bug file but fix does not match expected pattern.');
  } else if (hasFixPattern && !hasTestFile) {
    score = 50;
    details.push('Agent B fixed the bug but did not add a regression test.');
  } else if (hasFixPattern && hasTestFile && hasAntiPattern) {
    score = 70;
    details.push('Agent B fixed the bug with regression test, but anti-pattern remains.');
  } else if (hasFixPattern && hasTestFile && !hasAntiPattern) {
    score = 85;
    details.push('Agent B fixed the bug with regression test and no anti-patterns.');
  } else {
    score = 30;
    details.push('Agent B modified the bug file (partial progress).');
  }

  return {
    value: Math.max(0, Math.min(100, score)),
    confidence: bDiffs.length > 0 ? 'medium' : 'low',
    method: 'automated',
    justification: details.join(' '),
    dataQuality: hasMissingDiffs ? 'partial' : 'complete',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/scenarios/bug-investigation.test.ts --reporter verbose 2>&1 | tail -30`
Expected: All tests PASS. Check that existing tests still pass — some may need score value adjustments since the scoring rubric changed.

- [ ] **Step 5: Fix any broken existing tests**

The existing tests may expect old score values (e.g., 30 for modifying bug file). Update expected values to match the new gradient. Review each failing test and adjust the expected `value` to match the new rubric.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios/bug-investigation.ts tests/unit/scenarios/bug-investigation.test.ts
git commit -m "fix: smooth bug-investigation resolution scoring to partial-credit gradient"
```

---

### Task 3: Add coordinationLift scoring to BaseScenario

**Files:**
- Modify: `src/scenarios/scenario.interface.ts`
- Modify: `src/analyzer/llm-judge.ts`
- Modify: `tests/unit/scenarios/scenario-interface.test.ts`

- [ ] **Step 1: Add standalone quality evaluation templates to `llm-judge.ts`**

Add these templates to `src/analyzer/llm-judge.ts` after the existing template definitions:

```ts
/**
 * Standalone quality templates — evaluate output independent of coordination.
 * Used for coordinationLift calculation.
 */
export const STANDALONE_CORRECTNESS_TEMPLATE: EvaluatorPromptTemplate = {
  name: 'standalone-correctness',
  template: `You are evaluating the correctness of code changes in a TypeScript project.

## Expected Architecture
{{GROUND_TRUTH}}

## Code Changes
{{CODE_DIFFS}}

Evaluate ONLY the correctness of the implementation:
- Does the code compile and follow TypeScript best practices?
- Are the algorithms and logic correct?
- Are edge cases handled?
Do NOT consider how well agents coordinated or whether work was duplicated.`,
  rubric: {
    dimensions: ['correctness'],
    levels: [
      { score: 90, description: 'Code is correct, handles edge cases, follows best practices' },
      { score: 70, description: 'Code is mostly correct with minor issues' },
      { score: 50, description: 'Code has significant correctness issues' },
      { score: 30, description: 'Code has major bugs or logic errors' },
      { score: 10, description: 'Code is fundamentally broken' },
    ],
  },
};

export const STANDALONE_COMPLETENESS_TEMPLATE: EvaluatorPromptTemplate = {
  name: 'standalone-completeness',
  template: `You are evaluating the completeness of code changes in a TypeScript project.

## Expected Architecture
{{GROUND_TRUTH}}

## Code Changes
{{CODE_DIFFS}}

Evaluate ONLY whether the implementation is complete:
- Are all required components present?
- Are all required methods/functions implemented?
- Are tests included?
Do NOT consider coordination, handoffs, or multi-agent workflow.`,
  rubric: {
    dimensions: ['completeness'],
    levels: [
      { score: 90, description: 'All required components present and fully implemented' },
      { score: 70, description: 'Most components present, some gaps' },
      { score: 50, description: 'Partial implementation, significant gaps' },
      { score: 30, description: 'Minimal implementation, most requirements missing' },
      { score: 10, description: 'Almost nothing implemented' },
    ],
  },
};
```

- [ ] **Step 2: Add `evaluateStandaloneQuality()` function to `llm-judge.ts`**

Add to `src/analyzer/llm-judge.ts`:

```ts
/**
 * Evaluate standalone quality of code output, independent of coordination.
 * Returns StandaloneScoreResult with correctness, architecturalSoundness,
 * maintainability, and completeness dimensions.
 */
export async function evaluateStandaloneQuality(
  client: Anthropic,
  rawResults: RawResults,
  groundTruth: ArchitecturalManifest,
): Promise<StandaloneScoreResult> {
  const context = buildEvaluationContextFromResults(rawResults, groundTruth);
  // Strip all coordination artifacts — evaluate code only
  const blindedContext = blindContext(context);

  const correctnessEval = await runSingleEvaluation(
    client,
    STANDALONE_CORRECTNESS_TEMPLATE,
    blindedContext,
    DEFAULT_JUDGE_CONFIG,
    { blindMode: true },
  );

  const completenessEval = await runSingleEvaluation(
    client,
    STANDALONE_COMPLETENESS_TEMPLATE,
    blindedContext,
    DEFAULT_JUDGE_CONFIG,
    { blindMode: true },
  );

  // Use ARCHITECTURAL_COHERENCE_TEMPLATE (already exists) for architectural soundness
  const architectureEval = await runSingleEvaluation(
    client,
    ARCHITECTURAL_COHERENCE_TEMPLATE,
    blindedContext,
    DEFAULT_JUDGE_CONFIG,
    { blindMode: true },
  );

  const correctness: DimensionScore = {
    value: correctnessEval.score,
    confidence: correctnessEval.confidence as ScoreConfidence,
    method: 'llm-judge',
    justification: correctnessEval.justification,
  };

  const architecturalSoundness: DimensionScore = {
    value: architectureEval.score,
    confidence: architectureEval.confidence as ScoreConfidence,
    method: 'llm-judge',
    justification: architectureEval.justification,
  };

  const maintainability: DimensionScore = {
    value: Math.round((correctnessEval.score + architectureEval.score) / 2),
    confidence: 'medium',
    method: 'llm-judge',
    justification: 'Derived from correctness and architectural soundness.',
  };

  const completeness: DimensionScore = {
    value: completenessEval.score,
    confidence: completenessEval.confidence as ScoreConfidence,
    method: 'llm-judge',
    justification: completenessEval.justification,
  };

  const composite = Math.round(
    (correctness.value + architecturalSoundness.value + maintainability.value + completeness.value) / 4,
  );

  return {
    correctness,
    architecturalSoundness,
    maintainability,
    completeness,
    composite,
  };
}
```

- [ ] **Step 3: Add `computeCoordinationLift()` helper to `BaseScenario`**

Add to `src/scenarios/scenario.interface.ts`, as a protected method on `BaseScenario`:

```ts
/**
 * Compute coordinationLift by evaluating standalone quality via LLM judge.
 * Returns undefined if no evaluator client is available.
 * This is a parallel metric — does not affect the primary composite score.
 */
protected async computeCoordinationLift(
  rawResults: RawResults,
  groundTruth: ArchitecturalManifest,
  coordinationComposite: number,
  evaluatorClient?: Anthropic,
): Promise<{ standaloneScores: StandaloneScoreResult; coordinationLift: CoordinationLift } | undefined> {
  if (!evaluatorClient) return undefined;

  try {
    const standaloneScores = await evaluateStandaloneQuality(
      evaluatorClient,
      rawResults,
      groundTruth,
    );

    const coordinationLift: CoordinationLift = {
      lift: coordinationComposite - standaloneScores.composite,
      coordinationScore: coordinationComposite,
      standaloneScore: standaloneScores.composite,
    };

    return { standaloneScores, coordinationLift };
  } catch {
    // LLM judge errors should never break scoring
    return undefined;
  }
}
```

Add the necessary imports at the top of `scenario.interface.ts`:
```ts
import type { StandaloneScoreResult, CoordinationLift } from '../types/results.js';
import { evaluateStandaloneQuality } from '../analyzer/llm-judge.js';
```

- [ ] **Step 4: Write a test for `computeCoordinationLift`**

Add to `tests/unit/scenarios/scenario-interface.test.ts`:

```ts
describe('computeCoordinationLift', () => {
  it('returns undefined when no evaluator client provided', async () => {
    // Create a concrete subclass for testing
    const scenario = createRefactoringHandoffScenario();
    await scenario.setup(makeWorkingDir(), makeConditionContext());

    const rawResults: RawResults = {
      transcripts: [makeTranscript()],
      finalWorkingDir: '/tmp/test-repo',
      allSessionsCompleted: true,
      errors: [],
    };

    const result = await (scenario as any).computeCoordinationLift(
      rawResults,
      { name: 'test', description: 'test', decisions: [], moduleDependencies: {}, baselineTestCoverage: 0 },
      75.0,
      undefined, // no evaluator client
    );

    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run tests/unit/scenarios/ --reporter verbose 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios/scenario.interface.ts src/analyzer/llm-judge.ts tests/unit/scenarios/scenario-interface.test.ts
git commit -m "feat: add coordinationLift scoring via standalone quality LLM judge evaluation"
```

---

## Chunk 2: New Scenarios — Type Registration

### Task 4: Register new scenario names in types and registry

**Files:**
- Modify: `src/types/scenario.ts:10-18`
- Modify: `src/scenarios/registry.ts`

- [ ] **Step 1: Add new scenario names to `ScenarioName` union**

In `src/types/scenario.ts`, extend the `ScenarioName` type:

```ts
export type ScenarioName =
  | 'refactoring-handoff'
  | 'architecture-cascade'
  | 'bug-investigation'
  | 'multi-session-build'
  | 'scale-stress-test'
  | 'conflict-resolution'
  | 'concurrent-agents'
  | 'context-recovery'
  | 'iterative-feature-build'
  | 'decision-volume-recovery'
  | 'evolving-requirements';
```

- [ ] **Step 2: Verify the project still compiles**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors (the registry doesn't reference these yet, so the union expansion is safe).

- [ ] **Step 3: Commit**

```bash
git add src/types/scenario.ts
git commit -m "feat: add 3 new scenario names to ScenarioName union"
```

---

## Chunk 3: New Scenario — `evolving-requirements`

### Task 5: Implement `evolving-requirements` scenario

This is the most fixture-compatible new scenario (uses existing notification/EventBus domain).

**Files:**
- Create: `src/scenarios/evolving-requirements.ts`
- Modify: `src/scenarios/registry.ts`
- Create: `tests/unit/scenarios/evolving-requirements.test.ts`

- [ ] **Step 1: Create the scenario file**

Create `src/scenarios/evolving-requirements.ts`. Follow the exact pattern of `context-recovery.ts` — extend `BaseScenario`, implement all 6 abstract methods:

```ts
/**
 * Evolving Requirements Scenario
 *
 * 4-session scenario where requirements change mid-stream:
 * 1. Agent A: Implement email notifications using EventBus
 * 2. Agent B: Add SMS + webhook channels following A's pattern
 * 3. Agent C: Refactor for priority-based routing (requirement change)
 * 4. Agent D: Add audit logging, preferences, integration tests
 *
 * Scoring Dimensions:
 * - requirementAdaptation (0.30): Does session 3 implement priority routing correctly?
 * - decisionEvolution (0.25): Did session 3 record the change? Did session 4 discover it?
 * - backwardCompatibility (0.25): Do sessions 1-2 channels still work after session 3?
 * - integrationCompleteness (0.20): Does session 4's output exercise the evolved architecture?
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type { ScenarioMetadata, AgentTask, RawResults } from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;

export const EVOLVING_REQUIREMENTS_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'evolving-requirements',
  description:
    'Expected outcome: Notification system with email/SMS/webhook channels, priority-based routing, audit logging, and user preferences.',
  decisions: [
    {
      id: 'notification-pattern',
      description: 'Agent A should implement email notifications using the EventBus pattern',
      affectedFiles: [
        'src/services/notification.service.ts',
        'src/events/event-bus.ts',
      ],
      expectedPatterns: ['EventBus', 'subscribe', 'emit|publish'],
      antiPatterns: [],
    },
    {
      id: 'additional-channels',
      description: 'Agent B adds SMS and webhook channels using same EventBus pattern',
      affectedFiles: [
        'src/notifications/sms-handler.ts',
        'src/notifications/webhook-handler.ts',
      ],
      expectedPatterns: ['EventBus', 'subscribe'],
      antiPatterns: ['CallbackRegistry'],
    },
    {
      id: 'priority-routing',
      description: 'Agent C adds priority-based routing: urgent→SMS, normal→email, low→webhook',
      affectedFiles: [
        'src/notifications/priority-router.ts',
        'src/services/notification.service.ts',
      ],
      expectedPatterns: ['priority|Priority', 'urgent|normal|low'],
      antiPatterns: [],
    },
    {
      id: 'audit-and-preferences',
      description: 'Agent D adds audit logging and notification preferences',
      affectedFiles: [
        'src/services/audit.service.ts',
        'src/services/notification-preferences.service.ts',
      ],
      expectedPatterns: ['audit|Audit', 'preference|Preference'],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'src/notifications/': ['src/events/event-bus.ts'],
  },
  baselineTestCoverage: 74,
};

export class EvolvingRequirementsScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'evolving-requirements',
      description:
        'Requirements change mid-stream. 4 agents build notifications, then adapt to priority routing. Tests decision evolution and backward compatibility.',
      estimatedDurationMinutes: 60,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 4,
      scoringDimensions: [
        'requirementAdaptation',
        'decisionEvolution',
        'backwardCompatibility',
        'integrationCompleteness',
      ],
      excludeFromAll: true, // Exclude from 'all' initially for cost control
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

Your task: Implement email notifications for order status changes using the EventBus pattern.

The codebase has an existing EventBus at src/events/event-bus.ts. Use it to:
1. Create an email notification handler that subscribes to order status change events
2. The handler should be in src/notifications/email-handler.ts
3. Update the notification service to emit events through the EventBus when order status changes
4. Add tests for the email handler
5. Document your architectural decision — other developers will build on this pattern

Follow existing code patterns. Keep all existing tests passing.`,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'initial-architect',
      },
      {
        prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

Your task: Add SMS and webhook notification channels, following the existing notification pattern.

Look at how the existing notification system works — use the same approach the codebase already uses.

1. Create src/notifications/sms-handler.ts — SMS notification handler
2. Create src/notifications/webhook-handler.ts — webhook notification handler
3. Both should integrate with the existing notification architecture
4. Add tests for both handlers
5. Keep all existing tests passing

Build on what's already there — respect the existing architecture and patterns.`,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'channel-extender',
      },
      {
        prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

REQUIREMENTS CHANGE: The notification system must now support priority-based routing.

New requirements:
- Urgent notifications → always sent via SMS
- Normal notifications → sent via email
- Low priority notifications → sent via webhook only

Your task:
1. Review the existing notification channels (email, SMS, webhook)
2. Add a priority routing layer that directs notifications to the correct channel based on priority
3. Create src/notifications/priority-router.ts
4. Update the notification service to use priority routing
5. Keep ALL existing channels working — do not break backward compatibility
6. Add tests for priority routing
7. Document this architectural change — this is a significant requirement evolution

IMPORTANT: The existing notification channels must continue to work. You are adding a routing layer on top, not replacing the channels.`,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
        sequenceOrder: 2,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'requirements-changer',
      },
      {
        prompt: `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

Your task: Add audit logging and notification preferences to the notification system.

1. Create src/services/audit.service.ts — log every notification sent (channel, recipient, timestamp, priority)
2. Create src/services/notification-preferences.service.ts — users can opt out of specific channels
3. The preferences service should be checked BEFORE sending — if a user has opted out of SMS, urgent notifications should fall back to email
4. Write integration tests that exercise the full notification flow: priority routing → preference check → channel delivery → audit log
5. Keep all existing tests passing

IMPORTANT: The system now has priority-based routing. Make sure your audit logging and preferences respect the current architecture including priority routing.`,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
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
    return { scenarioType: 'evolving-requirements' };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const metrics = this.extractMetrics(rawResults);

    const requirementAdaptation = this.scoreRequirementAdaptation(rawResults, groundTruth);
    const decisionEvolution = this.scoreDecisionEvolution(rawResults);
    const backwardCompatibility = this.scoreBackwardCompatibility(rawResults, groundTruth);
    const integrationCompleteness = this.scoreIntegrationCompleteness(rawResults, groundTruth);

    const composite = Math.round(
      requirementAdaptation.value * 0.30 +
      decisionEvolution.value * 0.25 +
      backwardCompatibility.value * 0.25 +
      integrationCompleteness.value * 0.20,
    );

    const scored: ScoredResults = {
      runId: '',
      scenario: 'evolving-requirements',
      condition: '',
      iteration: 0,
      scores: {
        requirementAdaptation,
        decisionEvolution,
        backwardCompatibility,
        integrationCompleteness,
      },
      metrics,
      composite,
    };

    // Compute coordinationLift if evaluator available
    const lift = await this.computeCoordinationLift(
      rawResults, groundTruth, composite, evaluatorClient,
    );
    if (lift) {
      scored.standaloneScores = lift.standaloneScores;
      scored.coordinationLift = lift.coordinationLift;
    }

    return scored;
  }

  protected async doTeardown(): Promise<void> {}

  /**
   * Score requirement adaptation: Did session 3 correctly implement priority routing?
   */
  private scoreRequirementAdaptation(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptC = rawResults.transcripts[2];
    if (!transcriptC) {
      return { value: 0, confidence: 'high', method: 'automated', justification: 'Agent C did not produce a transcript.' };
    }

    let score = 0;
    const details: string[] = [];

    const cDiffs = transcriptC.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const cFiles = transcriptC.fileChanges.map((c) => c.path);

    // Check for priority routing patterns
    const priorityDecision = groundTruth.decisions.find((d) => d.id === 'priority-routing');
    if (priorityDecision) {
      const hasRouter = cFiles.some((f) => f.includes('priority') || f.includes('router'));
      if (hasRouter) {
        score += 40;
        details.push('Priority router file created.');
      }

      const hasPriorityPatterns = priorityDecision.expectedPatterns.some(
        (p) => new RegExp(p, 'i').test(cDiffs),
      );
      if (hasPriorityPatterns) {
        score += 30;
        details.push('Priority routing patterns found in diffs.');
      }
    }

    // Check session 3 completed
    if (transcriptC.exitReason === 'completed') {
      score += 15;
      details.push('Agent C completed successfully.');
    }

    // Check for tests
    const hasTests = cFiles.some((f) => /test|spec/i.test(f));
    if (hasTests) {
      score += 15;
      details.push('Tests added for priority routing.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
      dataQuality: 'complete',
    };
  }

  /**
   * Score decision evolution: Did session 3 record the change? Did session 4 discover it?
   */
  private scoreDecisionEvolution(rawResults: RawResults): DimensionScore {
    const transcriptC = rawResults.transcripts[2];
    const transcriptD = rawResults.transcripts[3];
    if (!transcriptC || !transcriptD) {
      return { value: 0, confidence: 'high', method: 'automated', justification: 'Missing transcripts for agents C or D.' };
    }

    let score = 0;
    const details: string[] = [];

    // Did Agent C record the architectural change via coordination tools?
    const cCoordCalls = transcriptC.toolCalls.filter(
      (tc) => tc.toolName.includes('twining_decide') ||
              tc.toolName.includes('twining_post') ||
              tc.toolName.includes('COORDINATION') ||
              tc.toolName.includes('CONTEXT'),
    );
    if (cCoordCalls.length > 0) {
      score += 50;
      details.push(`Agent C made ${cCoordCalls.length} coordination tool calls.`);
    } else {
      // Check if C wrote coordination files
      const cFiles = transcriptC.fileChanges.map((c) => c.path);
      const wroteCoordFiles = cFiles.some(
        (f) => f.includes('COORDINATION') || f.includes('CONTEXT') || f.includes('decisions'),
      );
      if (wroteCoordFiles) {
        score += 30;
        details.push('Agent C wrote coordination files.');
      }
    }

    // Did Agent D discover the priority routing before writing code?
    const dToolCalls = transcriptD.toolCalls;
    const dFirstWriteIdx = dToolCalls.findIndex(
      (tc) => tc.toolName === 'Write' || tc.toolName === 'Edit',
    );
    const dEarlyPhase = dFirstWriteIdx > 0 ? dToolCalls.slice(0, dFirstWriteIdx) : dToolCalls.slice(0, Math.ceil(dToolCalls.length * 0.3));

    const dDiscoveredPriority = dEarlyPhase.some((tc) => {
      if (tc.toolName === 'Read') {
        const filePath = String(tc.parameters.file_path ?? '');
        return filePath.includes('priority') || filePath.includes('router');
      }
      return tc.toolName.includes('twining_assemble') || tc.toolName.includes('twining_recent');
    });

    if (dDiscoveredPriority) {
      score += 50;
      details.push('Agent D discovered priority routing before writing code.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score backward compatibility: Do sessions 1-2 channels still work after session 3?
   */
  private scoreBackwardCompatibility(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptC = rawResults.transcripts[2];
    if (!transcriptC) {
      return { value: 0, confidence: 'high', method: 'automated', justification: 'Agent C did not produce a transcript.' };
    }

    let score = 100; // Start at 100, deduct for breakage
    const details: string[] = [];

    const cDiffs = transcriptC.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');

    // Check that session 3 didn't delete/gut the email handler
    const channelDecision = groundTruth.decisions.find((d) => d.id === 'additional-channels');
    if (channelDecision) {
      for (const file of channelDecision.affectedFiles) {
        // If C's diffs show large deletions in channel files, penalize
        const fileChanges = transcriptC.fileChanges.filter(
          (fc) => fc.path.includes(file.split('/').pop()!),
        );
        for (const fc of fileChanges) {
          if (fc.linesRemoved > fc.linesAdded * 2) {
            score -= 25;
            details.push(`Agent C removed significantly more than added in ${fc.path}.`);
          }
        }
      }
    }

    // Check that EventBus pattern is preserved (not replaced)
    const notifDecision = groundTruth.decisions.find((d) => d.id === 'notification-pattern');
    if (notifDecision) {
      const hasAntiPattern = notifDecision.antiPatterns.some(
        (p) => new RegExp(p).test(cDiffs),
      );
      if (hasAntiPattern) {
        score -= 30;
        details.push('Agent C introduced anti-patterns in the notification system.');
      }
    }

    if (details.length === 0) {
      details.push('No backward compatibility issues detected.');
    }

    return {
      value: Math.max(0, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
      dataQuality: 'complete',
    };
  }

  /**
   * Score integration completeness: Does session 4 exercise the full evolved architecture?
   */
  private scoreIntegrationCompleteness(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptD = rawResults.transcripts[3];
    if (!transcriptD) {
      return { value: 0, confidence: 'high', method: 'automated', justification: 'Agent D did not produce a transcript.' };
    }

    let score = 0;
    const details: string[] = [];

    const dFiles = transcriptD.fileChanges.map((c) => c.path);
    const dDiffs = transcriptD.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');

    const auditDecision = groundTruth.decisions.find((d) => d.id === 'audit-and-preferences');
    if (auditDecision) {
      // Check for audit service
      const hasAudit = dFiles.some((f) => f.includes('audit'));
      if (hasAudit) {
        score += 25;
        details.push('Audit service created.');
      }

      // Check for preferences service
      const hasPreferences = dFiles.some((f) => f.includes('preference'));
      if (hasPreferences) {
        score += 25;
        details.push('Preferences service created.');
      }

      // Check for expected patterns
      const hasPatterns = auditDecision.expectedPatterns.some(
        (p) => new RegExp(p, 'i').test(dDiffs),
      );
      if (hasPatterns) {
        score += 25;
        details.push('Expected patterns found in implementation.');
      }
    }

    // Check for integration tests
    const hasIntegrationTests = dFiles.some(
      (f) => /test|spec/i.test(f) && (f.includes('integration') || f.includes('notification')),
    );
    if (hasIntegrationTests) {
      score += 25;
      details.push('Integration tests present.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
      dataQuality: 'complete',
    };
  }
}

export function createEvolvingRequirementsScenario(): EvolvingRequirementsScenario {
  return new EvolvingRequirementsScenario();
}
```

- [ ] **Step 2: Write tests for the scenario**

Create `tests/unit/scenarios/evolving-requirements.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EvolvingRequirementsScenario,
  EVOLVING_REQUIREMENTS_GROUND_TRUTH,
  createEvolvingRequirementsScenario,
} from '../../../src/scenarios/evolving-requirements.js';
import type { WorkingDirectory } from '../../../src/types/target.js';
import type { ConditionContext } from '../../../src/types/condition.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';
import type { RawResults } from '../../../src/types/scenario.js';

function makeWorkingDir(): WorkingDirectory {
  return { path: '/tmp/test-repo', gitDir: '/tmp/test-repo/.git', cleanup: async () => {} };
}

function makeConditionContext(): ConditionContext {
  return {
    agentConfig: { systemPrompt: '', mcpServers: {}, allowedTools: ['Read', 'Edit', 'Write', 'Bash'], permissionMode: 'acceptEdits' },
    setupFiles: [],
    metadata: { conditionName: 'baseline' },
  };
}

function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'test-session', runId: 'test-run', scenario: 'evolving-requirements', condition: 'baseline',
    taskIndex: 0, prompt: 'Test', toolCalls: [], fileChanges: [],
    tokenUsage: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0, total: 1500, costUsd: 0.01 },
    timing: { startTime: '2026-03-01T00:00:00Z', endTime: '2026-03-01T00:15:00Z', durationMs: 900000, timeToFirstActionMs: 10000 },
    exitReason: 'completed', numTurns: 5, stopReason: 'success', contextWindowSize: 200000, compactionCount: 0, turnUsage: [],
    ...overrides,
  };
}

describe('EvolvingRequirementsScenario', () => {
  let scenario: EvolvingRequirementsScenario;

  beforeEach(() => { scenario = new EvolvingRequirementsScenario(); });
  afterEach(async () => { await scenario.teardown(); });

  it('returns correct metadata', () => {
    const meta = scenario.getMetadata();
    expect(meta.name).toBe('evolving-requirements');
    expect(meta.agentSessionCount).toBe(4);
    expect(meta.excludeFromAll).toBe(true);
  });

  it('has 4 agent tasks', async () => {
    await scenario.setup(makeWorkingDir(), makeConditionContext());
    expect(scenario.getAgentTasks()).toHaveLength(4);
  });

  it('scores requirementAdaptation based on priority router creation', async () => {
    await scenario.setup(makeWorkingDir(), makeConditionContext());

    const rawResults: RawResults = {
      transcripts: [
        makeTranscript({ taskIndex: 0 }),
        makeTranscript({ taskIndex: 1 }),
        makeTranscript({
          taskIndex: 2,
          fileChanges: [
            { path: 'src/notifications/priority-router.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0,
              diff: '+ export class PriorityRouter {\n+ route(priority: "urgent" | "normal" | "low")' },
          ],
        }),
        makeTranscript({ taskIndex: 3 }),
      ],
      finalWorkingDir: '/tmp/test-repo', allSessionsCompleted: true, errors: [],
    };

    const scored = await scenario.score(rawResults, EVOLVING_REQUIREMENTS_GROUND_TRUTH);
    expect(scored.scores.requirementAdaptation.value).toBeGreaterThanOrEqual(70);
  });

  it('produces a factory function', () => {
    const s = createEvolvingRequirementsScenario();
    expect(s).toBeInstanceOf(EvolvingRequirementsScenario);
  });
});
```

- [ ] **Step 3: Register in the registry**

Add to `src/scenarios/registry.ts`:

Import:
```ts
import { createEvolvingRequirementsScenario } from './evolving-requirements.js';
```

Add entry to `SCENARIO_REGISTRY`:
```ts
'evolving-requirements': {
  metadata: {
    name: 'evolving-requirements',
    description: 'Requirements change mid-stream. 4 agents build notifications, then adapt to priority routing. Tests decision evolution and backward compatibility.',
    estimatedDurationMinutes: 60,
    requiredTargetType: 'service-with-dependency',
    agentSessionCount: 4,
    scoringDimensions: ['requirement-adaptation', 'decision-evolution', 'backward-compatibility', 'integration-completeness'],
    excludeFromAll: true,
  },
  create: () => createEvolvingRequirementsScenario(),
},
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/scenarios/evolving-requirements.test.ts --reporter verbose 2>&1 | tail -20`
Expected: All PASS.

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/evolving-requirements.ts src/scenarios/registry.ts tests/unit/scenarios/evolving-requirements.test.ts
git commit -m "feat: add evolving-requirements scenario (4-session, mid-stream requirement change)"
```

---

### Task 6: Implement `iterative-feature-build` scenario

**Files:**
- Create: `src/scenarios/iterative-feature-build.ts`
- Modify: `src/scenarios/registry.ts`
- Create: `tests/unit/scenarios/iterative-feature-build.test.ts`

Follow the exact same pattern as Task 5 but with 5 sessions, analytics domain, and the scoring dimensions from the spec:
- `architecturalDrift` (0.30)
- `layerIntegrity` (0.25)
- `decisionAccumulation` (0.25)
- `integrationCompleteness` (0.20)

- [ ] **Step 1: Create `src/scenarios/iterative-feature-build.ts`**

Structure: extend `BaseScenario`, 5 agent tasks (data modeler → repository → service → controller → integration), ground truth with analytics models pattern, scoring methods for each dimension. The prompts should reference `src/models/analytics.ts`, `src/repositories/analytics.repository.ts`, `src/services/analytics.service.ts`, `src/controllers/analytics.controller.ts`.

Key scoring logic:
- `architecturalDrift`: Check that session 5 diffs import from the analytics models/service (not redefining them). Penalize if session 1's model names aren't present in session 5's test imports.
- `layerIntegrity`: For each session's diffs, check import patterns. Controller should only import from service, service from repository, repository from models. Penalize cross-layer imports.
- `decisionAccumulation`: Count coordination tool calls and file reads of prior sessions' output files in the early phase of each session's transcript.
- `integrationCompleteness`: Check session 5 for test files that import from analytics controller/service.

- [ ] **Step 2: Write tests in `tests/unit/scenarios/iterative-feature-build.test.ts`**

Same pattern as evolving-requirements tests: metadata check, task count (5), one scoring check.

- [ ] **Step 3: Register in registry**

Add import and registry entry with `excludeFromAll: true`.

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run tests/unit/scenarios/iterative-feature-build.test.ts --reporter verbose && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/iterative-feature-build.ts src/scenarios/registry.ts tests/unit/scenarios/iterative-feature-build.test.ts
git commit -m "feat: add iterative-feature-build scenario (5-session layered analytics build)"
```

---

### Task 7: Implement `decision-volume-recovery` scenario

**Files:**
- Create: `src/scenarios/decision-volume-recovery.ts`
- Modify: `src/scenarios/registry.ts`
- Create: `tests/unit/scenarios/decision-volume-recovery.test.ts`

Follow the same pattern with 4 sessions, scoring dimensions from the spec:
- `decisionRecovery` (0.30)
- `patternCompliance` (0.30)
- `crossCuttingConsistency` (0.25)
- `retrievalPrecision` (0.15)

- [ ] **Step 1: Create `src/scenarios/decision-volume-recovery.ts`**

Structure: 4 agent tasks (comprehensive refactorer → cache builder → order feature builder → integration tester). Agent A's prompt should explicitly request 6 refactoring operations and documentation of each decision.

Key scoring logic:
- `decisionRecovery`: For agents B and C, check their first 30% of tool calls for reads of files that Agent A modified. Also check for coordination tool usage (assemble/recent/query).
- `patternCompliance`: Check B's and C's diffs for interface usage patterns (IUserRepository, IOrderRepository) and error handling patterns from A's refactoring.
- `crossCuttingConsistency`: Check Agent D's test files for imports from both B's caching code and C's order history code.
- `retrievalPrecision`: Ratio of relevant file reads to total file reads in orientation phase.

- [ ] **Step 2: Write tests in `tests/unit/scenarios/decision-volume-recovery.test.ts`**

- [ ] **Step 3: Register in registry with `excludeFromAll: true`**

- [ ] **Step 4: Run tests and type check**

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/decision-volume-recovery.ts src/scenarios/registry.ts tests/unit/scenarios/decision-volume-recovery.test.ts
git commit -m "feat: add decision-volume-recovery scenario (4-session, needle-in-haystack retrieval)"
```

---

### Task 8: Final validation

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter verbose 2>&1 | tail -40`
Expected: All tests pass.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify registry completeness**

Run: `npx vitest run tests/unit/scenarios/ --reporter verbose 2>&1 | grep -E '(PASS|FAIL|Tests)'`
Expected: All scenario test files pass.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A && git status
# Only commit if there are changes
```
