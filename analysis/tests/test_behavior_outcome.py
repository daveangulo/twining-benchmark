"""Tests for behavior-outcome correlation analyzer."""
import pytest
from tests.conftest import make_scored_result, make_transcript, make_tool_call
from benchmark_analysis.dimensions.behavior_outcome import analyze_behavior_outcome


def test_correlations_computed(sample_scores):
    transcripts = [
        make_transcript(scenario="refactoring-handoff", condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("Read")] * 5,
                       cost=2.0),
        make_transcript(scenario="refactoring-handoff", condition="baseline",
                       tool_calls=[make_tool_call("Read")] * 10,
                       cost=1.0),
    ]
    result = analyze_behavior_outcome(sample_scores, transcripts)
    assert "correlations" in result
    assert len(result["correlations"]) > 0
    for c in result["correlations"]:
        assert "behavior_metric" in c
        assert "outcome_metric" in c
        assert "pearson_r" in c
        assert -1 <= c["pearson_r"] <= 1


def test_predictive_behaviors(sample_scores):
    transcripts = [
        make_transcript(scenario=s, condition=c,
                       tool_calls=[make_tool_call("twining_assemble")] * (10 if c == "full-twining" else 0))
        for s in ["refactoring-handoff", "architecture-cascade"]
        for c in ["baseline", "full-twining"]
        for _ in range(3)
    ]
    result = analyze_behavior_outcome(sample_scores, transcripts)
    assert "predictive_behaviors" in result
    assert "non_predictive_behaviors" in result
