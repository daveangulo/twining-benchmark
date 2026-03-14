"""Tests for scorer diagnostics analyzer."""
from tests.conftest import make_scored_result, make_score
from benchmark_analysis.dimensions.scorer_diagnostics import analyze_scorers


def test_detects_ceiling_effect():
    scores = [
        make_scored_result(
            condition="baseline", iteration=i,
            scores={"dim_a": make_score(97), "dim_b": make_score(50)},
        )
        for i in range(6)
    ]
    result = analyze_scorers(scores)
    ceiling_dims = [e["dimension"] for e in result["ceiling_effects"]]
    assert "dim_a" in ceiling_dims
    assert "dim_b" not in ceiling_dims


def test_detects_zero_variance():
    scores = [
        make_scored_result(
            condition="baseline", iteration=i,
            scores={"constant_dim": make_score(50.0)},
        )
        for i in range(6)
    ]
    result = analyze_scorers(scores)
    zero_dims = [e["dimension"] for e in result["zero_variance"]]
    assert "constant_dim" in zero_dims


def test_detects_non_discriminating():
    scores = []
    for cond in ["baseline", "treatment"]:
        for i in range(3):
            scores.append(make_scored_result(
                condition=cond, iteration=i,
                scores={"flat_dim": make_score(50.0)},
            ))
    result = analyze_scorers(scores)
    non_disc = [e["dimension"] for e in result["non_discriminating"]]
    assert "flat_dim" in non_disc


def test_detects_floor_effect():
    scores = [
        make_scored_result(
            condition="baseline", iteration=i,
            scores={"low_dim": make_score(5.0)},
        )
        for i in range(6)
    ]
    result = analyze_scorers(scores)
    floor_dims = [e["dimension"] for e in result["floor_effects"]]
    assert "low_dim" in floor_dims
