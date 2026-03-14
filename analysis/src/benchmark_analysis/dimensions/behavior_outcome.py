"""Correlation between coordination behaviors and outcomes.

Answers: which specific agent behaviors predict better scores?
This is the key explanatory analysis for harness comparison.
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from scipy import stats as sp_stats
from ..models import ScoredResult, SessionTranscript

# Behavior categories for tool calls
ORIENTATION_TOOLS = {"twining_assemble", "twining_recent", "twining_query", "twining_why", "twining_read"}
RECORDING_TOOLS = {"twining_decide", "twining_post", "twining_link_commit"}
GRAPH_TOOLS = {"twining_add_entity", "twining_add_relation", "twining_neighbors", "twining_graph_query"}
VERIFICATION_TOOLS = {"twining_verify"}
PRODUCTIVE_TOOLS = {"Read", "Edit", "Write", "Bash", "Glob", "Grep"}


def analyze_behavior_outcome(
    scores: list[ScoredResult],
    transcripts: list[SessionTranscript],
) -> dict:
    """Correlate coordination behaviors with outcome scores.

    Returns dict with:
      - correlations: list of {behavior_metric, outcome_metric, pearson_r, p_value, n, significant}
      - predictive_behaviors: behaviors with |r| > 0.3 and p < 0.05
      - non_predictive_behaviors: behaviors with |r| < 0.1 (overhead candidates)
    """
    # Aggregate transcript behaviors per scenario x condition
    behavior_by_key = defaultdict(lambda: defaultdict(list))
    for t in transcripts:
        key = (t.scenario, t.condition)
        tools = [tc.toolName for tc in t.toolCalls]
        behavior_by_key[key]["total_tool_calls"].append(len(tools))
        behavior_by_key[key]["twining_calls"].append(sum(1 for tn in tools if "twining" in tn))
        behavior_by_key[key]["orientation_calls"].append(sum(1 for tn in tools if tn in ORIENTATION_TOOLS))
        behavior_by_key[key]["recording_calls"].append(sum(1 for tn in tools if tn in RECORDING_TOOLS))
        behavior_by_key[key]["graph_calls"].append(sum(1 for tn in tools if tn in GRAPH_TOOLS))
        behavior_by_key[key]["verification_calls"].append(sum(1 for tn in tools if tn in VERIFICATION_TOOLS))
        behavior_by_key[key]["productive_calls"].append(sum(1 for tn in tools if tn in PRODUCTIVE_TOOLS))
        behavior_by_key[key]["twining_pct"].append(
            sum(1 for tn in tools if "twining" in tn) / max(len(tools), 1) * 100
        )
        behavior_by_key[key]["num_turns"].append(t.numTurns)
        behavior_by_key[key]["compaction_count"].append(t.compactionCount)

    # Aggregate behaviors to means per (scenario, condition) to match score granularity
    agg_behaviors = {}
    for key, metrics in behavior_by_key.items():
        agg_behaviors[key] = {m: float(np.mean(v)) for m, v in metrics.items()}

    # Build paired arrays: behavior metric values vs outcome values
    behavior_metrics = [
        "twining_calls", "orientation_calls", "recording_calls", "graph_calls",
        "verification_calls", "twining_pct", "productive_calls", "num_turns",
        "compaction_count", "total_tool_calls",
    ]
    outcome_metrics = ["composite", "cost_usd"]

    # Collect paired data points
    score_by_key = defaultdict(list)
    for s in scores:
        score_by_key[(s.scenario, s.condition)].append(s)

    correlations = []
    for behavior_metric in behavior_metrics:
        for outcome_metric in outcome_metrics:
            behavior_vals = []
            outcome_vals = []
            for key in agg_behaviors:
                if key not in score_by_key:
                    continue
                b_val = agg_behaviors[key].get(behavior_metric, 0)
                if outcome_metric == "composite":
                    o_vals = [s.composite for s in score_by_key[key]]
                elif outcome_metric == "cost_usd":
                    o_vals = [s.metrics.costUsd for s in score_by_key[key]]
                else:
                    continue
                for o_val in o_vals:
                    behavior_vals.append(b_val)
                    outcome_vals.append(o_val)

            if len(behavior_vals) < 4:
                continue

            # Skip constant arrays where correlation is undefined
            if np.std(behavior_vals) == 0 or np.std(outcome_vals) == 0:
                continue

            r, p = sp_stats.pearsonr(behavior_vals, outcome_vals)
            correlations.append({
                "behavior_metric": behavior_metric,
                "outcome_metric": outcome_metric,
                "pearson_r": round(float(r), 3),
                "p_value": round(float(p), 4),
                "n": len(behavior_vals),
                "significant": p < 0.05,
                "interpretation": _interpret_r(r),
            })

    # Classify behaviors
    predictive = [c for c in correlations if abs(c["pearson_r"]) > 0.3 and c["significant"]]
    non_predictive = [c for c in correlations if abs(c["pearson_r"]) < 0.1]

    return {
        "correlations": correlations,
        "predictive_behaviors": predictive,
        "non_predictive_behaviors": non_predictive,
    }


def _interpret_r(r: float) -> str:
    abs_r = abs(r)
    if abs_r < 0.1:
        return "negligible"
    elif abs_r < 0.3:
        return "weak"
    elif abs_r < 0.5:
        return "moderate"
    elif abs_r < 0.7:
        return "strong"
    else:
        return "very strong"
