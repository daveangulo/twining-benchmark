"""Reliability analysis: variance flags, power analysis, sample size recommendations."""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult
from ..stats import cohens_d, power_analysis, required_sample_size, minimum_detectable_effect


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

    # Compute MDES for the actual sample size — the most useful metric
    # This tells users "with your data, effects smaller than X cannot be detected"
    sample_n = len(baseline_values) if baseline_values else 0
    mdes = minimum_detectable_effect(sample_n) if sample_n >= 3 else float("inf")
    # Also compute MDES at 5 iterations (common upgrade path)
    n_scenarios = len(set(s.scenario for s in scores))
    mdes_at_5 = minimum_detectable_effect(n_scenarios * 5) if n_scenarios >= 1 else float("inf")

    for condition, values in sorted(by_condition.items()):
        if condition == baseline or not baseline_values:
            continue
        d = cohens_d(baseline_values, values)
        if np.isnan(d):
            continue
        n_baseline = len(baseline_values)
        n_treatment = len(values)
        n_harmonic = int(2 * n_baseline * n_treatment / (n_baseline + n_treatment))
        observed_power = power_analysis(abs(d), n_harmonic)
        rec_n = required_sample_size(abs(d))
        effect_mdes = minimum_detectable_effect(n_harmonic)

        # Classify the result based on effect vs MDES
        if abs(d) < 0.1:
            verdict = "negligible effect — no meaningful difference observed"
        elif abs(d) < effect_mdes:
            verdict = f"effect (d={abs(d):.2f}) is below detectable threshold (MDES={effect_mdes:.2f}) — inconclusive, not evidence of no effect"
        elif observed_power >= 0.8:
            verdict = "adequately powered"
        else:
            verdict = f"detectable range but underpowered — consider 5 iterations/pair for MDES={mdes_at_5:.2f}"

        power_results.append({
            "comparison": f"{baseline} vs {condition}",
            "cohens_d": round(d, 3),
            "n_per_group": n_harmonic,
            "observed_power": round(observed_power, 3),
            "mdes": round(effect_mdes, 2),
            "recommended_n": rec_n,
            "underpowered": observed_power < 0.8,
            "verdict": verdict,
        })
        sample_recs.append({
            "comparison": f"{baseline} vs {condition}",
            "current_n": n_harmonic,
            "recommended_n_for_80pct_power": rec_n,
            "additional_runs_needed": max(0, rec_n - n_harmonic),
        })

    return {
        "variance_flags": variance_flags,
        "power_analysis": power_results,
        "sample_size_recommendations": sample_recs,
        "design_guidance": {
            "current_n_per_condition": sample_n,
            "current_mdes": round(mdes, 2),
            "n_scenarios": n_scenarios,
            "iterations_per_pair": sample_n // max(n_scenarios, 1) if n_scenarios else 0,
            "at_5_iterations": {
                "n_per_condition": n_scenarios * 5,
                "mdes": round(mdes_at_5, 2),
                "note": "Going from 3→5 iterations costs ~66% more but detects medium effects (d≈0.6) at 80% power",
            },
        },
    }
