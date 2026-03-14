"""Scenarios dimension analyzer for benchmark analysis."""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult, DimensionAnalysis
from ..stats import cohens_d, interpret_cohens_d, condition_summary


def analyze_scenarios(scores: list[ScoredResult], baseline: str = "baseline") -> dict:
    """Analyze per-scenario characteristics.

    Returns a dict with:
    - discriminating_scenarios: scenarios ranked by how well they separate conditions
    - ceiling_effects: list of (scenario, condition) pairs with mean > 95 and std < 3
    - floor_effects: list of (scenario, condition) pairs with mean < 20
    - effect_sizes: per-scenario effect size (best condition vs baseline)
    - high_variance_pairs: (scenario, condition) pairs with CV > 30%
    - per_scenario: detailed summary per scenario
    """
    # Group composites by scenario -> condition -> [values]
    by_scenario: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in scores:
        by_scenario[r.scenario][r.condition].append(r.composite)

    discriminating_scenarios = []
    ceiling_effects = []
    floor_effects = []
    effect_sizes = []
    high_variance_pairs = []
    per_scenario = {}

    for scenario, conditions in by_scenario.items():
        # Compute condition means
        condition_means = {
            cond: float(np.mean(vals)) for cond, vals in conditions.items()
        }
        condition_stds = {
            cond: float(np.std(vals, ddof=1)) if len(vals) > 1 else 0.0
            for cond, vals in conditions.items()
        }

        # Spread: max - min of condition means
        if condition_means:
            spread = max(condition_means.values()) - min(condition_means.values())
        else:
            spread = 0.0

        discriminating_scenarios.append({
            "scenario": scenario,
            "spread": spread,
            "condition_means": condition_means,
        })

        # Ceiling effects: mean > 95 and std < 3
        for cond, mean in condition_means.items():
            std = condition_stds[cond]
            if mean > 95 and std < 3:
                ceiling_effects.append({
                    "scenario": scenario,
                    "condition": cond,
                    "mean": mean,
                    "std": std,
                })

        # Floor effects: mean < 20
        for cond, mean in condition_means.items():
            if mean < 20:
                floor_effects.append({
                    "scenario": scenario,
                    "condition": cond,
                    "mean": mean,
                    "std": condition_stds[cond],
                })

        # Effect size: best condition vs baseline
        if baseline in conditions and len(conditions) > 1:
            baseline_vals = conditions[baseline]
            # Best condition by mean (excluding baseline)
            best_cond = max(
                (c for c in conditions if c != baseline),
                key=lambda c: np.mean(conditions[c]),
            )
            best_vals = conditions[best_cond]
            d = cohens_d(baseline_vals, best_vals)
            effect_sizes.append({
                "scenario": scenario,
                "baseline": baseline,
                "best_condition": best_cond,
                "cohens_d": d,
                "interpretation": interpret_cohens_d(d),
                "mean_baseline": float(np.mean(baseline_vals)),
                "mean_best": float(np.mean(best_vals)),
            })

        # High-variance pairs: CV > 30%
        for cond, vals in conditions.items():
            mean = condition_means[cond]
            std = condition_stds[cond]
            if mean != 0:
                cv = (std / abs(mean)) * 100
            else:
                cv = float("inf")
            if cv > 30:
                high_variance_pairs.append({
                    "scenario": scenario,
                    "condition": cond,
                    "mean": mean,
                    "std": std,
                    "cv": cv,
                })

        # Per-scenario detailed summary
        summaries = {
            cond: condition_summary(cond, vals)
            for cond, vals in conditions.items()
        }
        per_scenario[scenario] = {
            "spread": spread,
            "condition_summaries": {c: s.model_dump() for c, s in summaries.items()},
            "best_condition": max(condition_means, key=condition_means.get) if condition_means else None,
            "worst_condition": min(condition_means, key=condition_means.get) if condition_means else None,
        }

    # Sort discriminating_scenarios by spread descending
    discriminating_scenarios.sort(key=lambda x: x["spread"], reverse=True)

    return {
        "discriminating_scenarios": discriminating_scenarios,
        "ceiling_effects": ceiling_effects,
        "floor_effects": floor_effects,
        "effect_sizes": effect_sizes,
        "high_variance_pairs": high_variance_pairs,
        "per_scenario": per_scenario,
    }
