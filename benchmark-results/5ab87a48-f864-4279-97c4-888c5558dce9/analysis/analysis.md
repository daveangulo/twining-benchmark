# Benchmark Analysis Report

**Run ID:** 5ab87a48-f864-4279-97c4-888c5558dce9  
**Timestamp:** 2026-04-03T18:54:21.616Z  
**Status:** running  
**Scenarios:** context-recovery, multi-session-build, architecture-cascade  
**Conditions:** baseline, shared-markdown, full-twining, twining-lite  
**Runs per pair:** 5  

## Executive Summary

> twining-lite ranks #1 with 82.7 composite but lift is not statistically significant (need more runs)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | twining-lite | 82.7 | +3.4 |  | small | +0.28 | $2.00 | $0.024 |
| 2 | shared-markdown | 80.9 | +1.6 |  | negligible | +0.10 | $1.58 | $0.020 |
| 3 | full-twining | 80.6 | +1.3 |  | negligible | +0.12 | $0.93 | $0.011 |
| 4 | baseline | 79.3 | +0.0 |  | N/A | N/A | $1.37 | $0.017 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | +1.3 | No | +0.12 | negligible |
| shared-markdown | +1.6 | No | +0.10 | negligible |
| twining-lite | +3.4 | No | +0.28 | small |

## Behavior-Outcome Correlations

| Behavior | Outcome | r | Interpretation |
| --- | --- | --- | --- |
| num_turns | composite | +0.88 | very strong |
| num_turns | cost_usd | +0.98 | very strong |

## Effect Decomposition

_All 8 mechanisms show identical associated difference (-2.1) because the same conditions use all Twining tools. See lite-vs-full comparison below for tool surface analysis._

### Lite vs Full Twining

| Metric | Value |
| --- | --- |
| twining-lite mean | 82.72 |
| full-twining mean | 80.62 |
| delta (full - lite) | -2.1 |
| conclusion | twining-lite scored comparably |

**Never-called tools:** acknowledge, add_entity, add_relation, agents, archive, assemble, commits, decide, delegate, discover, dismiss, export, graph_query, handoff, link_commit, neighbors, override, post, promote, prune_graph, query, read, recent, reconsider, register, search_decisions, status, summarize, trace, verify, what_changed, why

## Per-Scenario Breakdown

| Scenario | Mean | Std | Best Condition | Worst Condition |
| --- | --- | --- | --- | --- |
| context-recovery | 10.9 | 0.0 | full-twining | shared-markdown |
| multi-session-build | 11.4 | 0.0 | shared-markdown | full-twining |

## Interaction Effects

### Disordinal Interactions (ranking reversals)

- **baseline** vs **full-twining**: ranking reverses across scenarios
- **baseline** vs **shared-markdown**: ranking reverses across scenarios
- **full-twining** vs **shared-markdown**: ranking reverses across scenarios
- **full-twining** vs **twining-lite**: ranking reverses across scenarios
- **shared-markdown** vs **twining-lite**: ranking reverses across scenarios

## Effect Sizes (vs Baseline)

| Condition | Cohen's d | Interpretation | Significant |
| --- | --- | --- | --- |
| full-twining | +0.12 | negligible |  |
| shared-markdown | +0.10 | negligible |  |
| twining-lite | +0.28 | small |  |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| full-twining | 12.1% | 97% | 35 |
| baseline | 0.0% | 0% | 44 |
| shared-markdown | 0.0% | 0% | 35 |
| twining-lite | 14.1% | 97% | 35 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $1.37 | $0.017 |
| full-twining | $0.93 | $0.011 |
| shared-markdown | $1.58 | $0.020 |
| twining-lite | $2.00 | $0.024 |

## Construct Validity

**Internal consistency:** 21/28 scenario-condition-dimension cells have CV < 20%

### Dimension Correlations

| Dimension A | Dimension B | Pearson r | Interpretation |
| --- | --- | --- | --- |
| architecturalDrift | cumulativeRework | 0.51 | moderately related |
| architecturalDrift | finalQuality | 0.14 | independent |
| context-accuracy | orientation-efficiency | -0.50 | moderately related |
| context-accuracy | redundant-rework | -0.30 | weakly related |
| cumulativeRework | finalQuality | -0.04 | independent |
| orientation-efficiency | redundant-rework | -0.36 | weakly related |

## Reliability

**All 8 scenario-condition cells have CV <= 30%.**

### Statistical Design

- **Iterations per pair:** 5
- **Scenarios:** 2
- **N per condition:** 10 (pooled across scenarios)
- **Minimum Detectable Effect (MDES):** d ≥ 1.32 at 80% power

### Power Analysis

| Comparison | Cohen's d | N | MDES | Power | Verdict |
| --- | --- | --- | --- | --- | --- |
| baseline vs full-twining | +0.123 | 10 | d≥1.32 | 0.058 | effect (d=0.12) is below detectable threshold (MDES=1.32) — inconclusive, not evidence of no effect |
| baseline vs shared-markdown | +0.103 | 10 | d≥1.32 | 0.056 | effect (d=0.10) is below detectable threshold (MDES=1.32) — inconclusive, not evidence of no effect |
| baseline vs twining-lite | +0.280 | 10 | d≥1.32 | 0.091 | effect (d=0.28) is below detectable threshold (MDES=1.32) — inconclusive, not evidence of no effect |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 44 | 44 | 0 | 0 | 0 | 0 | 0.0 | 0% | 513s |
| full-twining | 35 | 35 | 0 | 0 | 0 | 95 | 2.7 | 97% | 760s |
| shared-markdown | 35 | 35 | 0 | 0 | 0 | 0 | 0.0 | 0% | 396s |
| twining-lite | 35 | 35 | 0 | 0 | 0 | 131 | 3.7 | 97% | 338s |

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 44 | 33.2 | 344.1 | 0 | 0 | Agent |
| full-twining | 35 | 24.5 | 244.7 | 0 | 0 | ToolSearch |
| shared-markdown | 35 | 22.5 | 403.8 | 38 | 28 | Read |
| twining-lite | 35 | 27.3 | 365.3 | 0 | 0 | ToolSearch |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 41 | 0.001 | 0.999 | 0.240 |
| full-twining | 33 | 0.000 | 1.000 | 0.146 |
| shared-markdown | 33 | 0.001 | 0.995 | 0.358 |
| twining-lite | 33 | 0.003 | 0.996 | 0.304 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $13.67 | $1.367 | $0.0172 | 22573s | 1107 | 107 |
| full-twining | $9.31 | $0.931 | $0.0115 | 26586s | 920 | 92 |
| shared-markdown | $15.82 | $1.583 | $0.0196 | 13848s | 893 | 50 |
| twining-lite | $19.97 | $1.997 | $0.0241 | 11823s | 640 | 48 |

## Recommendations

- **[high]** Reduce tool surface area: full-twining (80.6) scores lower than twining-lite (82.7)
- **[high]** Broken scorer: dimension 'completion' has zero variance (always 65) — fix or remove
- **[high]** No statistically significant coordination lift detected — coordination tools may not be providing measurable value
- **[medium]** Scenario 'multi-session-build' x 'shared-markdown' has ceiling effect (mean=96.4, std=2.5) — consider redesigning for more discrimination
- **[medium]** Insensitive scorer: dimension 'completion' has only 0.0-point spread across conditions
- **[medium]** Insensitive scorer: dimension 'cumulativeRework' has only 0.8-point spread across conditions
- **[medium]** Insensitive scorer: dimension 'orientation-efficiency' has only 3.4-point spread across conditions
- **[medium]** Interaction effect: baseline vs full-twining ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: baseline vs shared-markdown ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: full-twining vs shared-markdown ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: full-twining vs twining-lite ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: shared-markdown vs twining-lite ranking reverses across scenarios — no universal winner
- **[medium]** High scorer variance (CV>20%) in 7 scenario x condition pairs for dimensions: architecturalDrift, context-accuracy, finalQuality, redundant-rework
- **[low]** Inconclusive comparisons (full-twining, shared-markdown, twining-lite): observed effects are below detectable threshold — cannot distinguish from noise at current sample size
- **[low]** Escalating cost in 'multi-session-build' x 'baseline': cost increases across sessions (slope=0.104)

---
_Generated by benchmark-analysis_