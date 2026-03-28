"""Work leverage metrics computed from session file changes."""
from __future__ import annotations

import re
from collections import defaultdict

from ..models import SessionTranscript


def parse_added_lines(diff: str) -> list[str]:
    """Extract added lines from a unified diff, stripping the '+' prefix."""
    return [
        line[1:].strip()
        for line in diff.split('\n')
        if line.startswith('+') and not line.startswith('+++') and line[1:].strip()
    ]


def parse_removed_lines(diff: str) -> list[str]:
    """Extract removed lines from a unified diff, stripping the '-' prefix."""
    return [
        line[1:].strip()
        for line in diff.split('\n')
        if line.startswith('-') and not line.startswith('---') and line[1:].strip()
    ]


def _is_source_file(path: str) -> bool:
    """Return True if path is a TypeScript source file in src/ or tests/."""
    return (path.startswith('src/') or path.startswith('tests/')) and path.endswith('.ts')


# Pattern for symbol declarations in TypeScript
_SYMBOL_PATTERN = re.compile(
    r'(?:export\s+)?(?:class|interface|function|const|let|type|enum)\s+(\w+)'
)


def _extract_symbol_names(lines: list[str]) -> set[str]:
    """Extract declared symbol names from added lines."""
    symbols: set[str] = set()
    for line in lines:
        for m in _SYMBOL_PATTERN.finditer(line):
            symbols.add(m.group(1))
    return symbols


def _get_session_diffs(session: SessionTranscript) -> tuple[list[str], list[str]]:
    """Get all added and removed lines from source-file changes in a session.

    Returns (added_lines, removed_lines).
    """
    added: list[str] = []
    removed: list[str] = []
    for fc in session.fileChanges:
        if not _is_source_file(fc.path):
            continue
        if fc.diff:
            added.extend(parse_added_lines(fc.diff))
            removed.extend(parse_removed_lines(fc.diff))
    return added, removed


def analyze_work_leverage(transcripts: list[SessionTranscript]) -> dict:
    """Analyze work leverage across consecutive sessions.

    For each pair of consecutive sessions (same condition+scenario+iteration),
    computes rework ratio, line survival, and continuation index.

    Returns dict with:
      - per_condition: list of dicts with aggregate metrics per condition
      - per_pair: list of dicts with per-pair details (for deeper inspection)
    """
    # Group sessions by (condition, scenario, iteration) and order by taskIndex
    groups: dict[tuple[str, str, int], list[SessionTranscript]] = defaultdict(list)

    # Determine iteration from runId — sessions share a runId within an iteration
    # Group by (condition, scenario, runId) to get sessions in same iteration
    for t in transcripts:
        # runId encodes the iteration context
        key = (t.condition, t.scenario, t.runId)
        groups[key].append(t)

    # Sort each group by taskIndex
    for key in groups:
        groups[key].sort(key=lambda t: t.taskIndex)

    per_pair: list[dict] = []
    condition_metrics: dict[str, list[dict]] = defaultdict(list)

    for (condition, scenario, run_id), sessions in groups.items():
        if len(sessions) < 2:
            continue

        for i in range(len(sessions) - 1):
            session_a = sessions[i]
            session_b = sessions[i + 1]

            added_a, _ = _get_session_diffs(session_a)
            added_b, removed_b = _get_session_diffs(session_b)

            # Rework ratio: lines B removed that A added / lines A added
            if added_a:
                added_a_set = set(added_a)
                removed_by_b_of_a = sum(1 for line in removed_b if line in added_a_set)
                rework_ratio = removed_by_b_of_a / len(added_a)
            else:
                rework_ratio = 0.0

            # Line survival: fraction of A's added lines NOT removed by later sessions
            # For simplicity, check against session B's removals only
            if added_a:
                survived = sum(1 for line in added_a if line not in set(removed_b))
                survival = survived / len(added_a)
            else:
                survival = 1.0

            # Continuation index: fraction of B's added lines that reference
            # A's new symbol names
            symbols_a = _extract_symbol_names(added_a)
            if added_b and symbols_a:
                referencing = sum(
                    1 for line in added_b
                    if any(sym in line for sym in symbols_a)
                )
                continuation = referencing / len(added_b)
            else:
                continuation = 0.0

            pair_data = {
                "condition": condition,
                "scenario": scenario,
                "run_id": run_id,
                "session_a_task": session_a.taskIndex,
                "session_b_task": session_b.taskIndex,
                "lines_added_a": len(added_a),
                "lines_added_b": len(added_b),
                "rework_ratio": round(rework_ratio, 4),
                "line_survival": round(survival, 4),
                "continuation_index": round(continuation, 4),
            }
            per_pair.append(pair_data)
            condition_metrics[condition].append(pair_data)

    # Aggregate per condition
    per_condition: list[dict] = []
    for condition in sorted(condition_metrics):
        pairs = condition_metrics[condition]
        n = len(pairs)
        avg_rework = sum(p["rework_ratio"] for p in pairs) / max(n, 1)
        avg_survival = sum(p["line_survival"] for p in pairs) / max(n, 1)
        avg_continuation = sum(p["continuation_index"] for p in pairs) / max(n, 1)
        per_condition.append({
            "condition": condition,
            "n_pairs": n,
            "avg_rework_ratio": round(avg_rework, 4),
            "avg_line_survival": round(avg_survival, 4),
            "avg_continuation_index": round(avg_continuation, 4),
        })

    return {
        "per_condition": per_condition,
        "per_pair": per_pair,
    }
