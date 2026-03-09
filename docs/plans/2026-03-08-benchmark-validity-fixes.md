# Benchmark Validity Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all known bugs, scoring methodology biases, and missing experimental controls; add high-priority conditions and scenarios to make benchmark results valid and credible.

**Architecture:** Vertical slices — fix foundation (bugs, scoring, Twining prompt, execution order), validate with smoke test, then add independent condition/scenario slices in parallel.

**Tech Stack:** TypeScript, vitest, @anthropic-ai/claude-agent-sdk, @anthropic-ai/sdk, simple-statistics

**Pre-existing fixes (verified already applied):**
- 1.1 stddev: `sampleStandardDeviation` already imported at `src/analyzer/statistics.ts:4`
- 1.2 transcript index: placeholder transcript already pushed in catch block at `src/scenarios/scenario.interface.ts:158-178`
- 1.4 extractMetrics: already in BaseScenario, not duplicated

---

## Task 1: Fix Silent Perfect Scores on Missing Data

**Files:**
- Modify: `src/types/results.ts:14-23`
- Modify: `src/scenarios/refactoring-handoff.ts:316-319`
- Modify: `src/scenarios/architecture-cascade.ts` (equivalent scoring section)
- Modify: `src/scenarios/bug-investigation.ts` (equivalent scoring section)
- Modify: `src/scenarios/multi-session-build.ts` (equivalent scoring section)
- Modify: `src/scenarios/scale-stress-test.ts` (equivalent scoring section)
- Test: `tests/unit/scenarios/refactoring-handoff.test.ts`

**Step 1: Add `dataQuality` field to DimensionScore**

In `src/types/results.ts`, add to DimensionScore interface:

```typescript
export interface DimensionScore {
  /** Score value from 0-100 */
  value: number;
  /** Confidence in this score */
  confidence: ScoreConfidence;
  /** How the score was produced */
  method: ScoreMethod;
  /** Human-readable justification for the score */
  justification: string;
  /** Quality of the data used for scoring */
  dataQuality?: 'complete' | 'partial' | 'missing';
}
```

**Step 2: Write failing test for missing-data detection**

In `tests/unit/scenarios/refactoring-handoff.test.ts`, add:

```typescript
it('returns dataQuality: missing when diffs are undefined', () => {
  // Create a transcript with fileChanges that have no diff
  const transcript: AgentTranscript = {
    ...makeTranscript(),
    fileChanges: [{ path: 'src/foo.ts', diff: undefined }],
  };
  const rawResults: RawResults = {
    transcripts: [makeTranscript(), transcript],
    finalWorkingDir: '/tmp/test',
    allSessionsCompleted: true,
    errors: [],
  };
  // Score should report dataQuality: missing and score 0, not 100
  const scored = scenario.score(rawResults, manifest);
  const consistency = scored.scores['consistency'];
  expect(consistency.dataQuality).toBe('missing');
  expect(consistency.value).toBe(0);
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/scenarios/refactoring-handoff.test.ts --reporter=verbose`
Expected: FAIL — `dataQuality` is undefined

**Step 4: Fix scoring in all 5 scenarios**

In each scenario's scoring methods, where diffs are joined:

```typescript
// BEFORE (e.g., refactoring-handoff.ts:316-319):
const bDiffs = bChanges
  .map((c) => c.diff ?? '')
  .join('\n');

// AFTER:
const bDiffs = bChanges
  .map((c) => c.diff)
  .filter((d): d is string => d !== undefined)
  .join('\n');

const hasMissingDiffs = bChanges.some((c) => c.diff === undefined);
```

Then after pattern matching, if `hasMissingDiffs && bDiffs.length === 0`:

```typescript
if (hasMissingDiffs && bDiffs.length === 0) {
  return {
    value: 0,
    confidence: 'low',
    method: 'automated',
    justification: 'No diff data available for scoring — git enrichment may have failed.',
    dataQuality: 'missing',
  };
}
```

If `hasMissingDiffs && bDiffs.length > 0`, set `dataQuality: 'partial'` on the returned score.

Apply this pattern to each scoring function in all 5 scenario files. Search for `.diff ?? ''` to find all locations.

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/scenarios/refactoring-handoff.test.ts --reporter=verbose`
Expected: PASS

**Step 6: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/types/results.ts src/scenarios/ tests/unit/scenarios/refactoring-handoff.test.ts
git commit -m "fix: detect missing diff data and return score 0 instead of silent 100"
```

---

## Task 2: Replace Z-Test with Mann-Whitney U in rankConditions

**Files:**
- Modify: `src/analyzer/composite-scorer.ts:216-263`
- Modify: `src/types/results.ts:166-174` (ConditionRanking)
- Test: `tests/unit/analyzer/composite-scorer.test.ts`

**Step 1: Update ConditionRanking type**

In `src/types/results.ts`, update:

```typescript
export interface ConditionRanking {
  rank: number;
  condition: string;
  compositeScore: number;
  deltaVsBest: number;
  significance: 'significant' | 'suggestive' | 'not-distinguishable';
  /** Mann-Whitney U p-value (primary) */
  pValue?: number;
  /** Z-test p-value (reference only, not appropriate for N < 30) */
  zTestPValue?: number;
}
```

**Step 2: Write failing test**

In `tests/unit/analyzer/composite-scorer.test.ts`, add:

```typescript
it('rankConditions uses Mann-Whitney U for significance and reports z-test as secondary', () => {
  // Create aggregated results with enough samples (n >= 3)
  const results = [
    makeAggregated('baseline', { mean: 40, sd: 5, n: 5 }),
    makeAggregated('full-twining', { mean: 80, sd: 5, n: 5 }),
  ];
  const rankings = rankConditions(results);
  // Should have pValue from Mann-Whitney U
  expect(rankings[0].pValue).toBeDefined();
  expect(rankings[0].pValue).toBeGreaterThanOrEqual(0);
  expect(rankings[0].pValue).toBeLessThanOrEqual(1);
  // Should also have zTestPValue as secondary
  expect(rankings[1].zTestPValue).toBeDefined();
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/analyzer/composite-scorer.test.ts --reporter=verbose`
Expected: FAIL — `pValue` and `zTestPValue` don't exist on ranking

**Step 4: Update `rankConditions()` to accept raw scores and use Mann-Whitney U**

The current `rankConditions()` at `composite-scorer.ts:216-263` only has summary stats (mean, sd, n), not raw values. Mann-Whitney U requires raw sample values. Two options:

Option A: Change `rankConditions` signature to accept raw composite scores per iteration alongside aggregated results.
Option B: Generate approximate raw values from summary stats for Mann-Whitney U (less ideal but backward compatible).

Use Option A — add an optional `rawScores` parameter:

```typescript
export function rankConditions(
  results: AggregatedResults[],
  rawScores?: Map<string, number[]>,  // condition name → composite scores per iteration
): ConditionRanking[] {
```

In the significance section (lines 230-252), replace the z-test with:

```typescript
if (index > 0) {
  const prev = sorted[index - 1]!;

  // Z-test as secondary reference
  const diff = prev.compositeScore.mean - agg.compositeScore.mean;
  const combinedSe = Math.sqrt(
    (prev.compositeScore.standardDeviation ** 2) / prev.compositeScore.n +
    (agg.compositeScore.standardDeviation ** 2) / agg.compositeScore.n,
  );
  let zTestPValue: number | undefined;
  if (combinedSe > 0) {
    const z = diff / combinedSe;
    zTestPValue = 2 * (1 - normalCdf(Math.abs(z)));
  }

  // Mann-Whitney U as primary (if raw scores available)
  let mwPValue: number | undefined;
  if (rawScores) {
    const prevRaw = rawScores.get(prev.condition);
    const currRaw = rawScores.get(agg.condition);
    if (prevRaw && currRaw && prevRaw.length >= 3 && currRaw.length >= 3) {
      const mwResult = mannWhitneyU(prevRaw, currRaw);
      mwPValue = mwResult.pValue;
    }
  }

  // Use Mann-Whitney p-value if available, fall back to z-test
  const effectivePValue = mwPValue ?? zTestPValue;
  if (effectivePValue !== undefined) {
    if (effectivePValue < 0.05) {
      significance = 'significant';
    } else if (effectivePValue < 0.10) {
      significance = 'suggestive';
    }
  }

  return {
    rank: index + 1,
    condition: agg.condition,
    compositeScore: agg.compositeScore.mean,
    deltaVsBest: agg.compositeScore.mean - bestScore,
    significance,
    pValue: mwPValue,
    zTestPValue,
  };
}
```

Import `mannWhitneyU` from `./statistics.js` at the top of the file.

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/analyzer/composite-scorer.test.ts --reporter=verbose`
Expected: PASS

**Step 6: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/analyzer/composite-scorer.ts src/types/results.ts tests/unit/analyzer/composite-scorer.test.ts
git commit -m "fix: use Mann-Whitney U as primary significance test, retain z-test as secondary reference"
```

---

## Task 3: Smooth Overhead Penalty

**Files:**
- Modify: `src/analyzer/composite-scorer.ts:73-75`
- Modify: `src/types/run.ts` (add overheadPenaltyFormula to RunMetadata if it exists)
- Test: `tests/unit/analyzer/composite-scorer.test.ts`

**Step 1: Write failing test**

```typescript
it('uses smooth linear overhead penalty without cliff', () => {
  const metrics = makeMetrics({ coordinationOverheadRatio: 0.08 }); // 8% overhead
  const ces = calculateCes(metrics);
  // Old formula: max(0, 0.08 - 0.10) * 200 = 0 (no penalty below 10%)
  // New formula: 0.08 * 100 = 8 penalty points (before weight)
  // With weight 0.10: 0.10 * 8 = 0.8 point deduction
  expect(ces.overheadPenalty).toBeCloseTo(8);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/analyzer/composite-scorer.test.ts --reporter=verbose`
Expected: FAIL — overhead penalty is 0 for 8% ratio (old cliff formula)

**Step 3: Replace formula**

In `src/analyzer/composite-scorer.ts:73-75`, change:

```typescript
// BEFORE:
const overheadPenalty =
  Math.max(0, metrics.coordinationOverheadRatio - 0.10) * 200;

// AFTER:
// Smooth linear penalty — provisional, pending empirical calibration from real runs.
// See: docs/plans/2026-03-08-benchmark-validity-fixes-design.md
const overheadPenalty = metrics.coordinationOverheadRatio * 100;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/analyzer/composite-scorer.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Fix any other tests broken by the formula change**

Run: `npx vitest run --reporter=verbose`
Update expected values in any existing overhead penalty tests.

**Step 6: Commit**

```bash
git add src/analyzer/composite-scorer.ts tests/unit/analyzer/composite-scorer.test.ts
git commit -m "fix: replace cliff overhead penalty with smooth linear formula (provisional)"
```

---

## Task 4: Dual-Rubric LLM Judge

**Files:**
- Modify: `src/analyzer/llm-judge.ts:248-395` (add 4 new templates after existing 4)
- Modify: `src/analyzer/llm-judge.ts` (add standalone evaluation orchestrator)
- Modify: `src/types/results.ts` (add StandaloneScoreResult, CoordinationLift, update ScoredResults)
- Modify: `src/analyzer/composite-scorer.ts` (add standalone scoring function)
- Test: `tests/unit/analyzer/llm-judge.test.ts`

**Step 1: Add types to `src/types/results.ts`**

```typescript
/** Standalone quality scores — evaluates output independent of coordination. */
export interface StandaloneScoreResult {
  correctness: DimensionScore;
  architecturalSoundness: DimensionScore;
  maintainability: DimensionScore;
  completeness: DimensionScore;
  /** Composite standalone score (0-100), equal weights */
  composite: number;
}

/** Coordination lift — difference between coordination and standalone scores. */
export interface CoordinationLift {
  /** coordinationScore - standaloneScore (positive = coordination helped) */
  lift: number;
  /** Coordination composite score */
  coordinationScore: number;
  /** Standalone composite score */
  standaloneScore: number;
}
```

Update `ScoredResults`:

```typescript
export interface ScoredResults {
  runId: string;
  scenario: string;
  condition: string;
  iteration: number;
  scores: Record<string, DimensionScore>;
  metrics: RunMetrics;
  composite: number;
  /** Standalone quality scores (if LLM judge available) */
  standaloneScores?: StandaloneScoreResult;
  /** Coordination lift (if both coordination and standalone scores available) */
  coordinationLift?: CoordinationLift;
}
```

**Step 2: Write failing test for standalone templates**

In `tests/unit/analyzer/llm-judge.test.ts`:

```typescript
describe('standalone quality templates', () => {
  it('CODE_CORRECTNESS_TEMPLATE does not reference agents or coordination', () => {
    expect(CODE_CORRECTNESS_TEMPLATE.template).not.toMatch(/agent/i);
    expect(CODE_CORRECTNESS_TEMPLATE.template).not.toMatch(/coordinat/i);
    expect(CODE_CORRECTNESS_TEMPLATE.template).not.toMatch(/prior.*decision/i);
    expect(CODE_CORRECTNESS_TEMPLATE.template).not.toMatch(/shared.*state/i);
  });

  it('ARCHITECTURAL_SOUNDNESS_TEMPLATE does not reference agents or coordination', () => {
    expect(ARCHITECTURAL_SOUNDNESS_TEMPLATE.template).not.toMatch(/agent/i);
    expect(ARCHITECTURAL_SOUNDNESS_TEMPLATE.template).not.toMatch(/coordinat/i);
  });

  it('MAINTAINABILITY_TEMPLATE does not reference agents or coordination', () => {
    expect(MAINTAINABILITY_TEMPLATE.template).not.toMatch(/agent/i);
    expect(MAINTAINABILITY_TEMPLATE.template).not.toMatch(/coordinat/i);
  });

  it('COMPLETENESS_TEMPLATE does not reference agents or coordination', () => {
    expect(COMPLETENESS_TEMPLATE.template).not.toMatch(/agent/i);
    expect(COMPLETENESS_TEMPLATE.template).not.toMatch(/coordinat/i);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/analyzer/llm-judge.test.ts --reporter=verbose`
Expected: FAIL — templates not exported

**Step 4: Add 4 standalone templates to `src/analyzer/llm-judge.ts`**

After the existing templates (line ~395), add:

```typescript
export const CODE_CORRECTNESS_TEMPLATE: EvaluatorPromptTemplate = {
  name: 'code-correctness',
  dimension: 'correctness',
  template: `You are evaluating the quality of code in a TypeScript project.

Given the following code changes and project context, evaluate the **correctness** of the implementation:

## Project Context
{{ground_truth}}

## Code Changes
{{code_diffs}}

## Evaluation Criteria

Rate the code correctness from 0 to 100:

- **90-100 (Excellent):** Code is fully correct, handles edge cases, no logical errors
- **70-89 (Good):** Code is mostly correct with minor issues that don't affect core functionality
- **40-69 (Acceptable):** Code has some correctness issues but core functionality works
- **0-39 (Poor):** Code has significant logical errors or missing functionality

Respond with ONLY a JSON object:
\`\`\`json
{
  "score": <number 0-100>,
  "confidence": "<low|medium|high>",
  "justification": "<2-3 sentences explaining the score>"
}
\`\`\``,
};

export const ARCHITECTURAL_SOUNDNESS_TEMPLATE: EvaluatorPromptTemplate = {
  name: 'architectural-soundness',
  dimension: 'architecturalSoundness',
  template: `You are evaluating the architecture of a TypeScript project.

Given the following code changes and project context, evaluate the **architectural soundness** of the codebase:

## Project Context
{{ground_truth}}

## Code Changes
{{code_diffs}}

## Evaluation Criteria

Rate the architectural quality from 0 to 100:

- **90-100 (Excellent):** Clean separation of concerns, consistent patterns, well-defined interfaces, appropriate abstraction levels
- **70-89 (Good):** Generally sound architecture with minor inconsistencies or unnecessary coupling
- **40-69 (Acceptable):** Architecture works but has notable design issues (tight coupling, mixed concerns, inconsistent patterns)
- **0-39 (Poor):** Fundamentally flawed architecture, spaghetti dependencies, no clear structure

Respond with ONLY a JSON object:
\`\`\`json
{
  "score": <number 0-100>,
  "confidence": "<low|medium|high>",
  "justification": "<2-3 sentences explaining the score>"
}
\`\`\``,
};

export const MAINTAINABILITY_TEMPLATE: EvaluatorPromptTemplate = {
  name: 'maintainability',
  dimension: 'maintainability',
  template: `You are evaluating the maintainability of code in a TypeScript project.

Given the following code changes, evaluate how **maintainable** the resulting code is:

## Code Changes
{{code_diffs}}

## Evaluation Criteria

Rate maintainability from 0 to 100:

- **90-100 (Excellent):** Code is clear, well-named, appropriately documented, easy to test, follows consistent conventions
- **70-89 (Good):** Code is readable and mostly well-structured with minor style inconsistencies
- **40-69 (Acceptable):** Code works but is hard to follow, poorly named, lacks structure, or mixes concerns
- **0-39 (Poor):** Code is opaque, heavily nested, uses magic numbers/strings, impossible to test in isolation

Respond with ONLY a JSON object:
\`\`\`json
{
  "score": <number 0-100>,
  "confidence": "<low|medium|high>",
  "justification": "<2-3 sentences explaining the score>"
}
\`\`\``,
};

export const COMPLETENESS_TEMPLATE: EvaluatorPromptTemplate = {
  name: 'completeness',
  dimension: 'completeness',
  template: `You are evaluating whether the implementation in a TypeScript project is complete.

Given the following project requirements and code changes, evaluate **completeness**:

## Requirements
{{ground_truth}}

## Code Changes
{{code_diffs}}

## Evaluation Criteria

Rate completeness from 0 to 100:

- **90-100 (Excellent):** All requirements fully implemented with tests, no gaps
- **70-89 (Good):** Core requirements implemented, minor features or edge cases missing
- **40-69 (Acceptable):** Some requirements implemented but significant gaps remain
- **0-39 (Poor):** Most requirements unimplemented or only partially started

Respond with ONLY a JSON object:
\`\`\`json
{
  "score": <number 0-100>,
  "confidence": "<low|medium|high>",
  "justification": "<2-3 sentences explaining the score>"
}
\`\`\``,
};
```

**Step 5: Add standalone evaluation orchestrator function**

Add to `src/analyzer/llm-judge.ts`:

```typescript
/**
 * Run standalone quality evaluation using coordination-agnostic rubrics.
 * Returns scores for correctness, architectural soundness, maintainability, and completeness.
 */
export async function evaluateStandaloneQuality(
  client: Anthropic,
  context: EvaluationContext,
  config: LlmJudgeConfig = DEFAULT_JUDGE_CONFIG,
): Promise<StandaloneScoreResult> {
  const [correctness, soundness, maintainability, completeness] = await Promise.all([
    runAggregatedEvaluation(client, CODE_CORRECTNESS_TEMPLATE, context, config),
    runAggregatedEvaluation(client, ARCHITECTURAL_SOUNDNESS_TEMPLATE, context, config),
    runAggregatedEvaluation(client, MAINTAINABILITY_TEMPLATE, context, config),
    runAggregatedEvaluation(client, COMPLETENESS_TEMPLATE, context, config),
  ]);

  const toDimensionScore = (result: AggregatedJudgeResult): DimensionScore => ({
    value: result.medianScore,
    confidence: result.medianConfidence,
    method: 'llm-judge',
    justification: result.justifications.join(' | '),
  });

  const scores = {
    correctness: toDimensionScore(correctness),
    architecturalSoundness: toDimensionScore(soundness),
    maintainability: toDimensionScore(maintainability),
    completeness: toDimensionScore(completeness),
  };

  const composite = (
    scores.correctness.value +
    scores.architecturalSoundness.value +
    scores.maintainability.value +
    scores.completeness.value
  ) / 4;

  return { ...scores, composite };
}
```

Import `StandaloneScoreResult` from types.

**Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/analyzer/llm-judge.test.ts --reporter=verbose`
Expected: PASS

**Step 7: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

**Step 8: Commit**

```bash
git add src/analyzer/llm-judge.ts src/types/results.ts tests/unit/analyzer/llm-judge.test.ts
git commit -m "feat: add dual-rubric LLM judge with standalone quality templates"
```

---

## Task 5: LLM Judge Test Coverage

**Files:**
- Modify: `tests/unit/analyzer/llm-judge.test.ts`

**Step 1: Add parseEvaluationResponse tests**

```typescript
describe('parseEvaluationResponse', () => {
  it('parses valid JSON in markdown code block', () => {
    const response = '```json\n{"score": 85, "confidence": "high", "justification": "Good work"}\n```';
    const result = parseEvaluationResponse(response);
    expect(result.score).toBe(85);
    expect(result.confidence).toBe('high');
    expect(result.justification).toBe('Good work');
  });

  it('parses raw JSON without code block', () => {
    const response = '{"score": 50, "confidence": "medium", "justification": "OK"}';
    const result = parseEvaluationResponse(response);
    expect(result.score).toBe(50);
  });

  it('returns score 0 and low confidence for unparseable response', () => {
    const result = parseEvaluationResponse('This is not JSON at all');
    expect(result.score).toBe(0);
    expect(result.confidence).toBe('low');
    expect(result.justification).toContain('Failed to parse');
  });

  it('clamps score to 0-100 range', () => {
    const response = '{"score": 150, "confidence": "high", "justification": "Over"}';
    const result = parseEvaluationResponse(response);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('handles missing fields gracefully', () => {
    const response = '{"score": 70}';
    const result = parseEvaluationResponse(response);
    expect(result.score).toBe(70);
    // Should have defaults for missing fields
    expect(result.confidence).toBeDefined();
    expect(result.justification).toBeDefined();
  });
});
```

**Step 2: Add runSingleEvaluation tests (mocked API)**

```typescript
describe('runSingleEvaluation', () => {
  it('sends correct prompt structure to Anthropic API', async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"score": 80, "confidence": "high", "justification": "test"}' }],
        }),
      },
    } as unknown as Anthropic;

    const result = await runSingleEvaluation(
      mockClient,
      DECISION_CONSISTENCY_TEMPLATE,
      { groundTruth: 'test truth', codeDiffs: 'test diffs', coordinationArtifacts: '' },
    );

    expect(mockClient.messages.create).toHaveBeenCalledOnce();
    const callArgs = (mockClient.messages.create as any).mock.calls[0][0];
    expect(callArgs.model).toBeDefined();
    expect(callArgs.max_tokens).toBeDefined();
    expect(callArgs.messages[0].content).toContain('test truth');
    expect(result.score).toBe(80);
  });
});
```

**Step 3: Add runAggregatedEvaluation tests (mocked API)**

```typescript
describe('runAggregatedEvaluation', () => {
  it('takes median of 3 evaluations', async () => {
    let callCount = 0;
    const scores = [60, 80, 70]; // median = 70
    const mockClient = {
      messages: {
        create: vi.fn().mockImplementation(() => {
          const score = scores[callCount++];
          return Promise.resolve({
            content: [{ type: 'text', text: `{"score": ${score}, "confidence": "medium", "justification": "eval ${callCount}"}` }],
          });
        }),
      },
    } as unknown as Anthropic;

    const result = await runAggregatedEvaluation(
      mockClient,
      DECISION_CONSISTENCY_TEMPLATE,
      { groundTruth: 'truth', codeDiffs: 'diffs', coordinationArtifacts: '' },
    );

    expect(result.medianScore).toBe(70);
    expect(result.evaluationVariance).toBeGreaterThan(0);
    expect(mockClient.messages.create).toHaveBeenCalledTimes(3);
  });
});
```

**Step 4: Run tests**

Run: `npx vitest run tests/unit/analyzer/llm-judge.test.ts --reporter=verbose`
Expected: All pass. If `parseEvaluationResponse` doesn't clamp scores, add the clamp and fix (it's already exported).

**Step 5: Commit**

```bash
git add tests/unit/analyzer/llm-judge.test.ts
git commit -m "test: add behavioral tests for LLM judge core functions"
```

---

## Task 6: Fix Full-Twining System Prompt and CLAUDE.md

**Files:**
- Modify: `src/conditions/full-twining.ts:7-8` (system prompt)
- Modify: `src/conditions/full-twining.ts:160-167` (CLAUDE.md Twining section)
- Test: `tests/unit/conditions/full-twining.test.ts`

**Step 1: Write failing test**

In `tests/unit/conditions/full-twining.test.ts`, add:

```typescript
it('system prompt includes explicit lifecycle gate instructions', () => {
  // The system prompt must tell agents to actually USE Twining tools
  const config = condition.getAgentConfig();
  expect(config.systemPrompt).toContain('twining_assemble');
  expect(config.systemPrompt).toContain('twining_decide');
  expect(config.systemPrompt).toContain('twining_verify');
  expect(config.systemPrompt).toContain('twining_handoff');
  expect(config.systemPrompt).toContain('twining_why');
  expect(config.systemPrompt).toContain('twining_post');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/conditions/full-twining.test.ts --reporter=verbose`
Expected: FAIL — current prompt only says "Use the twining:* skills"

**Step 3: Replace system prompt**

In `src/conditions/full-twining.ts:7-8`, replace:

```typescript
const TWINING_SYSTEM_PROMPT = `You have access to Twining, a coordination plugin for multi-agent workflows.

Follow the Twining lifecycle gates for every task:

**Before starting work:**
1. Call twining_assemble with your task description to get context from prior agents
2. Call twining_why on any files you plan to modify to understand prior decisions

**While working:**
3. Call twining_decide for any architectural or implementation choice where alternatives exist — include rationale and at least one rejected alternative
4. Call twining_post with entry_type "finding" for discoveries, "warning" for gotchas you encounter

**Before finishing:**
5. Call twining_verify on your scope to check for unresolved issues
6. Call twining_post with entry_type "status" summarizing what you accomplished
7. Call twining_handoff with your results so the next agent can pick up where you left off`;
```

**Step 4: Update CLAUDE.md Twining section**

In `src/conditions/full-twining.ts`, replace the Twining Integration section (lines 160-167) in `generateClaudeMdWithTwining()`:

```typescript
## Twining Integration

This project uses the Twining plugin for structured agent coordination.

### Mandatory Lifecycle Gates

**Before work:** Call \`twining_assemble\` with your task and scope to get decisions, warnings, and context from prior agents. Call \`twining_why\` on files you plan to modify.

**During work:** Call \`twining_decide\` for any choice where alternatives exist. Call \`twining_post\` with entry_type "finding" or "warning" as you discover things.

**Before finishing:** Call \`twining_verify\` on your scope. Call \`twining_post\` with entry_type "status" summarizing your work. Call \`twining_handoff\` with results for the next agent.

### Available Tools
- **Context:** twining_assemble, twining_why, twining_what_changed
- **Decisions:** twining_decide, twining_search_decisions, twining_trace
- **Blackboard:** twining_post, twining_read, twining_query, twining_recent
- **Coordination:** twining_handoff, twining_acknowledge, twining_agents
- **Verification:** twining_verify, twining_status
- **Knowledge Graph:** twining_add_entity, twining_add_relation, twining_neighbors
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/conditions/full-twining.test.ts --reporter=verbose`
Expected: PASS

**Step 6: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

**Step 7: Commit**

```bash
git add src/conditions/full-twining.ts tests/unit/conditions/full-twining.test.ts
git commit -m "fix: replace vague Twining system prompt with explicit lifecycle gate instructions"
```

---

## Task 7: Implement Seeded Execution Order Randomization

**Files:**
- Modify: `src/runner/orchestrator.ts:92-98` (captureEnvironment)
- Modify: `src/runner/orchestrator.ts:207-279` (iteration loop)
- Create: `src/runner/shuffle.ts` (seeded shuffle utility)
- Test: `tests/unit/runner/orchestrator.test.ts`

**Step 1: Create seeded shuffle utility**

Create `src/runner/shuffle.ts`:

```typescript
/**
 * Seeded PRNG using mulberry32 algorithm.
 * Deterministic: same seed always produces same sequence.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert a string seed to a numeric seed via simple hash. */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}

/**
 * Fisher-Yates shuffle with seeded PRNG.
 * Returns a new shuffled array (does not mutate input).
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const rng = mulberry32(hashSeed(seed));
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
```

**Step 2: Write test for seeded shuffle**

Create `tests/unit/runner/shuffle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { seededShuffle } from '../../../src/runner/shuffle.js';

describe('seededShuffle', () => {
  it('produces deterministic output for same seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = seededShuffle(items, 'test-seed-42');
    const b = seededShuffle(items, 'test-seed-42');
    expect(a).toEqual(b);
  });

  it('produces different output for different seeds', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = seededShuffle(items, 'seed-A');
    const b = seededShuffle(items, 'seed-B');
    expect(a).not.toEqual(b);
  });

  it('does not mutate the input array', () => {
    const items = [1, 2, 3];
    const original = [...items];
    seededShuffle(items, 'seed');
    expect(items).toEqual(original);
  });
});
```

**Step 3: Run test**

Run: `npx vitest run tests/unit/runner/shuffle.test.ts --reporter=verbose`
Expected: PASS

**Step 4: Integrate into orchestrator**

In `src/runner/orchestrator.ts`, before the iteration loop (~line 207):

```typescript
import { seededShuffle } from './shuffle.js';

// Build execution tuples
type ExecutionTuple = { scenario: Scenario; condition: Condition; iteration: number };
const tuples: ExecutionTuple[] = [];
for (const scenario of this.scenarios) {
  for (const condition of this.conditions) {
    for (let iteration = 0; iteration < this.runsPerPair; iteration++) {
      tuples.push({ scenario, condition, iteration });
    }
  }
}

// Shuffle if seed provided, otherwise fixed order
const executionOrder = this.seed
  ? seededShuffle(tuples, this.seed)
  : tuples;
```

Replace the nested for-loops (lines 210-278) with a single loop over `executionOrder`:

```typescript
for (let orderIndex = 0; orderIndex < executionOrder.length; orderIndex++) {
  const { scenario, condition, iteration } = executionOrder[orderIndex]!;
  const scenarioMeta = scenario.getMetadata();
  const iterationKey = `${scenarioMeta.name}:${condition.name}:${iteration}`;

  if (completedIterationKeys.has(iterationKey)) {
    // ... skip logic (unchanged)
    continue;
  }

  // ... rest of loop body (unchanged, just uses scenario/condition/iteration from tuple)
}
```

**Step 5: Add per-iteration environment snapshot**

In `captureEnvironment()`, keep it as-is for run-level. Add per-iteration metadata to the `executeIteration` call by recording `orderIndex` and timestamp in the result:

In `executeIteration()` return value, add:

```typescript
executionOrderIndex: orderIndex,
iterationStartTime: new Date().toISOString(),
```

**Step 6: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All pass (orchestrator tests use mocked session manager, loop structure change should be transparent)

**Step 7: Commit**

```bash
git add src/runner/shuffle.ts src/runner/orchestrator.ts tests/unit/runner/shuffle.test.ts
git commit -m "feat: implement seeded execution order randomization and per-iteration timestamps"
```

---

## Task 8: End-to-End Smoke Test

**Files:**
- Create: `src/runner/smoke-test.ts`
- Create: `src/cli/commands/smoke-test.ts`
- Create: `tests/e2e/smoke-test.test.ts`
- Modify: `src/cli/index.ts` (register command)

**Step 1: Create smoke test infrastructure**

Create `src/runner/smoke-test.ts`:

```typescript
import { SyntheticRepoTarget } from '../targets/synthetic-repo/index.js';
import { BaselineCondition } from '../conditions/baseline.js';
import { FullTwiningCondition } from '../conditions/full-twining.js';
import { createRefactoringHandoffScenario } from '../scenarios/refactoring-handoff.js';
import { RunOrchestrator } from './orchestrator.js';
import { ResultsStore } from '../results/store.js';
import type { AgentTranscript } from '../types/transcript.js';

export interface SmokeTestCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SmokeTestResult {
  passed: boolean;
  checks: SmokeTestCheck[];
  baselineTranscript?: AgentTranscript[];
  twiningTranscript?: AgentTranscript[];
}

export interface SmokeTestOptions {
  timeoutMinutes?: number;
  budgetDollars?: number;
}

export async function runSmokeTest(options: SmokeTestOptions = {}): Promise<SmokeTestResult> {
  const timeoutMs = (options.timeoutMinutes ?? 5) * 60 * 1000;
  const budget = options.budgetDollars ?? 10;
  const checks: SmokeTestCheck[] = [];

  const target = new SyntheticRepoTarget();
  const baseline = new BaselineCondition();
  const twining = new FullTwiningCondition();
  const scenario = createRefactoringHandoffScenario();

  // Run baseline
  const baselineResults = await runSingleCondition(target, baseline, scenario, timeoutMs, budget);
  // Run twining
  const twiningResults = await runSingleCondition(target, twining, scenario, timeoutMs, budget);

  // Check 1: Baseline transcripts have expected structure
  checks.push(checkTranscriptStructure('baseline', baselineResults.transcripts));

  // Check 2: Twining transcripts have expected structure
  checks.push(checkTranscriptStructure('full-twining', twiningResults.transcripts));

  // Check 3: Baseline does NOT contain twining tool calls
  checks.push(checkNoTwiningTools(baselineResults.transcripts));

  // Check 4: Twining DOES contain twining_assemble and twining_decide
  checks.push(checkHasTwiningTools(twiningResults.transcripts));

  // Check 5: No .twining/ directory in baseline working dir
  checks.push(await checkNoTwiningDir(baselineResults.workingDir));

  // Check 6: Scoring produces non-sentinel results
  checks.push(checkScoringQuality(baselineResults.scores));
  checks.push(checkScoringQuality(twiningResults.scores));

  return {
    passed: checks.every((c) => c.passed),
    checks,
    baselineTranscript: baselineResults.transcripts,
    twiningTranscript: twiningResults.transcripts,
  };
}
```

The helper functions (`runSingleCondition`, `checkTranscriptStructure`, `checkNoTwiningTools`, `checkHasTwiningTools`, `checkNoTwiningDir`, `checkScoringQuality`) should be implemented inline in this file. Each returns a `SmokeTestCheck`. The implementation details depend on the actual orchestrator/scenario APIs — follow the patterns established in `orchestrator.ts` and the phase1 integration test.

**Step 2: Create CLI command**

Create `src/cli/commands/smoke-test.ts`:

```typescript
import { Command } from 'commander';
import { runSmokeTest } from '../../runner/smoke-test.js';

export function registerSmokeTestCommand(program: Command): void {
  program
    .command('smoke-test')
    .description('Run end-to-end smoke test to validate harness pipeline')
    .option('--timeout <minutes>', 'Per-session timeout in minutes', '5')
    .option('--budget <dollars>', 'Maximum API spend in dollars', '10')
    .action(async (opts) => {
      console.log('Running smoke test...\n');
      const result = await runSmokeTest({
        timeoutMinutes: Number(opts.timeout),
        budgetDollars: Number(opts.budget),
      });

      for (const check of result.checks) {
        const icon = check.passed ? 'PASS' : 'FAIL';
        console.log(`  [${icon}] ${check.name}: ${check.detail}`);
      }

      console.log(`\n${result.passed ? 'All checks passed.' : 'Some checks failed.'}`);
      process.exit(result.passed ? 0 : 1);
    });
}
```

Register in `src/cli/index.ts` alongside other commands.

**Step 3: Create CI-gated e2e test**

Create `tests/e2e/smoke-test.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runSmokeTest } from '../../src/runner/smoke-test.js';

describe('E2E smoke test', () => {
  it('validates full pipeline with real agent sessions', async () => {
    if (!process.env['RUN_E2E']) {
      console.log('Skipping E2E smoke test (set RUN_E2E=true to enable)');
      return;
    }

    const result = await runSmokeTest({ timeoutMinutes: 5, budgetDollars: 10 });

    for (const check of result.checks) {
      expect(check.passed, `${check.name}: ${check.detail}`).toBe(true);
    }
  }, { timeout: 600_000 }); // 10 minute timeout
});
```

**Step 4: Run unit tests (not E2E)**

Run: `npx vitest run --reporter=verbose`
Expected: All pass, E2E test skips

**Step 5: Commit**

```bash
git add src/runner/smoke-test.ts src/cli/commands/smoke-test.ts tests/e2e/smoke-test.test.ts src/cli/index.ts
git commit -m "feat: add end-to-end smoke test with CLI command and CI-gated vitest"
```

---

## Task 9: Add `twining-lite` Condition

**Files:**
- Create: `src/conditions/twining-lite.ts`
- Modify: `src/types/condition.ts:6-12` (add to ConditionName union)
- Modify: `src/conditions/registry.ts` (register)
- Test: `tests/unit/conditions/twining-lite.test.ts`

**Step 1: Write failing test**

Create `tests/unit/conditions/twining-lite.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TwiningLiteCondition } from '../../../src/conditions/twining-lite.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('TwiningLiteCondition', () => {
  let condition: TwiningLiteCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new TwiningLiteCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-lite-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has name twining-lite', () => {
    expect(condition.name).toBe('twining-lite');
  });

  it('allows only 8 core Twining tools', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();
    const twiningTools = config.allowedTools.filter(t => t.startsWith('mcp__plugin_twining_twining__twining_'));
    expect(twiningTools).toHaveLength(8);
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_post');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_read');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_query');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_recent');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_decide');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_search_decisions');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_handoff');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_acknowledge');
    // Should NOT include graph, verification, advanced tools
    expect(twiningTools).not.toContain('mcp__plugin_twining_twining__twining_verify');
    expect(twiningTools).not.toContain('mcp__plugin_twining_twining__twining_add_entity');
  });

  it('system prompt references simplified lifecycle gates', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();
    expect(config.systemPrompt).toContain('twining_query');
    expect(config.systemPrompt).toContain('twining_decide');
    expect(config.systemPrompt).toContain('twining_handoff');
    expect(config.systemPrompt).not.toContain('twining_verify');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/conditions/twining-lite.test.ts --reporter=verbose`
Expected: FAIL — module not found

**Step 3: Implement TwiningLiteCondition**

Create `src/conditions/twining-lite.ts`. Model it on `full-twining.ts` but with restricted tool allowlist and simplified system prompt. The MCP server configuration is identical (same `npx -y twining-mcp --project <workingDir>` command) — only the `allowedTools` array is restricted.

**Step 4: Update ConditionName type**

In `src/types/condition.ts:6-12`, add `'twining-lite'` to the union.

**Step 5: Register in registry**

In `src/conditions/registry.ts`, add the entry.

**Step 6: Run tests**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

**Step 7: Commit**

```bash
git add src/conditions/twining-lite.ts src/types/condition.ts src/conditions/registry.ts tests/unit/conditions/twining-lite.test.ts
git commit -m "feat: add twining-lite condition with 8 core tools only"
```

---

## Task 10: Add `persistent-history` Condition

**Files:**
- Create: `src/conditions/persistent-history.ts`
- Modify: `src/types/condition.ts` (add to ConditionName union)
- Modify: `src/types/condition.ts:29-40` (add persistHistory to AgentConfiguration)
- Modify: `src/runner/agent-session.ts` (handle persistHistory flag)
- Modify: `src/conditions/registry.ts`
- Test: `tests/unit/conditions/persistent-history.test.ts`
- Test: `tests/unit/runner/agent-session.test.ts` (add persistent history test)

**Step 1: Add `persistHistory` to AgentConfiguration**

In `src/types/condition.ts:29-40`:

```typescript
export interface AgentConfiguration {
  systemPrompt: string;
  mcpServers: Record<string, McpServerConfig>;
  allowedTools: string[];
  permissionMode: 'acceptEdits' | 'plan' | 'full';
  env?: Record<string, string>;
  /** If true, pass previous agents' conversation as history prefix to subsequent agents */
  persistHistory?: boolean;
}
```

**Step 2: Write failing condition test**

Create `tests/unit/conditions/persistent-history.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersistentHistoryCondition } from '../../../src/conditions/persistent-history.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('PersistentHistoryCondition', () => {
  let condition: PersistentHistoryCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new PersistentHistoryCondition();
    workDir = await mkdtemp(join(tmpdir(), 'persist-hist-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has name persistent-history', () => {
    expect(condition.name).toBe('persistent-history');
  });

  it('sets persistHistory flag to true', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();
    expect(config.persistHistory).toBe(true);
  });

  it('has no MCP servers', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();
    expect(Object.keys(config.mcpServers)).toHaveLength(0);
  });

  it('has no coordination files', () => {
    // persistent-history relies on conversation context, not files
    expect(condition['getCoordinationFilePaths']()).toHaveLength(0);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/conditions/persistent-history.test.ts --reporter=verbose`
Expected: FAIL — module not found

**Step 4: Implement PersistentHistoryCondition**

Create `src/conditions/persistent-history.ts`. Same CLAUDE.md content as `claude-md-only` (project conventions only). System prompt is minimal — standard project guidance, no coordination file instructions. Key difference: `buildAgentConfig()` returns `persistHistory: true`.

**Step 5: Handle persistHistory in AgentSessionManager**

In `src/runner/agent-session.ts`, the session manager needs to accumulate transcripts when `persistHistory` is true. This means:

- Add a `conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>` to the manager
- When `persistHistory` is true, after each task completes, append the agent's conversation turns to `conversationHistory`
- When starting the next task, prepend `conversationHistory` as conversation context

This depends on how the Claude Agent SDK handles conversation history. Check the SDK's `query()` options for a `messages` or `conversationHistory` parameter. If the SDK doesn't support this directly, simulate it by prepending a summary of prior agent output to the next agent's prompt (prefixed with "Previous agents' work:\n\n").

**Step 6: Write agent-session test for persistent history**

In `tests/unit/runner/agent-session.test.ts`:

```typescript
it('accumulates conversation history when persistHistory is true', async () => {
  // Verify that when agentConfig.persistHistory is true,
  // subsequent tasks receive prior conversation context
  const manager = new AgentSessionManager({
    ...defaultOptions,
    agentConfig: { ...defaultConfig, persistHistory: true },
  });

  // Run first task
  const t1 = await manager.runAgentTask(task1);
  // Run second task — should include t1's conversation in prompt
  const t2 = await manager.runAgentTask(task2);

  // Verify the SDK was called with augmented prompt for task2
  const secondCall = mockSdkQuery.mock.calls[1];
  expect(secondCall[0].prompt).toContain('Previous agent');
});
```

**Step 7: Register and update types**

Update `ConditionName` union and registry.

**Step 8: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

**Step 9: Commit**

```bash
git add src/conditions/persistent-history.ts src/types/condition.ts src/conditions/registry.ts src/runner/agent-session.ts tests/unit/conditions/persistent-history.test.ts tests/unit/runner/agent-session.test.ts
git commit -m "feat: add persistent-history condition with conversation accumulation"
```

---

## Task 11: Add Parallel Execution Support to BaseScenario

**Files:**
- Modify: `src/types/scenario.ts:20-35` (add executionMode to ScenarioMetadata)
- Modify: `src/scenarios/scenario.interface.ts:131-187` (add parallel execution path)
- Test: `tests/unit/scenarios/scenario-interface.test.ts`

**Step 1: Add executionMode to ScenarioMetadata**

In `src/types/scenario.ts:20-35`:

```typescript
export interface ScenarioMetadata {
  name: ScenarioName;
  description: string;
  estimatedDurationMinutes: number;
  requiredTargetType: string;
  agentSessionCount: number;
  scoringDimensions: string[];
  excludeFromAll: boolean;
  /** How agent tasks are executed: sequentially (default) or in parallel */
  executionMode?: 'sequential' | 'parallel';
}
```

**Step 2: Write failing test**

In `tests/unit/scenarios/scenario-interface.test.ts`:

```typescript
it('executes tasks in parallel when executionMode is parallel', async () => {
  const startTimes: number[] = [];
  const mockRunner: ScenarioRunner = {
    runAgentTask: async (task) => {
      startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, 50)); // Simulate work
      return makeTranscript(task.sequenceOrder);
    },
  };

  // Create a scenario with parallel execution mode
  // (need a concrete subclass or test helper)
  const results = await parallelScenario.execute(mockRunner);

  // All tasks should have started nearly simultaneously (within 20ms)
  const maxGap = Math.max(...startTimes) - Math.min(...startTimes);
  expect(maxGap).toBeLessThan(20);
});
```

**Step 3: Implement parallel execution path**

In `BaseScenario.execute()` at `src/scenarios/scenario.interface.ts`, add:

```typescript
async execute(runner: ScenarioRunner): Promise<RawResults> {
  const tasks = this.getAgentTasks();
  const metadata = this.buildMetadata();

  if (metadata.executionMode === 'parallel') {
    return this.executeParallel(runner, tasks);
  }
  return this.executeSequential(runner, tasks);
}

private async executeParallel(runner: ScenarioRunner, tasks: AgentTask[]): Promise<RawResults> {
  const results = await Promise.allSettled(
    tasks.map((task) => runner.runAgentTask(task)),
  );

  const transcripts: AgentTranscript[] = [];
  const errors: string[] = [];
  let allCompleted = true;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === 'fulfilled') {
      transcripts.push(result.value);
      if (result.value.exitReason === 'error') {
        allCompleted = false;
        errors.push(`Task ${i}: ${result.value.error}`);
      }
    } else {
      allCompleted = false;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`Task ${i} failed: ${message}`);
      // Push placeholder transcript
      transcripts.push(this.makeErrorTranscript(tasks[i]!, message));
    }
  }

  return { transcripts, finalWorkingDir: this.workingDir, allSessionsCompleted: allCompleted, errors };
}
```

Rename the existing execute body to `executeSequential()`.

**Step 4: Run tests**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

**Step 5: Commit**

```bash
git add src/types/scenario.ts src/scenarios/scenario.interface.ts tests/unit/scenarios/scenario-interface.test.ts
git commit -m "feat: add parallel execution mode to BaseScenario"
```

---

## Task 12: Add `concurrent-agents` Scenario

**Files:**
- Create: `src/scenarios/concurrent-agents.ts`
- Modify: `src/types/scenario.ts:10-15` (add to ScenarioName union)
- Modify: `src/scenarios/registry.ts`
- Test: `tests/unit/scenarios/concurrent-agents.test.ts`

**Step 1: Write failing test**

Create `tests/unit/scenarios/concurrent-agents.test.ts` following the pattern in `tests/unit/scenarios/refactoring-handoff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createConcurrentAgentsScenario } from '../../../src/scenarios/concurrent-agents.js';

describe('ConcurrentAgentsScenario', () => {
  const scenario = createConcurrentAgentsScenario();

  it('has correct metadata', () => {
    const meta = scenario.getMetadata();
    expect(meta.name).toBe('concurrent-agents');
    expect(meta.agentSessionCount).toBe(4); // 3 parallel + 1 merge
    expect(meta.executionMode).toBe('parallel');
    expect(meta.excludeFromAll).toBe(false);
    expect(meta.scoringDimensions).toContain('merge-conflicts');
    expect(meta.scoringDimensions).toContain('architectural-consistency');
    expect(meta.scoringDimensions).toContain('completion');
  });

  it('produces 4 agent tasks', () => {
    const tasks = scenario.getAgentTasks();
    expect(tasks).toHaveLength(4);
  });

  it('first 3 tasks are parallel workers, 4th is merge agent', () => {
    const tasks = scenario.getAgentTasks();
    // First 3 have different roles
    expect(tasks[0]!.role).toBe('caching');
    expect(tasks[1]!.role).toBe('audit-logging');
    expect(tasks[2]!.role).toBe('input-validation');
    expect(tasks[3]!.role).toBe('merge-agent');
  });
});
```

**Step 2: Implement the scenario**

Create `src/scenarios/concurrent-agents.ts` following the pattern of `refactoring-handoff.ts`. Key differences:

- `executionMode: 'parallel'` in metadata
- 4 agent tasks: 3 parallel workers + 1 sequential merge agent
- Override `execute()` to run first 3 in parallel, then 4th sequentially
- Scoring functions for merge conflicts, architectural consistency, completion
- Ground truth: 3 expected components (cache service, audit service, validation middleware)

Agent prompts:
- Agent A: "Add a caching layer to the service layer using a CacheService..."
- Agent B: "Add audit logging to track all service operations..."
- Agent C: "Add input validation middleware for all service methods..."
- Agent D (merge): "Review the codebase. Multiple developers have been working in parallel. Resolve any merge conflicts, fix any integration issues, and ensure all tests pass."

**Step 3: Update ScenarioName type and registry**

**Step 4: Run tests**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

**Step 5: Commit**

```bash
git add src/scenarios/concurrent-agents.ts src/types/scenario.ts src/scenarios/registry.ts tests/unit/scenarios/concurrent-agents.test.ts
git commit -m "feat: add concurrent-agents scenario for parallel coordination testing"
```

---

## Task 13: Add `conflict-resolution` Scenario

**Files:**
- Create: `src/scenarios/conflict-resolution.ts`
- Modify: `src/types/scenario.ts` (add to ScenarioName)
- Modify: `src/scenarios/registry.ts`
- Test: `tests/unit/scenarios/conflict-resolution.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createConflictResolutionScenario } from '../../../src/scenarios/conflict-resolution.js';

describe('ConflictResolutionScenario', () => {
  const scenario = createConflictResolutionScenario();

  it('has correct metadata', () => {
    const meta = scenario.getMetadata();
    expect(meta.name).toBe('conflict-resolution');
    expect(meta.agentSessionCount).toBe(3);
    expect(meta.excludeFromAll).toBe(false);
    expect(meta.scoringDimensions).toContain('conflict-detection');
    expect(meta.scoringDimensions).toContain('resolution-quality');
    expect(meta.scoringDimensions).toContain('decision-documentation');
  });

  it('first two agents have contradictory preferences', () => {
    const tasks = scenario.getAgentTasks();
    expect(tasks[0]!.prompt).toContain('event-driven');
    expect(tasks[0]!.prompt).toContain('event bus');
    expect(tasks[1]!.prompt).toContain('direct service-to-service');
  });

  it('third agent is the resolver', () => {
    const tasks = scenario.getAgentTasks();
    expect(tasks[2]!.prompt).toContain('conflict');
    expect(tasks[2]!.role).toBe('resolver');
  });
});
```

**Step 2: Implement the scenario**

Create `src/scenarios/conflict-resolution.ts`. 3 sequential agents:
- Agent A: "Implement the notification system using an event-driven architecture with an EventBus. Create EventBus in src/events/, register event types, and have services emit events instead of calling each other directly. This is the preferred pattern for decoupling."
- Agent B: "Implement the notification system using direct service-to-service calls. Have NotificationService called directly by other services. This is the preferred pattern for simplicity and debuggability."
- Agent C (resolver): "Review the notification implementation in this codebase. Two prior developers may have made conflicting architectural choices. Identify any conflicts in the notification approach, choose the better pattern with clear justification, and unify the codebase so it follows a single consistent architecture. Document your decision and rationale."

Scoring:
- `conflict-detection` (30%): Did Agent C identify the contradiction? Check transcript for mentions of both patterns.
- `resolution-quality` (40%): LLM judge — is the final architecture unified and well-justified?
- `decision-documentation` (30%): Was the resolution rationale recorded? Check for coordination file changes, Twining decisions, or code comments.

**Step 3: Register and run tests**

**Step 4: Commit**

```bash
git add src/scenarios/conflict-resolution.ts src/types/scenario.ts src/scenarios/registry.ts tests/unit/scenarios/conflict-resolution.test.ts
git commit -m "feat: add conflict-resolution scenario for architectural disagreement testing"
```

---

## Task 14: Add `context-recovery` Scenario

**Files:**
- Create: `src/scenarios/context-recovery.ts`
- Modify: `src/types/scenario.ts` (add to ScenarioName)
- Modify: `src/scenarios/registry.ts`
- Test: `tests/unit/scenarios/context-recovery.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createContextRecoveryScenario } from '../../../src/scenarios/context-recovery.js';

describe('ContextRecoveryScenario', () => {
  const scenario = createContextRecoveryScenario();

  it('has correct metadata', () => {
    const meta = scenario.getMetadata();
    expect(meta.name).toBe('context-recovery');
    expect(meta.agentSessionCount).toBe(2);
    expect(meta.excludeFromAll).toBe(false);
    expect(meta.scoringDimensions).toContain('orientation-efficiency');
    expect(meta.scoringDimensions).toContain('redundant-rework');
    expect(meta.scoringDimensions).toContain('completion');
    expect(meta.scoringDimensions).toContain('context-accuracy');
  });

  it('both agents get the same task prompt (recovery scenario)', () => {
    const tasks = scenario.getAgentTasks();
    // Agent B should get a prompt similar to A's but with recovery framing
    expect(tasks[0]!.prompt).toContain('analytics dashboard');
    expect(tasks[1]!.prompt).toContain('analytics dashboard');
    expect(tasks[1]!.prompt).toContain('previous session');
  });

  it('Agent A has shorter timeout than Agent B', () => {
    const tasks = scenario.getAgentTasks();
    expect(tasks[0]!.timeoutMs).toBeLessThan(tasks[1]!.timeoutMs);
  });
});
```

**Step 2: Implement the scenario**

Create `src/scenarios/context-recovery.ts`. 2 sequential agents:
- Agent A (original developer): "Design and implement an analytics dashboard API for the TaskFlow Pro project. Create: (1) GET /api/analytics/summary — returns aggregate stats, (2) GET /api/analytics/users/:id — returns per-user analytics, (3) GET /api/analytics/trends — returns time-series data. Create models in src/models/analytics.ts, service in src/services/analytics.service.ts, and tests. Follow the existing repository pattern." Timeout: 8 minutes (enough for ~60% completion).
- Agent B (recovery agent): "You are continuing work on an analytics dashboard API that a previous session started. The previous session may have been interrupted — check the current state of the codebase to understand what was already done. Complete any remaining work: ensure all 3 API endpoints are implemented (summary, per-user, trends), the analytics service is complete, models are defined, and tests pass. Do NOT redo work that is already complete." Timeout: 15 minutes.

Scoring:
- `orientation-efficiency` (25%): Tokens and time before Agent B's first productive edit (not a read). Lower is better. Uses `timeToFirstActionMs` from transcript.
- `redundant-rework` (25%): Files that Agent B modifies that Agent A already completed and committed. Detect via git diff overlap.
- `completion` (25%): Are all 3 endpoints, service, models, and tests present in final state?
- `context-accuracy` (25%): LLM judge — did Agent B correctly understand Agent A's architectural choices?

**Step 3: Register and run tests**

**Step 4: Commit**

```bash
git add src/scenarios/context-recovery.ts src/types/scenario.ts src/scenarios/registry.ts tests/unit/scenarios/context-recovery.test.ts
git commit -m "feat: add context-recovery scenario for session handoff testing"
```

---

## Summary: Task Dependencies

```
Task 1 (missing data) ─────────────────────────┐
Task 2 (Mann-Whitney U) ───────────────────────┤
Task 3 (overhead penalty) ──────────────────────┤
Task 4 (dual rubrics) ─────────────────────────┤── Block 1: Foundation
Task 5 (LLM judge tests) ──────────────────────┤
Task 6 (Twining system prompt) ────────────────┤
Task 7 (seeded execution order) ────────────────┘
                                                │
Task 8 (smoke test) ────────────────────────────── Block 2: Validation (depends on Block 1)
                                                │
Task 9 (twining-lite condition) ────────────────┤
Task 10 (persistent-history condition) ─────────┤── Block 3: Slices (depend on Block 1)
Task 11 (parallel execution support) ───────────┤
Task 12 (concurrent-agents scenario) ──── depends on Task 11
Task 13 (conflict-resolution scenario) ─────────┤
Task 14 (context-recovery scenario) ────────────┘
```

Tasks within Block 1 are independent of each other.
Tasks 9, 10, 13, 14 are independent of each other.
Task 12 depends on Task 11 (parallel execution support).
