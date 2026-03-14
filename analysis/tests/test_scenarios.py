"""Tests for the scenarios dimension analyzer."""
import pytest
from benchmark_analysis.dimensions.scenarios import analyze_scenarios
from tests.conftest import make_scored_result, make_score


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_scores(scenario_condition_values: dict[tuple[str, str], list[float]]) -> list:
    """Build ScoredResult list from {(scenario, condition): [composites]}."""
    results = []
    for (scenario, condition), values in scenario_condition_values.items():
        for i, v in enumerate(values):
            results.append(make_scored_result(
                scenario=scenario, condition=condition,
                iteration=i, composite=v,
            ))
    return results


# ---------------------------------------------------------------------------
# Basic structure
# ---------------------------------------------------------------------------

def test_analyze_scenarios_returns_expected_keys(sample_scores):
    result = analyze_scenarios(sample_scores)
    assert "discriminating_scenarios" in result
    assert "ceiling_effects" in result
    assert "floor_effects" in result
    assert "effect_sizes" in result
    assert "high_variance_pairs" in result
    assert "per_scenario" in result


def test_empty_scores_returns_empty_collections():
    result = analyze_scenarios([])
    assert result["discriminating_scenarios"] == []
    assert result["ceiling_effects"] == []
    assert result["floor_effects"] == []
    assert result["effect_sizes"] == []
    assert result["high_variance_pairs"] == []
    assert result["per_scenario"] == {}


# ---------------------------------------------------------------------------
# Discriminating scenarios
# ---------------------------------------------------------------------------

def test_discriminating_scenarios_sorted_by_spread():
    """Scenario with higher spread appears first."""
    scores = _make_scores({
        ("high-spread", "baseline"): [50.0, 50.0],
        ("high-spread", "full-twining"): [90.0, 90.0],
        ("low-spread", "baseline"): [70.0, 70.0],
        ("low-spread", "full-twining"): [75.0, 75.0],
    })
    result = analyze_scenarios(scores)
    names = [s["scenario"] for s in result["discriminating_scenarios"]]
    assert names[0] == "high-spread"
    assert names[1] == "low-spread"


def test_discriminating_scenarios_spread_value():
    """Spread equals max_condition_mean - min_condition_mean."""
    scores = _make_scores({
        ("s1", "baseline"): [60.0, 60.0],
        ("s1", "twining"): [80.0, 80.0],
    })
    result = analyze_scenarios(scores)
    ds = result["discriminating_scenarios"]
    assert len(ds) == 1
    assert ds[0]["scenario"] == "s1"
    assert abs(ds[0]["spread"] - 20.0) < 1e-9


def test_discriminating_scenarios_contains_condition_means(sample_scores):
    result = analyze_scenarios(sample_scores)
    for entry in result["discriminating_scenarios"]:
        assert "condition_means" in entry
        assert len(entry["condition_means"]) > 0


# ---------------------------------------------------------------------------
# Ceiling effects
# ---------------------------------------------------------------------------

def test_ceiling_effect_detected():
    """mean > 95 and std < 3 triggers ceiling effect."""
    # Three identical values at 97 → mean=97, std=0
    scores = _make_scores({
        ("s1", "full-twining"): [97.0, 97.0, 97.0],
        ("s1", "baseline"): [75.0, 80.0, 70.0],
    })
    result = analyze_scenarios(scores)
    flags = [(e["scenario"], e["condition"]) for e in result["ceiling_effects"]]
    assert ("s1", "full-twining") in flags
    assert ("s1", "baseline") not in flags


def test_ceiling_effect_high_std_not_flagged():
    """mean > 95 but std >= 3 should not be flagged."""
    scores = _make_scores({
        ("s1", "full-twining"): [90.0, 96.0, 100.0],  # mean=95.33, std=5.03
        ("s1", "baseline"): [70.0, 70.0, 70.0],
    })
    result = analyze_scenarios(scores)
    flags = [(e["scenario"], e["condition"]) for e in result["ceiling_effects"]]
    assert ("s1", "full-twining") not in flags


def test_no_ceiling_effects_when_means_normal(sample_scores):
    """Standard fixture has no ceiling effects (max mean ~93)."""
    result = analyze_scenarios(sample_scores)
    assert result["ceiling_effects"] == []


# ---------------------------------------------------------------------------
# Floor effects
# ---------------------------------------------------------------------------

def test_floor_effect_detected():
    """mean < 20 triggers floor effect."""
    scores = _make_scores({
        ("s1", "broken"): [10.0, 15.0, 12.0],
        ("s1", "baseline"): [75.0, 80.0, 70.0],
    })
    result = analyze_scenarios(scores)
    flags = [(e["scenario"], e["condition"]) for e in result["floor_effects"]]
    assert ("s1", "broken") in flags
    assert ("s1", "baseline") not in flags


def test_no_floor_effects_when_means_normal(sample_scores):
    """Standard fixture has no floor effects."""
    result = analyze_scenarios(sample_scores)
    assert result["floor_effects"] == []


# ---------------------------------------------------------------------------
# Effect sizes (best vs baseline)
# ---------------------------------------------------------------------------

def test_effect_sizes_present_for_each_scenario_with_baseline(sample_scores):
    result = analyze_scenarios(sample_scores)
    scenarios_in_data = {r.scenario for r in sample_scores}
    scenarios_with_effect = {e["scenario"] for e in result["effect_sizes"]}
    assert scenarios_with_effect == scenarios_in_data


def test_effect_size_structure():
    scores = _make_scores({
        ("s1", "baseline"): [70.0, 70.0, 70.0],
        ("s1", "full-twining"): [85.0, 85.0, 85.0],
    })
    result = analyze_scenarios(scores)
    assert len(result["effect_sizes"]) == 1
    es = result["effect_sizes"][0]
    assert es["scenario"] == "s1"
    assert es["best_condition"] == "full-twining"
    assert es["baseline"] == "baseline"
    assert "cohens_d" in es
    assert "interpretation" in es
    assert "mean_baseline" in es
    assert "mean_best" in es


def test_effect_size_best_condition_is_highest_mean():
    scores = _make_scores({
        ("s1", "baseline"): [60.0, 60.0],
        ("s1", "medium"): [75.0, 75.0],
        ("s1", "best"): [90.0, 90.0],
    })
    result = analyze_scenarios(scores)
    es = result["effect_sizes"][0]
    assert es["best_condition"] == "best"


def test_no_effect_size_without_baseline():
    """If no baseline condition, no effect size computed."""
    scores = _make_scores({
        ("s1", "condA"): [70.0, 70.0],
        ("s1", "condB"): [85.0, 85.0],
    })
    result = analyze_scenarios(scores, baseline="baseline")
    assert result["effect_sizes"] == []


# ---------------------------------------------------------------------------
# High-variance pairs (CV > 30%)
# ---------------------------------------------------------------------------

def test_high_variance_pair_detected():
    """CV > 30% should be flagged."""
    # mean=50, std=20 → CV=40%
    scores = _make_scores({
        ("s1", "volatile"): [30.0, 50.0, 70.0],  # mean=50, std≈20
        ("s1", "stable"): [75.0, 76.0, 74.0],   # mean=75, std≈1 → CV≈1.3%
    })
    result = analyze_scenarios(scores)
    flags = [(e["scenario"], e["condition"]) for e in result["high_variance_pairs"]]
    assert ("s1", "volatile") in flags
    assert ("s1", "stable") not in flags


def test_high_variance_pair_cv_value():
    """CV is reported and exceeds 30 for flagged entries."""
    scores = _make_scores({
        ("s1", "volatile"): [10.0, 90.0],  # mean=50, std≈56.6 → CV≈113%
    })
    result = analyze_scenarios(scores)
    assert len(result["high_variance_pairs"]) == 1
    assert result["high_variance_pairs"][0]["cv"] > 30


# ---------------------------------------------------------------------------
# Per-scenario detail
# ---------------------------------------------------------------------------

def test_per_scenario_keys(sample_scores):
    result = analyze_scenarios(sample_scores)
    for scenario in {r.scenario for r in sample_scores}:
        assert scenario in result["per_scenario"]
        entry = result["per_scenario"][scenario]
        assert "spread" in entry
        assert "condition_summaries" in entry
        assert "best_condition" in entry
        assert "worst_condition" in entry


def test_per_scenario_best_and_worst():
    scores = _make_scores({
        ("s1", "baseline"): [60.0, 60.0],
        ("s1", "medium"): [75.0, 75.0],
        ("s1", "best"): [90.0, 90.0],
    })
    result = analyze_scenarios(scores)
    entry = result["per_scenario"]["s1"]
    assert entry["best_condition"] == "best"
    assert entry["worst_condition"] == "baseline"


def test_per_scenario_condition_summaries_have_stats():
    scores = _make_scores({
        ("s1", "baseline"): [70.0, 80.0, 75.0],
    })
    result = analyze_scenarios(scores)
    summary = result["per_scenario"]["s1"]["condition_summaries"]["baseline"]
    assert "mean" in summary
    assert "std" in summary
    assert "n" in summary
    assert summary["n"] == 3
    assert abs(summary["mean"] - 75.0) < 1e-9


# ---------------------------------------------------------------------------
# Integration: sample_scores fixture
# ---------------------------------------------------------------------------

def test_analyze_scenarios_with_sample_fixture(sample_scores):
    """Full integration test using the shared 48-result fixture."""
    result = analyze_scenarios(sample_scores)
    ds = result["discriminating_scenarios"]
    # Both scenarios present
    scenario_names = {e["scenario"] for e in ds}
    assert "refactoring-handoff" in scenario_names
    assert "architecture-cascade" in scenario_names
    # Both have equal spread in the fixture (same base values, same structure)
    for entry in ds:
        assert entry["spread"] >= 0
    # Effect sizes for both scenarios
    assert len(result["effect_sizes"]) == 2
    # No anomalies in the clean fixture
    assert result["ceiling_effects"] == []
    assert result["floor_effects"] == []
