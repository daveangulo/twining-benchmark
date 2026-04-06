# Benchmark Analysis Report

**Run ID:** d18ab582-d557-4976-88da-bb68cf90f33f  
**Timestamp:** 2026-03-31T02:41:03.301Z  
**Status:** completed  
**Scenarios:** sprint-simulation  
**Conditions:** full-twining, twining-lite, baseline, shared-markdown  
**Runs per pair:** 3  

## Executive Summary

> full-twining ranks #1 with 78.7 composite but lift is not statistically significant (need more runs)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | full-twining | 78.7 | +20.8 |  | large | +2.81 | $11.02 | $0.140 |
| 2 | twining-lite | 77.5 | +19.6 |  | large | +2.69 | $11.81 | $0.152 |
| 3 | shared-markdown | 72.7 | +14.8 |  | large | +1.63 | $10.11 | $0.139 |
| 4 | baseline | 57.9 | +0.0 |  | N/A | N/A | $9.84 | $0.170 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | +20.8 | No | +2.81 | large |
| shared-markdown | +14.8 | No | +1.63 | large |
| twining-lite | +19.6 | No | +2.69 | large |

## Behavior-Outcome Correlations

| Behavior | Outcome | r | Interpretation |
| --- | --- | --- | --- |
| productive_calls | composite | -1.00 | very strong |
| num_turns | cost_usd | +1.00 | very strong |
| total_tool_calls | composite | -1.00 | very strong |

## Effect Decomposition

| Mechanism | Associated Difference | Evidence |
| --- | --- | --- |
| orientation | -18.40 | non-users: twining-lite, shared-markdown, full-twining |
| recording | -18.40 | non-users: twining-lite, shared-markdown, full-twining |
| graph_building | -18.40 | non-users: twining-lite, shared-markdown, full-twining |
| verification | -18.40 | non-users: twining-lite, shared-markdown, full-twining |
| coordination_mgmt | -18.40 | non-users: twining-lite, shared-markdown, full-twining |
| search_retrieval | -18.40 | non-users: twining-lite, shared-markdown, full-twining |
| lifecycle | -18.40 | non-users: twining-lite, shared-markdown, full-twining |
| decision_mgmt | -18.40 | non-users: twining-lite, shared-markdown, full-twining |

## Per-Scenario Breakdown

| Scenario | Mean | Std | Best Condition | Worst Condition |
| --- | --- | --- | --- | --- |
| sprint-simulation | 20.8 | 0.0 | full-twining | baseline |

## Interaction Effects

_No disordinal interactions detected._

## Effect Sizes (vs Baseline)

| Condition | Cohen's d | Interpretation | Significant |
| --- | --- | --- | --- |
| full-twining | +2.81 | large |  |
| shared-markdown | +1.63 | large |  |
| twining-lite | +2.69 | large |  |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| twining-lite | 15.5% | 100% | 36 |
| baseline | 0.0% | 0% | 36 |
| shared-markdown | 0.0% | 0% | 36 |
| full-twining | 16.4% | 100% | 36 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $9.84 | $0.170 |
| full-twining | $11.02 | $0.140 |
| shared-markdown | $10.11 | $0.139 |
| twining-lite | $11.81 | $0.152 |

## Construct Validity

**Internal consistency:** 16/20 scenario-condition-dimension cells have CV < 20%

### Dimension Correlations

| Dimension A | Dimension B | Pearson r | Interpretation |
| --- | --- | --- | --- |
| assumptionHandling | contextRecovery | 0.95 | redundant |
| assumptionHandling | cumulativeRework | 0.19 | independent |
| assumptionHandling | decisionConsistency | 0.30 | weakly related |
| assumptionHandling | finalQuality | 0.26 | weakly related |
| contextRecovery | cumulativeRework | 0.08 | independent |
| contextRecovery | decisionConsistency | 0.36 | weakly related |
| contextRecovery | finalQuality | 0.44 | moderately related |
| cumulativeRework | decisionConsistency | 0.16 | independent |
| cumulativeRework | finalQuality | -0.15 | independent |
| decisionConsistency | finalQuality | 0.18 | independent |

## Reliability

**All 4 scenario-condition cells have CV <= 30%.**

### Statistical Design

- **Iterations per pair:** 3
- **Scenarios:** 1
- **N per condition:** 3 (pooled across scenarios)
- **Minimum Detectable Effect (MDES):** d ≥ 3.07 at 80% power
- **At 5 iterations:** n=5, MDES = d ≥ 2.02
  - Going from 3→5 iterations costs ~66% more but detects medium effects (d≈0.6) at 80% power

### Power Analysis

| Comparison | Cohen's d | N | MDES | Power | Verdict |
| --- | --- | --- | --- | --- | --- |
| baseline vs full-twining | +2.814 | 3 | d≥3.07 | 0.732 | effect (d=2.81) is below detectable threshold (MDES=3.07) — inconclusive, not evidence of no effect |
| baseline vs shared-markdown | +1.634 | 3 | d≥3.07 | 0.336 | effect (d=1.63) is below detectable threshold (MDES=3.07) — inconclusive, not evidence of no effect |
| baseline vs twining-lite | +2.688 | 3 | d≥3.07 | 0.695 | effect (d=2.69) is below detectable threshold (MDES=3.07) — inconclusive, not evidence of no effect |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 36 | 36 | 0 | 0 | 0 | 0 | 0.0 | 0% | 223s |
| full-twining | 36 | 36 | 0 | 0 | 0 | 161 | 4.5 | 100% | 182s |
| shared-markdown | 36 | 36 | 0 | 0 | 0 | 0 | 0.0 | 0% | 192s |
| twining-lite | 36 | 36 | 0 | 0 | 0 | 157 | 4.4 | 100% | 190s |

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 36 | 46.7 | 400.6 | 0 | 0 | Agent |
| full-twining | 36 | 32.4 | 386.8 | 0 | 0 | ToolSearch |
| shared-markdown | 36 | 35.6 | 431.6 | 48 | 36 | Read |
| twining-lite | 36 | 33.6 | 381.6 | 0 | 0 | ToolSearch |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 35 | 0.013 | 0.967 | 0.282 |
| full-twining | 35 | 0.014 | 0.971 | 0.294 |
| shared-markdown | 35 | 0.011 | 0.969 | 0.309 |
| twining-lite | 35 | 0.009 | 0.977 | 0.311 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $29.52 | $9.841 | $0.1700 | 8036s | 488 | 57 |
| full-twining | $33.06 | $11.020 | $0.1400 | 6563s | 421 | 35 |
| shared-markdown | $30.32 | $10.108 | $0.1390 | 6901s | 512 | 42 |
| twining-lite | $35.43 | $11.811 | $0.1525 | 6832s | 388 | 34 |

## Recommendations

- **[high]** Fix activation: Twining engagement rate is 0% for baseline — agents aren't using coordination tools
- **[high]** Fix activation: Twining engagement rate is 0% for shared-markdown — agents aren't using coordination tools
- **[high]** No statistically significant coordination lift detected — coordination tools may not be providing measurable value
- **[medium]** At 3 iterations/pair (n=3/condition), only large effects (d≥3.1) are detectable. At 5 iterations/pair, MDES drops to d≥2.0 — a ~66% cost increase for medium-effect detection
- **[medium]** Insensitive scorer: dimension 'cumulativeRework' has only 4.7-point spread across conditions
- **[medium]** High scorer variance (CV>20%) in 4 scenario x condition pairs for dimensions: decisionConsistency
- **[low]** Inconclusive comparisons (full-twining, shared-markdown, twining-lite): observed effects are below detectable threshold — cannot distinguish from noise at current sample size
- **[low]** Escalating cost in 'sprint-simulation' x 'twining-lite': cost increases across sessions (slope=0.050)

---
_Generated by benchmark-analysis_