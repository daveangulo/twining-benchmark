"""Cost and token efficiency analysis."""
from __future__ import annotations
from ..models import ScoredResult


def analyze_cost(scores: list[ScoredResult], baseline: str = "baseline") -> dict:
    """Analyze cost efficiency across conditions.

    Returns dict with:
      - per_condition: mean cost, cost per composite point for each condition
      - vs_baseline: marginal cost per point gained over baseline
      - token_efficiency: tokens per composite point, cache hit ratios
      - per_scenario: cost breakdown by scenario x condition
    """
    from collections import defaultdict
    import numpy as np

    by_condition = defaultdict(list)
    by_scenario_condition = defaultdict(list)
    for s in scores:
        by_condition[s.condition].append(s)
        by_scenario_condition[(s.scenario, s.condition)].append(s)

    # Per-condition summary
    per_condition = []
    baseline_mean_composite = 0.0
    baseline_mean_cost = 0.0
    for condition, items in sorted(by_condition.items()):
        composites = [s.composite for s in items]
        costs = [s.metrics.costUsd for s in items]
        mean_composite = float(np.mean(composites))
        mean_cost = float(np.mean(costs))
        if condition == baseline:
            baseline_mean_composite = mean_composite
            baseline_mean_cost = mean_cost
        per_condition.append({
            "condition": condition,
            "mean_cost_usd": round(mean_cost, 4),
            "mean_composite": round(mean_composite, 2),
            "cost_per_composite_point": round(mean_cost / max(mean_composite, 0.01), 4),
            "total_tokens_mean": int(np.mean([s.metrics.totalTokens for s in items])),
        })

    # Cost vs baseline
    vs_baseline = []
    for entry in per_condition:
        if entry["condition"] == baseline:
            continue
        delta_points = entry["mean_composite"] - baseline_mean_composite
        delta_cost = entry["mean_cost_usd"] - baseline_mean_cost
        vs_baseline.append({
            "condition": entry["condition"],
            "delta_composite": round(delta_points, 2),
            "delta_cost_usd": round(delta_cost, 4),
            "marginal_cost_per_point_gained": round(delta_cost / max(abs(delta_points), 0.01), 4),
        })

    # Token efficiency
    token_efficiency = []
    for condition, items in sorted(by_condition.items()):
        total_tokens = [s.metrics.totalTokens for s in items]
        cache_reads = [s.metrics.cacheReadTokens for s in items]
        composites = [s.composite for s in items]
        token_efficiency.append({
            "condition": condition,
            "tokens_per_composite_point": int(np.mean(total_tokens) / max(np.mean(composites), 0.01)),
            "cache_hit_ratio": round(float(np.mean(cache_reads)) / max(float(np.mean(total_tokens)), 1), 3),
        })

    return {
        "per_condition": per_condition,
        "vs_baseline": vs_baseline,
        "token_efficiency": token_efficiency,
    }
