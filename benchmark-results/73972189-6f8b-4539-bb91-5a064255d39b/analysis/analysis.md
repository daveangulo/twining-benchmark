# Benchmark Analysis Report

**Run ID:** 73972189-6f8b-4539-bb91-5a064255d39b  
**Timestamp:** 2026-03-30T00:31:32.733Z  
**Status:** completed  
**Scenarios:** sprint-simulation  
**Conditions:** full-twining, twining-lite, baseline, shared-markdown  
**Runs per pair:** 3  

## Executive Summary

> shared-markdown ranks #1 with 88.1 composite but lift is not statistically significant (need more runs)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | shared-markdown | 88.1 | +22.9 |  | large | +3.14 | $9.71 | $0.110 |
| 2 | full-twining | 87.6 | +22.4 |  | large | +2.41 | $10.11 | $0.115 |
| 3 | twining-lite | 83.3 | +18.1 |  | large | +2.76 | $10.22 | $0.123 |
| 4 | baseline | 65.2 | +0.0 |  | N/A | N/A | $7.55 | $0.116 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | +22.4 | No | +2.41 | large |
| shared-markdown | +22.9 | No | +3.14 | large |
| twining-lite | +18.1 | No | +2.76 | large |

## Behavior-Outcome Correlations

| Behavior | Outcome | r | Interpretation |
| --- | --- | --- | --- |
| productive_calls | cost_usd | -1.00 | very strong |
| num_turns | cost_usd | +1.00 | very strong |
| total_tool_calls | cost_usd | -1.00 | very strong |

## Effect Decomposition

| Mechanism | Associated Difference | Evidence |
| --- | --- | --- |
| orientation | -21.17 | non-users: shared-markdown, twining-lite, full-twining |
| recording | -21.17 | non-users: shared-markdown, twining-lite, full-twining |
| graph_building | -21.17 | non-users: shared-markdown, twining-lite, full-twining |
| verification | -21.17 | non-users: shared-markdown, twining-lite, full-twining |
| coordination_mgmt | -21.17 | non-users: shared-markdown, twining-lite, full-twining |
| search_retrieval | -21.17 | non-users: shared-markdown, twining-lite, full-twining |
| lifecycle | -21.17 | non-users: shared-markdown, twining-lite, full-twining |
| decision_mgmt | -21.17 | non-users: shared-markdown, twining-lite, full-twining |

## Per-Scenario Breakdown

| Scenario | Mean | Std | Best Condition | Worst Condition |
| --- | --- | --- | --- | --- |
| sprint-simulation | 22.9 | 0.0 | shared-markdown | baseline |

## Interaction Effects

_No disordinal interactions detected._

## Effect Sizes (vs Baseline)

| Condition | Cohen's d | Interpretation | Significant |
| --- | --- | --- | --- |
| full-twining | +2.41 | large |  |
| shared-markdown | +3.14 | large |  |
| twining-lite | +2.76 | large |  |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| baseline | 0.0% | 0% | 36 |
| shared-markdown | 0.0% | 0% | 36 |
| twining-lite | 15.1% | 100% | 36 |
| full-twining | 15.3% | 100% | 36 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $7.55 | $0.116 |
| full-twining | $10.11 | $0.115 |
| shared-markdown | $9.71 | $0.110 |
| twining-lite | $10.22 | $0.123 |

## Construct Validity

**Internal consistency:** 17/20 scenario-condition-dimension cells have CV < 20%

### Dimension Correlations

| Dimension A | Dimension B | Pearson r | Interpretation |
| --- | --- | --- | --- |
| assumptionHandling | contextRecovery | 0.68 | moderately related |
| assumptionHandling | cumulativeRework | -0.67 | moderately related |
| assumptionHandling | decisionConsistency | 0.23 | weakly related |
| contextRecovery | cumulativeRework | -0.20 | weakly related |
| contextRecovery | decisionConsistency | -0.08 | independent |
| cumulativeRework | decisionConsistency | 0.12 | independent |

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
| baseline vs full-twining | +2.408 | 3 | d≥3.07 | 0.605 | effect (d=2.41) is below detectable threshold (MDES=3.07) — inconclusive, not evidence of no effect |
| baseline vs shared-markdown | +3.141 | 3 | d≥3.07 | 0.816 | adequately powered |
| baseline vs twining-lite | +2.760 | 3 | d≥3.07 | 0.717 | effect (d=2.76) is below detectable threshold (MDES=3.07) — inconclusive, not evidence of no effect |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 36 | 36 | 0 | 0 | 0 | 0 | 0.0 | 0% | 750s |
| full-twining | 36 | 36 | 0 | 0 | 0 | 154 | 4.3 | 100% | 395s |
| shared-markdown | 36 | 36 | 0 | 0 | 0 | 0 | 0.0 | 0% | 258s |
| twining-lite | 36 | 36 | 0 | 0 | 0 | 150 | 4.2 | 100% | 411s |

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 36 | 48.3 | 320.5 | 0 | 0 | Agent |
| full-twining | 36 | 35.9 | 335.6 | 0 | 0 | ToolSearch |
| shared-markdown | 36 | 39.5 | 407.7 | 56 | 36 | Read |
| twining-lite | 36 | 33.1 | 334.7 | 0 | 0 | ToolSearch |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 35 | 0.008 | 0.977 | 0.276 |
| full-twining | 35 | 0.015 | 0.972 | 0.273 |
| shared-markdown | 35 | 0.016 | 0.972 | 0.324 |
| twining-lite | 35 | 0.012 | 0.973 | 0.251 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $22.65 | $7.549 | $0.1158 | 27010s | 510 | 77 |
| full-twining | $30.33 | $10.110 | $0.1154 | 14236s | 398 | 43 |
| shared-markdown | $29.14 | $9.713 | $0.1102 | 9272s | 504 | 49 |
| twining-lite | $30.67 | $10.222 | $0.1227 | 14787s | 393 | 39 |

## Recommendations

- **[high]** Fix activation: Twining engagement rate is 0% for baseline — agents aren't using coordination tools
- **[high]** Fix activation: Twining engagement rate is 0% for shared-markdown — agents aren't using coordination tools
- **[high]** Broken scorer: dimension 'finalQuality' has zero variance (always 100) — fix or remove
- **[high]** No statistically significant coordination lift detected — coordination tools may not be providing measurable value
- **[medium]** At 3 iterations/pair (n=3/condition), only large effects (d≥3.1) are detectable. At 5 iterations/pair, MDES drops to d≥2.0 — a ~66% cost increase for medium-effect detection
- **[medium]** Insensitive scorer: dimension 'cumulativeRework' has only 2.7-point spread across conditions
- **[medium]** Insensitive scorer: dimension 'finalQuality' has only 0.0-point spread across conditions
- **[medium]** High scorer variance (CV>20%) in 3 scenario x condition pairs for dimensions: assumptionHandling, decisionConsistency
- **[low]** Inconclusive comparisons (full-twining, twining-lite): observed effects are below detectable threshold — cannot distinguish from noise at current sample size
- **[low]** Escalating cost in 'sprint-simulation' x 'full-twining': cost increases across sessions (slope=0.039)
- **[low]** Escalating cost in 'sprint-simulation' x 'shared-markdown': cost increases across sessions (slope=0.033)
- **[low]** Escalating cost in 'sprint-simulation' x 'twining-lite': cost increases across sessions (slope=0.033)

---
_Generated by benchmark-analysis_