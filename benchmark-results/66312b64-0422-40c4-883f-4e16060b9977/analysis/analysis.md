# Benchmark Analysis Report

**Run ID:** 66312b64-0422-40c4-883f-4e16060b9977  
**Timestamp:** 2026-04-04T05:47:57.076Z  
**Status:** completed  
**Scenarios:** evolving-requirements, conflict-resolution  
**Conditions:** baseline, shared-markdown, full-twining, twining-lite  
**Runs per pair:** 5  

## Executive Summary

> full-twining ranks #1 with 88.1 composite (+25.7 vs baseline, large effect, p<0.05)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | full-twining | 88.1 | +25.7 | \* | large | +1.44 | $2.38 | $0.027 |
| 2 | twining-lite | 74.8 | +12.4 |  | medium | +0.61 | $1.67 | $0.022 |
| 3 | baseline | 62.4 | +0.0 |  | N/A | N/A | $1.78 | $0.029 |
| 4 | shared-markdown | 55.2 | -7.2 |  | small | -0.24 | $0.65 | $0.012 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | +25.7 | Yes | +1.44 | large |
| shared-markdown | -7.2 | No | -0.24 | small |
| twining-lite | +12.4 | No | +0.61 | medium |

## Behavior-Outcome Correlations

| Behavior | Outcome | r | Interpretation |
| --- | --- | --- | --- |
| num_turns | cost_usd | +0.98 | very strong |

## Effect Decomposition

_All 8 mechanisms show identical associated difference (-10.3) because the same conditions use all Twining tools. See lite-vs-full comparison below for tool surface analysis._

### Lite vs Full Twining

| Metric | Value |
| --- | --- |
| twining-lite mean | 74.85 |
| full-twining mean | 88.12 |
| delta (full - lite) | +13.3 |
| conclusion | full-twining scored higher |

**Never-called tools:** acknowledge, add_entity, add_relation, agents, archive, assemble, commits, decide, delegate, discover, dismiss, export, graph_query, handoff, link_commit, neighbors, override, post, promote, prune_graph, query, read, recent, reconsider, register, search_decisions, status, summarize, trace, verify, what_changed, why

## Per-Scenario Breakdown

| Scenario | Mean | Std | Best Condition | Worst Condition |
| --- | --- | --- | --- | --- |
| conflict-resolution | 38.6 | 0.0 | twining-lite | shared-markdown |
| evolving-requirements | 28.9 | 0.0 | full-twining | shared-markdown |

## Interaction Effects

_No disordinal interactions detected._

## Effect Sizes (vs Baseline)

| Condition | Cohen's d | Interpretation | Significant |
| --- | --- | --- | --- |
| full-twining | +1.44 | large |  |
| shared-markdown | -0.24 | small |  |
| twining-lite | +0.62 | medium |  |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| baseline | 0.0% | 0% | 35 |
| full-twining | 11.8% | 100% | 35 |
| shared-markdown | 0.0% | 0% | 35 |
| twining-lite | 9.6% | 100% | 35 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $1.78 | $0.029 |
| full-twining | $2.38 | $0.027 |
| shared-markdown | $0.65 | $0.012 |
| twining-lite | $1.67 | $0.022 |

## Construct Validity

**Internal consistency:** 12/28 scenario-condition-dimension cells have CV < 20%

### Dimension Correlations

| Dimension A | Dimension B | Pearson r | Interpretation |
| --- | --- | --- | --- |
| backwardCompatibility | decisionEvolution | -0.40 | weakly related |
| backwardCompatibility | integrationCompleteness | -0.15 | independent |
| backwardCompatibility | requirementAdaptation | -0.23 | weakly related |
| conflict-detection | decision-documentation | 0.71 | strongly related |
| conflict-detection | resolution-quality | 0.88 | strongly related |
| decision-documentation | resolution-quality | 0.47 | moderately related |
| decisionEvolution | integrationCompleteness | -0.16 | independent |
| decisionEvolution | requirementAdaptation | 0.57 | moderately related |
| integrationCompleteness | requirementAdaptation | 0.23 | weakly related |

## Reliability

**High-variance cells (CV > 30%):** 4 of 8

| Scenario | Condition | N | Mean | CV% |
| --- | --- | --- | --- | --- |
| conflict-resolution | baseline | 5 | 55.60 | 46.6 |
| conflict-resolution | shared-markdown | 5 | 43.60 | 93.1 |
| evolving-requirements | shared-markdown | 5 | 66.90 | 34.2 |
| evolving-requirements | twining-lite | 5 | 67.50 | 30.2 |

### Statistical Design

- **Iterations per pair:** 5
- **Scenarios:** 2
- **N per condition:** 10 (pooled across scenarios)
- **Minimum Detectable Effect (MDES):** d ≥ 1.32 at 80% power

### Power Analysis

| Comparison | Cohen's d | N | MDES | Power | Verdict |
| --- | --- | --- | --- | --- | --- |
| baseline vs full-twining | +1.443 | 10 | d≥1.32 | 0.862 | adequately powered |
| baseline vs shared-markdown | -0.241 | 10 | d≥1.32 | 0.080 | effect (d=0.24) is below detectable threshold (MDES=1.32) — inconclusive, not evidence of no effect |
| baseline vs twining-lite | +0.615 | 10 | d≥1.32 | 0.256 | effect (d=0.62) is below detectable threshold (MDES=1.32) — inconclusive, not evidence of no effect |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 35 | 35 | 0 | 0 | 0 | 0 | 0.0 | 0% | 654s |
| full-twining | 35 | 35 | 0 | 0 | 0 | 138 | 3.9 | 100% | 481s |
| shared-markdown | 35 | 35 | 0 | 0 | 0 | 0 | 0.0 | 0% | 988s |
| twining-lite | 35 | 35 | 0 | 0 | 0 | 97 | 2.8 | 100% | 812s |

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 35 | 33.8 | 235.3 | 0 | 0 | Agent |
| full-twining | 35 | 38.2 | 271.0 | 0 | 1 | ToolSearch |
| shared-markdown | 35 | 26.7 | 194.8 | 43 | 8 | Read |
| twining-lite | 35 | 35.5 | 122.3 | 0 | 0 | ToolSearch |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 33 | 0.032 | 0.982 | 0.228 |
| full-twining | 33 | 0.158 | 0.936 | 0.251 |
| shared-markdown | 33 | 0.027 | 0.992 | 0.088 |
| twining-lite | 33 | 0.168 | 0.925 | 0.168 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $17.85 | $1.785 | $0.0286 | 22876s | 461 | 66 |
| full-twining | $23.82 | $2.382 | $0.0270 | 16825s | 398 | 56 |
| shared-markdown | $6.49 | $0.649 | $0.0118 | 34587s | 1050 | 144 |
| twining-lite | $16.72 | $1.672 | $0.0223 | 28416s | 256 | 74 |

## Recommendations

- **[high]** Coordination hurts in 'conflict-resolution': shared-markdown scores -12.0 points below baseline
- **[medium]** High scorer variance (CV>20%) in 16 scenario x condition pairs for dimensions: backwardCompatibility, conflict-detection, decision-documentation, decisionEvolution, integrationCompleteness, requirementAdaptation, resolution-quality
- **[low]** Inconclusive comparisons (shared-markdown, twining-lite): observed effects are below detectable threshold — cannot distinguish from noise at current sample size
- **[low]** Escalating cost in 'conflict-resolution' x 'full-twining': cost increases across sessions (slope=0.127)
- **[low]** Escalating cost in 'conflict-resolution' x 'twining-lite': cost increases across sessions (slope=0.226)
- **[low]** Escalating cost in 'evolving-requirements' x 'baseline': cost increases across sessions (slope=0.214)
- **[low]** Escalating cost in 'evolving-requirements' x 'full-twining': cost increases across sessions (slope=0.167)

---
_Generated by benchmark-analysis_