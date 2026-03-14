"""CLI for benchmark analysis."""
from __future__ import annotations

import argparse
import sys
from dataclasses import asdict
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Analyze Twining benchmark results")
    subparsers = parser.add_subparsers(dest="command")

    # analyze <run-dir>
    analyze_parser = subparsers.add_parser("analyze", help="Analyze a single run")
    analyze_parser.add_argument("run_dir", type=Path, help="Path to benchmark run directory")
    analyze_parser.add_argument(
        "--format", choices=["markdown", "html", "json", "all"], default="all",
        dest="output_format",
    )
    analyze_parser.add_argument("--output", type=Path, help="Output directory (default: run_dir/analysis/)")

    # compare <run-dir-1> <run-dir-2>
    compare_parser = subparsers.add_parser("compare", help="Compare two runs")
    compare_parser.add_argument("run_dirs", nargs=2, type=Path)
    compare_parser.add_argument(
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


def run_analyze(args):
    """Run full analysis on a single benchmark run."""
    from .loader import load_run
    from .dimensions import (
        scoring, conditions, scenarios, coordination, coordination_lift,
        cost, reliability, scorer_diagnostics, sessions,
        behavior_outcome, effect_decomposition, learning_curve,
        interactions, construct_validity, harness_summary,
        recommendations,
    )
    from .reports import markdown, html, json_report

    run = load_run(args.run_dir)
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

    # Harness summary and recommendations depend on previous results
    _run_safe(results, "harness_summary", lambda: harness_summary.generate_harness_summary(results))
    _run_safe(results, "recommendations", lambda: recommendations.synthesize_recommendations(results))

    # Write reports
    output_dir = args.output or (args.run_dir / "analysis")
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

    # Predictive behaviors
    predictive = results.get("behavior_outcome", {}).get("predictive_behaviors", [])
    if predictive:
        print("\n=== PREDICTIVE BEHAVIORS ===")
        for p in predictive[:5]:
            print(f"  {p['behavior_metric']:<25s} -> {p['outcome_metric']:<12s} r={p['pearson_r']:+.2f} ({p['interpretation']})")

    # Interaction warnings
    disordinal = results.get("interactions", {}).get("disordinal_interactions", [])
    if disordinal:
        print("\n=== INTERACTION WARNINGS ===")
        for d in disordinal[:3]:
            print(f"  {d['condition_a']} vs {d['condition_b']}: ranking reverses across scenarios")

    # Key effect sizes
    effect_sizes = results.get("conditions", {}).get("effect_sizes", [])
    if effect_sizes:
        baseline_effects = [es for es in effect_sizes if es.get("condition_a") == "baseline"]
        if baseline_effects:
            print("\n=== KEY EFFECT SIZES (vs baseline) ===")
            for es in baseline_effects:
                sig = "*" if es.get("significant") else ""
                print(f"  {es['condition_b']:<30s} d={es['cohens_d']:+.2f} ({es['interpretation']}){sig}")

    recs = results.get("recommendations", {}).get("items", [])
    if recs:
        print("\n=== RECOMMENDATIONS ===")
        for rec in recs:
            print(f"  [{rec.get('priority', '?')}] {rec.get('message', '')}")


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
