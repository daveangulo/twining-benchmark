"""Single harness comparison summary matrix.

Produces the one table a researcher looks at first: each harness (condition)
as a row, key metrics as columns, with significance indicators.
"""
from __future__ import annotations


def generate_harness_summary(all_results: dict) -> dict:
    """Generate the master harness comparison matrix.

    Returns dict with:
      - matrix: list of rows, one per condition, with columns:
        condition, rank, composite_mean, lift_vs_baseline, lift_significant,
        effect_size, cost_usd, cost_per_point, best_scenario, worst_scenario,
        coordination_overhead_pct
      - headline: one-sentence summary of top finding
    """
    rankings = {r["condition"]: r for r in all_results.get("scoring", {}).get("condition_rankings", [])}
    lift_data = {e["condition"]: e for e in all_results.get("coordination_lift", {}).get("pairwise_lift", [])}
    cost_data = {e["condition"]: e for e in all_results.get("cost", {}).get("per_condition", [])}

    # Best/worst scenarios per condition from interactions
    interactions = all_results.get("interactions", {})
    best_scenarios = {}
    worst_scenarios = {}
    for entry in interactions.get("best_scenario_for_coordination", []):
        best_scenarios[entry.get("best_condition", "")] = entry.get("scenario", "")
    for entry in interactions.get("worst_scenario_for_coordination", []):
        worst_scenarios[entry.get("worst_condition", "")] = entry.get("scenario", "")

    # Coordination overhead from coordination analysis
    coord = all_results.get("coordination", {})
    overhead_data = {}
    if coord:
        pc = coord.get("per_condition", {})
        if isinstance(pc, dict):
            # per_condition is a dict keyed by condition name
            overhead_data = {k: v for k, v in pc.items() if isinstance(v, dict)}
        elif isinstance(pc, list):
            overhead_data = {e["condition"]: e for e in pc if isinstance(e, dict)}

    matrix = []
    for condition, ranking in sorted(rankings.items(), key=lambda x: x[1].get("rank", 99)):
        lift = lift_data.get(condition, {})
        cost = cost_data.get(condition, {})
        overhead = overhead_data.get(condition, {})

        matrix.append({
            "condition": condition,
            "rank": ranking.get("rank", "?"),
            "composite_mean": ranking.get("mean", 0),
            "lift_vs_baseline": lift.get("lift_points", 0),
            "lift_significant": lift.get("significant", False),
            "effect_size": lift.get("interpretation", "N/A"),
            "cohens_d": lift.get("cohens_d", None),
            "cost_usd": cost.get("mean_cost_usd", 0),
            "cost_per_point": cost.get("cost_per_composite_point", 0),
            "best_scenario": best_scenarios.get(condition, "\u2014"),
            "worst_scenario": worst_scenarios.get(condition, "\u2014"),
            "coordination_overhead_pct": overhead.get("avg_twining_pct", overhead.get("twining_pct", 0)),
        })

    # Generate headline
    headline = ""
    if matrix:
        top = matrix[0]
        if top["condition"] == "baseline":
            headline = (f"Baseline ranks #1 with {top['composite_mean']:.1f} composite "
                       f"— no coordination condition outperforms it")
        elif top["lift_significant"]:
            headline = (f"{top['condition']} ranks #1 with {top['composite_mean']:.1f} composite "
                       f"(+{top['lift_vs_baseline']:.1f} vs baseline, {top['effect_size']} effect, p<0.05)")
        else:
            headline = (f"{top['condition']} ranks #1 with {top['composite_mean']:.1f} composite "
                       f"but lift is not statistically significant (need more runs)")

    return {
        "matrix": matrix,
        "headline": headline,
    }
