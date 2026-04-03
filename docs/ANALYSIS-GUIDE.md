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

Only runs with `--setting-sources ''` (commit bddefdf+) produce valid cross-condition comparisons.

**Valid 4-condition sprint-simulation data (Opus 4.6, n=5):**
- **6393b4ac** + **9f93c5c4** (twining-lite rerun): 240 healthy sessions, all 4 conditions clean
  - twining-lite: 84.5 (d=3.03, p<0.05)
  - full-twining: 82.1 (d=1.79, significant)
  - shared-markdown: 80.9 (d=0.97, large)
  - baseline: 76.5

Note: Original twining-lite data in 6393b4ac was corrupted by 75-minute API rate limit. Dead sessions archived to `sessions/.archived-rate-limited/`. Clean rerun 9f93c5c4 data was merged in and original twining-lite scores replaced.

## Research Findings (Established)

1. **Coordination tools produce a large, statistically significant effect** (d=1.79-3.03 vs baseline) driven primarily by context recovery
2. **Context recovery is the dominant differentiator**: Coordination conditions score 68-69 vs baseline's 36 — nearly doubling context recovery in multi-session work
3. **Twining-lite and full-twining are functionally equivalent**: 84.5 vs 82.1 composite, near-identical cost (~$11.50/iter), engagement, and tool calls/session. The lite toolset captures the full coordination benefit
4. **Shared-markdown provides meaningful but smaller lift**: +4.4 over baseline (d=0.97), primarily through context recovery (+24 pts). Coordination tools add another ~10 pts on top
5. **The core value is in structured context assembly and decision recording**, not heavier lifecycle processes (graph building, verification gates, etc.)
6. **Cost of coordination is ~20% more per iteration**: $11.50 vs $9.55, but quality gains make $/point comparable

## Pending Research Questions

1. Does the coordination advantage hold across different scenarios (not just sprint-simulation)?
2. Does model choice (Opus vs Sonnet) affect the coordination lift magnitude?
3. Can the lite toolset be further reduced while maintaining the effect?
4. At what session count does the coordination advantage become significant? (dose-response)
