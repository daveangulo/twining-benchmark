# Benchmark Analysis Report

**Run ID:** 16a2e4e1-264c-4281-8fb9-2614dbd5a5c9  
**Timestamp:** 2026-03-28T00:58:32.559Z  
**Status:** completed  
**Scenarios:** sprint-simulation  
**Conditions:** full-twining, twining-lite, baseline, shared-markdown  
**Runs per pair:** 3  

## Executive Summary

> shared-markdown ranks #1 with 85.4 composite (+11.5 vs baseline, large effect, p<0.05)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | shared-markdown | 85.4 | +11.5 | \* | large | +2.57 | $19.14 | $0.224 |
| 2 | baseline | 73.8 | +0.0 |  | N/A | N/A | $23.41 | $0.317 |
| 3 | full-twining | 23.1 | -50.7 | \* | large | -22.03 | $2.57 | $0.111 |
| 4 | twining-lite | 23.1 | -50.7 | \* | large | -27.98 | $2.33 | $0.101 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | -50.7 | Yes | -22.03 | large |
| shared-markdown | +11.5 | Yes | +2.57 | large |
| twining-lite | -50.7 | Yes | -27.98 | large |

## Behavior-Outcome Correlations

_No behavior-outcome correlation data available._

## Effect Decomposition

| Mechanism | Associated Difference | Evidence |
| --- | --- | --- |
| orientation | +29.94 | non-users: shared-markdown, full-twining, twining-lite |
| recording | +29.94 | non-users: shared-markdown, full-twining, twining-lite |
| graph_building | +29.94 | non-users: shared-markdown, full-twining, twining-lite |
| verification | +29.94 | non-users: shared-markdown, full-twining, twining-lite |
| coordination_mgmt | +29.94 | non-users: shared-markdown, full-twining, twining-lite |
| search_retrieval | +29.94 | non-users: shared-markdown, full-twining, twining-lite |
| lifecycle | +29.94 | non-users: shared-markdown, full-twining, twining-lite |
| decision_mgmt | +29.94 | non-users: shared-markdown, full-twining, twining-lite |

## Per-Scenario Breakdown

| Scenario | Mean | Std | Best Condition | Worst Condition |
| --- | --- | --- | --- | --- |
| sprint-simulation | 62.2 | 0.0 | shared-markdown | twining-lite |

## Interaction Effects

_No disordinal interactions detected._

## Effect Sizes (vs Baseline)

| Condition | Cohen's d | Interpretation | Significant |
| --- | --- | --- | --- |
| full-twining | -22.03 | large |  |
| shared-markdown | +2.57 | large |  |
| twining-lite | -27.98 | large |  |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| shared-markdown | 0.0% | 0% | 35 |
| baseline | 0.0% | 0% | 36 |
| full-twining | 0.0% | 0% | 2 |
| twining-lite | 0.0% | 0% | 3 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $23.41 | $0.317 |
| full-twining | $2.57 | $0.111 |
| shared-markdown | $19.14 | $0.224 |
| twining-lite | $2.33 | $0.101 |

## Construct Validity

**Internal consistency:** 19/20 scenario-condition-dimension cells have CV < 20%

### Dimension Correlations

| Dimension A | Dimension B | Pearson r | Interpretation |
| --- | --- | --- | --- |
| assumptionHandling | contextRecovery | 0.97 | redundant |
| assumptionHandling | cumulativeRework | 0.94 | redundant |
| assumptionHandling | decisionConsistency | 0.80 | strongly related |
| assumptionHandling | finalQuality | 0.94 | redundant |
| contextRecovery | cumulativeRework | 0.99 | redundant |
| contextRecovery | decisionConsistency | 0.85 | strongly related |
| contextRecovery | finalQuality | 0.99 | redundant |
| cumulativeRework | decisionConsistency | 0.87 | strongly related |
| cumulativeRework | finalQuality | 1.00 | redundant |
| decisionConsistency | finalQuality | 0.85 | strongly related |

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
| baseline vs full-twining | -22.026 | 2 | d≥inf | 1.000 | effect (d=22.03) is below detectable threshold (MDES=inf) — inconclusive, not evidence of no effect |
| baseline vs shared-markdown | +2.566 | 3 | d≥3.07 | 0.657 | effect (d=2.57) is below detectable threshold (MDES=3.07) — inconclusive, not evidence of no effect |
| baseline vs twining-lite | -27.977 | 3 | d≥3.07 | 1.000 | adequately powered |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 36 | 36 | 0 | 0 | 0 | 0 | 0.0 | 0% | 413s |
| full-twining | 2 | 2 | 0 | 0 | 0 | 0 | 0.0 | 0% | 718s |
| shared-markdown | 35 | 35 | 0 | 0 | 0 | 0 | 0.0 | 0% | 284s |
| twining-lite | 3 | 3 | 0 | 0 | 0 | 0 | 0.0 | 0% | 526s |

**Warnings:**

- Condition 'full-twining' has 'twining' in name but 0 Twining tool calls across all 2 sessions — plugin likely not loaded
- Condition 'twining-lite' has 'twining' in name but 0 Twining tool calls across all 3 sessions — plugin likely not loaded

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 36 | 64.5 | 999.5 | 0 | 0 | Task |
| full-twining | 2 | 77.5 | 1194.5 | 0 | 0 | Task |
| shared-markdown | 35 | 50.7 | 478.6 | 68 | 41 | Read |
| twining-lite | 3 | 72.3 | 1049.7 | 0 | 0 | Task |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 35 | 0.008 | 0.966 | 0.375 |
| full-twining | 1 | 0.017 | 0.881 | 0.504 |
| shared-markdown | 34 | 0.008 | 0.970 | 0.338 |
| twining-lite | 2 | 0.016 | 0.909 | 0.511 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $70.24 | $23.412 | $0.3171 | 14885s | 512 | 33 |
| full-twining | $5.14 | $2.570 | $0.1110 | 1435s | 465 | 30 |
| shared-markdown | $57.43 | $19.143 | $0.2242 | 9944s | 292 | 31 |
| twining-lite | $6.98 | $2.325 | $0.1005 | 1577s | 451 | 31 |

## Recommendations

- **[high]** Fix activation: Twining engagement rate is 0% for shared-markdown — agents aren't using coordination tools
- **[high]** Fix activation: Twining engagement rate is 0% for baseline — agents aren't using coordination tools
- **[high]** Fix activation: Twining engagement rate is 0% for full-twining — agents aren't using coordination tools
- **[high]** Fix activation: Twining engagement rate is 0% for twining-lite — agents aren't using coordination tools
- **[high]** Coordination hurts in 'sprint-simulation': twining-lite scores -50.7 points below baseline
- **[medium]** At 3 iterations/pair (n=3/condition), only large effects (d≥3.1) are detectable. At 5 iterations/pair, MDES drops to d≥2.0 — a ~66% cost increase for medium-effect detection
- **[medium]** High scorer variance (CV>20%) in 1 scenario x condition pairs for dimensions: decisionConsistency
- **[low]** Inconclusive comparisons (full-twining, shared-markdown): observed effects are below detectable threshold — cannot distinguish from noise at current sample size

---
_Generated by benchmark-analysis_