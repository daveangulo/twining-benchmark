"""Per-condition behavioral profile analysis."""
from __future__ import annotations

from collections import Counter, defaultdict

from ..models import SessionTranscript
from ._constants import normalize_tool_name


# Coordination file path patterns
_COORDINATION_PATHS = ("COORDINATION.md", "CONTEXT.md", ".twining/")


def _is_coordination_path(path: str) -> bool:
    """Return True if path targets a coordination file."""
    for pattern in _COORDINATION_PATHS:
        if pattern in path:
            return True
    return False


def _is_file_interaction_tool(tool_name: str) -> bool:
    """Return True if tool reads/writes/edits files."""
    return tool_name in ("Read", "Edit", "Write", "MultiEdit")


def analyze_behavioral_profiles(transcripts: list[SessionTranscript]) -> dict:
    """Analyze behavioral patterns per condition.

    Returns dict with:
      - per_condition: list of dicts with behavioral profile for each condition
    """
    by_condition: dict[str, list[SessionTranscript]] = defaultdict(list)
    for t in transcripts:
        by_condition[t.condition].append(t)

    per_condition: list[dict] = []

    for condition in sorted(by_condition):
        sessions = by_condition[condition]

        # First 5 tool calls pattern across all sessions
        first_5_patterns: list[list[str]] = []
        for t in sessions:
            first_5 = [normalize_tool_name(tc.toolName) for tc in t.toolCalls[:5]]
            first_5_patterns.append(first_5)

        # Most common first tool
        first_tools = [p[0] for p in first_5_patterns if p]
        first_tool_counts = Counter(first_tools).most_common(5)

        # Group by taskIndex: most common first-3 tools for task 0 and task 1
        by_task: dict[int, list[list[str]]] = defaultdict(list)
        for t in sessions:
            first_3 = [normalize_tool_name(tc.toolName) for tc in t.toolCalls[:3]]
            if first_3:
                by_task[t.taskIndex].append(first_3)

        task_patterns: dict[str, list] = {}
        for task_idx in (0, 1):
            if task_idx in by_task:
                # Stringify the first-3 pattern for counting
                pattern_counter: Counter = Counter()
                for pattern in by_task[task_idx]:
                    pattern_counter[tuple(pattern)] += 1
                most_common = pattern_counter.most_common(3)
                task_patterns[f"task_{task_idx}_first_3"] = [
                    {"pattern": list(p), "count": c}
                    for p, c in most_common
                ]
            else:
                task_patterns[f"task_{task_idx}_first_3"] = []

        # Coordination file interactions
        coord_file_reads = 0
        coord_file_writes = 0
        for t in sessions:
            for tc in t.toolCalls:
                if _is_file_interaction_tool(normalize_tool_name(tc.toolName)):
                    # Check parameters for file path
                    file_path = (
                        tc.parameters.get("file_path", "")
                        or tc.parameters.get("path", "")
                        or tc.parameters.get("command", "")
                    )
                    if _is_coordination_path(file_path):
                        if normalize_tool_name(tc.toolName) == "Read":
                            coord_file_reads += 1
                        else:
                            coord_file_writes += 1

        # Average tools per session
        total_tools = sum(len(t.toolCalls) for t in sessions)
        avg_tools = total_tools / max(len(sessions), 1)

        # Average lines added per session
        total_lines_added = sum(
            fc.linesAdded for t in sessions for fc in t.fileChanges
        )
        avg_lines = total_lines_added / max(len(sessions), 1)

        per_condition.append({
            "condition": condition,
            "n_sessions": len(sessions),
            "first_tool_distribution": [
                {"tool": tool, "count": count} for tool, count in first_tool_counts
            ],
            "task_patterns": task_patterns,
            "coordination_file_reads": coord_file_reads,
            "coordination_file_writes": coord_file_writes,
            "coordination_file_total": coord_file_reads + coord_file_writes,
            "avg_tools_per_session": round(avg_tools, 1),
            "avg_lines_added_per_session": round(avg_lines, 1),
        })

    return {
        "per_condition": per_condition,
    }
