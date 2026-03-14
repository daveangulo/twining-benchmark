"""Coordination behavior analyzer.

Categorizes tool calls into productive vs coordination, computes per-condition
Twining engagement stats, flags non-engagement, and identifies graph-building overhead.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from ..models import SessionTranscript, CoordinationArtifacts
from ._constants import (
    PRODUCTIVE_TOOLS,
    ORIENTATION_OPS,
    RECORDING_OPS,
    GRAPH_OPS,
    normalize_tool_name,
    is_twining_tool,
    classify_twining_op,
    ENGAGEMENT_THRESHOLD,
    HIGH_OVERHEAD_RATIO,
)


# ---------------------------------------------------------------------------
# Tool-call classification
# ---------------------------------------------------------------------------

# Keep legacy names as module-level aliases so existing tests still import them.
GRAPH_BUILDING_OPS = GRAPH_OPS


def _twining_subcategory(tool_name: str) -> str:
    """Return 'graph_building', 'orientation', 'recording', or 'other'."""
    cat = classify_twining_op(tool_name)
    if cat == "graph_building":
        return "graph_building"
    if cat == "orientation":
        return "orientation"
    if cat in ("recording", "verification"):
        return "recording"
    if cat is not None:
        return cat
    return "other"


def _is_twining(tool_name: str) -> bool:
    return is_twining_tool(tool_name)


def _is_productive(tool_name: str) -> bool:
    return tool_name in PRODUCTIVE_TOOLS


def categorize_tool_calls(tool_calls: list) -> dict[str, Any]:
    """Categorize a list of ToolCall objects into productive vs coordination."""
    total = len(tool_calls)
    productive = 0
    coordination = 0
    graph_building = 0
    orientation = 0
    recording = 0
    coordination_other = 0

    for tc in tool_calls:
        name = tc.toolName
        if _is_twining(name):
            coordination += 1
            sub = _twining_subcategory(name)
            if sub == "graph_building":
                graph_building += 1
            elif sub == "orientation":
                orientation += 1
            elif sub == "recording":
                recording += 1
            else:
                coordination_other += 1
        elif _is_productive(name):
            productive += 1
        else:
            # Unknown tools counted as productive (non-coordination)
            productive += 1

    return {
        "total": total,
        "productive": productive,
        "coordination": coordination,
        "graph_building": graph_building,
        "orientation": orientation,
        "recording": recording,
        "coordination_other": coordination_other,
        "overhead_ratio": coordination / total if total > 0 else 0.0,
        "graph_building_pct": graph_building / coordination * 100 if coordination > 0 else 0.0,
    }


# ---------------------------------------------------------------------------
# Session-level result
# ---------------------------------------------------------------------------

@dataclass
class SessionCoordination:
    session_id: str
    scenario: str
    condition: str
    task_index: int
    total_calls: int
    productive_calls: int
    coordination_calls: int
    graph_building_calls: int
    orientation_calls: int
    recording_calls: int
    coordination_other_calls: int
    overhead_ratio: float           # coordination / total
    graph_building_pct: float       # graph_building / coordination * 100
    engaged: bool                   # has ≥1 twining call
    # Artifact-derived (optional)
    entities_added: int = 0
    decisions_added: int = 0
    state_growth: int = 0           # len(postSessionState) - len(preSessionState)


# ---------------------------------------------------------------------------
# Condition-level summary
# ---------------------------------------------------------------------------

@dataclass
class ConditionCoordination:
    condition: str
    session_count: int
    engaged_sessions: int
    engagement_rate: float          # engaged_sessions / session_count
    non_engagement_flagged: bool    # engagement_rate < 0.5
    avg_twining_calls: float
    avg_twining_pct: float          # avg(coordination / total * 100)
    avg_overhead_ratio: float
    avg_graph_building_pct: float   # avg graph-building % of twining calls
    avg_entities_added: float
    avg_decisions_added: float
    avg_state_growth: float


# ---------------------------------------------------------------------------
# Top-level result
# ---------------------------------------------------------------------------

@dataclass
class CoordinationAnalysis:
    sessions: list[SessionCoordination]
    per_condition: dict[str, ConditionCoordination]
    non_engagement_conditions: list[str]   # conditions with engagement < 50%
    high_overhead_conditions: list[str]    # conditions where avg overhead_ratio > 0.3
    summary: str


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def analyze_coordination(
    transcripts: list[SessionTranscript],
    artifacts_map: dict[str, CoordinationArtifacts] | None = None,
) -> CoordinationAnalysis:
    """Analyze coordination behavior across a list of session transcripts.

    Parameters
    ----------
    transcripts:
        List of SessionTranscript objects to analyze.
    artifacts_map:
        Optional mapping of session_id → CoordinationArtifacts for state-growth
        and entity/decision counts.
    """
    if artifacts_map is None:
        artifacts_map = {}

    session_results: list[SessionCoordination] = []

    for t in transcripts:
        cats = categorize_tool_calls(t.toolCalls)
        artifacts = artifacts_map.get(t.sessionId)

        # Artifact-derived metrics
        entities_added = 0
        decisions_added = 0
        state_growth = 0
        if artifacts is not None:
            pre = artifacts.preSessionState
            post = artifacts.postSessionState
            state_growth = len(post) - len(pre)
            # Count entity/decision additions from changes list
            for change in artifacts.changes:
                lc = change.lower()
                if "entity" in lc:
                    entities_added += 1
                elif "decision" in lc:
                    decisions_added += 1

        sr = SessionCoordination(
            session_id=t.sessionId,
            scenario=t.scenario,
            condition=t.condition,
            task_index=t.taskIndex,
            total_calls=cats["total"],
            productive_calls=cats["productive"],
            coordination_calls=cats["coordination"],
            graph_building_calls=cats["graph_building"],
            orientation_calls=cats["orientation"],
            recording_calls=cats["recording"],
            coordination_other_calls=cats["coordination_other"],
            overhead_ratio=cats["overhead_ratio"],
            graph_building_pct=cats["graph_building_pct"],
            engaged=cats["coordination"] > 0,
            entities_added=entities_added,
            decisions_added=decisions_added,
            state_growth=state_growth,
        )
        session_results.append(sr)

    # Aggregate by condition
    by_condition: dict[str, list[SessionCoordination]] = defaultdict(list)
    for sr in session_results:
        by_condition[sr.condition].append(sr)

    per_condition: dict[str, ConditionCoordination] = {}
    for cond, sessions in by_condition.items():
        n = len(sessions)
        engaged = sum(1 for s in sessions if s.engaged)
        eng_rate = engaged / n if n > 0 else 0.0

        avg_twining = sum(s.coordination_calls for s in sessions) / n if n > 0 else 0.0
        avg_twining_pct = (
            sum(s.coordination_calls / s.total_calls * 100 for s in sessions if s.total_calls > 0) / n
            if n > 0 else 0.0
        )
        avg_overhead = sum(s.overhead_ratio for s in sessions) / n if n > 0 else 0.0
        avg_gb_pct = sum(s.graph_building_pct for s in sessions) / n if n > 0 else 0.0
        avg_entities = sum(s.entities_added for s in sessions) / n if n > 0 else 0.0
        avg_decisions = sum(s.decisions_added for s in sessions) / n if n > 0 else 0.0
        avg_growth = sum(s.state_growth for s in sessions) / n if n > 0 else 0.0

        per_condition[cond] = ConditionCoordination(
            condition=cond,
            session_count=n,
            engaged_sessions=engaged,
            engagement_rate=eng_rate,
            non_engagement_flagged=eng_rate < 0.5,
            avg_twining_calls=avg_twining,
            avg_twining_pct=avg_twining_pct,
            avg_overhead_ratio=avg_overhead,
            avg_graph_building_pct=avg_gb_pct,
            avg_entities_added=avg_entities,
            avg_decisions_added=avg_decisions,
            avg_state_growth=avg_growth,
        )

    non_engagement = [c for c, cc in per_condition.items() if cc.non_engagement_flagged]
    high_overhead = [c for c, cc in per_condition.items() if cc.avg_overhead_ratio > 0.3]

    total_sessions = len(session_results)
    total_engaged = sum(1 for s in session_results if s.engaged)
    overall_engagement = total_engaged / total_sessions * 100 if total_sessions > 0 else 0.0

    summary_parts = [
        f"Analyzed {total_sessions} sessions across {len(per_condition)} conditions.",
        f"Overall engagement rate: {overall_engagement:.0f}% ({total_engaged}/{total_sessions} sessions used Twining).",
    ]
    if non_engagement:
        summary_parts.append(f"Non-engagement flagged for: {', '.join(sorted(non_engagement))}.")
    if high_overhead:
        summary_parts.append(f"High coordination overhead (>30%) in: {', '.join(sorted(high_overhead))}.")

    return CoordinationAnalysis(
        sessions=session_results,
        per_condition=per_condition,
        non_engagement_conditions=non_engagement,
        high_overhead_conditions=high_overhead,
        summary=" ".join(summary_parts),
    )
