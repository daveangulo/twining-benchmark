"""Per-session transcript deep dive analysis."""
from __future__ import annotations
from collections import defaultdict
from ..models import SessionTranscript


def analyze_sessions(transcripts: list[SessionTranscript]) -> dict:
    """Per-session deep dive analysis.

    Returns dict with:
      - per_session: tool call breakdown, cost, duration for each session
      - bottleneck_sessions: sessions with highest cost or duration relative to peers
      - compaction_events: sessions that triggered context compaction
      - exit_reasons: breakdown of session exit reasons
    """
    per_session = []
    by_scenario_condition = defaultdict(list)

    for t in transcripts:
        twining_calls = [tc for tc in t.toolCalls if "twining" in tc.toolName]
        productive_calls = [tc for tc in t.toolCalls if tc.toolName in {"Read", "Edit", "Write", "Bash", "Glob", "Grep"}]
        entry = {
            "session_id": t.sessionId,
            "scenario": t.scenario,
            "condition": t.condition,
            "task_index": t.taskIndex,
            "num_turns": t.numTurns,
            "total_tool_calls": len(t.toolCalls),
            "productive_tool_calls": len(productive_calls),
            "twining_tool_calls": len(twining_calls),
            "cost_usd": t.tokenUsage.costUsd,
            "duration_ms": t.timing.durationMs,
            "exit_reason": t.exitReason,
            "compaction_count": t.compactionCount,
        }
        per_session.append(entry)
        by_scenario_condition[(t.scenario, t.condition)].append(entry)

    # Identify bottleneck sessions (highest cost within their scenario x condition group)
    bottleneck_sessions = []
    for (scenario, condition), sessions in by_scenario_condition.items():
        if len(sessions) < 2:
            continue
        costs = [s["cost_usd"] for s in sessions]
        max_cost = max(costs)
        mean_cost = sum(costs) / len(costs)
        for s in sessions:
            if s["cost_usd"] == max_cost and max_cost > mean_cost * 1.5:
                bottleneck_sessions.append(s)

    # Compaction events
    compaction_events = [s for s in per_session if s["compaction_count"] > 0]

    # Exit reason breakdown
    exit_reasons = defaultdict(int)
    for t in transcripts:
        exit_reasons[t.exitReason] += 1

    return {
        "per_session": per_session,
        "bottleneck_sessions": bottleneck_sessions,
        "compaction_events": compaction_events,
        "exit_reasons": dict(exit_reasons),
    }
