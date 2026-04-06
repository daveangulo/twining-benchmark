# Benchmark Analysis Report

**Run ID:** pooled-all-valid  
**Timestamp:** 2026-04-04T00:00:00Z  
**Status:** completed  
**Scenarios:** architecture-cascade, conflict-resolution, context-recovery, evolving-requirements, multi-session-build, sprint-simulation  
**Conditions:** baseline, full-twining, shared-markdown, twining-lite  
**Runs per pair:** 5  

## Executive Summary

> twining-lite ranks #1 with 75.8 composite (+10.3 vs baseline, medium effect, p<0.05)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | twining-lite | 75.8 | +10.3 | \* | medium | +0.65 | $5.52 | $0.073 |
| 2 | full-twining | 74.5 | +9.0 | \* | medium | +0.59 | $4.48 | $0.060 |
| 3 | shared-markdown | 69.1 | +3.7 |  | negligible | +0.19 | $4.89 | $0.071 |
| 4 | baseline | 65.5 | +0.0 |  | N/A | N/A | $5.38 | $0.082 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | +9.0 | Yes | +0.59 | medium |
| shared-markdown | +3.7 | No | +0.19 | negligible |
| twining-lite | +10.3 | Yes | +0.65 | medium |

## Behavior-Outcome Correlations

| Behavior | Outcome | r | Interpretation |
| --- | --- | --- | --- |
| num_turns | cost_usd | +0.87 | very strong |
| total_tool_calls | cost_usd | +0.59 | strong |

## Effect Decomposition

| Mechanism | Diff | Avg Calls/Sess | Heavy Users | Non-Users |
| --- | --- | --- | --- | --- |
| graph_building | -7.7 | 0.0 | none | full-twining, shared-markdown, twining-lite |
| coordination_mgmt | -7.7 | 0.0 | none | full-twining, shared-markdown, twining-lite |
| search_retrieval | -7.7 | 0.1 | none | full-twining, shared-markdown, twining-lite |
| lifecycle | -7.7 | 0.0 | none | full-twining, shared-markdown, twining-lite |
| decision_mgmt | -7.7 | 0.1 | none | full-twining, shared-markdown, twining-lite |
| orientation | +6.0 | 1.1 | full-twining, twining-lite | shared-markdown |
| recording | +6.0 | 2.7 | full-twining, twining-lite | shared-markdown |
| verification | -3.7 | 0.8 | none | shared-markdown |

### Lite vs Full Twining

| Metric | Value |
| --- | --- |
| twining-lite mean | 75.81 |
| full-twining mean | 74.52 |
| delta (full - lite) | -1.3 |
| conclusion | twining-lite scored comparably |
| full-only tools | acknowledge |
| shared tools | add_relation, assemble, decide, dismiss, link_commit, post, reconsider, search_decisions, verify, why |

### Tool Utilization

| Condition | Tool | Count |
| --- | --- | --- |
| full-twining | assemble | 218 |
| full-twining | post | 215 |
| full-twining | verify | 190 |
| full-twining | decide | 181 |
| full-twining | why | 18 |
| full-twining | link_commit | 14 |
| full-twining | search_decisions | 14 |
| full-twining | dismiss | 7 |
| full-twining | add_relation | 4 |
| full-twining | reconsider | 4 |
| full-twining | acknowledge | 2 |
| twining-lite | post | 223 |
| twining-lite | assemble | 216 |
| twining-lite | decide | 177 |
| twining-lite | verify | 172 |
| twining-lite | why | 20 |
| twining-lite | link_commit | 11 |
| twining-lite | add_relation | 10 |
| twining-lite | search_decisions | 9 |
| twining-lite | reconsider | 5 |
| twining-lite | dismiss | 5 |
| twining-lite | add_entity | 2 |
| twining-lite | override | 1 |
| twining-lite | neighbors | 1 |

**Never-called tools:** agents, archive, commits, delegate, discover, export, graph_query, handoff, promote, prune_graph, query, read, recent, register, status, summarize, trace, what_changed

## Per-Scenario Breakdown

| Scenario | Spread | Best Condition | Best Mean | Worst Condition | Worst Mean |
| --- | --- | --- | --- | --- | --- |
| sprint-simulation | 10.9 | twining-lite | 81.4 | baseline | 70.5 |
| context-recovery | 12.2 | full-twining | 66.5 | shared-markdown | 54.3 |
| multi-session-build | 11.4 | shared-markdown | 96.4 | full-twining | 85.0 |
| conflict-resolution | 36.4 | twining-lite | 82.2 | shared-markdown | 45.8 |
| evolving-requirements | 18.9 | full-twining | 72.7 | baseline | 53.7 |
| architecture-cascade | 7.5 | twining-lite | 65.6 | full-twining | 58.1 |

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
| full-twining | +0.59 | medium | \* |
| shared-markdown | +0.19 | negligible |  |
| twining-lite | +0.65 | medium | \* |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| full-twining | 14.4% | 98% | 220 |
| baseline | 0.0% | 0% | 262 |
| shared-markdown | 0.0% | 0% | 253 |
| twining-lite | 14.3% | 100% | 217 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $5.38 | $0.082 |
| full-twining | $4.48 | $0.060 |
| shared-markdown | $4.89 | $0.071 |
| twining-lite | $5.52 | $0.073 |

## Construct Validity

**Internal consistency:** 56/92 scenario-condition-dimension cells have CV < 20%

### Dimension Correlations

| Dimension A | Dimension B | Pearson r | Interpretation |
| --- | --- | --- | --- |
| architecturalDrift | cumulativeRework | 0.47 | moderately related |
| architecturalDrift | finalQuality | 0.34 | weakly related |
| assumptionHandling | contextRecovery | 0.38 | weakly related |
| assumptionHandling | cumulativeRework | -0.29 | weakly related |
| assumptionHandling | decisionConsistency | -0.01 | independent |
| assumptionHandling | finalQuality | -0.04 | independent |
| backwardCompatibility | decisionEvolution | -0.40 | moderately related |
| backwardCompatibility | integrationCompleteness | 0.23 | weakly related |
| backwardCompatibility | requirementAdaptation | 0.09 | independent |
| completion | context-accuracy | 0.04 | independent |

## Reliability

**High-variance cells (CV > 30%):** 5 of 24

| Scenario | Condition | N | Mean | CV% |
| --- | --- | --- | --- | --- |
| conflict-resolution | baseline | 5 | 52.80 | 49.2 |
| conflict-resolution | shared-markdown | 5 | 45.80 | 73.0 |
| evolving-requirements | baseline | 5 | 53.72 | 43.7 |
| evolving-requirements | shared-markdown | 5 | 64.10 | 38.5 |
| evolving-requirements | twining-lite | 5 | 56.40 | 53.4 |

### Statistical Design

- **Iterations per pair:** 6
- **Scenarios:** 6
- **N per condition:** 39 (pooled across scenarios)
- **Minimum Detectable Effect (MDES):** d ≥ 0.64 at 80% power

### Power Analysis

| Comparison | Cohen's d | N | MDES | Power | Verdict |
| --- | --- | --- | --- | --- | --- |
| baseline vs full-twining | +0.588 | 37 | d≥0.66 | 0.704 | effect (d=0.59) is below detectable threshold (MDES=0.66) — inconclusive, not evidence of no effect |
| baseline vs shared-markdown | +0.188 | 39 | d≥0.64 | 0.130 | effect (d=0.19) is below detectable threshold (MDES=0.64) — inconclusive, not evidence of no effect |
| baseline vs twining-lite | +0.649 | 39 | d≥0.64 | 0.807 | adequately powered |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 262 | 262 | 0 | 0 | 0 | 0 | 0.0 | 0% | 452s |
| full-twining | 220 | 219 | 1 | 0 | 0 | 867 | 3.9 | 98% | 388s |
| shared-markdown | 253 | 252 | 0 | 1 | 0 | 0 | 0.0 | 0% | 368s |
| twining-lite | 217 | 217 | 0 | 0 | 0 | 852 | 3.9 | 100% | 357s |

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 262 | 44.7 | 431.3 | 0 | 0 | Agent |
| full-twining | 220 | 33.0 | 343.6 | 0 | 1 | ToolSearch |
| shared-markdown | 253 | 33.8 | 388.3 | 362 | 225 | Read |
| twining-lite | 217 | 32.1 | 327.2 | 0 | 0 | ToolSearch |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 252 | 0.011 | 0.978 | 0.293 |
| full-twining | 211 | 0.034 | 0.971 | 0.296 |
| shared-markdown | 244 | 0.013 | 0.976 | 0.300 |
| twining-lite | 209 | 0.034 | 0.970 | 0.286 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $209.67 | $5.376 | $0.0821 | 16922s | 539 | 56 |
| full-twining | $161.18 | $4.477 | $0.0601 | 12205s | 469 | 45 |
| shared-markdown | $190.79 | $4.892 | $0.0708 | 13319s | 515 | 45 |
| twining-lite | $226.12 | $5.515 | $0.0728 | 12919s | 314 | 31 |

## Recommendations

- **[high]** Reduce tool surface area: full-twining (74.5) scores lower than twining-lite (75.8)
- **[high]** Broken scorer: dimension 'completion' has zero variance (always 93) — fix or remove
- **[high]** Coordination hurts in 'conflict-resolution': shared-markdown scores -7.0 points below baseline
- **[high]** Coordination hurts in 'context-recovery': shared-markdown scores -5.6 points below baseline
- **[medium]** Scenario 'multi-session-build' x 'shared-markdown' has ceiling effect (mean=96.4, std=2.5) — consider redesigning for more discrimination
- **[medium]** Insensitive scorer: dimension 'completion' has only 0.6-point spread across conditions
- **[medium]** Interaction effect: baseline vs full-twining ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: baseline vs shared-markdown ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: full-twining vs shared-markdown ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: full-twining vs twining-lite ranking reverses across scenarios — no universal winner
- **[medium]** Interaction effect: shared-markdown vs twining-lite ranking reverses across scenarios — no universal winner
- **[medium]** High scorer variance (CV>20%) in 36 scenario x condition pairs for dimensions: architecturalDrift, assumptionHandling, backwardCompatibility, conflict-detection, context-accuracy, decision-documentation, decisionConsistency, decisionDiscovery, decisionEvolution, decisionPropagation, decisionQuality, finalQuality, integrationCompleteness, patternConsistency, redundant-rework, requirementAdaptation, resolution-quality
- **[low]** Inconclusive comparisons (full-twining, shared-markdown): observed effects are below detectable threshold — cannot distinguish from noise at current sample size
- **[low]** Escalating cost in 'conflict-resolution' x 'full-twining': cost increases across sessions (slope=0.127)
- **[low]** Escalating cost in 'conflict-resolution' x 'twining-lite': cost increases across sessions (slope=0.226)
- **[low]** Escalating cost in 'evolving-requirements' x 'baseline': cost increases across sessions (slope=0.214)
- **[low]** Escalating cost in 'evolving-requirements' x 'full-twining': cost increases across sessions (slope=0.167)
- **[low]** Escalating cost in 'multi-session-build' x 'baseline': cost increases across sessions (slope=0.104)
- **[low]** Escalating cost in 'sprint-simulation' x 'baseline': cost increases across sessions (slope=0.039)
- **[low]** Escalating cost in 'sprint-simulation' x 'shared-markdown': cost increases across sessions (slope=0.028)
- **[low]** Escalating cost in 'sprint-simulation' x 'twining-lite': cost increases across sessions (slope=0.035)

---
_Generated by benchmark-analysis_