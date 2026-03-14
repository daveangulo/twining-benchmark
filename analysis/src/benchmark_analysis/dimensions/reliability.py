"""Reliability analysis: variance flags, power analysis, sample size recommendations."""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult
from ..stats import cohens_d, power_analysis, required_sample_size


def analyze_reliability(scores: list[ScoredResult], baseline: str = "baseline") -> dict:
    """Analyze statistical reliability of benchmark results.

    Returns dict with:
      - variance_flags: scenario x condition pairs with CV > 30%
      - power_analysis: observed power for each pairwise comparison
      - sample_size_recommendations: recommended n per group for 0.8 power
    """
    by_pair = defaultdict(list)
    by_condition = defaultdict(list)
    for s in scores:
        by_pair[(s.scenario, s.condition)].append(s.composite)
        by_condition[s.condition].append(s.composite)

    # Variance flags
    variance_flags = []
    for (scenario, condition), values in sorted(by_pair.items()):
        arr = np.array(values)
        mean = float(np.mean(arr))
        std = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
        cv = (std / mean * 100) if mean > 0 else 0.0
        variance_flags.append({
            "scenario": scenario, "condition": condition,
            "n": len(arr), "mean": round(mean, 2), "std": round(std, 2),
            "cv_pct": round(cv, 1), "high_variance": cv > 30,
        })

    # Power analysis for each non-baseline condition vs baseline
    baseline_values = by_condition.get(baseline, [])
    power_results = []
    sample_recs = []
    for condition, values in sorted(by_condition.items()):
        if condition == baseline or not baseline_values:
            continue
        d = cohens_d(baseline_values, values)
        if np.isnan(d):
            continue
        n = len(values)
        observed_power = power_analysis(abs(d), n)
        rec_n = required_sample_size(abs(d))
        power_results.append({
            "comparison": f"{baseline} vs {condition}",
            "cohens_d": round(d, 3),
            "n_per_group": n,
            "observed_power": round(observed_power, 3),
            "recommended_n": rec_n,
            "underpowered": observed_power < 0.8,
        })
        sample_recs.append({
            "comparison": f"{baseline} vs {condition}",
            "current_n": n,
            "recommended_n_for_80pct_power": rec_n,
            "additional_runs_needed": max(0, rec_n - n),
        })

    return {
        "variance_flags": variance_flags,
        "power_analysis": power_results,
        "sample_size_recommendations": sample_recs,
    }
