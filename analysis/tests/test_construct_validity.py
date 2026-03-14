"""Tests for construct validity analyzer."""
import pytest
from tests.conftest import make_scored_result, make_score
from benchmark_analysis.dimensions.construct_validity import analyze_construct_validity


def test_dimension_intercorrelation(sample_scores):
    result = analyze_construct_validity(sample_scores)
    assert "dimension_correlations" in result
    for entry in result["dimension_correlations"]:
        assert "dim_a" in entry
        assert "dim_b" in entry
        assert "pearson_r" in entry


def test_score_consistency():
    """Same scenario x condition across iterations should be reasonably consistent."""
    scores = [
        make_scored_result(iteration=0, composite=80, scores={
            "completion": make_score(90), "consistency": make_score(70)}),
        make_scored_result(iteration=1, composite=82, scores={
            "completion": make_score(92), "consistency": make_score(72)}),
        make_scored_result(iteration=2, composite=78, scores={
            "completion": make_score(88), "consistency": make_score(68)}),
    ]
    result = analyze_construct_validity(scores)
    assert "internal_consistency" in result
    # Low variance across iterations = good consistency
    for entry in result["internal_consistency"]:
        assert entry["cv_pct"] < 20


def test_confidence_distribution(sample_scores):
    result = analyze_construct_validity(sample_scores)
    assert "confidence_distribution" in result
