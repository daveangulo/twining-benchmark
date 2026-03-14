"""Tests for the coordination behavior analyzer."""
import pytest
from benchmark_analysis.dimensions.coordination import (
    analyze_coordination,
    categorize_tool_calls,
    CoordinationAnalysis,
    SessionCoordination,
    ConditionCoordination,
    _is_twining,
    _twining_subcategory,
)
from benchmark_analysis.models import CoordinationArtifacts

# Import shared helpers from conftest
from tests.conftest import make_transcript, make_tool_call


# ---------------------------------------------------------------------------
# Unit tests: tool classification helpers
# ---------------------------------------------------------------------------

class TestIsTwining:
    def test_twining_prefix(self):
        assert _is_twining("twining_decide")

    def test_mcp_prefix(self):
        assert _is_twining("mcp__plugin_twining_twining__twining_assemble")

    def test_productive_tool(self):
        assert not _is_twining("Read")

    def test_bash(self):
        assert not _is_twining("Bash")


class TestTwiningSubcategory:
    def test_add_entity_is_graph_building(self):
        assert _twining_subcategory("twining_add_entity") == "graph_building"

    def test_add_relation_is_graph_building(self):
        assert _twining_subcategory("twining_add_relation") == "graph_building"

    def test_assemble_is_orientation(self):
        assert _twining_subcategory("twining_assemble") == "orientation"

    def test_recent_is_orientation(self):
        assert _twining_subcategory("twining_recent") == "orientation"

    def test_query_is_orientation(self):
        assert _twining_subcategory("twining_query") == "orientation"

    def test_decide_is_recording(self):
        assert _twining_subcategory("twining_decide") == "recording"

    def test_post_is_recording(self):
        assert _twining_subcategory("twining_post") == "recording"

    def test_mcp_prefix_stripped(self):
        assert _twining_subcategory("mcp__plugin_twining_twining__twining_add_entity") == "graph_building"

    def test_unknown_op_is_other(self):
        assert _twining_subcategory("twining_frobnicate") == "other"


class TestCategorizeCalls:
    def test_empty(self):
        result = categorize_tool_calls([])
        assert result["total"] == 0
        assert result["productive"] == 0
        assert result["coordination"] == 0
        assert result["overhead_ratio"] == 0.0

    def test_all_productive(self):
        calls = [make_tool_call("Read"), make_tool_call("Edit"), make_tool_call("Bash")]
        result = categorize_tool_calls(calls)
        assert result["productive"] == 3
        assert result["coordination"] == 0
        assert result["overhead_ratio"] == 0.0

    def test_all_twining(self):
        calls = [
            make_tool_call("twining_add_entity"),
            make_tool_call("twining_add_relation"),
            make_tool_call("twining_decide"),
        ]
        result = categorize_tool_calls(calls)
        assert result["coordination"] == 3
        assert result["productive"] == 0
        assert result["overhead_ratio"] == pytest.approx(1.0)

    def test_graph_building_subcategory(self):
        calls = [
            make_tool_call("twining_add_entity"),
            make_tool_call("twining_add_relation"),
            make_tool_call("twining_decide"),
        ]
        result = categorize_tool_calls(calls)
        assert result["graph_building"] == 2
        assert result["recording"] == 1
        assert result["graph_building_pct"] == pytest.approx(2 / 3 * 100)

    def test_mixed(self):
        calls = [
            make_tool_call("Read"),
            make_tool_call("Edit"),
            make_tool_call("twining_assemble"),
            make_tool_call("twining_decide"),
        ]
        result = categorize_tool_calls(calls)
        assert result["total"] == 4
        assert result["coordination"] == 2
        assert result["productive"] == 2
        assert result["overhead_ratio"] == pytest.approx(0.5)
        assert result["orientation"] == 1
        assert result["recording"] == 1

    def test_graph_building_pct_zero_when_no_twining(self):
        calls = [make_tool_call("Read")]
        result = categorize_tool_calls(calls)
        assert result["graph_building_pct"] == 0.0


# ---------------------------------------------------------------------------
# Integration tests: analyze_coordination
# ---------------------------------------------------------------------------

class TestAnalyzeCoordinationEmpty:
    def test_empty_transcripts(self):
        result = analyze_coordination([])
        assert isinstance(result, CoordinationAnalysis)
        assert result.sessions == []
        assert result.per_condition == {}
        assert result.non_engagement_conditions == []


class TestSessionLevelMetrics:
    def test_session_with_no_tool_calls(self):
        t = make_transcript(condition="baseline")
        result = analyze_coordination([t])
        assert len(result.sessions) == 1
        s = result.sessions[0]
        assert s.total_calls == 0
        assert s.coordination_calls == 0
        assert s.engaged is False
        assert s.overhead_ratio == 0.0

    def test_session_with_only_productive_calls(self):
        t = make_transcript(
            condition="baseline",
            tool_calls=[make_tool_call("Read"), make_tool_call("Bash")],
        )
        result = analyze_coordination([t])
        s = result.sessions[0]
        assert s.productive_calls == 2
        assert s.coordination_calls == 0
        assert s.engaged is False

    def test_session_engaged(self):
        t = make_transcript(
            condition="full-twining",
            tool_calls=[
                make_tool_call("Read"),
                make_tool_call("twining_assemble"),
                make_tool_call("Edit"),
                make_tool_call("twining_decide"),
            ],
        )
        result = analyze_coordination([t])
        s = result.sessions[0]
        assert s.engaged is True
        assert s.coordination_calls == 2
        assert s.productive_calls == 2
        assert s.overhead_ratio == pytest.approx(0.5)

    def test_session_subcategory_counts(self):
        t = make_transcript(
            condition="full-twining",
            tool_calls=[
                make_tool_call("twining_add_entity"),
                make_tool_call("twining_add_relation"),
                make_tool_call("twining_assemble"),
                make_tool_call("twining_recent"),
                make_tool_call("twining_decide"),
                make_tool_call("Read"),
            ],
        )
        result = analyze_coordination([t])
        s = result.sessions[0]
        assert s.graph_building_calls == 2
        assert s.orientation_calls == 2
        assert s.recording_calls == 1
        assert s.graph_building_pct == pytest.approx(2 / 5 * 100)


class TestConditionAggregation:
    def _make_twining_transcript(self, condition: str = "full-twining") -> object:
        return make_transcript(
            condition=condition,
            tool_calls=[
                make_tool_call("Read"),
                make_tool_call("twining_assemble"),
                make_tool_call("twining_decide"),
            ],
        )

    def _make_baseline_transcript(self, condition: str = "baseline") -> object:
        return make_transcript(
            condition=condition,
            tool_calls=[make_tool_call("Read"), make_tool_call("Bash")],
        )

    def test_single_condition_engaged(self):
        transcripts = [self._make_twining_transcript() for _ in range(3)]
        result = analyze_coordination(transcripts)
        cc = result.per_condition["full-twining"]
        assert cc.session_count == 3
        assert cc.engaged_sessions == 3
        assert cc.engagement_rate == pytest.approx(1.0)
        assert cc.non_engagement_flagged is False

    def test_non_engagement_flagged(self):
        # 1 of 4 sessions engaged → 25% < 50%
        transcripts = [
            self._make_twining_transcript("twining-lite"),
            self._make_baseline_transcript("twining-lite"),
            self._make_baseline_transcript("twining-lite"),
            self._make_baseline_transcript("twining-lite"),
        ]
        result = analyze_coordination(transcripts)
        cc = result.per_condition["twining-lite"]
        assert cc.engaged_sessions == 1
        assert cc.engagement_rate == pytest.approx(0.25)
        assert cc.non_engagement_flagged is True
        assert "twining-lite" in result.non_engagement_conditions

    def test_engagement_exactly_50_not_flagged(self):
        transcripts = [
            self._make_twining_transcript("cond-x"),
            self._make_baseline_transcript("cond-x"),
        ]
        result = analyze_coordination(transcripts)
        cc = result.per_condition["cond-x"]
        assert cc.engagement_rate == pytest.approx(0.5)
        assert cc.non_engagement_flagged is False

    def test_multiple_conditions(self):
        transcripts = [
            self._make_twining_transcript("full-twining"),
            self._make_baseline_transcript("baseline"),
        ]
        result = analyze_coordination(transcripts)
        assert "full-twining" in result.per_condition
        assert "baseline" in result.per_condition
        assert result.per_condition["baseline"].engaged_sessions == 0

    def test_avg_twining_calls(self):
        transcripts = [
            make_transcript(
                condition="full-twining",
                tool_calls=[
                    make_tool_call("twining_assemble"),
                    make_tool_call("twining_decide"),
                    make_tool_call("Read"),
                ],
            ),
            make_transcript(
                condition="full-twining",
                tool_calls=[
                    make_tool_call("twining_assemble"),
                    make_tool_call("Read"),
                ],
            ),
        ]
        result = analyze_coordination(transcripts)
        cc = result.per_condition["full-twining"]
        assert cc.avg_twining_calls == pytest.approx(1.5)  # (2 + 1) / 2

    def test_high_overhead_flagged(self):
        # Sessions where all calls are twining → overhead_ratio = 1.0
        transcripts = [
            make_transcript(
                condition="overhead-cond",
                tool_calls=[
                    make_tool_call("twining_add_entity"),
                    make_tool_call("twining_add_relation"),
                    make_tool_call("twining_decide"),
                    make_tool_call("twining_assemble"),
                ],
            ),
        ]
        result = analyze_coordination(transcripts)
        assert "overhead-cond" in result.high_overhead_conditions


class TestArtifactsIntegration:
    def test_state_growth_from_artifacts(self):
        artifacts = CoordinationArtifacts(
            preSessionState={"a": "1"},
            postSessionState={"a": "1", "b": "2", "c": "3"},
            changes=[],
        )
        t = make_transcript(condition="full-twining")
        result = analyze_coordination([t], artifacts_map={t.sessionId: artifacts})
        s = result.sessions[0]
        assert s.state_growth == 2  # 3 - 1

    def test_entity_decision_counts_from_changes(self):
        artifacts = CoordinationArtifacts(
            preSessionState={},
            postSessionState={},
            changes=["Added entity: AuthService", "Added decision: use-postgres", "Added entity: UserRepo"],
        )
        t = make_transcript(condition="full-twining")
        result = analyze_coordination([t], artifacts_map={t.sessionId: artifacts})
        s = result.sessions[0]
        assert s.entities_added == 2
        assert s.decisions_added == 1

    def test_avg_state_growth_per_condition(self):
        artifacts1 = CoordinationArtifacts(
            preSessionState={"a": "1"},
            postSessionState={"a": "1", "b": "2"},
            changes=[],
        )
        artifacts2 = CoordinationArtifacts(
            preSessionState={},
            postSessionState={"x": "1", "y": "2", "z": "3"},
            changes=[],
        )
        t1 = make_transcript(condition="full-twining")
        # Use a different session ID so both entries exist in the map
        t2 = make_transcript(condition="full-twining")
        t2 = t2.model_copy(update={"sessionId": "test-session-2"})
        result = analyze_coordination(
            [t1, t2],
            artifacts_map={t1.sessionId: artifacts1, t2.sessionId: artifacts2},
        )
        cc = result.per_condition["full-twining"]
        assert cc.avg_state_growth == pytest.approx(2.0)  # (1 + 3) / 2

    def test_no_artifacts_defaults_zero(self):
        t = make_transcript(condition="baseline")
        result = analyze_coordination([t])
        s = result.sessions[0]
        assert s.entities_added == 0
        assert s.decisions_added == 0
        assert s.state_growth == 0


class TestSummary:
    def test_summary_contains_session_count(self):
        transcripts = [make_transcript(condition="baseline") for _ in range(5)]
        result = analyze_coordination(transcripts)
        assert "5" in result.summary

    def test_summary_mentions_non_engagement(self):
        # Create condition with 0% engagement
        t = make_transcript(condition="no-twining", tool_calls=[make_tool_call("Read")])
        result = analyze_coordination([t])
        assert "no-twining" in result.summary

    def test_summary_all_engaged_no_flag(self):
        t = make_transcript(
            condition="full-twining",
            tool_calls=[make_tool_call("twining_assemble"), make_tool_call("Read")],
        )
        result = analyze_coordination([t])
        # Summary should not contain non-engagement warning
        assert "Non-engagement" not in result.summary
