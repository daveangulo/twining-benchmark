"""Tests for coordination lift analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.coordination_lift import analyze_coordination_lift


def test_empty_scores():
    result = analyze_coordination_lift([])
    assert result["pairwise_lift"] == []
    assert result["summary"] == {} or result["summary"].get("overall_lift_significant") is None


def test_lift_computed(sample_scores):
    result = analyze_coordination_lift(sample_scores)
    assert "pairwise_lift" in result
    # Should have comparisons for each coordinated condition vs baseline
    coordinated = [e for e in result["pairwise_lift"] if e["baseline"] == "baseline"]
    assert len(coordinated) > 0


def test_lift_direction(sample_scores):
    """Higher-scoring conditions should show positive lift."""
    result = analyze_coordination_lift(sample_scores)
    for entry in result["pairwise_lift"]:
        if entry["condition"] == "full-twining" and entry["baseline"] == "baseline":
            assert entry["lift_points"] > 0
            # full-twining base 90 - baseline base 75 = 15 points
            assert entry["lift_points"] == pytest.approx(15.0, abs=0.1)


def test_lift_per_scenario(sample_scores):
    result = analyze_coordination_lift(sample_scores)
    assert "per_scenario" in result
    for entry in result["per_scenario"]:
        assert "scenario" in entry
        assert "best_condition" in entry
        assert "lift_vs_baseline" in entry


def test_lift_summary(sample_scores):
    result = analyze_coordination_lift(sample_scores)
    assert "summary" in result
    assert "overall_lift_significant" in result["summary"]
    assert "best_coordinated_condition" in result["summary"]
