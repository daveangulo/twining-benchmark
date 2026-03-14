"""Tests for cost efficiency analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.cost import analyze_cost


def test_cost_per_point(sample_scores):
    result = analyze_cost(sample_scores)
    assert "per_condition" in result
    for entry in result["per_condition"]:
        assert "condition" in entry
        assert "mean_cost_usd" in entry
        assert "cost_per_composite_point" in entry
    # full-twining and baseline have different composites (and now different costs),
    # so cost_per_composite_point must differ
    by_cond = {e["condition"]: e for e in result["per_condition"]}
    assert by_cond["full-twining"]["cost_per_composite_point"] != by_cond["baseline"]["cost_per_composite_point"]


def test_cost_vs_baseline(sample_scores):
    result = analyze_cost(sample_scores)
    assert "vs_baseline" in result
    for entry in result["vs_baseline"]:
        assert "condition" in entry
        assert "marginal_cost_per_point_gained" in entry


def test_token_efficiency(sample_scores):
    result = analyze_cost(sample_scores)
    assert "token_efficiency" in result
    for entry in result["token_efficiency"]:
        assert "condition" in entry
        assert "tokens_per_composite_point" in entry
        assert "cache_hit_ratio" in entry


def test_baseline_not_in_vs_baseline(sample_scores):
    result = analyze_cost(sample_scores)
    conditions_in_vs = [e["condition"] for e in result["vs_baseline"]]
    assert "baseline" not in conditions_in_vs


def test_cost_with_custom_baseline():
    scores = [
        make_scored_result(condition="control", composite=70, costUsd=1.0),
        make_scored_result(condition="treatment", composite=90, costUsd=2.0),
    ]
    result = analyze_cost(scores, baseline="control")
    assert len(result["vs_baseline"]) == 1
    assert result["vs_baseline"][0]["condition"] == "treatment"
    assert result["vs_baseline"][0]["delta_composite"] == 20.0
