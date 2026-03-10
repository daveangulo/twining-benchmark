# Research Review Response — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address research review feedback to make initial benchmark results publishable, then strengthen toward research grade.

**Architecture:** Three pre-publication phases (blocking), then three post-publication phases (strengthening).

**Tech Stack:** TypeScript, vitest, simple-statistics, @anthropic-ai/sdk

---

## Pre-Publication: Must Complete Before Sharing Results

### Task 1: Update PRD to Match Implementation

**Files:**
- Modify: `PRD.md`

**Step 1:** Search PRD for all references to "6 conditions" and update to 8. Search for "5 scenarios" and update to 8.

**Step 2:** Find the CES overhead penalty description and update from `max(0, (ratio - 0.10)) * 200` to `ratio * 100` (smooth linear, provisional). Add note that this is pending empirical calibration.

**Step 3:** Add the 3 new scenarios (concurrent-agents, conflict-resolution, context-recovery) and 2 new conditions (twining-lite, persistent-history) to the relevant PRD sections.

**Step 4:** Add the dual-rubric scoring methodology (coordination + standalone + coordination lift) to the scoring section.

**Step 5:** Commit: "docs: align PRD with current implementation (8 conditions, 8 scenarios, smooth penalty, dual rubrics)"

---

### Task 2: Surface Primary Metrics in Results Display

**Files:**
- Modify: `src/cli/commands/results.ts`
- Modify: `src/results/exporter.ts`
- Test: `tests/unit/cli/results-display.test.ts`

The data already exists in `RunMetrics`. The issue is that the results display and export only emphasize CES.

**Step 1:** Read `src/cli/commands/results.ts` to understand the current display format.

**Step 2:** Add a "Primary Metrics" section to the results display that shows per-condition:
- Task success rate (allSessionsCompleted count / total)
- Tests passing (testsPass / (testsPass + testsFail))
- Cost per run (costUsd from RunMetrics)
- Wall time (wallTimeMs)
- Compilation success (compiles boolean)

Display these BEFORE the CES section, not after.

**Step 3:** Update the markdown exporter to include primary metrics table.

**Step 4:** Add test verifying primary metrics appear in output.

**Step 5:** Run `npx vitest run --reporter=verbose`

**Step 6:** Commit: "feat: surface primary metrics (success rate, test pass, cost, time) prominently in results"

---

### Task 3: Capture Reproducibility Metadata

**Files:**
- Modify: `src/runner/orchestrator.ts` (captureEnvironment)
- Modify: `src/types/run.ts` (RunEnvironment type)
- Test: `tests/unit/runner/orchestrator.test.ts`

**Step 1:** Read `src/types/run.ts` to find the `RunEnvironment` interface.

**Step 2:** Expand `RunEnvironment` to include:
```typescript
export interface RunEnvironment {
  nodeVersion: string;
  platform: string;
  claudeModel: string;
  // New fields:
  evaluatorModel: string;
  harnessVersion: string;      // from package.json version
  harnessCommitSha: string;    // git rev-parse HEAD
  twiningMcpVersion: string;   // twining-mcp --version or package.json
  runSeed?: string;
}
```

**Step 3:** Update `captureEnvironment()` in `src/runner/orchestrator.ts` to populate these fields. Use `execSync` for git SHA and twining-mcp version.

**Step 4:** Add test verifying new fields are captured.

**Step 5:** Run tests, commit: "feat: capture harness commit SHA, evaluator model, and MCP version in run metadata"

---

### Task 4: Blinded Judge Evaluation

**Files:**
- Modify: `src/analyzer/llm-judge.ts`
- Modify: `src/types/results.ts` (EvaluationContext or similar)
- Test: `tests/unit/analyzer/llm-judge.test.ts`

This is the most critical credibility fix. The judge currently sees coordination artifacts which can bias scoring.

**Step 1:** Read `src/analyzer/llm-judge.ts` to understand how `EvaluationContext` is built and what the judge sees.

**Step 2:** Add a `blindMode` option to evaluation functions:
```typescript
export interface EvaluationOptions {
  blindMode?: boolean;  // default: false for backward compat
}
```

**Step 3:** When `blindMode` is true:
- Set `coordinationArtifacts` to empty string (judge sees no coordination files)
- Strip condition name from any context passed to the judge
- Strip file paths containing `.twining/`, `COORDINATION.md`, `CONTEXT.md`, `coordination/` from code diffs — replace with generic path
- Strip tool call names that reveal condition identity (e.g., `twining_decide` → `coordination_tool_1`)

**Step 4:** The standalone quality templates should ALWAYS use blind mode (they're coordination-agnostic by design). Update `evaluateStandaloneQuality()` to force `blindMode: true`.

**Step 5:** For coordination rubrics, use a "semi-blind" mode: pass artifacts but strip condition identity labels. The judge should evaluate coordination quality without knowing WHICH coordination system produced it.

**Step 6:** Write tests:
- Verify blind mode strips coordination artifacts
- Verify blind mode strips condition-revealing tool names from diffs
- Verify standalone evaluation always uses blind mode
- Verify semi-blind mode preserves artifacts but strips identity

**Step 7:** Run tests, commit: "feat: add blinded judge evaluation to prevent artifact leakage bias"

---

### Task 5: Multiple Comparison Correction

**Files:**
- Modify: `src/analyzer/statistics.ts`
- Modify: `src/analyzer/composite-scorer.ts` (where pairwise comparisons happen)
- Test: `tests/unit/analyzer/statistics.test.ts`

**Step 1:** Add Holm-Bonferroni correction function to `src/analyzer/statistics.ts`:

```typescript
/**
 * Apply Holm-Bonferroni correction to a set of p-values.
 * Returns adjusted p-values that control family-wise error rate.
 */
export function holmBonferroni(pValues: number[]): number[] {
  const n = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  const adjusted = new Array<number>(n);
  let maxSoFar = 0;
  for (let rank = 0; rank < n; rank++) {
    const corrected = indexed[rank]!.p * (n - rank);
    maxSoFar = Math.max(maxSoFar, corrected);
    adjusted[indexed[rank]!.i] = Math.min(maxSoFar, 1.0);
  }
  return adjusted;
}
```

**Step 2:** In `composite-scorer.ts` where pairwise comparisons are generated, apply Holm-Bonferroni to all p-values. Add `adjustedPValue` field to `PairwiseComparison` type. Use adjusted p-values for significance determination.

**Step 3:** Update `PairwiseComparison` in `src/types/results.ts`:
```typescript
export interface PairwiseComparison {
  conditionA: string;
  conditionB: string;
  metric: string;
  deltaPercent: number;
  pValue: number;
  adjustedPValue: number;  // Holm-Bonferroni corrected
  significance: 'significant' | 'suggestive' | 'not-distinguishable';
}
```

**Step 4:** Write tests for Holm-Bonferroni (known inputs/outputs).

**Step 5:** Run tests, commit: "feat: add Holm-Bonferroni multiple comparison correction to pairwise tests"

---

### Task 6: Emphasize Effect Sizes Over P-Values

**Files:**
- Modify: `src/cli/commands/results.ts`
- Modify: `src/results/exporter.ts`

**Step 1:** In the results display and export, reorder columns in comparison tables:
- Lead with: condition pair, delta, Cohen's d (with interpretation: small/medium/large)
- Follow with: adjusted p-value, significance indicator
- The visual emphasis should be on "how big is the difference" not "is it statistically significant"

**Step 2:** In the KPI summary, add a "Key Effect Sizes" section that highlights the largest Cohen's d values across all comparisons.

**Step 3:** Run tests, commit: "feat: emphasize effect sizes over p-values in results display"

---

### Task 7: Write Limitations Section for Results

**Files:**
- Create: `docs/benchmark-limitations.md`

Document known limitations that should accompany any published results:

1. **Hand-designed CES weights** — weights are not empirically validated; primary metrics should be consulted alongside CES
2. **Same-family judge model** — agents and evaluator share the Claude model family; cross-model validation pending
3. **Synthetic TypeScript target** — clean architecture may favor coordination-aware systems; real-world codebases may produce different results
4. **Small sample sizes** — 3 runs per pair; bootstrap CIs pending
5. **No factorial ablation** — cannot isolate which Twining component drives improvements
6. **Smooth overhead penalty** — provisional formula pending calibration from empirical data

Commit: "docs: add benchmark limitations disclosure for published results"

---

### Task 8: Run Initial Results

After Tasks 1-7 are complete, run the focused benchmark:

```bash
node dist/cli/index.js run \
  --scenario refactoring-handoff,architecture-cascade,bug-investigation,context-recovery \
  --condition baseline,claude-md-only,file-reload-structured,full-twining,twining-lite \
  --runs 3 \
  --seed initial-results-v1 \
  --budget 250
```

4 scenarios x 5 conditions x 3 runs = 60 iterations, ~$200 estimated.

---

## Post-Publication: Strengthen Toward Research Grade

### Task 9: Factorial Ablation Conditions (Phase 3)

Add 3 new conditions that isolate individual Twining mechanisms:
- `shared-state-only` — blackboard (post/read/query), no decisions, no graph
- `decisions-only` — decision tracking (decide/search/why), no blackboard, no graph
- `graph-only` — knowledge graph (add_entity/add_relation/neighbors), no blackboard, no decisions

Plus a "null hypothesis" scenario where coordination should NOT help (single-agent task).

### Task 10: Cross-Model Judges (Phase 4)

Run evaluation with GPT-4o and Gemini as alternative judges. Compare inter-judge agreement (Cohen's kappa). Report multi-judge consensus.

### Task 11: Human Calibration Sample (Phase 4)

Score 10-20 runs manually. Compute judge-human correlation (Pearson r, Spearman rho). Report calibration.

### Task 12: Bootstrap Confidence Intervals (Phase 4)

Replace normal-approximation CIs with bootstrap CIs (10,000 resamples). More robust for small N.

### Task 13: Benchmark Expansion (Phase 5)

- Non-TypeScript targets (Python, Go)
- Ambiguous specification scenarios
- Incomplete/messy codebase targets
- Long-horizon tasks (10+ sessions)

---

## Dependency Graph

```
Task 1 (PRD update) ──────────────────┐
Task 2 (primary metrics) ─────────────┤
Task 3 (reproducibility metadata) ────┤── All block Task 8 (initial run)
Task 4 (blinded judge) ───────────────┤
Task 5 (multiple comparison) ─────────┤
Task 6 (effect size emphasis) ─────────┤
Task 7 (limitations doc) ─────────────┘

Tasks 1-3 are independent of each other.
Task 6 depends on Task 5 (needs adjustedPValue field).
Task 4 is independent of Tasks 1-3, 5-6.
Task 7 is independent (just documentation).

Tasks 9-13 are post-publication, independent of each other.
```
