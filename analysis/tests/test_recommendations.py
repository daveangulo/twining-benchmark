"""Tests for recommendation synthesizer."""
from benchmark_analysis.dimensions.recommendations import synthesize_recommendations


def test_empty_input_returns_empty():
    result = synthesize_recommendations({})
    assert result["items"] == []


def test_low_engagement_generates_high_priority():
    all_results = {
        "coordination": {
            "per_condition": [
                {"condition": "full-twining", "engagement_rate": 0.3},
            ]
        }
    }
    result = synthesize_recommendations(all_results)
    assert len(result["items"]) >= 1
    assert result["items"][0]["priority"] == "high"
    assert result["items"][0]["category"] == "coordination"


def test_zero_variance_scorer_generates_recommendation():
    all_results = {
        "scorer_diagnostics": {
            "zero_variance": [
                {"dimension": "broken_dim", "mean": 50.0, "std": 0.0},
            ],
            "non_discriminating": [],
        }
    }
    result = synthesize_recommendations(all_results)
    assert len(result["items"]) >= 1
    assert any("broken_dim" in item["message"] for item in result["items"])


def test_priority_sorting():
    all_results = {
        "scorer_diagnostics": {
            "zero_variance": [{"dimension": "d1", "mean": 50.0, "std": 0.0}],
            "non_discriminating": [{"dimension": "d2", "spread": 2.0}],
        }
    }
    result = synthesize_recommendations(all_results)
    priorities = [item["priority"] for item in result["items"]]
    assert priorities == sorted(priorities, key=lambda p: {"high": 0, "medium": 1, "low": 2}[p])


def test_underpowered_comparison():
    all_results = {
        "reliability": {
            "power_analysis": [
                {"comparison": "baseline vs treatment", "observed_power": 0.3,
                 "recommended_n": 20, "n_per_group": 3, "underpowered": True},
            ]
        }
    }
    result = synthesize_recommendations(all_results)
    assert len(result["items"]) >= 1
    assert result["items"][0]["priority"] == "high"
    assert "Underpowered" in result["items"][0]["message"]
