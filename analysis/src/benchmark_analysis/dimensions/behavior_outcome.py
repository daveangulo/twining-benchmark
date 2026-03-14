"""Correlation between coordination behaviors and outcomes.

Answers: which specific agent behaviors correlate with better scores?
This is the key explanatory analysis for harness comparison.
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from scipy import stats as sp_stats
from ..models import ScoredResult, SessionTranscript
from ..stats import holm_bonferroni
from ._constants import (
    PRODUCTIVE_TOOLS,
    ORIENTATION_OPS,
    RECORDING_OPS,
    GRAPH_OPS,
    VERIFICATION_OPS,
    normalize_tool_name,
    is_twining_tool,
    MIN_CORRELATION_N,
    SIGNIFICANT_ALPHA,
)


def analyze_behavior_outcome(
    scores: list[ScoredResult],
    transcripts: list[SessionTranscript],
) -> dict:
    """Correlate coordination behaviors with outcome scores.

    Returns dict with:
      - correlations: list of {behavior_metric, outcome_metric, spearman_r, p_value, p_value_corrected, n, significant}
      - correlated_behaviors: behaviors with |r| > 0.3 and corrected p < 0.05
      - uncorrelated_behaviors: behaviors with |r| < 0.1 (overhead candidates)
    """
    # Aggregate transcript behaviors per scenario x condition
    behavior_by_key = defaultdict(lambda: defaultdict(list))
    for t in transcripts:
        key = (t.scenario, t.condition)
        tools = [tc.toolName for tc in t.toolCalls]
        short_names = [normalize_tool_name(tn) for tn in tools]
        behavior_by_key[key]["total_tool_calls"].append(len(tools))
        behavior_by_key[key]["twining_calls"].append(sum(1 for tn in tools if is_twining_tool(tn)))
        behavior_by_key[key]["orientation_calls"].append(sum(1 for sn in short_names if sn in ORIENTATION_OPS))
        behavior_by_key[key]["recording_calls"].append(sum(1 for sn in short_names if sn in RECORDING_OPS))
        behavior_by_key[key]["graph_calls"].append(sum(1 for sn in short_names if sn in GRAPH_OPS))
        behavior_by_key[key]["verification_calls"].append(sum(1 for sn in short_names if sn in VERIFICATION_OPS))
        behavior_by_key[key]["productive_calls"].append(sum(1 for tn in tools if tn in PRODUCTIVE_TOOLS))
        behavior_by_key[key]["twining_pct"].append(
            sum(1 for tn in tools if is_twining_tool(tn)) / max(len(tools), 1) * 100
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

    # Aggregate outcome scores to cell means per (scenario, condition)
    # to avoid pseudo-replication (matching aggregated behavior means with
    # individual outcome scores).
    score_by_key = defaultdict(list)
    for s in scores:
        score_by_key[(s.scenario, s.condition)].append(s)

    agg_outcomes: dict[tuple, dict[str, float]] = {}
    for key, items in score_by_key.items():
        agg_outcomes[key] = {
            "composite": float(np.mean([s.composite for s in items])),
            "cost_usd": float(np.mean([s.metrics.costUsd for s in items])),
        }

    correlations = []
    for behavior_metric in behavior_metrics:
        for outcome_metric in outcome_metrics:
            behavior_vals = []
            outcome_vals = []
            for key in agg_behaviors:
                if key not in agg_outcomes:
                    continue
                b_val = agg_behaviors[key].get(behavior_metric, 0)
                o_val = agg_outcomes[key].get(outcome_metric)
                if o_val is None:
                    continue
                behavior_vals.append(b_val)
                outcome_vals.append(o_val)

            if len(behavior_vals) < 4:
                continue

            # Skip constant arrays where correlation is undefined
            if np.std(behavior_vals) == 0 or np.std(outcome_vals) == 0:
                continue

            r, p = sp_stats.spearmanr(behavior_vals, outcome_vals)
            correlations.append({
                "behavior_metric": behavior_metric,
                "outcome_metric": outcome_metric,
                "spearman_r": round(float(r), 3),
                "p_value": round(float(p), 4),
                "n": len(behavior_vals),
                "significant": False,  # will be set after Holm-Bonferroni
                "interpretation": _interpret_r(r),
            })

    # Apply Holm-Bonferroni correction across all correlations
    if correlations:
        raw_ps = [c["p_value"] for c in correlations]
        corrected_ps = holm_bonferroni(raw_ps)
        for c, cp in zip(correlations, corrected_ps):
            c["p_value_corrected"] = round(cp, 4)
            c["significant"] = cp < 0.05

    # Classify behaviors
    correlated = [c for c in correlations if abs(c["spearman_r"]) > 0.3 and c["significant"]]
    uncorrelated = [c for c in correlations if abs(c["spearman_r"]) < 0.1]

    return {
        "correlations": correlations,
        "correlated_behaviors": correlated,
        "uncorrelated_behaviors": uncorrelated,
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
