"""Tests for learning curve / session-order analyzer."""
import pytest
from tests.conftest import make_transcript, make_tool_call
from benchmark_analysis.dimensions.learning_curve import analyze_learning_curve


def test_empty_transcripts():
    result = analyze_learning_curve([])
    assert result["per_scenario"] == []


def test_session_order_metrics():
    """Sessions later in sequence should show measurable trend data."""
    transcripts = [
        make_transcript(scenario="multi-session-build", condition="full-twining",
                       task_index=i, num_turns=20 + i * 5, cost=1.0 + i * 0.5,
                       tool_calls=[make_tool_call("twining_assemble")] * (i + 1))
        for i in range(5)
    ]
    result = analyze_learning_curve(transcripts)
    assert "per_scenario" in result
    msb = [s for s in result["per_scenario"] if s["scenario"] == "multi-session-build"]
    assert len(msb) > 0
    assert "session_trend" in msb[0]
    # Input has monotonically increasing turns and cost, so trends should be increasing
    assert msb[0]["trends"]["cost_trend"] == "increasing"
    assert msb[0]["trends"]["turns_trend"] == "increasing"


def test_coordination_value_over_sessions():
    """Track whether coordination becomes more/less valuable over sessions."""
    transcripts = []
    for i in range(4):
        # Coordinated condition uses more twining in later sessions
        transcripts.append(make_transcript(
            scenario="evolving-requirements", condition="full-twining",
            task_index=i, num_turns=15,
            tool_calls=[make_tool_call("twining_assemble")] * (i + 1) + [make_tool_call("Read")] * 10,
            cost=1.0 + i * 0.3))
        # Baseline has no coordination
        transcripts.append(make_transcript(
            scenario="evolving-requirements", condition="baseline",
            task_index=i, num_turns=20 + i * 3,
            tool_calls=[make_tool_call("Read")] * 10,
            cost=0.8 + i * 0.4))
    result = analyze_learning_curve(transcripts)
    assert "coordination_value_trend" in result


def test_compaction_impact():
    """Sessions with compaction should show detectable patterns."""
    transcripts = [
        make_transcript(task_index=0, num_turns=20),
        make_transcript(task_index=1, num_turns=40),  # no compaction
    ]
    # Manually set compaction on second
    transcripts[1].compactionCount = 2
    result = analyze_learning_curve(transcripts)
    assert "compaction_analysis" in result
