# Benchmark Harness: Scorer Fixes, CoordinationLift, and Long-Horizon Scenarios

**Date:** 2026-03-13
**Project:** twining-benchmark-harness (`/Users/dave/Code/twining-benchmark-harness`)
**Motivation:** Benchmark run `4005bc41` revealed measurement issues that obscure Twining's actual signal: a broken `decisionPropagation` scorer, no separation of coordination value from task success, and no scenarios that test the long-horizon context persistence where Twining should excel.

## Problem Summary

1. **`decisionPropagation` scorer fails for Twining conditions.** When Agent A records its pattern choice in Twining (via `twining_decide`) rather than in code comments, the scorer can't detect it from git diffs alone. Full-twining scores 66.7 vs baseline's 83.3 — the scorer is penalizing the coordination mechanism it's supposed to measure.
2. **Binary resolution scores dominate composites.** Bug-investigation `resolution` (35% weight) is essentially 0 or 70. One unlucky run tanks the composite regardless of coordination quality. The coordination dimensions where Twining wins are outweighed.
3. **No coordinationLift metric.** The dual-rubric LLM judge decision exists (`01KK8MVXGW300EHPRTN9J5Q4JC`) but isn't implemented. We can't separate "did coordination help?" from "was the output good?"
4. **No long-horizon scenarios.** All scenarios use 2-3 agents with 15-minute windows. At this scale, reading the filesystem is sufficient coordination. We need 5+ session scenarios with context that accumulates beyond what any single agent can hold, where structural coordination memory should outperform ad-hoc file reading.

## Design

### Change 1: Fix `decisionPropagation` scorer in `architecture-cascade`

**Current behavior** (`src/scenarios/architecture-cascade.ts`):
The scorer calls `detectPatternChoice()` on Agent A's git diffs to detect which pattern (EventBus vs CallbackRegistry) was chosen. When the choice is recorded in `.twining/` files rather than in source code diffs, `detectPatternChoice()` returns `'none'` → score = 0.

**Fix:** Extend `scoreDecisionPropagation()` to fall back to transcript analysis when diff-based detection fails. `RawResults.transcripts[0]` provides `toolCalls: ToolCall[]` where each `ToolCall` has `toolName: string` and `parameters: Record<string, unknown>`. No infrastructure changes needed.

Priority order: code diffs first (most reliable), then transcript tool calls.

**Implementation:** Add a `detectPatternFromTranscript(transcript: AgentTranscript)` helper that:
- Scans `transcript.toolCalls` for calls where `toolName` contains `twining_decide` or `twining_post`
- Extracts `parameters.summary`, `parameters.rationale`, `parameters.detail` as strings
- Runs the existing `EVENT_BUS_PATTERNS` and `CALLBACK_REGISTRY_PATTERNS` regex arrays against the extracted text
- Returns `'eventbus' | 'callback' | 'mixed' | 'none'` using the same logic as `detectPatternChoice()`

The fallback is invoked in `scoreDecisionPropagation()` when `detectPatternChoice(aDiffs)` returns `'none'`.

### Change 2: Implement coordinationLift as a parallel scoring dimension

The dual-rubric approach from decision `01KK8MVXGW300EHPRTN9J5Q4JC` adds 4 standalone quality templates that evaluate output agnostically, then compute `coordinationLift = coordinationAwareScore - standaloneQualityScore`.

**Implementation:**

Add to `ScoredResults`:
```ts
interface ScoredResults {
  // ... existing fields
  standaloneScores?: StandaloneScoreResult;   // already defined in types
  coordinationLift?: CoordinationLift;         // already defined in types
}
```

The types already exist in `src/types/results.ts`. What's missing is the actual scoring call in each scenario's `doScore()`.

For each scenario, after computing the coordination-aware composite, also compute a standalone quality score using the LLM judge with templates that strip all coordination context:

| Scenario | Standalone quality dimensions |
|----------|------------------------------|
| refactoring-handoff | Code correctness, test pass rate, architectural soundness |
| architecture-cascade | Pattern implementation quality, test coverage, code organization |
| bug-investigation | Bug fix correctness, regression test quality, code cleanliness |
| context-recovery | Feature completeness, code correctness, test coverage |

`coordinationLift` = coordination-aware composite minus standalone quality composite. Positive values mean coordination helped; negative means it hurt.

**Implementation approach:** Add a `scoreStandaloneQuality()` method to `BaseScenario` that calls the LLM judge with blinded templates (no mention of agents, coordination, or handoffs — just "evaluate this code output"). Each scenario overrides with scenario-specific standalone templates.

This is a **parallel metric**, not a replacement. The existing composite remains the primary score. `coordinationLift` is reported alongside it for analysis.

### Change 3: Smooth the binary resolution scorer in `bug-investigation`

**Current:** `resolution` (`src/scenarios/bug-investigation.ts:472-553`) awards +30 for modifying bug file, +30 for fix pattern match, -20 for anti-patterns, +40 for regression test (range 0-100). In practice, runs cluster at 0 (didn't touch bug file) or 70-100 (found and fixed), with little middle ground. The score distribution is bimodal, making composites dominated by whether the agent found the right file.

**Fix:** Add partial credit for progress toward resolution:
- 0: No investigation of bug file, no changes
- 15: Investigated the correct file but didn't fix
- 30: Modified the correct file but fix is wrong or incomplete
- 50: Fixed the bug but no regression test
- 70: Fixed the bug with a regression test
- 85: Fixed + regression test + no anti-patterns
- 100: Fixed + regression test + no anti-patterns + existing tests still pass

This creates a gradient that rewards partial progress and doesn't let one binary outcome dominate.

### Change 4: New scenario — `iterative-feature-build`

A 5-session sequential build where each agent adds a layer to a feature, and later agents must understand all prior architectural decisions to maintain consistency.

**Scenario design:**

This scenario extends the existing synthetic repo fixture domain (users, orders, notifications) rather than introducing a new domain, ensuring agents interact with existing code patterns.

| Session | Agent Role | Task | Coordination Challenge |
|---------|-----------|------|----------------------|
| 1 | Data Modeler | Define TypeScript models for an analytics dashboard: `AnalyticsSummary`, `UserAnalytics`, `TrendPoint`, `DashboardConfig` in `src/models/analytics.ts`, following the existing model patterns in `src/models/` | Must follow existing model conventions (User, Order patterns). Establishes the domain model for all subsequent sessions |
| 2 | Repository Layer | Implement `AnalyticsRepository` extending `BaseRepository` with methods for aggregation queries, time-range filtering, and user-scoped analytics, using models from session 1 | Must discover session 1's model structure AND follow existing `BaseRepository` patterns from `src/repositories/` |
| 3 | Service Layer | Implement `AnalyticsService` with business logic: compute summaries from raw data, generate trends, cache expensive aggregations, using repository from session 2 and following existing service patterns (DI, error handling) | Must understand model layer, repository API, AND existing service patterns |
| 4 | API/Controller Layer | Implement controller functions in `src/controllers/analytics.controller.ts` that expose the analytics service with input validation, error handling, and response formatting | Must understand 3 prior layers of abstraction |
| 5 | Integration & Polish | Add cross-cutting concerns: audit logging for analytics queries, rate limiting for expensive aggregations, and integration tests that exercise the full analytics stack end-to-end | Must understand the entire 4-layer architecture to add concerns correctly |

**Why this tests coordination:** By session 5, the agent must understand decisions from sessions 1-4: model field names, repository method signatures, service validation rules, controller response formats. Without coordination memory, agent 5 must re-derive all of this from code. With Twining, the decisions are pre-assembled. Building within the existing fixture domain tests whether agents can distinguish new analytics decisions from pre-existing user/order decisions.

**Timeouts:** 15 minutes each (no artificial truncation). The challenge is accumulated complexity, not time pressure.

**Ground truth:**
- `decisions`: Model naming conventions (following existing User/Order patterns), repository patterns (extending BaseRepository), service layer patterns (constructor DI, consistent error handling)
- `expectedPatterns`: Each layer imports from the layer below, consistent naming, DI pattern preserved, analytics models follow existing model conventions
- `antiPatterns`: Direct database access from controller, model redefinition, bypassing service layer, inconsistent error handling vs existing services

**Scoring dimensions:**
| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| `architecturalDrift` | 0.30 | Do later sessions preserve earlier decisions? Measured by checking if session 1's models are still used correctly in session 5's integration tests |
| `layerIntegrity` | 0.25 | Does each layer only import from the layer below? No leaky abstractions? |
| `decisionAccumulation` | 0.25 | Did each agent build on prior decisions rather than re-deriving? Measured by coordination tool usage and file-read patterns |
| `integrationCompleteness` | 0.20 | Does session 5's output actually exercise the full stack? |

### Change 5: New scenario — `decision-volume-recovery`

A scenario that tests recovery when prior work produces many decisions — not by constraining context, but by creating a genuine "needle in a haystack" challenge where the right decisions must be found among many.

**Scenario design:**

4 agents, where Agent A produces a high volume of changes and decisions, and later agents must find the specific decisions relevant to their narrower tasks:

| Session | Agent Role | Task | Coordination Challenge |
|---------|-----------|------|----------------------|
| 1 | Comprehensive Refactorer | Perform 6 distinct refactoring operations: (1) extract `IUserRepository` interface, (2) extract `IOrderRepository` interface, (3) add input validation to `UserService`, (4) normalize error handling in `OrderService`, (5) standardize logging across all services, (6) update all tests. Document every decision. | Produces 6+ decisions across different domains and files |
| 2 | Cache Builder | Add caching to `UserService.findById()` and `UserService.findByEmail()` using the interface pattern from session 1. Must respect session 1's error handling and validation patterns. | Must find the 2-3 relevant decisions (interface extraction, error handling, validation) among 6+ total decisions. Low embedding similarity between "caching" and "error handling normalization" |
| 3 | Order Feature Builder | Add order history tracking to `OrderService` — record status transitions with timestamps. Must respect session 1's error handling and interface patterns. | Must find different relevant decisions from the same pool. Tests whether retrieval can distinguish per-scope relevance |
| 4 | Integration Tester | Write integration tests that exercise both the caching (session 2) and order history (session 3) features, verifying they follow session 1's patterns. | Must recover all prior decisions and verify cross-cutting consistency |

**Why this tests coordination:** Agent B needs "the decision about error handling" when its task is "add caching" — low embedding similarity but high structural relevance (caching must follow the normalized error handling patterns). The graph should surface this via `UserService` → `decided_by` → error handling decision. Similarity search would rank the user repository interface extraction higher (more word overlap with "UserService caching") even though error handling normalization is equally important.

**Timeouts:** All agents: 15 minutes. No artificial truncation — the challenge is retrieval precision, not time pressure.

**Scoring dimensions:**
| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| `decisionRecovery` | 0.30 | Did agents B/C discover the specific decisions relevant to their task before writing code? Measured by checking transcript tool calls (file reads of A's modified files, coordination tool usage) in first 30% of tool calls |
| `patternCompliance` | 0.30 | Do agents B/C follow A's patterns? Automated: check for interface usage, error handling patterns, validation patterns in their diffs. LLM judge fallback for nuanced assessment |
| `crossCuttingConsistency` | 0.25 | Does Agent D's integration test correctly exercise both B's and C's features together? Measured by test file presence and import patterns |
| `retrievalPrecision` | 0.15 | Ratio of relevant-to-task file reads vs total file reads in first orientation phase. Higher = agent found the right context faster |

### Change 6: New scenario — `evolving-requirements`

A 4-session scenario where requirements change mid-stream and prior decisions must be reconsidered.

| Session | Agent Role | Task | Coordination Challenge |
|---------|-----------|------|----------------------|
| 1 | Initial Architect | Design and implement a notification system using EventBus pattern. Implement email notifications for order status changes. | Establishes the pattern |
| 2 | Extender | Add SMS and webhook notification channels, following the existing pattern. | Must discover and follow session 1's EventBus pattern |
| 3 | Requirements Changer | Requirements changed: notifications must now support priority-based routing (urgent → SMS, normal → email, low → webhook only). Refactor the notification system to support priority routing while keeping existing channels working. | Must understand the full system, then modify the architecture without breaking it |
| 4 | Auditor & Finalizer | Add audit logging for all notifications sent, add a notification preferences service (users can opt out of channels), and write integration tests. Must respect the priority routing from session 3 AND the channel implementations from sessions 1-2. | Must synthesize decisions from 3 prior sessions, including a mid-stream architectural change |

**Why this tests coordination:** Session 3 changes the architecture. Without coordination memory, session 4 might follow session 1-2's original pattern and miss the priority routing requirement. With Twining, the `reconsider`/`override` workflow surfaces the architectural change.

**Scoring dimensions:**
| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| `requirementAdaptation` | 0.30 | Does session 3's refactor correctly implement priority routing without breaking existing channels? |
| `decisionEvolution` | 0.25 | Did session 3 record the architectural change? Did session 4 discover it? |
| `backwardCompatibility` | 0.25 | Do sessions 1-2's channels still work after session 3's refactor? |
| `integrationCompleteness` | 0.20 | Does session 4's audit + preferences system work with the evolved architecture? |

## Files Changed

| File | Change |
|------|--------|
| `src/scenarios/architecture-cascade.ts` | Fix `scoreDecisionPropagation()` to fall back to transcript `toolCalls` analysis when diff-based `detectPatternChoice()` returns `'none'` |
| `src/scenarios/bug-investigation.ts` | Smooth resolution scoring to partial credit gradient |
| `src/scenarios/scenario.interface.ts` | Add `scoreStandaloneQuality()` optional method to BaseScenario |
| `src/scenarios/iterative-feature-build.ts` | **New.** 5-session layered build scenario |
| `src/scenarios/decision-volume-recovery.ts` | **New.** Context constraint recovery scenario |
| `src/scenarios/evolving-requirements.ts` | **New.** Mid-stream requirement change scenario |
| `src/scenarios/registry.ts` | Register 3 new scenarios |
| `src/types/scenario.ts` | Add 3 new names to `ScenarioName` union |
| `src/analyzer/llm-judge.ts` | Add standalone quality templates for coordinationLift |
| `tests/unit/scenarios/` | Tests for all scorer changes and new scenarios |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| New scenarios increase benchmark cost | Each 5-session scenario costs ~$4-5 per run. At 5 conditions x 3 runs = $60-75 per new scenario. Budget accordingly. Can exclude from `all` initially via `excludeFromAll: true` |
| Smoothed resolution scoring changes historical comparisons | This is the point — the old binary scoring was a measurement bug. Document the change and re-baseline |
| coordinationLift adds LLM judge cost per run | Only run when `evaluatorClient` is provided. Skip in budget-constrained runs |
| 5-session scenario may hit token limits | 15-minute timeouts with 50 turns should be sufficient. Monitor for compaction |
| `iterative-feature-build` agents may deviate from analytics domain | Prompt each agent with explicit reference to the models/files created by prior sessions. Ground truth `expectedPatterns` enforce correct imports |
| Scoring `architecturalDrift` and `decisionRecovery` may be hard to automate | Primary approach: diff/transcript analysis (file reads, import patterns, coordination tool usage). LLM judge as fallback for `patternCompliance` and `crossCuttingConsistency` |

## Success Criteria

1. `decisionPropagation` scores for full-twining should be >= baseline (currently 16.7 points below)
2. Bug-investigation composite variance (CV) should drop below 30% (currently 35-47%)
3. New scenarios should show statistically significant separation between conditions (Cohen's d > 0.5 on at least one dimension)
4. `iterative-feature-build` session 5 composite should correlate with coordination condition tier (baseline < file-based < Twining)
5. `decision-volume-recovery` Agent B `decisionRecovery` should show clear Twining advantage over file-based conditions
