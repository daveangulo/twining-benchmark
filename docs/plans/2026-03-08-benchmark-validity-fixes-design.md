# Benchmark Validity Fixes — Design Document

**Date:** 2026-03-08
**Author:** Dave (Product Owner) / Claude Opus 4.6 (Design)
**Status:** Approved
**Approach:** Vertical Slices (fix core + smoke test, then independent condition/scenario slices)

---

## Problem Statement

A senior research engineering review of the benchmark harness identified ~20 issues across 4 categories: correctness bugs producing wrong numerical results, scoring methodology biases that could unfairly favor or penalize conditions, missing experimental controls, and gaps in condition/scenario coverage. These must be fixed before benchmark results can be considered valid.

## Scope

- Fix all known bugs
- Fix all validity threats in scoring methodology
- Add high-priority missing conditions (twining-lite, persistent-history)
- Add high-priority missing scenarios (concurrent-agents, conflict-resolution, context-recovery)
- Build end-to-end smoke test infrastructure

## Decisions

- **Dual-rubric approach** for LLM judge: keep coordination-aware rubrics, add parallel standalone quality rubrics. Both scores reported, enabling `coordinationLift` metric.
- **Smooth overhead penalty** for initial runs (`overhead_ratio x 100`), flagged as provisional pending empirical calibration.
- **Mann-Whitney U as primary significance test**, z-test retained as secondary reference.
- **Smoke test: both CLI command and CI-gated** (`RUN_E2E=true`).

---

## Section 1: Bug Fixes (Foundation)

### 1.1 Population vs Sample Standard Deviation

**File:** `src/analyzer/statistics.ts`

Change `standardDeviation` import to `sampleStandardDeviation` from `simple-statistics`. Single line change. All downstream consumers are correct — they just receive the wrong value today.

### 1.2 Transcript Index Misalignment

**File:** `src/scenarios/scenario.interface.ts` (~line 129)

When a task throws in `BaseScenario.execute()`, no transcript is pushed, shifting subsequent indices. Fix: push a sentinel/error transcript for failed tasks so indices always match task sequence order. The sentinel carries `{ status: 'failed', error: message, taskIndex: i }` and scoring logic skips sentinels.

### 1.3 Silent Perfect Scores on Missing Data

**Files:** All 5 scenario `doScore()` methods

When `fileChanges[].diff` is undefined (missing git enrichment), regex matching produces 0 matches which result in perfect scores. Fix: detect missing data explicitly and return a low-confidence result with score 0 and a `dataQuality: 'missing'` flag rather than silently scoring 100.

### 1.4 Duplicated `extractMetrics()` Across Scenarios

**Files:** All 5 scenario files

Copy-pasted ~60-line method. Extract to a shared utility in `src/scenarios/shared/extract-metrics.ts` and import in each scenario. Pure refactor, no behavior change.

---

## Section 2: Scoring Methodology Fixes

### 2.1 Replace Z-Test with Mann-Whitney U in `rankConditions()`

**File:** `src/analyzer/composite-scorer.ts` (~`rankConditions()`)

The existing Mann-Whitney U implementation in `statistics.ts` is correct. Replace the z-test significance calculation in `rankConditions()` with a call to the existing `mannWhitneyU()`. Keep the z-test result as a secondary field (`zTestPValue`) on the ranking output for reference, clearly marked as "not appropriate for N < 30."

### 2.2 Smooth Overhead Penalty

**File:** `src/analyzer/composite-scorer.ts` (CES calculation)

Replace `max(0, (ratio - 0.10)) x 200` with a continuous linear penalty: `overhead_ratio x 100`. This means 10% overhead = 10 penalty points (before weighting), 20% = 20 points. No cliff. Add a comment flagging this as provisional, pending empirical calibration from first real runs. Add a `overheadPenaltyFormula: 'linear-v1' | 'calibrated'` field to run metadata so future calibration is traceable.

### 2.3 Dual-Rubric LLM Judge (Coordination Quality + Standalone Quality)

**File:** `src/analyzer/llm-judge.ts`

Add 4 new standalone quality prompt templates alongside the existing coordination-aware ones:

| Existing (Coordination) | New (Standalone) |
|---|---|
| `DECISION_CONSISTENCY_TEMPLATE` | `CODE_CORRECTNESS_TEMPLATE` — Does the code work? Does it handle edge cases? |
| `INTEGRATION_QUALITY_TEMPLATE` | `ARCHITECTURAL_SOUNDNESS_TEMPLATE` — Is the architecture clean regardless of how many agents built it? |
| `ARCHITECTURAL_COHERENCE_TEMPLATE` | `MAINTAINABILITY_TEMPLATE` — Is the code readable, well-structured, testable? |
| `REDUNDANCY_DETECTION_TEMPLATE` | `COMPLETENESS_TEMPLATE` — Did the agents accomplish what was asked? |

The standalone templates must NOT reference agents, coordination, prior decisions, or shared state. They evaluate the final codebase as if one developer wrote it.

**Scoring output changes:**

- `coordinationScore` — existing CES formula using coordination rubrics
- `standaloneScore` — new composite using standalone rubrics (equal weights: 0.25 each, no overhead penalty)
- `coordinationLift` — `coordinationScore - standaloneScore` (positive = coordination helped, negative = coordination overhead hurt net quality)

**Types:** Add `StandaloneScoreResult` and `CoordinationLift` to `src/types/results.ts`. Update `RunResult` to carry both scores.

### 2.4 Add Real Test Coverage for LLM Judge Core Functions

**File:** `tests/unit/analyzer/llm-judge.test.ts`

Add tests for:

- `parseEvaluationResponse()` — valid JSON, malformed JSON, missing fields, score out of range
- `runSingleEvaluation()` — mock the Anthropic API call, verify prompt construction and response handling
- `runAggregatedEvaluation()` — verify median selection from 3 evaluations, variance calculation

Export `parseEvaluationResponse` if not already exported (currently private).

---

## Section 3: Twining Condition Validity Fix

### 3.1 Fix Full-Twining System Prompt to Engage Lifecycle Gates

**File:** `src/conditions/full-twining.ts`

The single highest-impact validity fix. Currently the system prompt vaguely says "You have access to Twining." Replace with explicit lifecycle gates that mirror real Twining usage:

```
Before starting work:
1. Call twining_assemble with your task description to get context from prior agents
2. Call twining_why on any files you plan to modify

While working:
3. Call twining_decide for any architectural or implementation choice where alternatives exist
4. Call twining_post with entry_type "finding" for discoveries, "warning" for gotchas

Before finishing:
5. Call twining_verify on your scope
6. Call twining_post with entry_type "status" summarizing what you did
7. Call twining_handoff with your results for the next agent
```

Do NOT add similar procedural guidance to other conditions' system prompts. File-reload conditions already have their own procedural prompts — that's fair.

### 3.2 Update CLAUDE.md Content for Full-Twining Condition

**File:** `src/conditions/full-twining.ts` (CLAUDE.md content written during setup)

Include the same lifecycle gates section (orient, decide, verify) that appears in real Twining-instrumented projects.

---

## Section 4: Execution Order & Reproducibility

### 4.1 Implement Seeded Randomization of Execution Order

**File:** `src/runner/orchestrator.ts`

When `seed` is provided, use it to create a seeded PRNG and shuffle `(scenario, condition, iteration)` execution tuples via Fisher-Yates. When omitted, use current fixed order. Log effective order to run metadata.

### 4.2 Capture Per-Iteration Environment Snapshots

**File:** `src/runner/orchestrator.ts` (~`executeIteration()`)

Add lightweight per-iteration snapshot: wall clock timestamp start/end, iteration index in shuffled order, cumulative API token spend. Store in existing iteration metadata.

---

## Section 5: End-to-End Smoke Test

### 5.1 Smoke Test Infrastructure

**New file:** `src/runner/smoke-test.ts`

Runs `refactoring-handoff` scenario under `baseline` and `full-twining` conditions, single iteration each. Hard budget cap $10, 5-minute per-session timeout.

Validates:

- Transcripts contain expected structure (messages, tool calls, token usage)
- Baseline transcript does NOT contain `twining_*` tool calls
- Full-twining transcript DOES contain `twining_assemble` and `twining_decide` calls
- Scoring pipeline produces non-sentinel results with `dataQuality: 'complete'`
- Condition isolation — no `.twining/` directory in baseline working dir
- Both standalone and coordination scores are populated

### 5.2 CLI Command

**New file:** `src/cli/commands/smoke-test.ts`

```bash
twining-bench smoke-test [--timeout <minutes>] [--budget <dollars>]
```

Summary table of checks passed/failed. Exit code 0/1.

### 5.3 CI-Gated Version

**New file:** `tests/e2e/smoke-test.test.ts`

Gated behind `RUN_E2E=true` env var. Long timeout (10 minutes). Skips with clear message when env var not set.

---

## Section 6: New Conditions

### 6.1 `twining-lite` Condition

**New file:** `src/conditions/twining-lite.ts`

Same MCP server as `full-twining` but restricted to 8 core tools:

- Blackboard: `twining_post`, `twining_read`, `twining_query`, `twining_recent`
- Decisions: `twining_decide`, `twining_search_decisions`
- Handoff: `twining_handoff`, `twining_acknowledge`

Excludes: knowledge graph, verification, advanced decisions, discovery (18 tools).

System prompt: Simplified lifecycle gates — orient via `twining_query`, decide, handoff. No verification gate.

**Hypothesis:** Is the full 26-tool suite necessary, or do core blackboard + decisions suffice?

### 6.2 `persistent-history` Condition

**New file:** `src/conditions/persistent-history.ts`

Agents share conversation context rather than starting fresh. No coordination files.

- System prompt: Standard project guidance (similar to claude-md-only)
- CLAUDE.md: Standard project conventions
- No CONTEXT.md, no COORDINATION.md

**Key implementation change:** `agent-session.ts` gets a `conversationHistory` option. When condition returns `persistHistory: true`, session manager accumulates transcripts across tasks within an iteration, passing prior agents' output as conversation prefix.

**Hypothesis:** Does /clear pattern help or hurt compared to continuous conversation?

### 6.3 Register Both in Condition Registry

**File:** `src/conditions/registry.ts`

---

## Section 7: New Scenarios

### 7.1 `concurrent-agents` Scenario

**New file:** `src/scenarios/concurrent-agents.ts`

3 agents working simultaneously — Agent A (caching), Agent B (audit logging), Agent C (input validation). All touch overlapping files.

Launched via `Promise.all()`. A final sequential merge agent resolves conflicts and runs integration tests.

**Scoring:** merge conflict severity (40%), architectural consistency (30%), completion rate (30%).

**Hypothesis:** Does Twining's blackboard enable concurrent coordination that file-based approaches can't match?

### 7.2 `conflict-resolution` Scenario

**New file:** `src/scenarios/conflict-resolution.ts`

2 agents given contradictory architectural preferences (event-driven vs direct calls), then Agent C must identify the conflict, choose the better approach, and unify.

**Scoring:** conflict detection (30%), resolution quality (40%), decision documentation (30%).

**Hypothesis:** Does coordination tooling help surface and resolve architectural disagreements?

### 7.3 `context-recovery` Scenario

**New file:** `src/scenarios/context-recovery.ts`

Agent A works on a substantial task, then simulated crash wipes conversation context. Agent B must orient to partial work and complete it.

**Scoring:** orientation efficiency (25%), redundant rework (25%), completion rate (25%), context accuracy (25%).

**Hypothesis:** Does `twining_assemble` provide faster/more accurate context recovery than manual file reading?

### 7.4 Register All Three in Scenario Registry

**File:** `src/scenarios/registry.ts`

`concurrent-agents` and `conflict-resolution` included in `--scenario all`. `context-recovery` also included (not parameterized, predictable cost).

### 7.5 Update `BaseScenario` for Parallel Execution Support

**File:** `src/scenarios/scenario.interface.ts`

Add `executionMode: 'sequential' | 'parallel'` field (default: `sequential`). When `parallel`, `execute()` launches sessions via `Promise.all()`. Only `concurrent-agents` uses this initially.

---

## Implementation Sequencing (Vertical Slices)

### Block 1: Foundation (must complete first)
- Section 1 (bug fixes) — all independent, can parallelize
- Section 2 (scoring methodology) — depends on 1.1 for stddev fix
- Section 3 (Twining system prompt) — independent
- Section 4 (execution order) — independent

### Block 2: Validation (depends on Block 1)
- Section 5 (smoke test) — validates all Block 1 changes

### Block 3: New Capabilities (depends on Block 1, independent of each other)
- Section 6.1 (twining-lite condition)
- Section 6.2 (persistent-history condition)
- Section 7.1 (concurrent-agents scenario)
- Section 7.2 (conflict-resolution scenario)
- Section 7.3 (context-recovery scenario)

Each Block 3 item is an independent vertical slice that can be developed in parallel.
