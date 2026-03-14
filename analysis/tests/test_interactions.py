"""Tests for scenario x condition interaction analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.interactions import analyze_interactions


def test_empty_scores():
    result = analyze_interactions([])
    assert result["matrix"] == []


def test_interaction_matrix(sample_scores):
    result = analyze_interactions(sample_scores)
    assert "matrix" in result
    assert len(result["matrix"]) > 0
    for entry in result["matrix"]:
        assert "scenario" in entry
        assert "condition" in entry
        assert "mean_composite" in entry


def test_disordinal_detection():
    """Detect when condition A beats B in scenario X but loses in scenario Y."""
    scores = [
        # Scenario 1: full-twining wins
        make_scored_result(scenario="refactoring-handoff", condition="baseline", composite=70),
        make_scored_result(scenario="refactoring-handoff", condition="full-twining", composite=90),
        # Scenario 2: full-twining loses (coordination overhead hurts simple task)
        make_scored_result(scenario="bug-investigation", condition="baseline", composite=85),
        make_scored_result(scenario="bug-investigation", condition="full-twining", composite=75),
    ]
    result = analyze_interactions(scores)
    assert "disordinal_interactions" in result
    assert len(result["disordinal_interactions"]) > 0


def test_scenario_characteristics():
    """Identify which scenario features predict coordination benefit."""
    result = analyze_interactions([
        make_scored_result(scenario="multi-session-build", condition="baseline", composite=60),
        make_scored_result(scenario="multi-session-build", condition="full-twining", composite=85),
        make_scored_result(scenario="bug-investigation", condition="baseline", composite=80),
        make_scored_result(scenario="bug-investigation", condition="full-twining", composite=82),
    ])
    assert "best_scenario_for_coordination" in result
