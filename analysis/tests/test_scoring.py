"""Tests for the scoring dimension analyzer."""
import pytest
from benchmark_analysis.dimensions.scoring import analyze_scoring

# Import helper functions directly — they are plain functions, not fixtures
from tests.conftest import make_scored_result, make_score


class TestAnalyzeScoringReturnShape:
    """The return value must be a dict with the three required top-level keys."""

    def test_returns_dict(self, sample_scores):
        result = analyze_scoring(sample_scores)
        assert isinstance(result, dict)

    def test_has_required_top_level_keys(self, sample_scores):
        result = analyze_scoring(sample_scores)
        assert "condition_rankings" in result["details"]
        assert "per_scenario" in result["details"]
        assert "dimension_breakdown" in result["details"]

    def test_has_dimension_and_summary_fields(self, sample_scores):
        result = analyze_scoring(sample_scores)
        assert result["dimension"] == "scoring"
        assert isinstance(result["summary"], str)
        assert len(result["summary"]) > 0


class TestConditionRankings:
    """condition_rankings must be sorted by mean composite descending."""

    def test_rankings_sorted_descending(self, sample_scores):
        result = analyze_scoring(sample_scores)
        rankings = result["details"]["condition_rankings"]
        means = [r["mean"] for r in rankings]
        assert means == sorted(means, reverse=True)

    def test_all_conditions_present(self, sample_scores):
        result = analyze_scoring(sample_scores)
        ranked_conditions = {r["condition"] for r in result["details"]["condition_rankings"]}
        expected = {
            "baseline", "claude-md-only", "shared-markdown", "file-reload-generic",
            "file-reload-structured", "persistent-history", "twining-lite", "full-twining",
        }
        assert ranked_conditions == expected

    def test_ranking_entries_have_required_fields(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for entry in result["details"]["condition_rankings"]:
            assert "condition" in entry
            assert "rank" in entry
            assert "mean" in entry
            assert "std" in entry
            assert "ci_lower" in entry
            assert "ci_upper" in entry
            assert "n" in entry

    def test_rank_values_are_sequential(self, sample_scores):
        result = analyze_scoring(sample_scores)
        ranks = [r["rank"] for r in result["details"]["condition_rankings"]]
        assert ranks == list(range(1, len(ranks) + 1))

    def test_top_condition_is_full_twining(self, sample_scores):
        """full-twining has base 90, highest of all conditions."""
        result = analyze_scoring(sample_scores)
        top = result["details"]["condition_rankings"][0]
        assert top["condition"] == "full-twining"

    def test_bottom_condition_is_baseline(self, sample_scores):
        """baseline has base 75, lowest of all conditions."""
        result = analyze_scoring(sample_scores)
        bottom = result["details"]["condition_rankings"][-1]
        assert bottom["condition"] == "baseline"

    def test_ci_bounds_are_reasonable(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for entry in result["details"]["condition_rankings"]:
            assert entry["ci_lower"] <= entry["mean"] <= entry["ci_upper"]


class TestPerScenario:
    """per_scenario must contain a breakdown for each scenario."""

    def test_all_scenarios_present(self, sample_scores):
        result = analyze_scoring(sample_scores)
        per_scenario = result["details"]["per_scenario"]
        assert "refactoring-handoff" in per_scenario
        assert "architecture-cascade" in per_scenario

    def test_scenario_has_condition_ranking(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for scenario_data in result["details"]["per_scenario"].values():
            assert "condition_ranking" in scenario_data
            assert isinstance(scenario_data["condition_ranking"], list)

    def test_scenario_has_conditions_dict(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for scenario_data in result["details"]["per_scenario"].values():
            assert "conditions" in scenario_data
            assert isinstance(scenario_data["conditions"], dict)

    def test_per_scenario_condition_stats_fields(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for scenario_data in result["details"]["per_scenario"].values():
            for cond_stats in scenario_data["conditions"].values():
                assert "mean" in cond_stats
                assert "std" in cond_stats
                assert "ci_lower" in cond_stats
                assert "ci_upper" in cond_stats
                assert "n" in cond_stats

    def test_scenario_ranking_sorted_descending(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for scenario_data in result["details"]["per_scenario"].values():
            ranking = scenario_data["condition_ranking"]
            means = [scenario_data["conditions"][c]["mean"] for c in ranking]
            assert means == sorted(means, reverse=True)


class TestDimensionBreakdown:
    """dimension_breakdown must cover scenarios and dimensions with flags."""

    def test_all_scenarios_in_dimension_breakdown(self, sample_scores):
        result = analyze_scoring(sample_scores)
        dim_breakdown = result["details"]["dimension_breakdown"]
        assert "refactoring-handoff" in dim_breakdown
        assert "architecture-cascade" in dim_breakdown

    def test_dimensions_present(self, sample_scores):
        """conftest makes 'completion', 'consistency', 'rework' dimensions."""
        result = analyze_scoring(sample_scores)
        for scenario, dim_stats in result["details"]["dimension_breakdown"].items():
            assert "completion" in dim_stats
            assert "consistency" in dim_stats
            assert "rework" in dim_stats

    def test_dimension_has_flags(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for scenario, dim_stats in result["details"]["dimension_breakdown"].items():
            for dim, info in dim_stats.items():
                assert "ceiling_effect" in info
                assert "high_variance" in info
                assert isinstance(info["ceiling_effect"], bool)
                assert isinstance(info["high_variance"], bool)

    def test_dimension_has_by_condition(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for scenario, dim_stats in result["details"]["dimension_breakdown"].items():
            for dim, info in dim_stats.items():
                assert "by_condition" in info
                assert isinstance(info["by_condition"], dict)

    def test_by_condition_stats_fields(self, sample_scores):
        result = analyze_scoring(sample_scores)
        for scenario, dim_stats in result["details"]["dimension_breakdown"].items():
            for dim, info in dim_stats.items():
                for cond_stats in info["by_condition"].values():
                    assert "mean" in cond_stats
                    assert "std" in cond_stats
                    assert "cv" in cond_stats
                    assert "ci_lower" in cond_stats
                    assert "ci_upper" in cond_stats
                    assert "n" in cond_stats


class TestCeilingEffect:
    """Ceiling effect detected when mean > 95 and std < 2."""

    def test_ceiling_detected_for_high_score_low_variance(self):
        # All dimensions score 97 with zero variance — ceiling should be True
        scores_list = [
            make_scored_result(
                scenario="s1", condition="perfect",
                iteration=i, composite=97.0,
                scores={"metric": make_score(97.0)},
            )
            for i in range(5)
        ]
        result = analyze_scoring(scores_list)
        metric_info = result["details"]["dimension_breakdown"]["s1"]["metric"]
        assert metric_info["ceiling_effect"] is True

    def test_no_ceiling_for_moderate_scores(self, sample_scores):
        # "consistency" dimension is always 80 — not ceiling
        result = analyze_scoring(sample_scores)
        for scenario in ["refactoring-handoff", "architecture-cascade"]:
            info = result["details"]["dimension_breakdown"][scenario]["consistency"]
            assert info["ceiling_effect"] is False


class TestHighVariance:
    """High variance flagged when CV > 30%."""

    def test_high_variance_flagged(self):
        # High variance: values 10-90, mean ~50, std ~31.6 -> CV ~63%
        values = [10.0, 30.0, 50.0, 70.0, 90.0]
        scores_list = [
            make_scored_result(
                scenario="s1", condition="volatile",
                iteration=i, composite=values[i],
                scores={"unstable": make_score(values[i])},
            )
            for i in range(5)
        ]
        result = analyze_scoring(scores_list)
        dim_info = result["details"]["dimension_breakdown"]["s1"]["unstable"]
        assert dim_info["high_variance"] is True

    def test_low_variance_not_flagged(self, sample_scores):
        # sample_scores has noise of ±3 on base 80 for consistency -> CV ~3%
        result = analyze_scoring(sample_scores)
        for scenario in ["refactoring-handoff", "architecture-cascade"]:
            info = result["details"]["dimension_breakdown"][scenario]["consistency"]
            assert info["high_variance"] is False


class TestEmptyInput:
    """Empty input should not crash."""

    def test_empty_scores(self):
        result = analyze_scoring([])
        assert result is not None  # should not crash


class TestEdgeCases:
    """Edge cases: single score, single condition, single scenario."""

    def test_single_result(self):
        sr = make_scored_result(
            scenario="solo", condition="only",
            iteration=0, composite=70.0,
            scores={"dim": make_score(70.0)},
        )
        result = analyze_scoring([sr])
        assert result["details"]["condition_rankings"][0]["condition"] == "only"
        assert "solo" in result["details"]["per_scenario"]
        assert "solo" in result["details"]["dimension_breakdown"]

    def test_multiple_conditions_single_scenario(self):
        scores_list = [
            make_scored_result(scenario="sc", condition="a", iteration=0, composite=80.0),
            make_scored_result(scenario="sc", condition="b", iteration=0, composite=90.0),
        ]
        result = analyze_scoring(scores_list)
        rankings = result["details"]["condition_rankings"]
        assert rankings[0]["condition"] == "b"
        assert rankings[1]["condition"] == "a"

    def test_summary_mentions_top_condition(self, sample_scores):
        result = analyze_scoring(sample_scores)
        assert "full-twining" in result["summary"]
