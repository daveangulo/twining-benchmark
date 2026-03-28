"""Detect broken or insensitive scorers."""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult


def analyze_scorers(scores: list[ScoredResult]) -> dict:
    """Detect problematic scoring dimensions.

    Returns dict with:
      - ceiling_effects: dimensions with mean > 95 across all conditions
      - floor_effects: dimensions with mean < 10 across all conditions
      - zero_variance: dimensions with std < 1 across all conditions
      - non_discriminating: dimensions where max condition mean - min condition mean < 5
      - bimodal_suspects: dimensions where values cluster into two groups (gap > 30 points between clusters)
    """
    # Collect per-dimension values by condition
    dim_by_condition = defaultdict(lambda: defaultdict(list))
    dim_all = defaultdict(list)
    for s in scores:
        for dim_name, dim_score in s.scores.items():
            dim_by_condition[dim_name][s.condition].append(dim_score.value)
            dim_all[dim_name].append(dim_score.value)

    ceiling_effects = []
    floor_effects = []
    zero_variance = []
    non_discriminating = []
    bimodal_suspects = []

    for dim_name, all_values in sorted(dim_all.items()):
        arr = np.array(all_values)
        mean_all = float(np.mean(arr))
        std_all = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0

        if mean_all > 95 and std_all < 3:
            ceiling_effects.append({"dimension": dim_name, "mean": round(mean_all, 1), "std": round(std_all, 2)})
        if mean_all < 10:
            floor_effects.append({"dimension": dim_name, "mean": round(mean_all, 1), "std": round(std_all, 2)})
        if std_all < 1:
            zero_variance.append({"dimension": dim_name, "mean": round(mean_all, 1), "std": round(std_all, 2)})

        # Discrimination: check spread of condition means
        condition_means = {c: float(np.mean(v)) for c, v in dim_by_condition[dim_name].items()}
        if condition_means:
            spread = max(condition_means.values()) - min(condition_means.values())
            if spread < 5:
                non_discriminating.append({"dimension": dim_name, "spread": round(spread, 2), "condition_means": {k: round(v, 1) for k, v in condition_means.items()}})

        # Simple bimodal detection: sort values, find largest gap
        sorted_vals = np.sort(arr)
        if len(sorted_vals) > 4:
            gaps = np.diff(sorted_vals)
            max_gap = float(np.max(gaps))
            if max_gap > 30:
                gap_idx = int(np.argmax(gaps))
                bimodal_suspects.append({
                    "dimension": dim_name, "gap_size": round(max_gap, 1),
                    "cluster_1_mean": round(float(np.mean(sorted_vals[:gap_idx+1])), 1),
                    "cluster_2_mean": round(float(np.mean(sorted_vals[gap_idx+1:])), 1),
                })

    # --- Discrimination summary per dimension ---
    discrimination_summary = []
    for dim_name, all_values in sorted(dim_all.items()):
        arr = np.array(all_values)
        min_val = float(np.min(arr))
        max_val = float(np.max(arr))
        spread = max_val - min_val
        unique_values = len(set(round(float(v), 2) for v in arr))
        discriminates = spread > 5 and unique_values > 2
        discrimination_summary.append({
            "dimension": dim_name,
            "min": round(min_val, 2),
            "max": round(max_val, 2),
            "spread": round(spread, 2),
            "unique_values": unique_values,
            "discriminates": discriminates,
        })

    return {
        "ceiling_effects": ceiling_effects,
        "floor_effects": floor_effects,
        "zero_variance": zero_variance,
        "non_discriminating": non_discriminating,
        "bimodal_suspects": bimodal_suspects,
        "discrimination_summary": discrimination_summary,
    }
