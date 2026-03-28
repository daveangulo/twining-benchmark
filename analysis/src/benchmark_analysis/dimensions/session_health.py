"""Session health diagnostics per condition."""
from __future__ import annotations

from collections import defaultdict

from ..models import SessionTranscript
from ._constants import is_twining_tool


def analyze_session_health(transcripts: list[SessionTranscript]) -> dict:
    """Analyze session health metrics per condition.

    Returns dict with:
      - per_condition: list of dicts with health stats for each condition
      - warnings: list of string warnings (e.g. plugin likely not loaded)
    """
    by_condition: dict[str, list[SessionTranscript]] = defaultdict(list)
    for t in transcripts:
        by_condition[t.condition].append(t)

    per_condition: list[dict] = []
    warnings: list[str] = []

    for condition in sorted(by_condition):
        sessions = by_condition[condition]
        total = len(sessions)

        # Exit reason counts
        completed = sum(1 for t in sessions if t.exitReason == "completed")
        timed_out = sum(1 for t in sessions if t.exitReason in ("timeout", "timed_out", "timedOut"))
        errored = sum(1 for t in sessions if t.exitReason in ("error", "crashed", "failed"))

        # Sessions with 0 tool calls (potential crashes)
        zero_tool_sessions = sum(1 for t in sessions if len(t.toolCalls) == 0)

        # Twining tool call stats
        twining_calls_per_session: list[int] = []
        total_twining_calls = 0
        sessions_with_twining = 0
        for t in sessions:
            n_twining = sum(1 for tc in t.toolCalls if is_twining_tool(tc.toolName))
            twining_calls_per_session.append(n_twining)
            total_twining_calls += n_twining
            if n_twining > 0:
                sessions_with_twining += 1

        avg_twining = total_twining_calls / max(total, 1)
        engagement_rate = sessions_with_twining / max(total, 1)

        # Plugin validation: twining condition with 0 calls
        if "twining" in condition.lower() and total_twining_calls == 0 and total > 0:
            warnings.append(
                f"Condition '{condition}' has 'twining' in name but 0 Twining tool calls "
                f"across all {total} sessions — plugin likely not loaded"
            )

        # Session duration stats
        durations = [t.timing.durationMs for t in sessions]
        if durations:
            max_duration = max(durations)
            min_duration = min(durations)
            avg_duration = sum(durations) / len(durations)
        else:
            max_duration = min_duration = avg_duration = 0

        per_condition.append({
            "condition": condition,
            "total_sessions": total,
            "completed": completed,
            "timed_out": timed_out,
            "errored": errored,
            "zero_tool_sessions": zero_tool_sessions,
            "total_twining_calls": total_twining_calls,
            "avg_twining_calls_per_session": round(avg_twining, 2),
            "twining_engagement_rate": round(engagement_rate, 3),
            "max_duration_ms": max_duration,
            "min_duration_ms": min_duration,
            "avg_duration_ms": round(avg_duration, 1),
        })

    return {
        "per_condition": per_condition,
        "warnings": warnings,
    }
