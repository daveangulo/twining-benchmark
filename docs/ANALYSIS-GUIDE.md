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
| assumptionHandling | 25% | Did session 9 discover session 8's requirement change? |
| decisionConsistency | 25% | Do later sessions follow session 1's architectural pattern? |
| cumulativeRework | 20% | Lines reworked / lines added across all sessions |
| contextRecovery | 15% | How effectively do later sessions recover prior context? |
| finalQuality | 15% | Components present, tests pass, multi-channel support |

### What Drives the Scores
From all valid runs to date:
- **assumptionHandling** is the biggest differentiator (baseline ~55, coordination ~95)
- **contextRecovery** shows graduated difference (baseline 70, shared-md 80, twining 100)
- **decisionConsistency** and **cumulativeRework** are similar across conditions
- **finalQuality** has ceiling effect (almost always 100)

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

## Known Issues and Fixes (as of March 29, 2026)

### Fixed
- **Scorer bias** — Pattern detection, zero-variance dimensions, process-as-outcome all fixed (d7420c1)
- **Plugin contamination** — `--setting-sources ''` isolates conditions (bddefdf)
- **Rate limit handling** — 2 retries with 30s exponential backoff (22f7eb4)
- **CLI execution** — `claude -p` instead of SDK `query()` for full plugin support (90f54f5)

### Open
- **twining-lite gets all 32 tools** — CLI doesn't support `--allowedTools`; twining-lite is effectively full-twining in CLI mode
- **Timeout enforcement for CLI** — `execa` timeout should work but not battle-tested at scale
- **Zero-tool sessions** — Retry helps but persistent rate limits can still produce failures

## Run Validity Quick Reference

Only runs with `--setting-sources ''` (commit bddefdf+) produce valid cross-condition comparisons. Earlier runs are valid only for baseline vs shared-markdown (no plugin contamination for non-plugin conditions).

**Valid baseline vs shared-markdown data (Opus):**
- 16a2e4e1: 3 iterations each, composite baseline=73.8, shared-md=85.4

**No valid full-twining sprint-simulation data yet.** All prior runs had either:
- Plugin not loading (SDK mode)
- Plugin contamination (CLI without --setting-sources '')

## Research Findings (Established)

1. **Coordination value compounds with session count**: ~5pt gap at 2-3 sessions → ~13pt gap at 12 sessions
2. **assumptionHandling is the killer differentiator**: Requirement change propagation is where coordination earns its keep
3. **shared-markdown is remarkably stable**: 84-87 composite across multiple runs, lowest variance
4. **Simple beats complex in short scenarios**: shared-markdown >= twining at 2-3 sessions
5. **Cost efficiency**: shared-markdown is cheapest per quality point (~$0.12/pt vs $0.19/pt baseline)

## Pending Research Questions

1. Does full-twining (with plugin actually working) outperform shared-markdown at 12 sessions?
2. Does contextRecovery=100 for Twining translate to better outcomes than shared-markdown's 80?
3. Is twining-lite the sweet spot (structured retrieval without overhead)?
4. How does the model matter? (Opus vs Sonnet showed different patterns)
