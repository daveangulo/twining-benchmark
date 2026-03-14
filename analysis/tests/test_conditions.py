"""Tests for the conditions dimension analyzer."""
import pytest
from benchmark_analysis.dimensions.conditions import analyze_conditions
from benchmark_analysis.models import ScoredResult, DimensionAnalysis


# ── Basic structure ──────────────────────────────────────────────────────────

def test_analyze_conditions_returns_dimension_analysis(sample_scores):
    result = analyze_conditions(sample_scores)
    assert isinstance(result, DimensionAnalysis)
    assert result.dimension == "conditions"


def test_analyze_conditions_has_required_keys(sample_scores):
    result = analyze_conditions(sample_scores)
    assert "effect_sizes" in result.details
    assert "condition_summaries" in result.details
    assert "rope_results" in result.details


# ── Effect sizes ─────────────────────────────────────────────────────────────

def test_effect_sizes_are_all_pairwise(sample_scores):
    """With 8 conditions there are C(8,2) = 28 pairwise comparisons."""
    result = analyze_conditions(sample_scores)
    effect_sizes = result.details["effect_sizes"]
    assert len(effect_sizes) == 28  # C(8,2)


def test_effect_sizes_have_required_fields(sample_scores):
    result = analyze_conditions(sample_scores)
    es = result.details["effect_sizes"][0]
    required = {
        "condition_a", "condition_b", "metric", "cohens_d",
        "interpretation", "p_value", "p_value_corrected", "significant",
        "mean_a", "mean_b", "delta",
    }
    assert required.issubset(es.keys())


def test_effect_sizes_metric_is_composite(sample_scores):
    result = analyze_conditions(sample_scores)
    for es in result.details["effect_sizes"]:
        assert es["metric"] == "composite"


def test_effect_sizes_holm_bonferroni_corrected_p_gte_raw(sample_scores):
    """Corrected p-values should be >= raw p-values (corrections inflate)."""
    result = analyze_conditions(sample_scores)
    for es in result.details["effect_sizes"]:
        assert es["p_value_corrected"] >= es["p_value"] - 1e-9


def test_effect_sizes_interpretation_values(sample_scores):
    valid = {"negligible", "small", "medium", "large"}
    result = analyze_conditions(sample_scores)
    for es in result.details["effect_sizes"]:
        assert es["interpretation"] in valid


def test_effect_sizes_direction(sample_scores):
    """full-twining (90) vs baseline (75) should have positive Cohen's d."""
    result = analyze_conditions(sample_scores)
    relevant = [
        e for e in result.details["effect_sizes"]
        if (e["condition_a"] == "baseline" and e["condition_b"] == "full-twining") or
           (e["condition_a"] == "full-twining" and e["condition_b"] == "baseline")
    ]
    assert len(relevant) == 1
    es = relevant[0]
    # baseline is condition_a, full-twining is condition_b → delta > 0
    if es["condition_a"] == "baseline":
        assert es["delta"] > 0
    else:
        assert es["delta"] < 0


# ── Condition summaries ──────────────────────────────────────────────────────

def test_condition_summaries_count(sample_scores):
    """Should have one summary per unique condition (8)."""
    result = analyze_conditions(sample_scores)
    summaries = result.details["condition_summaries"]
    assert len(summaries) == 8


def test_condition_summaries_have_ci(sample_scores):
    result = analyze_conditions(sample_scores)
    for s in result.details["condition_summaries"]:
        assert "ci_lower" in s
        assert "ci_upper" in s
        assert s["ci_lower"] <= s["mean"] <= s["ci_upper"]


def test_condition_summaries_n(sample_scores):
    """Each condition has 3 iterations × 2 scenarios = 6 scores."""
    result = analyze_conditions(sample_scores)
    for s in result.details["condition_summaries"]:
        assert s["n"] == 6


# ── ROPE results ─────────────────────────────────────────────────────────────

def test_rope_results_count(sample_scores):
    """One ROPE entry per pair = 28."""
    result = analyze_conditions(sample_scores)
    assert len(result.details["rope_results"]) == 28


def test_rope_results_decision_values(sample_scores):
    valid = {"equivalent", "different", "undecided"}
    result = analyze_conditions(sample_scores)
    for entry in result.details["rope_results"].values():
        assert entry["decision"] in valid


def test_rope_results_probabilities_sum(sample_scores):
    """prob_equivalent + prob_different should equal 1.0."""
    result = analyze_conditions(sample_scores)
    for entry in result.details["rope_results"].values():
        total = entry["prob_equivalent"] + entry["prob_different"]
        assert abs(total - 1.0) < 1e-9


def test_rope_results_have_power_info(sample_scores):
    result = analyze_conditions(sample_scores)
    for entry in result.details["rope_results"].values():
        assert "power" in entry
        p = entry["power"]
        assert "observed_power" in p
        assert "required_n_for_0_8_power" in p
        assert "n_per_group" in p
        assert 0.0 <= p["observed_power"] <= 1.0


def test_rope_equivalent_when_means_close():
    """Conditions with nearly identical scores should be equivalent within ROPE (-5, 5)."""
    from tests.conftest import make_scored_result
    scores = (
        [make_scored_result(condition="a", iteration=i, composite=80.0) for i in range(5)]
        + [make_scored_result(condition="b", iteration=i, composite=81.0) for i in range(5)]
    )
    result = analyze_conditions(scores, rope=(-5.0, 5.0))
    rope_res = result.details["rope_results"]["a|b"]
    assert rope_res["decision"] == "equivalent"


# ── Edge cases ───────────────────────────────────────────────────────────────

def test_single_condition_returns_gracefully():
    from tests.conftest import make_scored_result
    scores = [make_scored_result(condition="only", iteration=i, composite=80.0) for i in range(3)]
    result = analyze_conditions(scores)
    assert result.dimension == "conditions"
    assert result.details["effect_sizes"] == []


def test_baseline_parameter_reflected_in_summary(sample_scores):
    result = analyze_conditions(sample_scores, baseline="full-twining")
    assert "full-twining" in result.summary


def test_two_conditions_produces_one_pair():
    from tests.conftest import make_scored_result
    scores = (
        [make_scored_result(condition="x", iteration=i, composite=70.0 + i) for i in range(3)]
        + [make_scored_result(condition="y", iteration=i, composite=85.0 + i) for i in range(3)]
    )
    result = analyze_conditions(scores)
    assert len(result.details["effect_sizes"]) == 1
    assert len(result.details["rope_results"]) == 1
