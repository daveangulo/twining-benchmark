"""Tests for behavior-outcome correlation analyzer."""
import pytest
from tests.conftest import make_scored_result, make_transcript, make_tool_call
from benchmark_analysis.dimensions.behavior_outcome import analyze_behavior_outcome


def test_correlations_computed(sample_scores):
    # Need transcripts covering at least 4 unique (scenario, condition) cells
    # because outcomes are aggregated per cell and MIN_CORRELATION_N == 4.
    transcripts = [
        make_transcript(scenario="refactoring-handoff", condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("Read")] * 5,
                       cost=2.0),
        make_transcript(scenario="refactoring-handoff", condition="baseline",
                       tool_calls=[make_tool_call("Read")] * 10,
                       cost=1.0),
        make_transcript(scenario="architecture-cascade", condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("Read")] * 3,
                       cost=1.5),
        make_transcript(scenario="architecture-cascade", condition="baseline",
                       tool_calls=[make_tool_call("Read")] * 8,
                       cost=0.8),
        make_transcript(scenario="refactoring-handoff", condition="twining-lite",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("Read")] * 2,
                       cost=1.2),
        make_transcript(scenario="architecture-cascade", condition="twining-lite",
                       tool_calls=[make_tool_call("twining_assemble")] * 2 + [make_tool_call("Read")] * 4,
                       cost=1.1),
    ]
    result = analyze_behavior_outcome(sample_scores, transcripts)
    assert "correlations" in result
    assert len(result["correlations"]) > 0
    for c in result["correlations"]:
        assert "behavior_metric" in c
        assert "outcome_metric" in c
        assert "spearman_r" in c
        assert -1 <= c["spearman_r"] <= 1


def test_predictive_behaviors(sample_scores):
    transcripts = [
        make_transcript(scenario=s, condition=c,
                       tool_calls=[make_tool_call("twining_assemble")] * (10 if c == "full-twining" else 0))
        for s in ["refactoring-handoff", "architecture-cascade"]
        for c in ["baseline", "full-twining"]
        for _ in range(3)
    ]
    result = analyze_behavior_outcome(sample_scores, transcripts)
    assert "correlated_behaviors" in result
    assert "uncorrelated_behaviors" in result
