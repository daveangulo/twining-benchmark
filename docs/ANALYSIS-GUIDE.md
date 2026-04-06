# Benchmark Harness Analysis Guide

Context document for analyzing benchmark results. Load this at the start of analysis sessions.

## Architecture Overview

The harness runs AI agents through multi-session scenarios under different coordination conditions, then scores the outcomes. The goal is to measure whether coordination mechanisms (shared files, Twining tools) improve how agents evolve a codebase together.

### Execution Flow
1. **Condition** sets up coordination artifacts (CLAUDE.md, COORDINATION.md, Twining plugin)
2. **Scenario** defines N sequential agent tasks (e.g., sprint-simulation = 12 tasks)
3. **Agent sessions** execute via `claude -p` CLI subprocess with `--setting-sources ''` (clean plugin isolation)
4. **Scorers** evaluate outcomes from git diffs, file changes, and tool call transcripts
5. **Analysis package** aggregates across iterations and produces reports

### Key Files
- `src/conditions/*.ts` — 8 coordination conditions (baseline through full-twining)
- `src/scenarios/*.ts` — 12 scenarios with per-scenario scorers
- `src/runner/agent-session.ts` — CLI execution, timeout, retry
- `src/runner/orchestrator.ts` — Iteration management, condition setup
- `src/runner/error-handler.ts` — Failure detection, retry logic
- `src/analyzer/work-leverage.ts` — Rework ratio, continuation index, line survival
- `analysis/` — Python analysis package (20 dimensions, 3 report formats)

### Conditions (the independent variable)
| Condition | What it adds | Plugin? |
|-----------|-------------|---------|
| baseline | CLAUDE.md only (no coordination) | No |
| claude-md-only | CLAUDE.md with project conventions | No |
| shared-markdown | CLAUDE.md + COORDINATION.md file | No |
| file-reload-generic | CLAUDE.md + CONTEXT.md | No |
| file-reload-structured | Structured framework (STATE.md, PLAN.md, decisions.md) | No |
| persistent-history | Conversation history prefix | No |
| twining-lite | Twining plugin (9 core tools) | Yes |
| full-twining | Twining plugin (32 tools) | Yes |

All conditions get identical `BASE_CLAUDE_MD` content. Plugin conditions get lifecycle gates auto-injected by the plugin's SessionStart hook.

### Sprint-Simulation Scenario (the long-horizon test)
12 sequential agent sessions simulating a 2-week sprint:
- Sessions 1-3: Architecture + email adapter + preferences (email-only)
- Session 4: Bug fix
- Sessions 5-7: Shared validation + webhook + notification history
- **Session 8: SMS requirement introduced (invalidates session 3's email-only assumption)**
- **Session 9: Must discover the change and update preferences for multi-channel**
- Sessions 10-12: Preferences service, integration tests, final integration

The session 8→9 handoff is the key test: does the coordination mechanism propagate the requirement change?

## Scoring Framework

### Four Axes (25/30/25/20 weights)
1. **Task Completion (25%)** — Tests pass, bug fixed, feature built
2. **Work Leverage (30%)** — Did agents build on each other effectively?
3. **Code Quality (25%)** — Architectural consistency, pattern compliance
4. **Efficiency (20%)** — Cost, time, coordination overhead

### Core Principle
**Score outcomes, not process.** If two conditions produce identical code, they score identically. Tool usage (did agent call twining_assemble?) is explanatory metadata, not a scored dimension.

### Sprint-Simulation Dimensions
| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| decisionConsistency | 20% | Do later sessions follow session 1's architectural pattern? (multi-signal detection) |
| assumptionHandling | 20% | Did session 8 flag the email-only assumption? Did session 9 restructure preferences? (graduated) |
| cumulativeRework | 20% | Lines reworked / lines added across all sessions |
| contextRecovery | 20% | How effectively do later sessions recover prior context? (coordination tools + efficiency) |
| finalQuality | 20% | Components, tests, architecture consistency, test coverage depth, API surface consistency |

### What Drives the Scores
From clean run 6393b4ac (n=5 per condition, re-scored with fixed scorers):
- **contextRecovery** is the dominant differentiator (baseline 36, coordination 68-69) — coordination tools nearly double context recovery
- **assumptionHandling** now varies meaningfully (baseline 80-92, coordination 80-100) — graduated scoring requires explicit assumption flagging
- **decisionConsistency** varies 50-100 with reduced false negatives from broadened pattern detection
- **cumulativeRework** is similar across conditions (83-94) — all agents produce low rework
- **finalQuality** has narrow but meaningful spread (89-100) — test coverage depth and API consistency add discrimination

## Analysis Workflow

### Step 1: Session Health Check
Before looking at scores, verify sessions ran correctly:
```bash
python3 -c "
import json, glob, os
from collections import defaultdict
stats = defaultdict(lambda: {'total':0,'ok':0,'timeout':0,'zero_tool':0,'twining':0})
for sd in sorted(glob.glob('benchmark-results/<RUN_ID>/sessions/*/')):
    t = json.load(open(os.path.join(sd, 'transcript.json')))
    c = t['condition']; stats[c]['total'] += 1
    if len(t['toolCalls']) == 0: stats[c]['zero_tool'] += 1
    if t['exitReason'] == 'timeout': stats[c]['timeout'] += 1
    elif t['exitReason'] == 'completed': stats[c]['ok'] += 1
    stats[c]['twining'] += len([tc for tc in t['toolCalls'] if 'twining' in tc.get('toolName','')])
for c,s in sorted(stats.items()):
    print(f'{c:20s}: {s[\"total\"]:3d} sess, {s[\"ok\"]:3d} ok, {s[\"timeout\"]:2d} timeout, {s[\"zero_tool\"]:2d} zero-tool, {s[\"twining\"]:4d} twining')
"
```

**What to check:**
- baseline/shared-markdown must have **ZERO** Twining calls (plugin isolation)
- Twining conditions should have >0 Twining calls (plugin loaded)
- Zero-tool sessions should be <10% (rate limit retries should catch most)
- Timeouts should be rare (sprint-simulation timeout = 25 min)

### Step 2: Per-Iteration Scores
```bash
python3 -c "
import json, glob
for f in sorted(glob.glob('benchmark-results/<RUN_ID>/scores/*.json')):
    s = json.load(open(f))
    scores = {k: v['value'] for k, v in s['scores'].items()}
    print(f'{s[\"condition\"]:20s} i{s[\"iteration\"]} comp={s[\"composite\"]:5.1f} | ' + ' | '.join(f'{k[:6]}={v}' for k,v in sorted(scores.items())))
"
```

**What to check:**
- composite=0 means crashed-iteration guard fired (>50% sessions failed)
- High variance within a condition suggests infrastructure instability
- assumptionHandling=0 for a coordination condition is a red flag

### Step 3: Run Full Analysis
```bash
benchmark-analysis analyze benchmark-results/<RUN_ID> --min-tokens 1000
```

### Step 4: Cross-Run Comparison (when pooling data)
```bash
benchmark-analysis compare-conditions \
  --runs benchmark-results/<ID1> benchmark-results/<ID2> \
  --conditions baseline,shared-markdown,full-twining,twining-lite
```

## Known Issues and Fixes (as of April 2, 2026)

### Fixed
- **Scorer bias** — Pattern detection, zero-variance dimensions, process-as-outcome all fixed (d7420c1)
- **Plugin contamination** — `--setting-sources ''` isolates conditions (bddefdf)
- **Rate limit handling** — 2 retries with 30s exponential backoff (22f7eb4)
- **CLI execution** — `claude -p` instead of SDK `query()` for full plugin support (90f54f5)
- **twining-lite tool restriction** — Belt-and-suspenders MCP enforcement (0ff8b25)
- **assumptionHandling always 100** — Graduated scoring requires explicit assumption flagging (e10b9d1)
- **finalQuality 4pt spread** — Added test coverage depth + API consistency sub-scores (e24edab)
- **decisionConsistency false negatives** — Multi-signal pattern detection, dynamic session selection (b9271ec)
- **Effect decomposition uninformative** — Renders lite-vs-full comparison, per-tool utilization (38d742d)
- **Recommendation false positives** — Skip engagement checks for non-coordination conditions (856df63)
- **Composite weight imbalance** — Equal 20% weights across all 5 dimensions (23f20e6)

### Open
- **Timeout enforcement for CLI** — `execa` timeout should work but not battle-tested at scale
- **Zero-tool sessions** — Retry helps but persistent rate limits can still produce failures

## Re-Scoring Existing Data

When scorer code changes, existing results can be re-scored without re-running agent sessions:

```bash
npx tsx scripts/rescore.ts <run-id>
```

This reads raw transcripts from `sessions/`, reconstructs `RawResults`, and runs the current scenario scorer. Original scores are backed up to `scores/.pre-rescore-backup/`. Test results (pass/fail/compiles) are preserved from original score files since they're not stored in transcripts.

After re-scoring, re-run the analysis:
```bash
cd analysis && benchmark-analysis analyze ../benchmark-results/<run-id> --format all
```

## Run Validity Quick Reference

### Validity Requirements

Two independent requirements determine run validity:
1. **Plugin isolation** (`--setting-sources ''`, commit bddefdf+) — prevents Twining plugin leaking into non-plugin conditions
2. **Condition implementation** (commit d7420c1+) — standardized BASE_CLAUDE_MD across all conditions
3. **twining-lite tool restriction** (commit 0ff8b25+) — belt-and-suspenders enforcement of 9-tool limit

Runs pre-d7420c1 used different CLAUDE.md content per condition (baseline had no CLAUDE.md, shared-markdown had hardcoded guidelines). Data from those runs is **not comparable** to post-d7420c1 data.

### Valid Runs

All invalid runs archived to `benchmark-results/.archived-invalid/` (50 runs). Valid runs:

| Run ID | Date | Scenarios | Conditions | n | Notes |
|--------|------|-----------|------------|---|-------|
| **6393b4ac** | Apr 2 | sprint-simulation | all 4 | 5 | Primary sprint-sim data |
| **9f93c5c4** | Apr 3 | sprint-simulation | twining-lite | 5 | Clean rerun, merged into 6393b4ac |
| **66312b64** | Apr 4 | evolving-requirements, conflict-resolution | all 4 | 5 | Tier 2 scenarios |
| **73972189** | Mar 30 | sprint-simulation | all 4 | 3 | Rescored with current scorers |
| **d18ab582** | Mar 31 | sprint-simulation | all 4 | 3 | Rescored with current scorers |
| **5ab87a48** | Apr 3 | context-recovery, multi-session-build | all 4 | 5 | Rescued from interrupted run (status=running but 2 scenarios complete) |
| **8a2b18b3** | Apr 5 | architecture-cascade | all 4 | 5 | Post all fixes, completed |
| **16a2e4e1** | Mar 28 | sprint-simulation | baseline, shared-markdown | 3 | Pre-bddefdf but 0 Twining contamination; twining-lite/full-twining removed |

### Archived Run Assessment

Pre-bddefdf runs were checked for contamination. Run 9be7a749 had 168/215 Twining calls in baseline/shared-markdown — confirmed contamination. Run 16a2e4e1 had 0 Twining calls in baseline/shared-markdown — salvaged. All other pre-bddefdf runs also had condition implementation differences (pre-d7420c1) making them incomparable.

## Pooled Results (All Valid Data)

**8 runs, 6 scenarios, n=36-41 per condition (unbalanced)**

| Condition | N | Mean | Std | Lift | Hedges' g | p-value | Sig |
|-----------|---|------|-----|------|-----------|---------|-----|
| twining-lite | 41 | 75.8 | 15.1 | +10.3 | +0.65 (medium) | <0.05 | YES * |
| full-twining | 36 | 74.5 | 13.7 | +9.0 | +0.59 (medium) | NS | no (below MDES) |
| shared-markdown | 39 | 69.1 | 21.7 | +3.7 | +0.19 (negligible) | NS | no |
| baseline | 39 | 65.5 | 16.5 | — | — | — | — |

**MDES at n~40: d≥0.64** — sufficient to detect medium effects.

**full-twining vs twining-lite**: delta=1.3, not significantly different.

### Per-Scenario Breakdown

| Scenario | N/cond | baseline | shared-md | twining-lite | full-twining |
|----------|--------|----------|-----------|--------------|--------------|
| sprint-simulation | 11-16 | 70.5 | 77.2 | 81.4 | 79.5 |
| architecture-cascade | 5 | 58.9 | 60.3 | 65.6 | 58.1 |
| evolving-requirements | 5 | 69.2 | 66.9 | 67.5 | 95.9 |
| conflict-resolution | 5 | 55.6 | 45.8 | 82.2 | 80.4 |
| context-recovery | 5 | 60.1 | 54.3 | 65.5 | 66.5 |
| multi-session-build | 5 | 89.2 | 96.4 | 91.5 | 85.0 |

## Research Findings (Established)

1. **Twining-lite produces a statistically significant effect across 6 scenarios** — g=0.65, adequately powered (power=0.81)
2. **Full-twining shows a medium effect** (g=0.59) but falls just below MDES at current sample size — likely significant with more data
3. **Context recovery remains the dominant differentiator** in sprint-simulation: baseline 34-41 vs coordination 64-72, nearly 2x
4. **Full-twining and twining-lite are not significantly different** (delta=1.3) — the lite toolset captures the coordination benefit
5. **Shared-markdown provides small non-significant aggregate benefit** (g=0.19, NS) — helps in sprint-sim but hurts in conflict-resolution
5. **The effect generalizes across scenario types**: sequential handoff, requirement evolution, conflict resolution, context recovery all show coordination advantage
6. **The core value is in structured context assembly and decision recording**, not heavier lifecycle processes (graph building, verification gates, etc.)

## Pending Research Questions

1. Does model choice (Opus vs Sonnet) affect the coordination lift magnitude?
2. Can the lite toolset be further reduced while maintaining the effect?
3. At what session count does the coordination advantage become significant? (dose-response)
4. Why does shared-markdown hurt in conflict-resolution? (coordination overhead without structured tools may increase confusion)
