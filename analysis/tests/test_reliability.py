"""Tests for reliability analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.reliability import analyze_reliability


def test_variance_flags(sample_scores):
    result = analyze_reliability(sample_scores)
    assert "variance_flags" in result
    # No pair should have CV > 30% with our low-noise test data
    assert all(f["cv_pct"] < 30 for f in result["variance_flags"])


def test_power_analysis(sample_scores):
    result = analyze_reliability(sample_scores)
    assert "power_analysis" in result
    for entry in result["power_analysis"]:
        assert "comparison" in entry
        assert "observed_power" in entry
        assert "recommended_n" in entry
        assert 0 <= entry["observed_power"] <= 1


def test_sample_size_recommendations(sample_scores):
    result = analyze_reliability(sample_scores)
    assert "sample_size_recommendations" in result


def test_high_variance_flagged():
    """Test that high-variance data gets flagged."""
    scores = [
        make_scored_result(scenario="s1", condition="baseline", iteration=0, composite=10),
        make_scored_result(scenario="s1", condition="baseline", iteration=1, composite=90),
        make_scored_result(scenario="s1", condition="baseline", iteration=2, composite=50),
    ]
    result = analyze_reliability(scores)
    flags = [f for f in result["variance_flags"] if f["high_variance"]]
    assert len(flags) > 0
