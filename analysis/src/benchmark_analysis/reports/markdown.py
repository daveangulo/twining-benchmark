"""Markdown report generator for benchmark analysis results."""
from __future__ import annotations

from benchmark_analysis.models import RunMetadata


def generate_markdown_report(results: dict, metadata: RunMetadata) -> str:
    """Generate a comprehensive Markdown report with sections for each dimension.

    Args:
        results: Dictionary of analysis results from all dimensions.
        metadata: Run metadata for header information.

    Returns:
        Complete Markdown document as a string.
    """
    lines: list[str] = []

    def add(text: str = ""):
        lines.append(text)

    def add_table(headers: list[str], rows: list[list[str]]):
        """Add a Markdown table."""
        add("| " + " | ".join(headers) + " |")
        add("| " + " | ".join("---" for _ in headers) + " |")
        for row in rows:
            add("| " + " | ".join(str(c) for c in row) + " |")
        add()

    # --- Header ---
    add(f"# Benchmark Analysis Report")
    add()
    add(f"**Run ID:** {metadata.id}  ")
    add(f"**Timestamp:** {metadata.timestamp}  ")
    add(f"**Status:** {metadata.status}  ")
    add(f"**Scenarios:** {', '.join(metadata.scenarios)}  ")
    add(f"**Conditions:** {', '.join(metadata.conditions)}  ")
    add(f"**Runs per pair:** {metadata.runsPerPair}  ")
    add()

    # --- Executive Summary ---
    add("## Executive Summary")
    add()
    headline = results.get("harness_summary", {}).get("headline", "")
    if headline:
        add(f"> {headline}")
        add()

    # --- Harness Comparison Matrix ---
    add("## Harness Comparison Matrix")
    add()
    matrix = results.get("harness_summary", {}).get("matrix", [])
    if matrix:
        headers = ["Rank", "Condition", "Mean", "Lift", "Sig", "Effect", "d", "Cost", "$/pt"]
        rows = []
        for row in matrix:
            sig = "\\*" if row.get("lift_significant") else ""
            d_str = f"{row['cohens_d']:+.2f}" if row.get("cohens_d") is not None else "N/A"
            rows.append([
                str(row.get("rank", "?")),
                row["condition"],
                f"{row.get('composite_mean', 0):.1f}",
                f"{row.get('lift_vs_baseline', 0):+.1f}",
                sig,
                row.get("effect_size", "N/A"),
                d_str,
                f"${row.get('cost_usd', 0):.2f}",
                f"${row.get('cost_per_point', 0):.3f}",
            ])
        add_table(headers, rows)
    else:
        add("_No harness summary data available._")
        add()

    # --- Coordination Lift ---
    add("## Coordination Lift")
    add()
    lift_data = results.get("coordination_lift", {})
    pairwise = lift_data.get("pairwise_lift", [])
    if pairwise:
        headers = ["Condition", "Lift (pts)", "Significant", "Cohen's d", "Interpretation"]
        rows = []
        for item in pairwise:
            rows.append([
                item.get("condition", ""),
                f"{item.get('lift_points', 0):+.1f}",
                "Yes" if item.get("significant") else "No",
                f"{item.get('cohens_d', 0):+.2f}",
                item.get("interpretation", ""),
            ])
        add_table(headers, rows)
    else:
        add("_No coordination lift data available._")
        add()

    # --- Behavior-Outcome Correlations ---
    add("## Behavior-Outcome Correlations")
    add()
    predictive = results.get("behavior_outcome", {}).get("predictive_behaviors", [])
    if predictive:
        headers = ["Behavior", "Outcome", "r", "Interpretation"]
        rows = []
        for p in predictive[:10]:
            rows.append([
                p.get("behavior_metric", ""),
                p.get("outcome_metric", ""),
                f"{p.get('pearson_r', 0):+.2f}",
                p.get("interpretation", ""),
            ])
        add_table(headers, rows)
    else:
        add("_No behavior-outcome correlation data available._")
        add()

    # --- Effect Decomposition ---
    add("## Effect Decomposition")
    add()
    decomp = results.get("effect_decomposition", {})
    mechanisms = decomp.get("mechanisms", [])
    if mechanisms:
        headers = ["Mechanism", "Contribution", "Evidence"]
        rows = []
        for m in mechanisms:
            rows.append([
                m.get("mechanism", ""),
                f"{m.get('contribution_pct', 0):.0f}%",
                m.get("evidence", ""),
            ])
        add_table(headers, rows)
    else:
        add("_No effect decomposition data available._")
        add()

    # --- Per-Scenario Breakdown ---
    add("## Per-Scenario Breakdown")
    add()
    scenario_data = results.get("scenarios", {})
    per_scenario = scenario_data.get("per_scenario", {})
    if per_scenario:
        headers = ["Scenario", "Mean", "Std", "Best Condition", "Worst Condition"]
        rows = []
        # per_scenario may be a dict keyed by scenario name or a list of dicts
        items = per_scenario.items() if isinstance(per_scenario, dict) else [(s.get("scenario", ""), s) for s in per_scenario]
        for scenario_name, s in items:
            if isinstance(s, str):
                continue
            rows.append([
                scenario_name,
                f"{s.get('mean', s.get('spread', 0)):.1f}",
                f"{s.get('std', 0):.1f}",
                s.get("best_condition", ""),
                s.get("worst_condition", ""),
            ])
        add_table(headers, rows)
    else:
        add("_No per-scenario data available._")
        add()

    # --- Interaction Effects ---
    add("## Interaction Effects")
    add()
    interactions = results.get("interactions", {})
    disordinal = interactions.get("disordinal_interactions", [])
    if disordinal:
        add("### Disordinal Interactions (ranking reversals)")
        add()
        for d in disordinal:
            add(f"- **{d.get('condition_a', '')}** vs **{d.get('condition_b', '')}**: ranking reverses across scenarios")
        add()
    else:
        add("_No disordinal interactions detected._")
        add()

    # --- Effect Sizes ---
    add("## Effect Sizes (vs Baseline)")
    add()
    effect_sizes = results.get("conditions", {}).get("effect_sizes", [])
    baseline_effects = [e for e in effect_sizes if e.get("condition_a") == "baseline"]
    if baseline_effects:
        headers = ["Condition", "Cohen's d", "Interpretation", "Significant"]
        rows = []
        for es in baseline_effects:
            rows.append([
                es.get("condition_b", ""),
                f"{es.get('cohens_d', 0):+.2f}",
                es.get("interpretation", ""),
                "\\*" if es.get("significant") else "",
            ])
        add_table(headers, rows)
    else:
        add("_No effect size data available._")
        add()

    # --- Coordination Behavior ---
    add("## Coordination Behavior")
    add()
    coord = results.get("coordination", {})
    per_condition = coord.get("per_condition", {})
    if per_condition:
        headers = ["Condition", "Twining %", "Engagement Rate", "Sessions"]
        rows = []
        # per_condition may be a dict keyed by condition name or a list of dicts
        items = per_condition.values() if isinstance(per_condition, dict) else per_condition
        for c in items:
            if not isinstance(c, dict):
                continue
            rows.append([
                c.get("condition", ""),
                f"{c.get('avg_twining_pct', c.get('twining_pct', 0)):.1f}%",
                f"{c.get('engagement_rate', 0):.0%}",
                str(c.get("session_count", c.get("total_tool_calls", 0))),
            ])
        add_table(headers, rows)
    else:
        add("_No coordination behavior data available._")
        add()

    # --- Cost Analysis ---
    add("## Cost Analysis")
    add()
    cost_data = results.get("cost", {})
    cost_per_condition = cost_data.get("per_condition", [])
    if cost_per_condition:
        headers = ["Condition", "Mean Cost", "Median Cost", "Cost/Point"]
        rows = []
        for c in cost_per_condition:
            rows.append([
                c.get("condition", ""),
                f"${c.get('mean_cost_usd', 0):.2f}",
                f"${c.get('median_cost_usd', 0):.2f}",
                f"${c.get('cost_per_composite_point', 0):.3f}",
            ])
        add_table(headers, rows)
    else:
        add("_No cost data available._")
        add()

    # --- Construct Validity ---
    add("## Construct Validity")
    add()
    validity = results.get("construct_validity", {})
    if validity:
        cronbach = validity.get("cronbach_alpha")
        if cronbach is not None:
            add(f"**Cronbach's alpha:** {cronbach:.3f}")
            add()
        convergent = validity.get("convergent_pairs", [])
        if convergent:
            add("### Convergent Validity")
            add()
            headers = ["Dimension A", "Dimension B", "Correlation"]
            rows = [[p.get("dim_a", ""), p.get("dim_b", ""), f"{p.get('correlation', 0):.2f}"] for p in convergent[:10]]
            add_table(headers, rows)
    else:
        add("_No construct validity data available._")
        add()

    # --- Reliability ---
    add("## Reliability")
    add()
    reliability = results.get("reliability", {})
    if reliability:
        icc = reliability.get("icc")
        if icc is not None:
            add(f"**ICC (intra-class correlation):** {icc:.3f}")
            add()
        per_condition_rel = reliability.get("per_condition", [])
        if per_condition_rel:
            headers = ["Condition", "CV", "Spread"]
            rows = []
            for c in per_condition_rel:
                rows.append([
                    c.get("condition", ""),
                    f"{c.get('cv', 0):.2f}",
                    f"{c.get('spread', 0):.1f}",
                ])
            add_table(headers, rows)
    else:
        add("_No reliability data available._")
        add()

    # --- Recommendations ---
    add("## Recommendations")
    add()
    recs = results.get("recommendations", {}).get("items", [])
    if recs:
        for rec in recs:
            priority = rec.get("priority", "?")
            message = rec.get("message", "")
            add(f"- **[{priority}]** {message}")
        add()
    else:
        add("_No recommendations generated._")
        add()

    # --- Footer ---
    add("---")
    add("_Generated by benchmark-analysis_")

    return "\n".join(lines)
