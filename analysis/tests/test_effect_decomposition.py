"""Tests for effect decomposition analyzer."""
import pytest
from tests.conftest import make_scored_result, make_transcript, make_tool_call
from benchmark_analysis.dimensions.effect_decomposition import analyze_effect_decomposition


def test_mechanism_attribution(sample_scores):
    transcripts = [
        make_transcript(scenario="refactoring-handoff", condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble")] * 5 + [make_tool_call("twining_add_entity")] * 3),
        make_transcript(scenario="refactoring-handoff", condition="twining-lite",
                       tool_calls=[make_tool_call("twining_assemble")] * 5),
        make_transcript(scenario="refactoring-handoff", condition="baseline",
                       tool_calls=[]),
    ]
    result = analyze_effect_decomposition(sample_scores, transcripts)
    assert "mechanism_attribution" in result
    for entry in result["mechanism_attribution"]:
        assert "mechanism" in entry
        assert "associated_difference" in entry


def test_tool_utilization(sample_scores):
    transcripts = [
        make_transcript(condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("twining_decide"),
                                   make_tool_call("twining_verify")]),
    ]
    result = analyze_effect_decomposition(sample_scores, transcripts)
    assert "tool_utilization" in result
    assert "never_called" in result["tool_utilization"]


def test_lite_vs_full_delta():
    """Identify what full-twining adds over twining-lite."""
    full_scores = [make_scored_result(condition="full-twining", composite=88 + i) for i in range(3)]
    lite_scores = [make_scored_result(condition="twining-lite", composite=90 + i) for i in range(3)]
    base_scores = [make_scored_result(condition="baseline", composite=75 + i) for i in range(3)]
    transcripts = [
        make_transcript(condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("twining_add_entity")] * 5),
        make_transcript(condition="twining-lite",
                       tool_calls=[make_tool_call("twining_assemble")] * 5),
        make_transcript(condition="baseline", tool_calls=[]),
    ]
    result = analyze_effect_decomposition(full_scores + lite_scores + base_scores, transcripts)
    assert "lite_vs_full" in result
