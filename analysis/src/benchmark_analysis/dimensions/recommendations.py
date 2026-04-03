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
        condition = entry.get("condition", "")
        # Only flag engagement for conditions that SHOULD use Twining
        if condition in ("baseline", "shared-markdown", "claude-md-only"):
            continue
        if entry.get("engagement_rate", 1.0) < 0.5:
            items.append({
                "priority": "high",
                "category": "coordination",
                "message": f"Fix activation: Twining engagement rate is {entry['engagement_rate']:.0%} for {condition} — agents aren't using coordination tools",
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

    # Check power from reliability — use MDES-based messaging
    reliability = all_results.get("reliability", {})
    design = reliability.get("design_guidance", {})
    mdes = design.get("current_mdes", 0)
    mdes_at_5 = design.get("at_5_iterations", {}).get("mdes", 0)
    current_iters = design.get("iterations_per_pair", 0)

    # One overall design recommendation instead of per-comparison noise
    if mdes and mdes > 1.0 and current_iters <= 3:
        items.append({
            "priority": "medium",
            "category": "reliability",
            "message": f"At {current_iters} iterations/pair (n={design.get('current_n_per_condition', '?')}/condition), "
                       f"only large effects (d≥{mdes:.1f}) are detectable. "
                       f"At 5 iterations/pair, MDES drops to d≥{mdes_at_5:.1f} — "
                       f"a ~66% cost increase for medium-effect detection",
        })

    # Flag comparisons where observed effect is below MDES (inconclusive, not "no effect")
    inconclusive = [pa for pa in reliability.get("power_analysis", [])
                    if abs(pa.get("cohens_d", 0)) > 0.1
                    and abs(pa.get("cohens_d", 0)) < pa.get("mdes", 999)]
    if inconclusive:
        names = ", ".join(pa["comparison"].split(" vs ")[1] for pa in inconclusive[:3])
        items.append({
            "priority": "low",
            "category": "reliability",
            "message": f"Inconclusive comparisons ({names}): observed effects are below detectable threshold — "
                       f"cannot distinguish from noise at current sample size",
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
    lift_summary = lift.get("summary", {})
    if lift_summary.get("overall_lift_significant") is False:
        # Check if there's a large effect that's just underpowered
        reliability = all_results.get("reliability", {})
        power_analyses = reliability.get("power_analysis", [])
        large_effects = [pa for pa in power_analyses
                         if abs(pa.get("cohens_d", 0)) >= 0.8
                         and abs(pa.get("cohens_d", 0)) < pa.get("mdes", 999)]
        if large_effects:
            max_d = max(abs(pa['cohens_d']) for pa in large_effects)
            items.append({
                "priority": "medium",
                "category": "coordination-lift",
                "message": f"Large coordination effects detected (d={max_d:.2f}) "
                           f"but study is underpowered to reach significance — increase sample size, not a coordination problem",
            })
        else:
            items.append({
                "priority": "high",
                "category": "coordination-lift",
                "message": "No statistically significant coordination lift detected — coordination tools may not be providing measurable value",
            })

    # Check behavior-outcome correlations — flag overhead candidates
    behavior = all_results.get("behavior_outcome", {})
    for np_entry in behavior.get("uncorrelated_behaviors", []):
        if np_entry.get("behavior_metric") in ("graph_calls", "verification_calls") and np_entry.get("outcome_metric") == "composite":
            items.append({
                "priority": "medium",
                "category": "behavior-outcome",
                "message": f"Overhead candidate: {np_entry['behavior_metric']} has negligible correlation with composite (r={np_entry['spearman_r']:.2f})",
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
