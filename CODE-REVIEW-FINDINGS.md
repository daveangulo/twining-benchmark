# Code Review Findings — Twining Benchmark Harness

**Date:** 2026-02-25
**Reviewer:** Senior Software Engineer (Claude Opus 4.6)
**Scope:** Full codebase review against PRD.md, Phase 2 level
**Codebase:** ~15,700 lines source, ~8,000 lines test, 466 tests (all passing)

---

## Executive Summary

The harness has a solid foundation — the type system is well-designed, the CLI structure is clean, and the scenario/condition registry pattern is extensible. However, there are several critical correctness bugs that would silently produce wrong numerical results, and multiple tests that provide false confidence by testing existence rather than behavior. The integration tests are mislabeled unit tests that mock out all real functionality.

---

## 1. CRITICAL: Statistical Correctness Bug (Population vs Sample Std Dev)

**File:** `src/analyzer/statistics.ts:4,25`
**Impact:** Every numerical output — CIs, significance tests, Cohen's d — is wrong.

The import uses `standardDeviation` from `simple-statistics`, which computes the **population** standard deviation (divides by N). For benchmark samples (small N, typically 3–10 runs), the correct function is `sampleStandardDeviation` (divides by N−1).

```typescript
// CURRENT (wrong):
import { standardDeviation as ssStdDev } from 'simple-statistics';
const stdDev = n >= 2 ? ssStdDev(values) : 0;

// CORRECT:
import { sampleStandardDeviation as ssStdDev } from 'simple-statistics';
const stdDev = n >= 2 ? ssStdDev(values) : 0;
```

**Why it matters:** For N=3, population stddev is ~18% smaller than sample stddev. This means:
- Confidence intervals are too narrow → false precision
- p-values in significance tests are too small → false positives
- Cohen's d is inflated → effect sizes appear larger than they are

**Fix:** Single import rename. All downstream consumers are correct — they just receive the wrong value.

---

## 2. HIGH: Tests That Don't Test Functionality

### 2a. `tests/unit/analyzer/code-analysis.test.ts` (69 lines, 3 tests)

The 469-line `code-analysis.ts` module has near-zero behavioral test coverage:

- **Test 1:** "exports expected functions" — checks `typeof mod.X === 'function'`. This is a module existence check, not a test.
- **Test 2:** `detectPatterns` against fixture — one integration-style test, but doesn't cover `parseTestOutput`, `analyzeGitChurn`, `checkCompilation`, or `runTestSuite` with actual data.
- **Test 3:** "TestSuiteResults has expected shape" — calls `runTestSuite('/nonexistent/path')` and asserts the error-fallback return shape. This tests the error path, not the happy path.

**Missing tests:** `parseTestOutput` regex parsing with real vitest/jest output, `analyzeGitChurn` with actual git history, `checkCompilation` with valid/invalid TypeScript.

### 2b. `tests/unit/analyzer/llm-judge.test.ts` (144 lines, 10 tests)

The 405-line `llm-judge.ts` module's core functions are completely untested:

- `runSingleEvaluation()` — performs the actual LLM API call and response parsing — **zero tests**
- `runAggregatedEvaluation()` — orchestrates multi-template evaluation — **zero tests**
- `parseEvaluationResponse()` — parses JSON from LLM response — **zero tests** (not even exported)

What IS tested: string interpolation in `buildEvaluatorPrompt()`, constant values on template objects, and template placeholder existence. These are essentially snapshot tests of string literals.

### 2c. Integration Tests Are Unit Tests in Disguise

**File:** `tests/integration/phase1-exit-criterion.test.ts` (131 lines)

Completely mocks `AgentSessionManager` with a class that returns fabricated data. This tests orchestration plumbing with fake agent responses — it never runs a real agent, touches a real repo, or validates exit criteria.

**File:** `tests/integration/phase2-exit-criterion.test.ts` (306 lines)

Tests scoring and reporting functions with hand-crafted mock data. These are unit tests of `calculateCes`, `aggregateResults`, `rankConditions`, and `exportMarkdown` — valuable, but mislabeled as integration tests.

**Impact:** There are no actual integration tests. The exit criteria for Phase 1 and Phase 2 have never been validated end-to-end.

---

## 3. HIGH: Scenario Execution Bugs

### 3a. Transcript-Index Bug in `BaseScenario.execute()`

**File:** `src/scenarios/scenario.interface.ts:129-164`

When a task throws an exception in the catch block, no transcript is pushed to the `transcripts` array, but the loop continues. If tasks 1 and 3 succeed but task 2 throws, `transcripts[0]` = task 1, `transcripts[1]` = task 3. Any scoring logic that relies on transcript index matching task sequence order will produce wrong scores.

```typescript
// CURRENT:
} catch (err) {
  allCompleted = false;
  const message = err instanceof Error ? err.message : String(err);
  errors.push(`Task ${task.sequenceOrder} failed: ${message}`);
  // <-- no transcript pushed, shifting subsequent indexes
}
```

**Fix:** Push a sentinel/placeholder transcript for failed tasks, or use a `Map<number, AgentTranscript>` keyed by sequence order.

### 3b. `extractMetrics()` Duplicated Across All 5 Scenarios

**Files:** All 5 scenario files contain a ~60-line `private extractMetrics(rawResults: RawResults)` method that is copy-pasted verbatim.

| File | Line |
|------|------|
| `src/scenarios/refactoring-handoff.ts` | 452 |
| `src/scenarios/architecture-cascade.ts` | 580 |
| `src/scenarios/bug-investigation.ts` | 531 |
| `src/scenarios/multi-session-build.ts` | 646 |
| `src/scenarios/scale-stress-test.ts` | 606 |

**Impact:** Any bug fix or enhancement must be made in 5 places. This is a clear candidate for extraction to `BaseScenario` or a shared utility.

### 3c. No LLM-as-Judge Scoring Anywhere

Despite the PRD requiring LLM-as-judge for FR-SCN-002 (Architecture Cascade coherence) and FR-SCN-004 (Multi-Session Build), none of the 5 scenario `doScore()` methods invoke the LLM judge. All scoring is heuristic-based.

### 3d. Scoring Dimension Name Mismatch

The scenario registry uses kebab-case dimension names (`decision-consistency`) but scenario `doScore()` implementations use camelCase (`consistency`). This may cause silent scoring failures if the registry validates dimension names.

---

## 4. HIGH: Condition Setup Bugs

### 4a. Baseline Condition: `.claude` Directory Removal Fails on Subdirectories

**File:** `src/conditions/baseline.ts:29-35`

```typescript
const entries = await readdir(claudeDir);
for (const entry of entries) {
  await unlink(join(claudeDir, entry));  // <-- fails if entry is a directory
}
```

`unlink` only works on files. If `.claude/` contains subdirectories (which it can), this throws EPERM/EISDIR.

**Fix:** Use `rm(claudeDir, { recursive: true, force: true })` to remove the whole directory.

### 4b. Full-Twining Condition: Missing 7 MCP Tools

**File:** `src/conditions/full-twining.ts:61-91`

The `allowedTools` array is missing these Twining tools that are part of the Twining API:

| Missing Tool | Purpose |
|---|---|
| `mcp__twining__twining_archive` | Lifecycle management |
| `mcp__twining__twining_agents` | Agent coordination |
| `mcp__twining__twining_discover` | Agent discovery |
| `mcp__twining__twining_delegate` | Task delegation |
| `mcp__twining__twining_handoff` | Work handoff |
| `mcp__twining__twining_acknowledge` | Handoff acceptance |
| `mcp__twining__twining_what_changed` | Change tracking |

Multi-agent scenarios (scale-stress-test with 8 agents) would be unable to use delegation/handoff, which is a core Twining feature being benchmarked.

### 4c. Full-Twining Condition: Artifact Collection Incomplete

**File:** `src/conditions/full-twining.ts:107-109`

```typescript
protected override getCoordinationFilePaths(): string[] {
  return ['CLAUDE.md'];
}
```

This only collects `CLAUDE.md` as a coordination artifact. The `.twining/` directory (blackboard, decisions, knowledge graph) is the primary Twining coordination artifact and is completely ignored in data collection.

---

## 5. HIGH: Runner Module Issues

### 5a. Resume Logic is Dead Code

**File:** `src/runner/orchestrator.ts:145,271-273`

`completedSessionIds` is computed from resume state and passed to `executeIteration()`, but inside `executeIteration()` it is destructured out and never read:

```typescript
// Line 273: destructures but ignores completedSessionIds
const { runId, scenario, condition, iteration, collector } = params;
//                                                           ^ completedSessionIds NOT destructured
```

The `--resume` flag appears functional but actually re-runs every iteration from scratch.

### 5b. Error Classification Maps `error_max_turns` to `completed`

**File:** `src/runner/agent-session.ts`

When an agent session hits its maximum turn limit, it's classified as `completed` instead of a distinct status. This means sessions that timed out by exceeding turns are indistinguishable from genuinely completed sessions in analysis.

### 5c. Silent Error Swallowing in Data Collector

**File:** `src/runner/data-collector.ts`

Multiple `catch {}` blocks that silently swallow errors during data enrichment. If git operations fail during `enrichAndSave()`, the collected data silently loses git churn metrics without any indication.

---

## 6. MEDIUM: Missing PRD Features

| PRD Requirement | Status | Impact |
|---|---|---|
| FR-CFG-001: Config file loading (`tbh.config.ts`) | `init` command writes template, `run` never loads it | Config is decoration only |
| FR-RUN-003: Budget enforcement | Projection-only; never actually stops execution | Unbounded API spend |
| FR-RUN-001: Seed determinism | `--seed` accepted by CLI but never wired to RNG | Runs are not reproducible |
| FR-SCN-002/004: LLM-as-judge scoring | Templates exist, API call logic exists, never invoked by scenarios | Scoring is entirely heuristic |
| FR-ANL-002: Diff-based completeness | Scenarios score based on completion flags, not actual code diff analysis | Quality unmeasured |
| FR-TGT-002: External repo adapter | `cmd.split(' ')` breaks on quoted arguments; no working copy isolation | Unusable with complex setups |
| FR-TGT-001: Generator validation | `validate()` is a no-op; `fileCount` parameter accepted but unused | Non-functional repos |
| FR-DSH-005: Export command | `twining-bench export --format <md\|csv\|png>` not registered in CLI | No export CLI |
| NFR-004: Reproduce command | `twining-bench reproduce <run-id>` entirely absent | Not implemented |
| FR-CLI-001: `--output` flag | Not present on `run` command; results always go to default directory | Can't customize output path |
| FR-CLI-001: `--scale-factor` | Accepted by CLI but never wired to scale-stress-test scenario | Silently ignored |
| FR-CLI-002: Scenario descriptions | `scenarios list` table omits description column | Minor display gap |

---

## 7. MEDIUM: Code Smells

### 7a. `approxNormalCdf` Duplicated 3x

The same normal CDF approximation appears in three files:
- `src/cli/commands/results.ts:302`
- `src/analyzer/composite-scorer.ts:345`
- `src/analyzer/statistics.ts:449`

Additionally, `estimateCost` is duplicated between `src/phase0/phase0-runner.ts:517` and `src/phase0/phase0-analyze.ts:337`, and `formatDuration` is duplicated between `src/cli/utils/progress.ts:22` and `src/phase0/phase0-runner.ts:499`. The Phase 0 types (`Phase0RunResult`, `Phase0SessionResult`) are also redefined in both phase0 files rather than shared.

### 7b. `results compare` Uses Different Statistical Test Than Analysis Pipeline

**File:** `src/cli/commands/results.ts:236`

The comparison view computes significance using a Wald z-test from aggregated means/stddevs, while the rest of the analysis pipeline uses Mann-Whitney U. Significance indicators can disagree between `results show` and `results compare` for the same data.

### 7c. `rankConditions` Uses Z-Test Instead of Mann-Whitney U

**File:** `src/analyzer/composite-scorer.ts`

The `rankConditions` function uses a z-test for pairwise comparisons, but the PRD specifies Mann-Whitney U for non-parametric comparison of conditions (benchmark scores aren't guaranteed normal). The correct `mannWhitneyU` function exists in `statistics.ts` but isn't used here.

### 7d. Scoring Silently Degrades to Perfect Scores on Missing Data

**File:** `src/scenarios/refactoring-handoff.ts:299`

Scoring functions access `fileChanges[i].diff` which is optional (populated by `DataCollector` after git enrichment). If enrichment fails or is skipped, `diff` is `undefined` and all regex tests silently match nothing — producing a perfect score instead of a low-confidence result. This is the opposite of safe: failures look like success.

### 7e. `contextUtilization` Can Exceed 1.0

**File:** Multiple scenario files

The `contextUtilization` metric is calculated as cumulative tokens divided by context window size. Since tokens accumulate across a multi-turn conversation, this routinely exceeds 1.0, making it meaningless as a utilization metric.

### 7f. Synchronous I/O in `code-analysis.ts`

**File:** `src/analyzer/code-analysis.ts`

`detectPatterns` uses synchronous `ts-morph` file scanning, which blocks the event loop during AST analysis. For large repos this could cause noticeable latency.

---

## 8. HIGH: Target Implementation Gaps

### 8a. Generated Repo Target Is Non-Functional

**File:** `src/targets/generator/index.ts`

Multiple compounding issues make generated repos unusable:

1. **`npm install` is never called.** The generated `package.json` lists `typescript` and `vitest` as devDependencies, but `setup()` never installs them. Without `node_modules/`, neither `tsc` nor `vitest` can run.
2. **`fileCount` parameter is dead code.** Validated (10-100) but never used — actual file count is `moduleCount × 4` regardless of the `fileCount` setting.
3. **`validate()` is a no-op.** Only checks git status for uncommitted changes. Does not run `tsc` or tests, unlike the synthetic repo target which runs both.
4. **`reset()` doesn't reset to initial commit.** Only does `git checkout . && git clean -fd`, leaving agent commits in history. Compare with the synthetic repo which does `git reset --hard <initialCommitHash>`.

**PRD violation:** FR-TGT-002 requires "Generated repos are valid TypeScript projects that compile and have passing tests."

### 8b. External Repo Target Has No Isolation

**File:** `src/targets/external/index.ts`

1. **No isolated working copies per run.** `setup()` creates a single working directory; no mechanism for independent copies. PR-TGT-003 explicitly requires: "The adapter creates an isolated working copy per run to prevent cross-contamination."
2. **`reset()` only cleans the working tree.** Agent commits persist after `reset()`, and the shallow clone (`--depth 1`) means you can't even find the initial commit to reset to.
3. **`getGroundTruth()` returns a mutable reference.** Returns `this.config.manifest` directly — caller mutations corrupt the shared config.
4. **Tests have near-zero real coverage.** No cloning, no filesystem operations, no setup commands — every test only constructs the object and checks properties.

### 8c. Scenario Scoring Weaknesses

Multiple scoring methods across scenarios produce unreliable signals:

| Scenario | Issue |
|---|---|
| `refactoring-handoff` | `scoreConsistency()` iterates all ground truth decisions but only penalizes for `caching-via-interface` — missing `extract-iuser-repository` and `preserve-repository-pattern` |
| `refactoring-handoff` | `scoreRework()` counts ALL `linesRemoved` by B in A's files as rework, even legitimate refactoring |
| `architecture-cascade` | Pattern matching is too loose — generic patterns like `subscribe`, `handler(` match across unrelated code |
| `architecture-cascade` | `scoreDecisionQuality()` gives 20 points for words like "because" and "approach" in any output |
| `bug-investigation` | `scoreRedundantInvestigation()` penalizes B for reading the buggy file, which is necessary to fix it |
| `bug-investigation` | `scoreTimeToResolution` uses total session duration, not time-to-fix-commit as PRD requires |
| `multi-session-build` | `scoreFinalQuality()` ignores `groundTruth` entirely (parameter is `_groundTruth`) |
| `scale-stress-test` | `scoreCoherenceDegradation()` Jaccard similarity uses patterns so generic they appear in any TypeScript |
| `scale-stress-test` | `scoreIntegrationSuccess()` checks for Bash calls containing "test" but never verifies test outcomes |

### 8d. Scenario Setup Doesn't Actually Set Up

All five scenarios' `doSetup()` methods return hardcoded metadata without modifying the working directory. No files are created, no bugs are planted, no repo state is changed. The bug-investigation scenario in particular requires "a known bug is planted in the test target" (PRD) but relies entirely on the target repo being pre-bugged.

---

## 9. LOW: Minor Issues

- **`src/runner/error-handler.ts`:** `non-compiling` failure class is declared but never produced by any classifier
- **`src/results/store.ts`:** No file locking or atomic writes — concurrent runs writing to the same store could corrupt data
- **`src/scenarios/registry.ts` and `src/conditions/registry.ts`:** Registry uses a global mutable map, no protection against double-registration in tests
- **`src/conditions/file-reload-structured.ts`:** System prompt is not parameterized per agent; `PLAN.md` content is entirely placeholder

---

## 9. Positive Observations

- **Type system is excellent.** The `types/` directory provides comprehensive, strict TypeScript interfaces that align well with the PRD data models.
- **Results exporter is well-tested.** `src/results/exporter.ts` and its test file show good coverage and PRD alignment.
- **Statistical tests are correctly implemented** (Mann-Whitney U, paired t-test, Wilcoxon signed-rank, Cohen's d) — the implementations themselves are sound, they just receive wrong input due to the stddev bug.
- **The condition/scenario plugin architecture is clean** — easy to add new conditions or scenarios.
- **Error handling in the CLI layer** is well-structured with proper error classification and retry logic.
- **Dashboard module** (not deeply reviewed) appears well-structured with Vite + React + Recharts.

---

## 10. Prioritized Recommendations

### Immediate (blocks correct results) -- DONE
1. ~~**Fix stddev import**~~ -- FIXED: `standardDeviation` -> `sampleStandardDeviation` in `statistics.ts`
2. ~~**Fix transcript-index bug**~~ -- FIXED: push placeholder transcript in `scenario.interface.ts`
3. ~~**Fix baseline `.claude` removal**~~ -- FIXED: `rm -rf` in `baseline.ts`
4. ~~**Add missing Twining tools**~~ -- FIXED: 7 tools added to `full-twining.ts`
5. ~~**Add `.twining/` files to artifact collection**~~ -- FIXED: 3 Twining data files in `full-twining.ts`

### Short-term (blocks meaningful benchmarking) -- DONE
6. ~~**Wire resume logic**~~ -- FIXED: skip completed iterations using `completedIterationKeys` in orchestrator
7. ~~**Write real tests**~~ -- FIXED: 36 behavioral tests for `parseTestOutput`, `parseEvaluationResponse`, `runSingleEvaluation`, `buildEvaluatorPrompt`, templates
8. ~~**Fix generated repo target**~~ -- FIXED: real `validate()` with structure checks, `reset()` to initial commit, defensive copy from `getGroundTruth()`, fileCount mismatch warning
9. ~~**Fix external repo target**~~ -- FIXED: shell execution for setup commands, `reset()` to baseline commit, defensive copy from `getGroundTruth()`

### Medium-term (PRD alignment)
10. ~~**Extract `extractMetrics()`**~~ -- FIXED: moved to `BaseScenario`, removed from all 5 scenario files (~300 lines removed)
11. ~~**Invoke LLM-as-judge**~~ -- FIXED: wired LLM-as-judge into all 5 scenarios for their most subjective dimension (consistency, decisionQuality, resolution, architecturalDrift, coherenceDegradation) with automated fallback when no API key is set
12. ~~**Wire config file loading**~~ -- FIXED: `run` loads `twining-bench.config.json`, `init` generates it