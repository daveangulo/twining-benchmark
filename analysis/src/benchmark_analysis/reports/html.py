"""HTML report generator with interactive plotly charts."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from benchmark_analysis.models import RunMetadata


def generate_html_report(results: dict, metadata: RunMetadata, output_path: Path) -> None:
    """Generate a self-contained HTML report with interactive plotly charts.

    Charts included:
      - Composite score bar chart by condition
      - Per-scenario x condition heatmap
      - Effect size visualization
      - Cost vs quality scatter

    Args:
        results: Dictionary of analysis results from all dimensions.
        metadata: Run metadata for header information.
        output_path: Path to write the HTML file.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    charts_json = _build_charts(results)
    matrix_html = _build_matrix_table(results)
    recommendations_html = _build_recommendations(results)

    html = _TEMPLATE.format(
        run_id=metadata.id,
        timestamp=metadata.timestamp,
        status=metadata.status,
        scenarios=", ".join(metadata.scenarios),
        conditions=", ".join(metadata.conditions),
        runs_per_pair=metadata.runsPerPair,
        headline=results.get("harness_summary", {}).get("headline", ""),
        matrix_table=matrix_html,
        recommendations=recommendations_html,
        charts_json=charts_json,
    )

    with open(output_path, "w") as f:
        f.write(html)


def _safe_float(val, default=0.0):
    """Convert a value to float, handling None and NaN."""
    if val is None:
        return default
    try:
        v = float(val)
        if np.isnan(v) or np.isinf(v):
            return default
        return v
    except (TypeError, ValueError):
        return default


def _build_charts(results: dict) -> str:
    """Build plotly chart specs as JSON."""
    charts = {}

    # 1. Composite score bar chart
    matrix = results.get("harness_summary", {}).get("matrix", [])
    if matrix:
        conditions = [r["condition"] for r in matrix]
        means = [_safe_float(r.get("composite_mean")) for r in matrix]
        colors = ["#2ecc71" if r.get("lift_significant") else "#3498db" for r in matrix]
        charts["composite_bar"] = {
            "data": [{
                "type": "bar",
                "x": conditions,
                "y": means,
                "marker": {"color": colors},
                "text": [f"{m:.1f}" for m in means],
                "textposition": "auto",
            }],
            "layout": {
                "title": "Composite Score by Condition",
                "yaxis": {"title": "Composite Score", "range": [0, 105]},
                "xaxis": {"tickangle": -30},
                "margin": {"b": 120},
            },
        }

    # 2. Per-scenario heatmap
    scenario_data = results.get("scenarios", {}).get("per_scenario", {})
    if scenario_data:
        # per_scenario may be a dict keyed by scenario name or a list
        if isinstance(scenario_data, dict):
            scenario_names = sorted(scenario_data.keys())
            # Collect all condition names across scenarios
            condition_set = set()
            for s_name, s_val in scenario_data.items():
                if isinstance(s_val, dict):
                    cond_summaries = s_val.get("condition_summaries", {})
                    if isinstance(cond_summaries, dict):
                        condition_set.update(cond_summaries.keys())
            condition_set = sorted(condition_set)

            # Build lookup from condition_summaries
            lookup = {}
            for s_name, s_val in scenario_data.items():
                if isinstance(s_val, dict):
                    cond_summaries = s_val.get("condition_summaries", {})
                    if isinstance(cond_summaries, dict):
                        for cond_name, cond_stats in cond_summaries.items():
                            if isinstance(cond_stats, dict):
                                lookup[(s_name, cond_name)] = _safe_float(cond_stats.get("mean"))
        else:
            scenario_names = sorted(set(s.get("scenario", "") for s in scenario_data if isinstance(s, dict)))
            condition_set = sorted(set(s.get("condition", "") for s in scenario_data if isinstance(s, dict) and s.get("condition")))
            if not condition_set:
                condition_set = [r["condition"] for r in matrix] if matrix else []
            lookup = {}
            for s in scenario_data:
                if isinstance(s, dict):
                    for cond_entry in s.get("condition_means", []):
                        key = (s.get("scenario", ""), cond_entry.get("condition", ""))
                        lookup[key] = _safe_float(cond_entry.get("mean"))

        if scenario_names and condition_set:
            z = []
            for scenario in scenario_names:
                row = [lookup.get((scenario, c), 0) for c in condition_set]
                z.append(row)

            charts["scenario_heatmap"] = {
                "data": [{
                    "type": "heatmap",
                    "z": z,
                    "x": condition_set,
                    "y": scenario_names,
                    "colorscale": "RdYlGn",
                    "zmin": 0,
                    "zmax": 100,
                }],
                "layout": {
                    "title": "Score Heatmap: Scenario x Condition",
                    "xaxis": {"tickangle": -30},
                    "margin": {"b": 120, "l": 200},
                },
            }

    # 3. Effect size visualization
    effect_sizes = results.get("conditions", {}).get("effect_sizes", [])
    baseline_effects = [e for e in effect_sizes if e.get("condition_a") == "baseline"]
    if baseline_effects:
        conds = [e.get("condition_b", "") for e in baseline_effects]
        ds = [_safe_float(e.get("cohens_d")) for e in baseline_effects]
        colors = []
        for e in baseline_effects:
            if e.get("significant"):
                colors.append("#e74c3c" if _safe_float(e.get("cohens_d")) < 0 else "#2ecc71")
            else:
                colors.append("#95a5a6")

        charts["effect_sizes"] = {
            "data": [{
                "type": "bar",
                "x": conds,
                "y": ds,
                "marker": {"color": colors},
                "text": [f"d={d:+.2f}" for d in ds],
                "textposition": "auto",
            }],
            "layout": {
                "title": "Effect Sizes vs Baseline (Cohen's d)",
                "yaxis": {"title": "Cohen's d"},
                "xaxis": {"tickangle": -30},
                "margin": {"b": 120},
                "shapes": [{
                    "type": "line", "y0": 0, "y1": 0,
                    "x0": -0.5, "x1": len(conds) - 0.5,
                    "line": {"color": "black", "width": 1, "dash": "dot"},
                }],
            },
        }

    # 4. Cost vs quality scatter
    cost_data = results.get("cost", {}).get("per_condition", [])
    if cost_data and matrix:
        mean_lookup = {r["condition"]: _safe_float(r.get("composite_mean")) for r in matrix}
        scatter_conditions = [c.get("condition", "") for c in cost_data if c.get("condition") in mean_lookup]
        costs = [_safe_float(c.get("mean_cost_usd")) for c in cost_data if c.get("condition") in mean_lookup]
        qualities = [mean_lookup[c.get("condition", "")] for c in cost_data if c.get("condition") in mean_lookup]

        if scatter_conditions:
            charts["cost_quality"] = {
                "data": [{
                    "type": "scatter",
                    "mode": "markers+text",
                    "x": costs,
                    "y": qualities,
                    "text": scatter_conditions,
                    "textposition": "top center",
                    "marker": {"size": 12, "color": "#3498db"},
                }],
                "layout": {
                    "title": "Cost vs Quality",
                    "xaxis": {"title": "Mean Cost (USD)"},
                    "yaxis": {"title": "Composite Score"},
                },
            }

    return json.dumps(charts, default=str)


def _build_matrix_table(results: dict) -> str:
    """Build an HTML table for the harness comparison matrix."""
    matrix = results.get("harness_summary", {}).get("matrix", [])
    if not matrix:
        return "<p><em>No harness summary data available.</em></p>"

    rows_html = []
    for row in matrix:
        sig = " *" if row.get("lift_significant") else ""
        d_str = f"{row['cohens_d']:+.2f}" if row.get("cohens_d") is not None else "N/A"
        rows_html.append(
            f"<tr>"
            f"<td>{row.get('rank', '?')}</td>"
            f"<td><strong>{row['condition']}</strong></td>"
            f"<td>{row.get('composite_mean', 0):.1f}</td>"
            f"<td>{row.get('lift_vs_baseline', 0):+.1f}{sig}</td>"
            f"<td>{row.get('effect_size', 'N/A')}</td>"
            f"<td>{d_str}</td>"
            f"<td>${row.get('cost_usd', 0):.2f}</td>"
            f"<td>${row.get('cost_per_point', 0):.3f}</td>"
            f"</tr>"
        )

    return (
        '<table class="matrix-table">'
        "<thead><tr>"
        "<th>Rank</th><th>Condition</th><th>Mean</th><th>Lift</th>"
        "<th>Effect</th><th>d</th><th>Cost</th><th>$/pt</th>"
        "</tr></thead>"
        "<tbody>" + "".join(rows_html) + "</tbody></table>"
    )


def _build_recommendations(results: dict) -> str:
    """Build HTML for recommendations section."""
    recs = results.get("recommendations", {}).get("items", [])
    if not recs:
        return "<p><em>No recommendations generated.</em></p>"

    items = []
    for rec in recs:
        priority = rec.get("priority", "?")
        message = rec.get("message", "")
        cls = "high" if priority in ("high", "critical") else "normal"
        items.append(f'<li class="rec-{cls}"><strong>[{priority}]</strong> {message}</li>')

    return "<ul>" + "".join(items) + "</ul>"


_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Benchmark Analysis: {run_id}</title>
<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         max-width: 1200px; margin: 0 auto; padding: 20px; background: #f8f9fa; color: #333; }}
  h1 {{ color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }}
  h2 {{ color: #34495e; margin-top: 40px; }}
  .headline {{ background: #eaf2f8; border-left: 4px solid #3498db;
               padding: 15px; margin: 20px 0; font-size: 1.1em; }}
  .meta {{ background: white; padding: 15px; border-radius: 8px;
           box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }}
  .meta span {{ margin-right: 20px; }}
  .chart {{ background: white; padding: 20px; border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 20px 0; }}
  .matrix-table {{ width: 100%; border-collapse: collapse; background: white;
                   box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-radius: 8px; }}
  .matrix-table th {{ background: #34495e; color: white; padding: 10px 12px;
                      text-align: left; }}
  .matrix-table td {{ padding: 8px 12px; border-bottom: 1px solid #eee; }}
  .matrix-table tr:hover {{ background: #f0f7ff; }}
  ul {{ list-style: none; padding: 0; }}
  ul li {{ padding: 8px 12px; margin: 4px 0; background: white;
           border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }}
  .rec-high {{ border-left: 4px solid #e74c3c; }}
  .rec-normal {{ border-left: 4px solid #f39c12; }}
  footer {{ margin-top: 60px; padding-top: 20px; border-top: 1px solid #ddd;
            color: #999; font-size: 0.85em; }}
</style>
</head>
<body>

<h1>Benchmark Analysis Report</h1>

<div class="meta">
  <span><strong>Run:</strong> {run_id}</span>
  <span><strong>Time:</strong> {timestamp}</span>
  <span><strong>Status:</strong> {status}</span><br>
  <span><strong>Scenarios:</strong> {scenarios}</span><br>
  <span><strong>Conditions:</strong> {conditions}</span>
  <span><strong>Runs/pair:</strong> {runs_per_pair}</span>
</div>

<div class="headline">{headline}</div>

<h2>Harness Comparison Matrix</h2>
{matrix_table}

<h2>Composite Scores</h2>
<div class="chart" id="chart-composite"></div>

<h2>Scenario Heatmap</h2>
<div class="chart" id="chart-heatmap"></div>

<h2>Effect Sizes vs Baseline</h2>
<div class="chart" id="chart-effects"></div>

<h2>Cost vs Quality</h2>
<div class="chart" id="chart-cost"></div>

<h2>Recommendations</h2>
{recommendations}

<footer>Generated by benchmark-analysis</footer>

<script>
(function() {{
  var charts = {charts_json};
  var chartMap = {{
    "composite_bar": "chart-composite",
    "scenario_heatmap": "chart-heatmap",
    "effect_sizes": "chart-effects",
    "cost_quality": "chart-cost",
  }};
  for (var key in chartMap) {{
    var el = document.getElementById(chartMap[key]);
    if (charts[key]) {{
      Plotly.newPlot(el, charts[key].data, charts[key].layout, {{responsive: true}});
    }} else {{
      el.innerHTML = "<p style='color:#999;text-align:center'>No data available</p>";
    }}
  }}
}})();
</script>

</body>
</html>
"""
