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


def test_non_coordination_conditions_skip_engagement_check():
    """baseline and shared-markdown should not get flagged for low Twining engagement."""
    all_results = {
        "coordination": {
            "per_condition": [
                {"condition": "baseline", "engagement_rate": 0.0},
                {"condition": "shared-markdown", "engagement_rate": 0.0},
                {"condition": "claude-md-only", "engagement_rate": 0.0},
                {"condition": "full-twining", "engagement_rate": 0.3},
            ]
        }
    }
    result = synthesize_recommendations(all_results)
    coord_items = [i for i in result["items"] if i["category"] == "coordination" and "engagement" in i["message"].lower()]
    # Only full-twining should be flagged
    assert len(coord_items) == 1
    assert "full-twining" in coord_items[0]["message"]
    assert "baseline" not in coord_items[0]["message"]
    assert "shared-markdown" not in coord_items[0]["message"]


def test_underpowered_large_effect_produces_medium_not_high():
    """When lift is not significant but effect is large and underpowered, produce medium priority."""
    all_results = {
        "coordination_lift": {
            "summary": {"overall_lift_significant": False},
        },
        "reliability": {
            "power_analysis": [
                {
                    "comparison": "baseline vs full-twining",
                    "cohens_d": 0.94,
                    "mdes": 1.2,
                    "observed_power": 0.45,
                    "n_per_group": 10,
                }
            ],
        },
    }
    result = synthesize_recommendations(all_results)
    lift_items = [i for i in result["items"] if i["category"] == "coordination-lift"]
    assert len(lift_items) == 1
    assert lift_items[0]["priority"] == "medium"
    assert "underpowered" in lift_items[0]["message"]
    assert "coordination problem" not in lift_items[0]["message"].lower() or "not a coordination problem" in lift_items[0]["message"]


def test_no_effect_lift_produces_high():
    """When lift is not significant and no large effects, produce high priority warning."""
    all_results = {
        "coordination_lift": {
            "summary": {"overall_lift_significant": False},
        },
        "reliability": {
            "power_analysis": [
                {
                    "comparison": "baseline vs full-twining",
                    "cohens_d": 0.2,
                    "mdes": 0.8,
                    "observed_power": 0.2,
                    "n_per_group": 10,
                }
            ],
        },
    }
    result = synthesize_recommendations(all_results)
    lift_items = [i for i in result["items"] if i["category"] == "coordination-lift"]
    assert len(lift_items) == 1
    assert lift_items[0]["priority"] == "high"
    assert "No statistically significant" in lift_items[0]["message"]


def test_mdes_based_design_recommendation():
    """Recommendations use MDES-based messaging, not 'need N runs'."""
    all_results = {
        "reliability": {
            "power_analysis": [
                {"comparison": "baseline vs treatment", "observed_power": 0.3,
                 "cohens_d": 0.15, "mdes": 0.82,
                 "recommended_n": 20, "n_per_group": 12, "underpowered": True},
            ],
            "design_guidance": {
                "current_n_per_condition": 12,
                "current_mdes": 1.2,
                "n_scenarios": 4,
                "iterations_per_pair": 3,
                "at_5_iterations": {
                    "n_per_condition": 20,
                    "mdes": 0.82,
                    "note": "Going from 3→5 iterations costs ~66% more",
                },
            },
        }
    }
    result = synthesize_recommendations(all_results)
    assert len(result["items"]) >= 1
    # Should produce MDES-based design recommendation, not "need N runs"
    messages = " ".join(item["message"] for item in result["items"])
    assert "MDES" in messages or "detectable" in messages or "iterations" in messages
    # Should NOT produce old "Underpowered: need X runs" message
    assert "need 20 runs per group" not in messages
