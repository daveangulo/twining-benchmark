"""CoordinationLift: measures delta between coordinated and uncoordinated performance.

This is the core metric for the Twining benchmark — does coordination
actually improve multi-agent outcomes?
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult
from ..stats import cohens_d, interpret_cohens_d, bootstrap_ci, welch_t_test, holm_bonferroni

from ._constants import COORDINATED_CONDITIONS, UNCOORDINATED_CONDITIONS


def analyze_coordination_lift(
    scores: list[ScoredResult],
    baseline: str = "baseline",
) -> dict:
    """Analyze the lift provided by coordination tools.

    Returns dict with:
      - pairwise_lift: for each coordinated condition vs baseline, the lift in composite points with effect size and significance
      - per_scenario: which scenarios benefit most from coordination
      - per_dimension: which scoring dimensions show most lift
      - summary: overall assessment of coordination value
    """
    by_condition = defaultdict(list)
    by_scenario_condition = defaultdict(list)
    for s in scores:
        by_condition[s.condition].append(s.composite)
        by_scenario_condition[(s.scenario, s.condition)].append(s)

    baseline_values = by_condition.get(baseline, [])
    if not baseline_values:
        return {"pairwise_lift": [], "per_scenario": [], "per_dimension": [], "summary": {}}

    # Pairwise lift vs baseline
    pairwise_lift = []
    p_values = []
    for condition, values in sorted(by_condition.items()):
        if condition == baseline:
            continue
        d = cohens_d(baseline_values, values)
        p = welch_t_test(baseline_values, values)
        p_values.append(p)
        bl_ci = bootstrap_ci(baseline_values)
        cond_ci = bootstrap_ci(values)
        pairwise_lift.append({
            "baseline": baseline,
            "condition": condition,
            "is_coordinated": condition in COORDINATED_CONDITIONS,
            "baseline_mean": round(float(np.mean(baseline_values)), 2),
            "condition_mean": round(float(np.mean(values)), 2),
            "lift_points": round(float(np.mean(values)) - float(np.mean(baseline_values)), 2),
            "lift_pct": round((float(np.mean(values)) - float(np.mean(baseline_values))) / max(float(np.mean(baseline_values)), 0.01) * 100, 1),
            "cohens_d": round(d, 3) if not np.isnan(d) else None,
            "interpretation": interpret_cohens_d(d) if not np.isnan(d) else "insufficient data",
            "p_value": round(p, 4),
            "n": len(values),
            "condition_ci": [round(cond_ci[0], 2), round(cond_ci[1], 2)],
        })

    # Apply Holm-Bonferroni correction
    if p_values:
        corrected = holm_bonferroni(p_values)
        for i, entry in enumerate(pairwise_lift):
            entry["p_value_corrected"] = round(corrected[i], 4)
            entry["significant"] = corrected[i] < 0.05

    # Per-scenario lift
    scenarios = set(s.scenario for s in scores)
    per_scenario = []
    for scenario in sorted(scenarios):
        baseline_scenario = [s.composite for s in by_scenario_condition.get((scenario, baseline), [])]
        if not baseline_scenario:
            continue
        best_condition = None
        best_lift = -float('inf')
        for condition in by_condition:
            if condition == baseline:
                continue
            cond_values = [s.composite for s in by_scenario_condition.get((scenario, condition), [])]
            if not cond_values:
                continue
            lift = float(np.mean(cond_values)) - float(np.mean(baseline_scenario))
            if lift > best_lift:
                best_lift = lift
                best_condition = condition
        per_scenario.append({
            "scenario": scenario,
            "baseline_mean": round(float(np.mean(baseline_scenario)), 2),
            "best_condition": best_condition,
            "best_condition_mean": round(float(np.mean(baseline_scenario)) + best_lift, 2),
            "lift_vs_baseline": round(best_lift, 2),
        })

    # Per-dimension lift (which scoring dimensions benefit most)
    dim_lifts = defaultdict(lambda: defaultdict(list))
    for s in scores:
        for dim_name, dim_score in s.scores.items():
            dim_lifts[dim_name][s.condition].append(dim_score.value)

    per_dimension = []
    for dim_name, by_cond in sorted(dim_lifts.items()):
        bl_vals = by_cond.get(baseline, [])
        if not bl_vals:
            continue
        best_lift = -float('inf')
        best_cond = None
        for cond, vals in by_cond.items():
            if cond == baseline:
                continue
            lift = float(np.mean(vals)) - float(np.mean(bl_vals))
            if lift > best_lift:
                best_lift = lift
                best_cond = cond
        per_dimension.append({
            "dimension": dim_name,
            "baseline_mean": round(float(np.mean(bl_vals)), 2),
            "best_condition": best_cond,
            "lift": round(best_lift, 2),
        })

    # Summary
    coordinated_lifts = [e for e in pairwise_lift if e["is_coordinated"]]
    any_significant = any(e.get("significant", False) for e in coordinated_lifts)
    best = max(coordinated_lifts, key=lambda e: e["lift_points"]) if coordinated_lifts else None

    summary = {
        "overall_lift_significant": any_significant,
        "best_coordinated_condition": best["condition"] if best else None,
        "best_lift_points": best["lift_points"] if best else 0,
        "best_effect_size": best["interpretation"] if best else None,
        "num_conditions_tested": len(pairwise_lift),
        "num_significant": sum(1 for e in pairwise_lift if e.get("significant", False)),
    }

    return {
        "pairwise_lift": pairwise_lift,
        "per_scenario": per_scenario,
        "per_dimension": per_dimension,
        "summary": summary,
    }
