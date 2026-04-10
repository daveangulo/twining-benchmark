"""CLI for benchmark analysis."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Analyze Twining benchmark results")
    subparsers = parser.add_subparsers(dest="command")

    # analyze <run-dir> [<run-dir>...]
    analyze_parser = subparsers.add_parser(
        "analyze",
        help="Analyze one or more benchmark runs (pooled if multiple)",
    )
    analyze_parser.add_argument(
        "run_dirs", nargs="+", type=Path,
        help="Path(s) to benchmark run directories. If multiple, data is pooled.",
    )
    analyze_parser.add_argument(
        "--format", choices=["markdown", "html", "json", "all"], default="all",
        dest="output_format",
    )
    analyze_parser.add_argument(
        "--output", type=Path,
        help="Output directory (default: run_dir/analysis/ for single run, "
             "required for pooled analysis)",
    )
    analyze_parser.add_argument(
        "--min-tokens", type=int, default=0,
        help="Exclude scores/transcripts with totalTokens below this threshold (filters failed runs)",
    )

    # compare <run-dir-1> <run-dir-2>
    compare_parser = subparsers.add_parser("compare", help="Compare two runs")
    compare_parser.add_argument("run_dirs", nargs=2, type=Path)
    compare_parser.add_argument(
        "--format", choices=["markdown", "json"], default="markdown",
        dest="output_format",
    )

    # compare-conditions <run-dir-1> <run-dir-2> [<run-dir-3>...]
    cc_parser = subparsers.add_parser("compare-conditions", help="Compare conditions across multiple runs")
    cc_parser.add_argument("--runs", nargs="+", type=Path, required=True, help="Paths to benchmark run directories")
    cc_parser.add_argument(
        "--conditions", type=str, default=None,
        help="Comma-separated list of conditions to include (default: all)",
    )
    cc_parser.add_argument(
        "--format", choices=["markdown", "json"], default="markdown",
        dest="output_format",
    )

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "analyze":
        run_analyze(args)
    elif args.command == "compare":
        run_compare(args)
    elif args.command == "compare-conditions":
        run_compare_conditions(args)


def run_analyze(args):
    """Run full analysis on one or more benchmark runs (pooled if multiple)."""
    from .loader import load_run, pool_runs
    from .dimensions import (
        scoring, conditions, scenarios, coordination, coordination_lift,
        cost, reliability, scorer_diagnostics, sessions,
        behavior_outcome, effect_decomposition, learning_curve,
        interactions, construct_validity, harness_summary,
        recommendations,
        session_health, behavioral_profile, work_leverage, cost_efficiency,
    )
    from .reports import markdown, html, json_report

    is_pooled = len(args.run_dirs) > 1
    if is_pooled:
        run = pool_runs(args.run_dirs)
        print(f"Pooled {len(args.run_dirs)} runs: {', '.join(str(d) for d in args.run_dirs)}")
    else:
        run = load_run(args.run_dirs[0])

    total_scores = len(run.scores)
    total_transcripts = len(run.transcripts)

    # Filter out failed runs (e.g. rate-limited sessions with zero tokens)
    if args.min_tokens > 0:
        run.scores = [s for s in run.scores if s.metrics.totalTokens >= args.min_tokens]
        run.transcripts = [t for t in run.transcripts if t.tokenUsage.total >= args.min_tokens]
        run.session_data = [sd for sd in run.session_data if sd.transcript.tokenUsage.total >= args.min_tokens]
        filtered_scores = total_scores - len(run.scores)
        filtered_transcripts = total_transcripts - len(run.transcripts)
        print(f"Loaded run {run.metadata.id}: {total_scores} scores, {total_transcripts} transcripts")
        print(f"  Filtered {filtered_scores} scores and {filtered_transcripts} transcripts with <{args.min_tokens} tokens")
        print(f"  Analyzing {len(run.scores)} scores, {len(run.transcripts)} transcripts")
    else:
        print(f"Loaded run {run.metadata.id}: {len(run.scores)} scores, {len(run.transcripts)} transcripts")

    results: dict = {}

    # Run each analyzer, catching errors gracefully
    _run_safe(results, "scoring", lambda: scoring.analyze_scoring(run.scores))
    _run_safe(results, "conditions", lambda: conditions.analyze_conditions(run.scores))
    _run_safe(results, "scenarios", lambda: scenarios.analyze_scenarios(run.scores))

    # Coordination needs transcripts + optional artifacts map
    def _run_coordination():
        artifacts_map = {}
        for sd in run.session_data:
            if sd.artifacts is not None:
                artifacts_map[sd.transcript.sessionId] = sd.artifacts
        result = coordination.analyze_coordination(run.transcripts, artifacts_map)
        # Convert dataclass to dict for downstream consumers
        from dataclasses import asdict
        return asdict(result)

    _run_safe(results, "coordination", _run_coordination)
    _run_safe(results, "coordination_lift", lambda: coordination_lift.analyze_coordination_lift(run.scores))
    _run_safe(results, "cost", lambda: cost.analyze_cost(run.scores))
    _run_safe(results, "reliability", lambda: reliability.analyze_reliability(run.scores))
    _run_safe(results, "scorer_diagnostics", lambda: scorer_diagnostics.analyze_scorers(run.scores))
    _run_safe(results, "sessions", lambda: sessions.analyze_sessions(run.transcripts))
    _run_safe(results, "behavior_outcome",
              lambda: behavior_outcome.analyze_behavior_outcome(run.scores, run.transcripts))
    _run_safe(results, "effect_decomposition",
              lambda: effect_decomposition.analyze_effect_decomposition(run.scores, run.transcripts))
    _run_safe(results, "learning_curve", lambda: learning_curve.analyze_learning_curve(run.transcripts))
    _run_safe(results, "interactions", lambda: interactions.analyze_interactions(run.scores))
    _run_safe(results, "construct_validity",
              lambda: construct_validity.analyze_construct_validity(run.scores))

    # New dimensions: session health, behavioral profiles, work leverage, cost efficiency
    _run_safe(results, "session_health",
              lambda: session_health.analyze_session_health(run.transcripts))
    _run_safe(results, "behavioral_profile",
              lambda: behavioral_profile.analyze_behavioral_profiles(run.transcripts))
    _run_safe(results, "work_leverage",
              lambda: work_leverage.analyze_work_leverage(run.transcripts))
    _run_safe(results, "cost_efficiency",
              lambda: cost_efficiency.analyze_cost_efficiency(run.scores, run.transcripts))

    # Harness summary and recommendations depend on previous results
    _run_safe(results, "harness_summary", lambda: harness_summary.generate_harness_summary(results))
    _run_safe(results, "recommendations", lambda: recommendations.synthesize_recommendations(results))

    # Write reports
    if args.output:
        output_dir = args.output
    elif is_pooled:
        # Default pooled output: sibling of first run dir
        output_dir = args.run_dirs[0].parent / f"pooled-analysis-{len(args.run_dirs)}-runs"
        print(f"  Pooled output directory: {output_dir}")
    else:
        output_dir = args.run_dirs[0] / "analysis"
    output_dir.mkdir(parents=True, exist_ok=True)

    fmt = args.output_format
    if fmt in ("json", "all"):
        json_report.generate_json_report(results, output_dir / "analysis.json")
        print(f"  JSON report: {output_dir / 'analysis.json'}")

    if fmt in ("markdown", "all"):
        md = markdown.generate_markdown_report(results, run.metadata)
        (output_dir / "analysis.md").write_text(md)
        print(f"  Markdown report: {output_dir / 'analysis.md'}")

    if fmt in ("html", "all"):
        html.generate_html_report(results, run.metadata, output_dir / "analysis.html")
        print(f"  HTML report: {output_dir / 'analysis.html'}")

    # Print summary to terminal
    _print_terminal_summary(results)


def run_compare(args):
    """Compare two benchmark runs."""
    from .loader import load_run
    from .dimensions.temporal import analyze_temporal

    runs = [load_run(d) for d in args.run_dirs]
    comparison = analyze_temporal(runs)

    if args.output_format == "json":
        import json
        print(json.dumps(comparison, indent=2, default=str))
    else:
        _print_comparison(comparison, runs)


def _run_safe(results: dict, key: str, fn):
    """Run an analyzer function, storing errors instead of crashing."""
    try:
        result = fn()
        # Normalize: if a Pydantic BaseModel, convert to dict
        if hasattr(result, "model_dump"):
            result = result.model_dump()
        # Unwrap DimensionAnalysis-shaped dicts: extract details so downstream
        # consumers can access keys like "condition_rankings" directly
        if isinstance(result, dict) and "details" in result and "dimension" in result:
            unwrapped = dict(result["details"])
            unwrapped["_summary"] = result.get("summary", "")
            result = unwrapped
        results[key] = result
    except Exception as e:
        print(f"  Warning: {key} analysis failed: {e}", file=sys.stderr)
        results[key] = {"error": str(e)}


def _print_terminal_summary(results: dict):
    """Print a concise terminal summary."""
    # Headline
    headline = results.get("harness_summary", {}).get("headline", "")
    if headline:
        print(f"\n>>> {headline}")

    # Harness comparison matrix
    matrix = results.get("harness_summary", {}).get("matrix", [])
    if matrix:
        print("\n=== HARNESS COMPARISON MATRIX ===")
        print(f"  {'Condition':<28s} {'Rank':>4s} {'Mean':>6s} {'Lift':>6s} {'Sig':>4s} {'d':>6s} {'Cost':>7s}")
        print(f"  {'-'*28} {'-'*4} {'-'*6} {'-'*6} {'-'*4} {'-'*6} {'-'*7}")
        for row in matrix:
            sig = " *" if row.get("lift_significant") else "  "
            d_str = f"{row['cohens_d']:+.2f}" if row.get("cohens_d") is not None else "  N/A"
            print(f"  {row['condition']:<28s} {row['rank']:>4} {row['composite_mean']:>6.1f} "
                  f"{row['lift_vs_baseline']:>+6.1f}{sig} {d_str} ${row['cost_usd']:>6.2f}")

    # Correlated behaviors
    correlated = results.get("behavior_outcome", {}).get("correlated_behaviors", [])
    if correlated:
        print("\n=== CORRELATED BEHAVIORS ===")
        for p in correlated[:5]:
            print(f"  {p['behavior_metric']:<25s} -> {p['outcome_metric']:<12s} r={p['spearman_r']:+.2f} ({p['interpretation']})")

    # Interaction warnings
    disordinal = results.get("interactions", {}).get("disordinal_interactions", [])
    if disordinal:
        print("\n=== INTERACTION WARNINGS ===")
        for d in disordinal[:3]:
            print(f"  {d['condition_a']} vs {d['condition_b']}: ranking reverses across scenarios")

    # Statistical design context
    design = results.get("reliability", {}).get("design_guidance", {})
    if design:
        n = design.get("current_n_per_condition", 0)
        iters = design.get("iterations_per_pair", 0)
        mdes = design.get("current_mdes", 0)
        print(f"\n=== STATISTICAL DESIGN ===")
        print(f"  {iters} iterations/pair, {design.get('n_scenarios', '?')} scenarios -> n={n}/condition, MDES=d≥{mdes:.2f}")
        at5 = design.get("at_5_iterations", {})
        if at5 and iters < 5:
            print(f"  At 5 iterations/pair: n={at5.get('n_per_condition', '?')}/condition, MDES=d≥{at5.get('mdes', '?')}")

    # Key effect sizes
    effect_sizes = results.get("conditions", {}).get("effect_sizes", [])
    if effect_sizes:
        baseline_effects = [es for es in effect_sizes if es.get("condition_a") == "baseline"]
        if baseline_effects:
            print("\n=== KEY EFFECT SIZES (vs baseline) ===")
            for es in baseline_effects:
                sig = "*" if es.get("significant") else ""
                d_val = abs(es.get("cohens_d", 0))
                marker = ""
                if mdes and d_val > 0.1 and d_val < mdes:
                    marker = " [below MDES]"
                print(f"  {es['condition_b']:<30s} d={es['cohens_d']:+.2f} ({es['interpretation']}){sig}{marker}")

    recs = results.get("recommendations", {}).get("items", [])
    if recs:
        print("\n=== RECOMMENDATIONS ===")
        for rec in recs:
            print(f"  [{rec.get('priority', '?')}] {rec.get('message', '')}")


def run_compare_conditions(args):
    """Compare conditions across multiple benchmark runs."""
    from collections import defaultdict
    from .loader import load_run
    from .stats import cohens_d, interpret_cohens_d
    import json as json_mod

    condition_filter = None
    if args.conditions:
        condition_filter = set(args.conditions.split(","))

    # Load all runs and pool scores
    all_scores: list = []
    run_ids: list[str] = []
    for run_dir in args.runs:
        run = load_run(run_dir)
        run_ids.append(run.metadata.id)
        all_scores.extend(run.scores)

    # Filter conditions if specified
    if condition_filter:
        all_scores = [s for s in all_scores if s.condition in condition_filter]

    # Group by condition
    by_condition: dict[str, list] = defaultdict(list)
    for s in all_scores:
        by_condition[s.condition].append(s)

    # Per-condition stats
    import numpy as np
    condition_summaries: list[dict] = []
    for condition in sorted(by_condition):
        items = by_condition[condition]
        composites = [s.composite for s in items]
        arr = np.array(composites, dtype=float)
        # Per-dimension means
        dim_means: dict[str, float] = defaultdict(list)
        for s in items:
            for dim_name, dim_score in s.scores.items():
                dim_means[dim_name].append(dim_score.value)
        dim_avg = {k: round(float(np.mean(v)), 2) for k, v in dim_means.items()}

        condition_summaries.append({
            "condition": condition,
            "n_iterations": len(items),
            "mean_composite": round(float(np.mean(arr)), 2),
            "std_composite": round(float(np.std(arr, ddof=1)), 2) if len(arr) > 1 else 0.0,
            "per_dimension_means": dim_avg,
        })

    # Pairwise effect sizes (Hedges' g)
    conditions_list = sorted(by_condition.keys())
    pairwise_effects: list[dict] = []
    for i, cond_a in enumerate(conditions_list):
        for cond_b in conditions_list[i + 1:]:
            vals_a = [s.composite for s in by_condition[cond_a]]
            vals_b = [s.composite for s in by_condition[cond_b]]
            d = cohens_d(vals_a, vals_b)
            pairwise_effects.append({
                "condition_a": cond_a,
                "condition_b": cond_b,
                "hedges_g": round(d, 3),
                "interpretation": interpret_cohens_d(d),
                "mean_a": round(float(np.mean(vals_a)), 2),
                "mean_b": round(float(np.mean(vals_b)), 2),
                "delta": round(float(np.mean(vals_b)) - float(np.mean(vals_a)), 2),
            })

    result = {
        "run_ids": run_ids,
        "n_runs": len(run_ids),
        "conditions_compared": conditions_list,
        "condition_summaries": condition_summaries,
        "pairwise_effects": pairwise_effects,
    }

    if args.output_format == "json":
        print(json_mod.dumps(result, indent=2, default=str))
    else:
        _print_condition_comparison(result)


def _print_condition_comparison(result: dict):
    """Print a terminal comparison of conditions across runs."""
    print(f"\n=== CONDITION COMPARISON ({result['n_runs']} runs) ===")
    print(f"  Runs: {', '.join(result['run_ids'])}")
    print()

    # Summary table
    summaries = result.get("condition_summaries", [])
    if summaries:
        print(f"  {'Condition':<28s} {'N':>4s} {'Mean':>7s} {'Std':>7s}")
        print(f"  {'-'*28} {'-'*4} {'-'*7} {'-'*7}")
        for s in summaries:
            print(f"  {s['condition']:<28s} {s['n_iterations']:>4} {s['mean_composite']:>7.2f} {s['std_composite']:>7.2f}")

    # Pairwise effects
    effects = result.get("pairwise_effects", [])
    if effects:
        print(f"\n  {'Comparison':<40s} {'g':>7s} {'Delta':>7s} {'Interpretation':<15s}")
        print(f"  {'-'*40} {'-'*7} {'-'*7} {'-'*15}")
        for e in effects:
            label = f"{e['condition_a']} vs {e['condition_b']}"
            print(f"  {label:<40s} {e['hedges_g']:>+7.3f} {e['delta']:>+7.2f} {e['interpretation']:<15s}")


def _print_comparison(comparison: dict, runs):
    """Print a terminal comparison of two runs."""
    print(f"\n=== COMPARING RUNS ===")
    print(f"  Run A: {runs[0].metadata.id} ({runs[0].metadata.timestamp})")
    print(f"  Run B: {runs[1].metadata.id} ({runs[1].metadata.timestamp})")
    for item in comparison.get("changes", []):
        direction = "+" if item["delta"] > 0 else ""
        print(f"  {item['condition']:<30s} {item['previous_mean']:5.1f} -> {item['current_mean']:5.1f} ({direction}{item['delta']:.1f})")
    if comparison.get("regressions"):
        print("\n  REGRESSIONS:")
        for r in comparison["regressions"]:
            print(f"    {r['condition']}: {r['delta']:+.1f} points")
    if comparison.get("improvements"):
        print("\n  IMPROVEMENTS:")
        for r in comparison["improvements"]:
            print(f"    {r['condition']}: {r['delta']:+.1f} points")
