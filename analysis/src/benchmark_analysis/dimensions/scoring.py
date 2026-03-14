"""Scoring dimension analyzer: composite score distributions, condition rankings, per-dimension breakdowns."""
from __future__ import annotations

from collections import defaultdict

import numpy as np

from benchmark_analysis.models import DimensionAnalysis, ScoredResult
from benchmark_analysis.stats import bootstrap_ci, condition_summary


def analyze_scoring(scores: list[ScoredResult]) -> dict:
    """Analyze scoring data: group by scenario×condition, compute statistics, rank conditions.

    Returns a dict matching DimensionAnalysis shape with:
      - condition_rankings: list of conditions sorted by overall mean composite (descending)
      - per_scenario: per-scenario breakdown with condition stats
      - dimension_breakdown: per-scenario × per-dimension stats with ceiling/variance flags
    """
    # --- Group composites by (scenario, condition) ---
    # key: (scenario, condition) -> list of composite values
    grouped: dict[tuple[str, str], list[float]] = defaultdict(list)
    # key: (scenario, condition, dim) -> list of dim values
    dim_grouped: dict[tuple[str, str, str], list[float]] = defaultdict(list)

    scenarios: set[str] = set()
    conditions: set[str] = set()

    for sr in scores:
        key = (sr.scenario, sr.condition)
        grouped[key].append(sr.composite)
        scenarios.add(sr.scenario)
        conditions.add(sr.condition)
        for dim, ds in sr.scores.items():
            dim_grouped[(sr.scenario, sr.condition, dim)].append(ds.value)

    # --- Compute per-condition overall stats (across all scenarios) ---
    overall_condition_composites: dict[str, list[float]] = defaultdict(list)
    for (scenario, condition), vals in grouped.items():
        overall_condition_composites[condition].extend(vals)

    condition_summaries = {
        cond: condition_summary(cond, vals)
        for cond, vals in overall_condition_composites.items()
    }

    # Rank conditions by overall mean composite, descending
    condition_rankings = sorted(
        [
            {
                "condition": cond,
                "rank": 0,  # will fill below
                "mean": s.mean,
                "std": s.std,
                "ci_lower": s.ci_lower,
                "ci_upper": s.ci_upper,
                "n": s.n,
            }
            for cond, s in condition_summaries.items()
        ],
        key=lambda x: x["mean"],
        reverse=True,
    )
    for rank_idx, entry in enumerate(condition_rankings, start=1):
        entry["rank"] = rank_idx

    # --- Per-scenario breakdown ---
    per_scenario: dict[str, dict] = {}
    for scenario in sorted(scenarios):
        scenario_conditions = {}
        for condition in sorted(conditions):
            vals = grouped.get((scenario, condition), [])
            if not vals:
                continue
            cs = condition_summary(condition, vals)
            scenario_conditions[condition] = {
                "mean": cs.mean,
                "std": cs.std,
                "ci_lower": cs.ci_lower,
                "ci_upper": cs.ci_upper,
                "median": cs.median,
                "n": cs.n,
            }

        # Rank conditions within this scenario
        ranked_within = sorted(
            scenario_conditions.keys(),
            key=lambda c: scenario_conditions[c]["mean"],
            reverse=True,
        )
        per_scenario[scenario] = {
            "conditions": scenario_conditions,
            "condition_ranking": ranked_within,
        }

    # --- Dimension breakdown per scenario ---
    dimension_breakdown: dict[str, dict] = {}
    for scenario in sorted(scenarios):
        # Collect all dimension names seen in this scenario
        dims_in_scenario: set[str] = set()
        for key in dim_grouped:
            if key[0] == scenario:
                dims_in_scenario.add(key[2])

        dim_stats: dict[str, dict] = {}
        for dim in sorted(dims_in_scenario):
            dim_by_condition: dict[str, dict] = {}
            for condition in sorted(conditions):
                vals = dim_grouped.get((scenario, condition, dim), [])
                if not vals:
                    continue
                arr = np.array(vals, dtype=float)
                mean = float(np.mean(arr))
                std = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
                cv = (std / mean * 100.0) if mean != 0 else 0.0

                ci_lower, ci_upper = (
                    bootstrap_ci(vals) if len(vals) >= 2 else (mean, mean)
                )

                dim_by_condition[condition] = {
                    "mean": mean,
                    "std": std,
                    "cv": cv,
                    "ci_lower": ci_lower,
                    "ci_upper": ci_upper,
                    "n": len(vals),
                }

            # Compute aggregate flags across all conditions for this dim+scenario
            all_means = [v["mean"] for v in dim_by_condition.values()]
            all_stds = [v["std"] for v in dim_by_condition.values()]
            all_cvs = [v["cv"] for v in dim_by_condition.values()]

            ceiling_effect = bool(
                all_means and np.mean(all_means) > 95 and np.mean(all_stds) < 2
            )
            high_variance = bool(all_cvs and np.mean(all_cvs) > 30)

            dim_stats[dim] = {
                "by_condition": dim_by_condition,
                "ceiling_effect": ceiling_effect,
                "high_variance": high_variance,
            }

        dimension_breakdown[scenario] = dim_stats

    details = {
        "condition_rankings": condition_rankings,
        "per_scenario": per_scenario,
        "dimension_breakdown": dimension_breakdown,
    }

    analysis = DimensionAnalysis(
        dimension="scoring",
        summary=(
            f"Analyzed {len(scores)} scored results across "
            f"{len(scenarios)} scenario(s) and {len(conditions)} condition(s). "
            f"Top condition: {condition_rankings[0]['condition']} "
            f"(mean={condition_rankings[0]['mean']:.1f})."
            if condition_rankings
            else "No data."
        ),
        details=details,
    )

    return analysis.model_dump()
