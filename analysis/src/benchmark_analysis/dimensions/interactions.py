"""Scenario x condition interaction effects.

Answers: are there scenarios where coordination hurts? Which scenario
characteristics predict coordination benefit?
"""
from __future__ import annotations
from collections import defaultdict
from itertools import combinations
import numpy as np
from ..models import ScoredResult
from ..stats import cohens_d, interpret_cohens_d


def analyze_interactions(
    scores: list[ScoredResult],
    baseline: str = "baseline",
) -> dict:
    """Analyze interaction effects between scenarios and conditions.

    Returns dict with:
      - matrix: scenario x condition mean composite (for heatmap)
      - disordinal_interactions: cases where condition ranking reverses across scenarios
      - best_scenario_for_coordination: scenarios with largest coordination lift
      - worst_scenario_for_coordination: scenarios where coordination hurts or doesn't help
      - scenario_difficulty: scenarios ranked by baseline performance (harder = lower baseline)
    """
    by_pair = defaultdict(list)
    for s in scores:
        by_pair[(s.scenario, s.condition)].append(s.composite)

    scenarios = sorted(set(s.scenario for s in scores))
    conditions = sorted(set(s.condition for s in scores))

    # Build matrix
    matrix = []
    pair_means = {}
    for scenario in scenarios:
        for condition in conditions:
            values = by_pair.get((scenario, condition), [])
            if values:
                mean = float(np.mean(values))
                pair_means[(scenario, condition)] = mean
                matrix.append({
                    "scenario": scenario,
                    "condition": condition,
                    "mean_composite": round(mean, 2),
                    "std": round(float(np.std(values, ddof=1)), 2) if len(values) > 1 else 0.0,
                    "n": len(values),
                })

    # Detect disordinal interactions
    # For each pair of conditions, check if their ranking reverses across scenarios
    disordinal = []
    for c1, c2 in combinations(conditions, 2):
        c1_wins = []
        c2_wins = []
        for scenario in scenarios:
            m1 = pair_means.get((scenario, c1))
            m2 = pair_means.get((scenario, c2))
            if m1 is not None and m2 is not None:
                if m1 > m2 + 2:  # meaningful difference threshold
                    c1_wins.append(scenario)
                elif m2 > m1 + 2:
                    c2_wins.append(scenario)
        if c1_wins and c2_wins:
            disordinal.append({
                "condition_a": c1,
                "condition_b": c2,
                "a_wins_in": c1_wins,
                "b_wins_in": c2_wins,
                "interpretation": f"{c1} and {c2} have reversed rankings across scenarios — no single condition is universally better",
            })

    # Best/worst scenarios for coordination (vs baseline)
    scenario_lift = []
    for scenario in scenarios:
        baseline_mean = pair_means.get((scenario, baseline))
        if baseline_mean is None:
            continue
        best_lift = 0.0
        best_condition = baseline
        worst_lift = 0.0
        worst_condition = baseline
        for condition in conditions:
            if condition == baseline:
                continue
            cond_mean = pair_means.get((scenario, condition))
            if cond_mean is None:
                continue
            lift = cond_mean - baseline_mean
            if lift > best_lift:
                best_lift = lift
                best_condition = condition
            if lift < worst_lift:
                worst_lift = lift
                worst_condition = condition
        scenario_lift.append({
            "scenario": scenario,
            "baseline_mean": round(baseline_mean, 2),
            "best_lift": round(best_lift, 2),
            "best_condition": best_condition,
            "worst_lift": round(worst_lift, 2),
            "worst_condition": worst_condition,
            "coordination_helps": best_lift > 5,
            "coordination_hurts": worst_lift < -5,
        })

    scenario_lift.sort(key=lambda x: -x["best_lift"])
    best = [s for s in scenario_lift if s["coordination_helps"]]
    worst = [s for s in scenario_lift if s["coordination_hurts"]]

    # Scenario difficulty ranking
    scenario_difficulty = []
    for scenario in scenarios:
        bl = pair_means.get((scenario, baseline))
        if bl is not None:
            scenario_difficulty.append({"scenario": scenario, "baseline_mean": round(bl, 2)})
    scenario_difficulty.sort(key=lambda x: x["baseline_mean"])

    return {
        "matrix": matrix,
        "disordinal_interactions": disordinal,
        "best_scenario_for_coordination": best,
        "worst_scenario_for_coordination": worst,
        "scenario_difficulty": scenario_difficulty,
    }
