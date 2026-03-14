"""Tests for harness comparison summary matrix."""
import pytest
from benchmark_analysis.dimensions.harness_summary import generate_harness_summary


def test_summary_matrix(sample_scores):
    # Simulate a minimal all_results dict
    all_results = {
        "scoring": {"condition_rankings": [
            {"rank": 1, "condition": "full-twining", "mean": 90},
            {"rank": 2, "condition": "baseline", "mean": 75},
        ]},
        "coordination_lift": {"pairwise_lift": [
            {"condition": "full-twining", "baseline": "baseline",
             "lift_points": 15, "significant": True, "cohens_d": 1.2, "interpretation": "large"},
        ]},
        "cost": {"per_condition": [
            {"condition": "full-twining", "mean_cost_usd": 2.0, "cost_per_composite_point": 0.022},
            {"condition": "baseline", "mean_cost_usd": 1.0, "cost_per_composite_point": 0.013},
        ]},
        "interactions": {"best_scenario_for_coordination": [], "worst_scenario_for_coordination": []},
    }
    result = generate_harness_summary(all_results)
    assert "matrix" in result
    assert len(result["matrix"]) >= 2
    for row in result["matrix"]:
        assert "condition" in row
        assert "composite_mean" in row
        assert "lift_vs_baseline" in row
        assert "cost_usd" in row


def test_summary_includes_all_conditions(sample_scores):
    all_results = {
        "scoring": {"condition_rankings": [
            {"rank": i + 1, "condition": c, "mean": 75 + i * 2}
            for i, c in enumerate(["baseline", "claude-md-only", "shared-markdown",
                                    "file-reload-generic", "file-reload-structured",
                                    "persistent-history", "twining-lite", "full-twining"])
        ]},
        "coordination_lift": {"pairwise_lift": []},
        "cost": {"per_condition": []},
        "interactions": {"best_scenario_for_coordination": [], "worst_scenario_for_coordination": []},
    }
    result = generate_harness_summary(all_results)
    assert len(result["matrix"]) == 8
