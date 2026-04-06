# Benchmark Analysis Report

**Run ID:** pooled-all-valid  
**Timestamp:** 2026-04-04T00:00:00Z  
**Status:** completed  
**Scenarios:** conflict-resolution, context-recovery, evolving-requirements, multi-session-build, sprint-simulation  
**Conditions:** baseline, full-twining, shared-markdown, twining-lite  
**Runs per pair:** 5  

## Executive Summary

> twining-lite ranks #1 with 77.2 composite (+10.8 vs baseline, medium effect, p<0.05)

## Harness Comparison Matrix

| Rank | Condition | Mean | Lift | Sig | Effect | d | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | twining-lite | 77.2 | +10.8 | \* | medium | +0.65 | $6.03 | $0.078 |
| 2 | full-twining | 77.2 | +10.7 | \* | medium | +0.70 | $4.97 | $0.064 |
| 3 | shared-markdown | 70.4 | +4.0 |  | negligible | +0.20 | $5.41 | $0.077 |
| 4 | baseline | 66.5 | +0.0 |  | N/A | N/A | $5.93 | $0.089 |

## Coordination Lift

| Condition | Lift (pts) | Significant | Cohen's d | Interpretation |
| --- | --- | --- | --- | --- |
| full-twining | +10.7 | Yes | +0.70 | medium |
| shared-markdown | +4.0 | No | +0.20 | negligible |
| twining-lite | +10.8 | Yes | +0.65 | medium |

## Behavior-Outcome Correlations

| Behavior | Outcome | r | Interpretation |
| --- | --- | --- | --- |
| num_turns | cost_usd | +0.90 | very strong |

## Effect Decomposition

| Mechanism | Diff | Avg Calls/Sess | Heavy Users | Non-Users |
| --- | --- | --- | --- | --- |
| graph_building | -8.5 | 0.0 | none | full-twining, shared-markdown, twining-lite |
| coordination_mgmt | -8.5 | 0.0 | none | full-twining, shared-markdown, twining-lite |
| search_retrieval | -8.5 | 0.1 | none | full-twining, shared-markdown, twining-lite |
| lifecycle | -8.5 | 0.0 | none | full-twining, shared-markdown, twining-lite |
| decision_mgmt | -8.5 | 0.1 | none | full-twining, shared-markdown, twining-lite |
| orientation | +6.8 | 1.1 | full-twining, twining-lite | shared-markdown |
| recording | +6.8 | 2.7 | full-twining, twining-lite | shared-markdown |
| verification | -4.0 | 0.8 | none | shared-markdown |

### Lite vs Full Twining

| Metric | Value |
| --- | --- |
| twining-lite mean | 77.22 |
| full-twining mean | 77.16 |
| delta (full - lite) | -0.1 |
| conclusion | twining-lite scored comparably |
| full-only tools | acknowledge |
| shared tools | add_relation, assemble, decide, dismiss, link_commit, post, reconsider, search_decisions, verify, why |

### Tool Utilization

| Condition | Tool | Count |
| --- | --- | --- |
| full-twining | post | 203 |
| full-twining | assemble | 202 |
| full-twining | verify | 178 |
| full-twining | decide | 168 |
| full-twining | why | 16 |
| full-twining | search_decisions | 14 |
| full-twining | link_commit | 12 |
| full-twining | dismiss | 7 |
| full-twining | add_relation | 4 |
| full-twining | reconsider | 4 |
| full-twining | acknowledge | 2 |
| twining-lite | post | 208 |
| twining-lite | assemble | 201 |
| twining-lite | decide | 162 |
| twining-lite | verify | 158 |
| twining-lite | why | 20 |
| twining-lite | link_commit | 10 |
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
| full-twining | +0.70 | medium | \* |
| shared-markdown | +0.20 | negligible |  |
| twining-lite | +0.65 | medium | \* |

## Coordination Behavior

| Condition | Twining % | Engagement Rate | Sessions |
| --- | --- | --- | --- |
| full-twining | 14.2% | 98% | 205 |
| baseline | 0.0% | 0% | 247 |
| shared-markdown | 0.0% | 0% | 238 |
| twining-lite | 14.2% | 100% | 202 |

## Cost Analysis

| Condition | Mean Cost | Cost/Point |
| --- | --- | --- |
| baseline | $5.93 | $0.089 |
| full-twining | $4.97 | $0.064 |
| shared-markdown | $5.41 | $0.077 |
| twining-lite | $6.03 | $0.078 |

## Construct Validity

**Internal consistency:** 47/76 scenario-condition-dimension cells have CV < 20%

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

**High-variance cells (CV > 30%):** 5 of 20

| Scenario | Condition | N | Mean | CV% |
| --- | --- | --- | --- | --- |
| conflict-resolution | baseline | 5 | 52.80 | 49.2 |
| conflict-resolution | shared-markdown | 5 | 45.80 | 73.0 |
| evolving-requirements | baseline | 5 | 53.72 | 43.7 |
| evolving-requirements | shared-markdown | 5 | 64.10 | 38.5 |
| evolving-requirements | twining-lite | 5 | 56.40 | 53.4 |

### Statistical Design

- **Iterations per pair:** 6
- **Scenarios:** 5
- **N per condition:** 34 (pooled across scenarios)
- **Minimum Detectable Effect (MDES):** d ≥ 0.69 at 80% power

### Power Analysis

| Comparison | Cohen's d | N | MDES | Power | Verdict |
| --- | --- | --- | --- | --- | --- |
| baseline vs full-twining | +0.705 | 32 | d≥0.71 | 0.793 | effect (d=0.70) is below detectable threshold (MDES=0.71) — inconclusive, not evidence of no effect |
| baseline vs shared-markdown | +0.198 | 34 | d≥0.69 | 0.127 | effect (d=0.20) is below detectable threshold (MDES=0.69) — inconclusive, not evidence of no effect |
| baseline vs twining-lite | +0.646 | 34 | d≥0.69 | 0.747 | effect (d=0.65) is below detectable threshold (MDES=0.69) — inconclusive, not evidence of no effect |

## Session Health

| Condition | Total | Completed | Timed Out | Errored | Zero Tools | Twining Calls | Twining/Sess | Engagement | Avg Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 247 | 247 | 0 | 0 | 0 | 0 | 0.0 | 0% | 443s |
| full-twining | 205 | 204 | 1 | 0 | 0 | 810 | 4.0 | 98% | 393s |
| shared-markdown | 238 | 237 | 0 | 1 | 0 | 0 | 0.0 | 0% | 361s |
| twining-lite | 202 | 202 | 0 | 0 | 0 | 792 | 3.9 | 100% | 372s |

## Behavioral Profiles

| Condition | Sessions | Avg Tools/Sess | Avg Lines/Sess | Coord Reads | Coord Writes | Top First Tool |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 247 | 45.0 | 435.5 | 0 | 0 | Agent |
| full-twining | 205 | 33.7 | 340.4 | 0 | 1 | ToolSearch |
| shared-markdown | 238 | 34.7 | 388.7 | 343 | 212 | Read |
| twining-lite | 202 | 32.7 | 322.3 | 0 | 0 | ToolSearch |

## Work Leverage

| Condition | Pairs | Avg Rework Ratio | Avg Line Survival | Avg Continuation |
| --- | --- | --- | --- | --- |
| baseline | 238 | 0.012 | 0.977 | 0.295 |
| full-twining | 197 | 0.036 | 0.968 | 0.291 |
| shared-markdown | 230 | 0.014 | 0.975 | 0.300 |
| twining-lite | 195 | 0.036 | 0.968 | 0.283 |

## Cost Efficiency

| Condition | Total Cost | $/Iteration | $/Point | Avg Time/Iter | Lines/$ | Calls/$ |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | $201.69 | $5.932 | $0.0893 | 18230s | 533 | 55 |
| full-twining | $154.02 | $4.968 | $0.0644 | 13430s | 453 | 45 |
| shared-markdown | $184.04 | $5.413 | $0.0768 | 14331s | 503 | 45 |
| twining-lite | $216.95 | $6.026 | $0.0780 | 15016s | 300 | 30 |

## Recommendations

- **[high]** Reduce tool surface area: full-twining (77.2) scores lower than twining-lite (77.2)
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
- **[medium]** High scorer variance (CV>20%) in 29 scenario x condition pairs for dimensions: architecturalDrift, assumptionHandling, backwardCompatibility, conflict-detection, context-accuracy, decision-documentation, decisionConsistency, decisionEvolution, finalQuality, integrationCompleteness, redundant-rework, requirementAdaptation, resolution-quality
- **[low]** Inconclusive comparisons (full-twining, shared-markdown, twining-lite): observed effects are below detectable threshold — cannot distinguish from noise at current sample size
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