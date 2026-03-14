"""Tests for session-level deep dive analyzer."""
from tests.conftest import make_transcript, make_tool_call
from benchmark_analysis.dimensions.sessions import analyze_sessions


def test_per_session_breakdown():
    transcripts = [
        make_transcript(scenario="s1", condition="baseline", task_index=0),
        make_transcript(scenario="s1", condition="treatment", task_index=0),
    ]
    result = analyze_sessions(transcripts)
    assert len(result["per_session"]) == 2
    for entry in result["per_session"]:
        assert "session_id" in entry
        assert "cost_usd" in entry
        assert "duration_ms" in entry
        assert "total_tool_calls" in entry


def test_exit_reasons():
    transcripts = [
        make_transcript(scenario="s1", condition="baseline"),
        make_transcript(scenario="s1", condition="treatment"),
    ]
    result = analyze_sessions(transcripts)
    assert "exit_reasons" in result
    assert result["exit_reasons"]["completed"] == 2


def test_bottleneck_detection():
    transcripts = [
        make_transcript(scenario="s1", condition="baseline", task_index=0, cost=1.0),
        make_transcript(scenario="s1", condition="baseline", task_index=1, cost=1.0),
        make_transcript(scenario="s1", condition="baseline", task_index=2, cost=5.0),
    ]
    result = analyze_sessions(transcripts)
    assert len(result["bottleneck_sessions"]) >= 1


def test_compaction_events():
    t = make_transcript(scenario="s1", condition="baseline")
    t.compactionCount = 3
    result = analyze_sessions([t])
    assert len(result["compaction_events"]) == 1
    assert result["compaction_events"][0]["compaction_count"] == 3
