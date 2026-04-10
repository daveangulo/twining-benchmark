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
    # Pooled runs: show the individual run IDs (stored in seed) instead of the synthetic id
    is_pooled = metadata.id.startswith("pooled-") and metadata.seed
    if is_pooled:
        run_ids = [r.strip() for r in metadata.seed.split(",") if r.strip()]
        add(f"**Pooled from {len(run_ids)} runs:**  ")
        for rid in run_ids:
            add(f"- `{rid}`")
        add()
    else:
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
    correlated = results.get("behavior_outcome", {}).get("correlated_behaviors", [])
    if correlated:
        headers = ["Behavior", "Outcome", "r", "Interpretation"]
        rows = []
        for p in correlated[:10]:
            rows.append([
                p.get("behavior_metric", ""),
                p.get("outcome_metric", ""),
                f"{p.get('spearman_r', 0):+.2f}",
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
    mechanisms = decomp.get("mechanism_attribution", [])

    if mechanisms:
        # Check if all mechanisms have the same value (uninformative)
        diffs = [m.get("associated_difference", 0) for m in mechanisms]
        all_same = len(set(round(d, 1) for d in diffs)) <= 1

        if all_same:
            add(f"_All {len(mechanisms)} mechanisms show identical associated difference "
                f"({diffs[0]:+.1f}) because the same conditions use all Twining tools. "
                f"See lite-vs-full comparison below for tool surface analysis._")
            add()
        else:
            headers = ["Mechanism", "Diff", "Avg Calls/Sess", "Heavy Users", "Non-Users"]
            rows = []
            for m in mechanisms:
                lift = m.get("associated_difference", 0)
                avg_calls = m.get("avg_calls_per_session", 0)
                heavy = ", ".join(m.get("heavy_user_conditions", [])) or "none"
                non = ", ".join(m.get("non_user_conditions", [])) or "none"
                rows.append([
                    m.get("mechanism", ""),
                    f"{lift:+.1f}",
                    f"{avg_calls:.1f}",
                    heavy,
                    non,
                ])
            add_table(headers, rows)

    # Lite vs Full comparison
    lvf = decomp.get("lite_vs_full", {})
    if lvf:
        add("### Lite vs Full Twining")
        add()
        add(f"| Metric | Value |")
        add(f"| --- | --- |")
        add(f"| twining-lite mean | {lvf.get('twining_lite_mean', 'N/A')} |")
        add(f"| full-twining mean | {lvf.get('full_twining_mean', 'N/A')} |")
        delta = lvf.get('delta', 0)
        add(f"| delta (full - lite) | {delta:+.1f} |")
        add(f"| conclusion | {lvf.get('conclusion', 'N/A')} |")
        full_only = lvf.get("full_only_tools", [])
        shared = lvf.get("shared_tools", [])
        if full_only:
            add(f"| full-only tools | {', '.join(full_only)} |")
        if shared:
            add(f"| shared tools | {', '.join(shared)} |")
        add()

    # Tool utilization
    util = decomp.get("tool_utilization", {})
    per_tool = util.get("per_tool_counts", [])
    if per_tool:
        add("### Tool Utilization")
        add()
        headers = ["Condition", "Tool", "Count"]
        rows = [[t["condition"], t["tool"], str(t["count"])] for t in per_tool]
        add_table(headers, rows)

    never = util.get("never_called", [])
    if never:
        add(f"**Never-called tools:** {', '.join(never)}")
        add()

    if not mechanisms and not lvf and not per_tool:
        add("_No effect decomposition data available._")
        add()

    # --- Per-Scenario Breakdown ---
    add("## Per-Scenario Breakdown")
    add()
    scenario_data = results.get("scenarios", {})
    per_scenario = scenario_data.get("per_scenario", {})
    if per_scenario:
        headers = ["Scenario", "Spread", "Best Condition", "Best Mean", "Worst Condition", "Worst Mean"]
        rows = []
        # per_scenario may be a dict keyed by scenario name or a list of dicts
        items = per_scenario.items() if isinstance(per_scenario, dict) else [(s.get("scenario", ""), s) for s in per_scenario]
        for scenario_name, s in items:
            if isinstance(s, str):
                continue
            best = s.get("best_condition", "")
            worst = s.get("worst_condition", "")
            summaries = s.get("condition_summaries", {})
            best_mean = summaries.get(best, {}).get("mean", 0)
            worst_mean = summaries.get(worst, {}).get("mean", 0)
            rows.append([
                scenario_name,
                f"{s.get('spread', 0):.1f}",
                best,
                f"{best_mean:.1f}",
                worst,
                f"{worst_mean:.1f}",
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

        # Exploration Efficiency: task vs coordination bytes decomposition
        items_for_bytes = per_condition.values() if isinstance(per_condition, dict) else per_condition
        sample = next((c for c in items_for_bytes if isinstance(c, dict)), None)
        if sample and "avg_coordination_bytes" in sample:
            # Build composite score lookup from cost data
            cost_data_for_eff = results.get("cost", {}).get("per_condition", [])
            composite_by_cond: dict[str, float] = {}
            for c in cost_data_for_eff:
                composite_by_cond[c.get("condition", "")] = c.get("mean_composite", 0)

            # Collect per-condition task/coord bytes
            eff_rows: list[dict] = []
            items_eff = per_condition.values() if isinstance(per_condition, dict) else per_condition
            for c in items_eff:
                if not isinstance(c, dict):
                    continue
                cond = c.get("condition", "")
                total_b = c.get("avg_total_response_bytes", 0)
                coord_b = c.get("avg_coordination_bytes", 0)
                task_b = total_b - coord_b
                eff_rows.append({
                    "condition": cond,
                    "task_bytes": task_b,
                    "coord_bytes": coord_b,
                    "composite": composite_by_cond.get(cond, 0),
                })

            # Find baseline task_bytes as reference
            baseline_task = next((r["task_bytes"] for r in eff_rows if r["condition"] == "baseline"), None)

            if baseline_task is not None and baseline_task > 0:
                add()
                add("### Exploration Efficiency")
                add()
                headers_e = ["Condition", "Task Bytes", "Coord Bytes", "Exploration Savings", "Savings %", "Coord ROI", "Effectiveness"]
                rows_e = []
                for r in eff_rows:
                    savings = baseline_task - r["task_bytes"]
                    savings_pct = savings / baseline_task * 100
                    if r["coord_bytes"] > 0:
                        roi = f"{savings / r['coord_bytes']:.1f}x"
                    else:
                        roi = "\u2014"
                    task_10kb = r["task_bytes"] / 10000
                    effectiveness = f"{r['composite'] / task_10kb:.1f}" if task_10kb > 0 else "\u2014"
                    is_baseline = r["condition"] == "baseline"
                    rows_e.append([
                        r["condition"],
                        f"{r['task_bytes']:,.0f}",
                        f"{r['coord_bytes']:,.0f}" if r["coord_bytes"] > 0 else "0",
                        f"{savings:,.0f}" if not is_baseline else "\u2014",
                        f"{savings_pct:.1f}%" if not is_baseline else "\u2014",
                        roi if not is_baseline else "\u2014",
                        effectiveness,
                    ])
                add_table(headers_e, rows_e)
                add()
                add("_Exploration savings measures reduction in non-coordination tool work vs baseline. Higher effectiveness = more score per unit of task work._")
                add()
    else:
        add("_No coordination behavior data available._")
        add()

    # --- Cost Analysis ---
    add("## Cost Analysis")
    add()
    cost_data = results.get("cost", {})
    cost_per_condition = cost_data.get("per_condition", [])
    if cost_per_condition:
        headers = ["Condition", "Mean Cost", "Cost/Point"]
        rows = []
        for c in cost_per_condition:
            rows.append([
                c.get("condition", ""),
                f"${c.get('mean_cost_usd', 0):.2f}",
                f"${c.get('cost_per_composite_point', 0):.3f}",
            ])
        add_table(headers, rows)
    else:
        add("_No cost data available._")
        add()

    # --- Token Usage Breakdown ---
    add("## Token Usage Breakdown")
    add()
    if cost_per_condition and any("input_tokens_mean" in c for c in cost_per_condition):
        headers = ["Condition", "Input", "Output", "Cache Read", "Cache Create", "Total", "Cache Hit %"]
        rows = []
        for c in cost_per_condition:
            total = c.get("total_tokens_mean", 0)
            cache_read = c.get("cache_read_tokens_mean", 0)
            cache_ratio = cache_read / max(total, 1) * 100
            rows.append([
                c.get("condition", ""),
                f"{c.get('input_tokens_mean', 0):,}",
                f"{c.get('output_tokens_mean', 0):,}",
                f"{cache_read:,}",
                f"{c.get('cache_creation_tokens_mean', 0):,}",
                f"{total:,}",
                f"{cache_ratio:.1f}%",
            ])
        add_table(headers, rows)
        add()
        add("_Session-level totals from CLI result message (billing-correct). Per-turn values are per-API-call snapshots and are not summable._")
        add()
    else:
        add("_Token breakdown not available (pre-token-tracking data)._")
        add()

    # --- Construct Validity ---
    add("## Construct Validity")
    add()
    validity = results.get("construct_validity", {})
    if validity:
        # Internal consistency summary
        internal = validity.get("internal_consistency", [])
        if internal:
            reliable_count = sum(1 for ic in internal if ic.get("reliable"))
            total_count = len(internal)
            add(f"**Internal consistency:** {reliable_count}/{total_count} scenario-condition-dimension cells have CV < 20%")
            add()

        # Dimension correlations
        dim_corrs = validity.get("dimension_correlations", [])
        if dim_corrs:
            add("### Dimension Correlations")
            add()
            headers = ["Dimension A", "Dimension B", "Pearson r", "Interpretation"]
            rows = [[p.get("dim_a", ""), p.get("dim_b", ""), f"{p.get('pearson_r', 0):.2f}", p.get("interpretation", "")] for p in dim_corrs[:10]]
            add_table(headers, rows)
    else:
        add("_No construct validity data available._")
        add()

    # --- Reliability ---
    add("## Reliability")
    add()
    reliability = results.get("reliability", {})
    if reliability:
        # Variance flags
        variance_flags = reliability.get("variance_flags", [])
        high_var = [v for v in variance_flags if v.get("high_variance")]
        if high_var:
            add(f"**High-variance cells (CV > 30%):** {len(high_var)} of {len(variance_flags)}")
            add()
            headers = ["Scenario", "Condition", "N", "Mean", "CV%"]
            rows = []
            for v in high_var:
                rows.append([
                    v.get("scenario", ""),
                    v.get("condition", ""),
                    str(v.get("n", 0)),
                    f"{v.get('mean', 0):.2f}",
                    f"{v.get('cv_pct', 0):.1f}",
                ])
            add_table(headers, rows)
        elif variance_flags:
            add(f"**All {len(variance_flags)} scenario-condition cells have CV <= 30%.**")
            add()

        # Design guidance
        design = reliability.get("design_guidance", {})
        if design:
            add("### Statistical Design")
            add()
            n = design.get("current_n_per_condition", 0)
            iters = design.get("iterations_per_pair", 0)
            mdes_val = design.get("current_mdes", 0)
            add(f"- **Iterations per pair:** {iters}")
            add(f"- **Scenarios:** {design.get('n_scenarios', '?')}")
            add(f"- **N per condition:** {n} (pooled across scenarios)")
            add(f"- **Minimum Detectable Effect (MDES):** d ≥ {mdes_val:.2f} at 80% power")
            at5 = design.get("at_5_iterations", {})
            if at5 and iters < 5:
                add(f"- **At 5 iterations:** n={at5.get('n_per_condition', '?')}, MDES = d ≥ {at5.get('mdes', '?')}")
                add(f"  - {at5.get('note', '')}")
            add()

        # Power analysis
        power_results = reliability.get("power_analysis", [])
        if power_results:
            add("### Power Analysis")
            add()
            headers = ["Comparison", "Cohen's d", "N", "MDES", "Power", "Verdict"]
            rows = []
            for pr in power_results:
                rows.append([
                    pr.get("comparison", ""),
                    f"{pr.get('cohens_d', 0):+.3f}",
                    str(pr.get("n_per_group", 0)),
                    f"d≥{pr.get('mdes', 0):.2f}",
                    f"{pr.get('observed_power', 0):.3f}",
                    pr.get("verdict", ""),
                ])
            add_table(headers, rows)
    else:
        add("_No reliability data available._")
        add()

    # --- Session Health ---
    add("## Session Health")
    add()
    health_data = results.get("session_health", {})
    health_per_condition = health_data.get("per_condition", [])
    if health_per_condition:
        headers = ["Condition", "Total", "Completed", "Timed Out", "Errored", "Zero Tools",
                   "Twining Calls", "Twining/Sess", "Engagement", "Avg Duration"]
        rows = []
        for h in health_per_condition:
            avg_dur_s = h.get("avg_duration_ms", 0) / 1000
            rows.append([
                h.get("condition", ""),
                str(h.get("total_sessions", 0)),
                str(h.get("completed", 0)),
                str(h.get("timed_out", 0)),
                str(h.get("errored", 0)),
                str(h.get("zero_tool_sessions", 0)),
                str(h.get("total_twining_calls", 0)),
                f"{h.get('avg_twining_calls_per_session', 0):.1f}",
                f"{h.get('twining_engagement_rate', 0):.0%}",
                f"{avg_dur_s:.0f}s",
            ])
        add_table(headers, rows)

        health_warnings = health_data.get("warnings", [])
        if health_warnings:
            add("**Warnings:**")
            add()
            for w in health_warnings:
                add(f"- {w}")
            add()
    else:
        add("_No session health data available._")
        add()

    # --- Behavioral Profiles ---
    add("## Behavioral Profiles")
    add()
    profile_data = results.get("behavioral_profile", {})
    profile_per_condition = profile_data.get("per_condition", [])
    if profile_per_condition:
        headers = ["Condition", "Sessions", "Avg Tools/Sess", "Avg Lines/Sess",
                   "Coord Reads", "Coord Writes", "Top First Tool"]
        rows = []
        for p in profile_per_condition:
            first_tools = p.get("first_tool_distribution", [])
            top_first = first_tools[0]["tool"] if first_tools else "N/A"
            rows.append([
                p.get("condition", ""),
                str(p.get("n_sessions", 0)),
                f"{p.get('avg_tools_per_session', 0):.1f}",
                f"{p.get('avg_lines_added_per_session', 0):.1f}",
                str(p.get("coordination_file_reads", 0)),
                str(p.get("coordination_file_writes", 0)),
                top_first,
            ])
        add_table(headers, rows)
    else:
        add("_No behavioral profile data available._")
        add()

    # --- Work Leverage ---
    add("## Work Leverage")
    add()
    leverage_data = results.get("work_leverage", {})
    leverage_per_condition = leverage_data.get("per_condition", [])
    if leverage_per_condition:
        headers = ["Condition", "Pairs", "Avg Rework Ratio", "Avg Line Survival", "Avg Continuation"]
        rows = []
        for lv in leverage_per_condition:
            rows.append([
                lv.get("condition", ""),
                str(lv.get("n_pairs", 0)),
                f"{lv.get('avg_rework_ratio', 0):.3f}",
                f"{lv.get('avg_line_survival', 0):.3f}",
                f"{lv.get('avg_continuation_index', 0):.3f}",
            ])
        add_table(headers, rows)
    else:
        add("_No work leverage data available._")
        add()

    # --- Cost Efficiency ---
    add("## Cost Efficiency")
    add()
    efficiency_data = results.get("cost_efficiency", {})
    efficiency_per_condition = efficiency_data.get("per_condition", [])
    if efficiency_per_condition:
        headers = ["Condition", "Total Cost", "$/Iteration", "$/Point", "Avg Time/Iter", "Lines/$", "Calls/$"]
        rows = []
        for ce in efficiency_per_condition:
            avg_time_s = ce.get("avg_time_per_iteration_ms", 0) / 1000
            rows.append([
                ce.get("condition", ""),
                f"${ce.get('total_cost_usd', 0):.2f}",
                f"${ce.get('cost_per_iteration_usd', 0):.3f}",
                f"${ce.get('cost_per_quality_point_usd', 0):.4f}",
                f"{avg_time_s:.0f}s",
                f"{ce.get('lines_per_dollar', 0):.0f}",
                f"{ce.get('tool_calls_per_dollar', 0):.0f}",
            ])
        add_table(headers, rows)
    else:
        add("_No cost efficiency data available._")
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
