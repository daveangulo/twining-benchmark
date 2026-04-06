# Benchmark Analysis Report

**Run ID:** 6393b4ac-6988-4e2d-bc2d-f78cf5cafb46  
**Timestamp:** 2026-04-02T12:06:55.235Z  
**Status:** completed  
**Scenarios:** sprint-simulation  
**Conditions:** full-twining, twining-lite, baseline, shared-markdown  
**Runs per pair:** 5  

## Executive Summary

> twining-lite ranks #1 with 84.5 composite (+8.0 vs baseline, large effect, p<0.05)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | twining-lite | 84.5 | +8.0 | \* | large | +3.03 | $11.42 | $0.135 |
| 2 | full-twining | 82.1 | +5.6 | \* | large | +1.79 | $11.50 | $0.140 |
| 3 | shared-markdown | 80.9 | +4.4 |  | large | +0.97 | $8.97 | $0.111 |
| 4 | baseline | 76.5 | +0.0 |  | N/A | N/A | $9.55 | $0.125 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | +5.6 | Yes | +1.79 | large |
| shared-markdown | +4.4 | No | +0.97 | large |
| twining-lite | +8.0 | Yes | +3.03 | large |

## Behavior-Outcome Correlations

| Behavior | Outcome | r | Interpretation |
| --- | --- | --- | --- |
| productive_calls | composite | -1.00 | very strong |

## Effect Decomposition

_All 8 mechanisms show identical associated difference (-6.0) because the same conditions use all Twining tools. See lite-vs-full comparison below for tool surface analysis._

### Lite vs Full Twining

| Metric | Value |
| --- | --- |
| twining-lite mean | 84.52 |
| full-twining mean | 82.08 |
| delta (full - lite) | -2.4 |
| conclusion | twining-lite scored comparably |

**Never-called tools:** acknowledge, add_entity, add_relation, agents, archive, assemble, commits, decide, delegate, discover, dismiss, export, graph_query, handoff, link_commit, neighbors, override, post, promote, prune_graph, query, read, recent, reconsider, register, search_decisions, status, summarize, trace, verify, what_changed, why

## Per-Scenario Breakdown

| Scenario | Mean | Std | Best Condition | Worst Condition |
| --- | --- | --- | --- | --- |
| sprint-simulation | 8.0 | 0.0 | twining-lite | baseline |

## Interaction Effects

_No disordinal interactions detected._

## Effect Sizes (vs Baseline)

| Condition | Cohen's d | Interpretation | Significant |
| --- | --- | --- | --- |
| full-twining | +1.79 | large |  |
| shared-markdown | +0.97 | large |  |
| twining-lite | +3.03 | large | \* |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| full-twining | 15.7% | 100% | 60 |
| shared-markdown | 0.0% | 0% | 60 |
| twining-lite | 15.4% | 100% | 60 |
| baseline | 0.0% | 0% | 60 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $9.55 | $0.125 |
| full-twining | $11.50 | $0.140 |
| shared-markdown | $8.97 | $0.111 |
| twining-lite | $11.42 | $0.135 |

## Construct Validity

**Internal consistency:** 19/20 scenario-condition-dimension cells have CV < 20%

### Dimension Correlations

| Dimension A | Dimension B | Pearson r | Interpretation |
| --- | --- | --- | --- |
| assumptionHandling | contextRecovery | 0.20 | independent |
| assumptionHandling | cumulativeRework | -0.33 | weakly related |
| assumptionHandling | decisionConsistency | -0.09 | independent |
| assumptionHandling | finalQuality | 0.23 | weakly related |
| contextRecovery | cumulativeRework | 0.15 | independent |
| contextRecovery | decisionConsistency | -0.15 | independent |
| contextRecovery | finalQuality | 0.17 | independent |
| cumulativeRework | decisionConsistency | -0.25 | weakly related |
| cumulativeRework | finalQuality | 0.16 | independent |
| decisionConsistency | finalQuality | 0.16 | independent |

## Reliability

**All 4 scenario-condition cells have CV <= 30%.**

### Statistical Design

- **Iterations per pair:** 5
- **Scenarios:** 1
- **N per condition:** 5 (pooled across scenarios)
- **Minimum Detectable Effect (MDES):** d ≥ 2.02 at 80% power

### Power Analysis

| Comparison | Cohen's d | N | MDES | Power | Verdict |
| --- | --- | --- | --- | --- | --- |
| baseline vs full-twining | +1.793 | 5 | d≥2.02 | 0.700 | effect (d=1.79) is below detectable threshold (MDES=2.02) — inconclusive, not evidence of no effect |
| baseline vs shared-markdown | +0.970 | 5 | d≥2.02 | 0.272 | effect (d=0.97) is below detectable threshold (MDES=2.02) — inconclusive, not evidence of no effect |
| baseline vs twining-lite | +3.033 | 5 | d≥2.02 | 0.986 | adequately powered |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 60 | 60 | 0 | 0 | 0 | 0 | 0.0 | 0% | 233s |
| full-twining | 60 | 60 | 0 | 0 | 0 | 262 | 4.4 | 100% | 193s |
| shared-markdown | 60 | 60 | 0 | 0 | 0 | 0 | 0.0 | 0% | 177s |
| twining-lite | 60 | 60 | 0 | 0 | 0 | 257 | 4.3 | 100% | 220s |

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 60 | 45.6 | 370.9 | 0 | 0 | Agent |
| full-twining | 60 | 33.6 | 367.2 | 0 | 0 | ToolSearch |
| shared-markdown | 60 | 33.6 | 401.9 | 88 | 63 | Read |
| twining-lite | 60 | 33.4 | 370.8 | 0 | 0 | ToolSearch |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 59 | 0.012 | 0.971 | 0.344 |
| full-twining | 59 | 0.014 | 0.968 | 0.395 |
| shared-markdown | 59 | 0.015 | 0.964 | 0.341 |
| twining-lite | 59 | 0.012 | 0.969 | 0.340 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $47.77 | $9.554 | $0.1249 | 13999s | 466 | 57 |
| full-twining | $57.50 | $11.501 | $0.1401 | 11586s | 383 | 35 |
| shared-markdown | $44.83 | $8.967 | $0.1108 | 10599s | 538 | 45 |
| twining-lite | $57.08 | $11.416 | $0.1351 | 13220s | 390 | 35 |

## Recommendations

- **[high]** Reduce tool surface area: full-twining (82.1) scores lower than twining-lite (84.5)
- **[medium]** Insensitive scorer: dimension 'finalQuality' has only 4.4-point spread across conditions
- **[medium]** High scorer variance (CV>20%) in 1 scenario x condition pairs for dimensions: decisionConsistency
- **[low]** Inconclusive comparisons (full-twining, shared-markdown): observed effects are below detectable threshold — cannot distinguish from noise at current sample size
- **[low]** Escalating cost in 'sprint-simulation' x 'baseline': cost increases across sessions (slope=0.033)
- **[low]** Escalating cost in 'sprint-simulation' x 'twining-lite': cost increases across sessions (slope=0.027)

---
_Generated by benchmark-analysis_