"""Enhanced cost efficiency analysis combining scores and transcripts."""
from __future__ import annotations

from collections import defaultdict

from ..models import ScoredResult, SessionTranscript
from ._constants import is_twining_tool


def analyze_cost_efficiency(
    scores: list[ScoredResult],
    transcripts: list[SessionTranscript],
) -> dict:
    """Enhanced cost reporting per condition.

    Combines score data (composite, cost) with transcript data (duration,
    tool calls, file changes) to produce cost efficiency metrics.

    Returns dict with:
      - per_condition: list of dicts with cost efficiency metrics
    """
    # Index scores by (condition, scenario, iteration) for composite lookup
    score_by_condition: dict[str, list[ScoredResult]] = defaultdict(list)
    for s in scores:
        score_by_condition[s.condition].append(s)

    # Index transcripts by condition
    transcripts_by_condition: dict[str, list[SessionTranscript]] = defaultdict(list)
    for t in transcripts:
        transcripts_by_condition[t.condition].append(t)

    # Group transcripts by (condition, runId) for per-iteration duration
    transcripts_by_iter: dict[tuple[str, str], list[SessionTranscript]] = defaultdict(list)
    for t in transcripts:
        transcripts_by_iter[(t.condition, t.runId)].append(t)

    per_condition: list[dict] = []

    all_conditions = sorted(set(list(score_by_condition.keys()) + list(transcripts_by_condition.keys())))

    for condition in all_conditions:
        cond_scores = score_by_condition.get(condition, [])
        cond_transcripts = transcripts_by_condition.get(condition, [])

        # Total cost from scores (per-iteration cost)
        total_cost = sum(s.metrics.costUsd for s in cond_scores)
        n_iterations = len(cond_scores)
        cost_per_iteration = total_cost / max(n_iterations, 1)

        # Cost per session (from transcripts)
        n_sessions = len(cond_transcripts)
        cost_per_session = total_cost / max(n_sessions, 1)

        # Composite score stats
        composites = [s.composite for s in cond_scores]
        mean_composite = sum(composites) / max(len(composites), 1) if composites else 0.0

        # Cost per quality point
        cost_per_point = total_cost / max(mean_composite * n_iterations, 0.01) if mean_composite > 0 else 0.0

        # Time per iteration: sum of session durations grouped by runId
        iter_keys = [k for k in transcripts_by_iter if k[0] == condition]
        iter_durations: list[int] = []
        for key in iter_keys:
            iter_sessions = transcripts_by_iter[key]
            iter_dur = sum(t.timing.durationMs for t in iter_sessions)
            iter_durations.append(iter_dur)
        avg_time_per_iteration_ms = (
            sum(iter_durations) / max(len(iter_durations), 1)
            if iter_durations else 0
        )

        # Lines of code per dollar
        total_lines = sum(
            fc.linesAdded for t in cond_transcripts for fc in t.fileChanges
        )
        lines_per_dollar = total_lines / max(total_cost, 0.001)

        # Tool calls per dollar
        total_tool_calls = sum(len(t.toolCalls) for t in cond_transcripts)
        tool_calls_per_dollar = total_tool_calls / max(total_cost, 0.001)

        # Token breakdown from transcripts (session-level billing-correct totals)
        n_t = max(len(cond_transcripts), 1)
        input_tokens_mean = sum(t.tokenUsage.input for t in cond_transcripts) / n_t
        output_tokens_mean = sum(t.tokenUsage.output for t in cond_transcripts) / n_t
        cache_read_mean = sum(t.tokenUsage.cacheRead for t in cond_transcripts) / n_t
        cache_creation_mean = sum(t.tokenUsage.cacheCreation for t in cond_transcripts) / n_t
        total_tokens_mean = sum(t.tokenUsage.total for t in cond_transcripts) / n_t
        ctx_windows = [t.contextWindowSize for t in cond_transcripts if t.contextWindowSize > 0]
        ctx_window_mean = sum(ctx_windows) / len(ctx_windows) if ctx_windows else 0

        per_condition.append({
            "condition": condition,
            "total_cost_usd": round(total_cost, 4),
            "n_iterations": n_iterations,
            "n_sessions": n_sessions,
            "cost_per_iteration_usd": round(cost_per_iteration, 4),
            "cost_per_session_usd": round(cost_per_session, 4),
            "mean_composite": round(mean_composite, 2),
            "cost_per_quality_point_usd": round(cost_per_point, 4),
            "avg_time_per_iteration_ms": round(avg_time_per_iteration_ms, 1),
            "total_lines_added": total_lines,
            "lines_per_dollar": round(lines_per_dollar, 1),
            "total_tool_calls": total_tool_calls,
            "tool_calls_per_dollar": round(tool_calls_per_dollar, 1),
            "input_tokens_mean": round(input_tokens_mean),
            "output_tokens_mean": round(output_tokens_mean),
            "cache_read_tokens_mean": round(cache_read_mean),
            "cache_creation_tokens_mean": round(cache_creation_mean),
            "total_tokens_mean": round(total_tokens_mean),
            "context_window_size_mean": round(ctx_window_mean),
        })

    return {
        "per_condition": per_condition,
    }
