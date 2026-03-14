"""Synthesize improvement recommendations from all dimension analyses."""
from __future__ import annotations


def synthesize_recommendations(all_results: dict) -> dict:
    """Produce prioritized recommendations from all dimension analyzer outputs.

    Returns dict with:
      - items: list of {priority: "high"|"medium"|"low", category: str, message: str}
    """
    items = []

    # Check coordination engagement
    coord = all_results.get("coordination", {})
    pc = coord.get("per_condition", {})
    # per_condition may be a dict keyed by condition name or a list of dicts
    coord_entries = pc.values() if isinstance(pc, dict) else (pc if isinstance(pc, list) else [])
    for entry in coord_entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("engagement_rate", 1.0) < 0.5:
            items.append({
                "priority": "high",
                "category": "coordination",
                "message": f"Fix activation: Twining engagement rate is {entry['engagement_rate']:.0%} for {entry['condition']} — agents aren't using coordination tools",
            })
        graph_pct = entry.get("avg_graph_building_pct", entry.get("graph_overhead_pct", 0))
        if graph_pct > 20:
            items.append({
                "priority": "medium",
                "category": "coordination",
                "message": f"Reduce graph ceremony: {graph_pct:.0f}% of twining calls in {entry.get('condition', '?')} are graph-building (add_entity/add_relation)",
            })

    # Check if full-twining underperforms twining-lite
    scoring = all_results.get("scoring", {})
    rankings = {r["condition"]: r["mean"] for r in scoring.get("condition_rankings", [])}
    if rankings.get("full-twining", 100) < rankings.get("twining-lite", 0):
        items.append({
            "priority": "high",
            "category": "tool-surface",
            "message": f"Reduce tool surface area: full-twining ({rankings['full-twining']:.1f}) scores lower than twining-lite ({rankings['twining-lite']:.1f})",
        })

    # Check ceiling effects from scenarios
    scenarios = all_results.get("scenarios", {})
    for ce in scenarios.get("ceiling_effects", []):
        items.append({
            "priority": "medium",
            "category": "scenarios",
            "message": f"Scenario '{ce['scenario']}' x '{ce['condition']}' has ceiling effect (mean={ce['mean']:.1f}, std={ce['std']:.1f}) — consider redesigning for more discrimination",
        })

    # Check power from reliability
    reliability = all_results.get("reliability", {})
    for pa in reliability.get("power_analysis", []):
        if pa.get("observed_power", 1.0) < 0.5:
            items.append({
                "priority": "high",
                "category": "reliability",
                "message": f"Underpowered comparison: {pa['comparison']} has power={pa['observed_power']:.2f} — need {pa['recommended_n']} runs per group (currently {pa['n_per_group']})",
            })
        elif pa.get("underpowered", False):
            items.append({
                "priority": "medium",
                "category": "reliability",
                "message": f"Low power: {pa['comparison']} has power={pa['observed_power']:.2f} — consider {pa['recommended_n']} runs per group",
            })

    # Check scorer diagnostics
    scorer = all_results.get("scorer_diagnostics", {})
    for d in scorer.get("zero_variance", []):
        items.append({
            "priority": "high",
            "category": "scoring",
            "message": f"Broken scorer: dimension '{d['dimension']}' has zero variance (always {d['mean']:.0f}) — fix or remove",
        })
    for d in scorer.get("non_discriminating", []):
        items.append({
            "priority": "medium",
            "category": "scoring",
            "message": f"Insensitive scorer: dimension '{d['dimension']}' has only {d['spread']:.1f}-point spread across conditions",
        })

    # Check coordination lift
    lift = all_results.get("coordination_lift", {})
    if lift.get("summary", {}).get("overall_lift_significant") is False:
        items.append({
            "priority": "high",
            "category": "coordination-lift",
            "message": "No statistically significant coordination lift detected — coordination tools may not be providing measurable value",
        })

    # Check behavior-outcome correlations — flag overhead candidates
    behavior = all_results.get("behavior_outcome", {})
    for np_entry in behavior.get("non_predictive_behaviors", []):
        if np_entry.get("behavior_metric") in ("graph_calls", "verification_calls") and np_entry.get("outcome_metric") == "composite":
            items.append({
                "priority": "medium",
                "category": "behavior-outcome",
                "message": f"Overhead candidate: {np_entry['behavior_metric']} has negligible correlation with composite (r={np_entry['pearson_r']:.2f})",
            })

    # Check effect decomposition — lite vs full
    decomp = all_results.get("effect_decomposition", {})
    lvf = decomp.get("lite_vs_full", {})
    if lvf.get("conclusion") == "lite sufficient":
        items.append({
            "priority": "high",
            "category": "tool-surface",
            "message": f"Twining-lite ({lvf['twining_lite_mean']:.1f}) matches full-twining ({lvf['full_twining_mean']:.1f}) — extra tools add complexity without benefit",
        })

    # Check interactions — disordinal warnings
    interactions = all_results.get("interactions", {})
    for d in interactions.get("disordinal_interactions", []):
        items.append({
            "priority": "medium",
            "category": "interactions",
            "message": f"Interaction effect: {d['condition_a']} vs {d['condition_b']} ranking reverses across scenarios — no universal winner",
        })
    for entry in interactions.get("worst_scenario_for_coordination", []):
        if entry.get("coordination_hurts"):
            items.append({
                "priority": "high",
                "category": "interactions",
                "message": f"Coordination hurts in '{entry['scenario']}': {entry['worst_condition']} scores {entry['worst_lift']:.1f} points below baseline",
            })

    # Check construct validity — unreliable dimensions
    validity = all_results.get("construct_validity", {})
    unreliable = [ic for ic in validity.get("internal_consistency", []) if not ic.get("reliable", True)]
    if unreliable:
        dims = set(ic["dimension"] for ic in unreliable)
        items.append({
            "priority": "medium",
            "category": "construct-validity",
            "message": f"High scorer variance (CV>20%) in {len(unreliable)} scenario x condition pairs for dimensions: {', '.join(sorted(dims))}",
        })

    # Check learning curve — escalating costs
    lc = all_results.get("learning_curve", {})
    for entry in lc.get("per_scenario", []):
        if entry.get("trends", {}).get("cost_trend") == "increasing":
            items.append({
                "priority": "low",
                "category": "scaling",
                "message": f"Escalating cost in '{entry['scenario']}' x '{entry['condition']}': cost increases across sessions (slope={entry['trends']['cost_slope']:.3f})",
            })

    # Sort by priority
    priority_order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda x: priority_order.get(x["priority"], 3))

    return {"items": items}
