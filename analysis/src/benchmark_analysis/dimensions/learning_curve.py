"""Session-order performance trends in multi-session scenarios.

Answers: does coordination become more/less valuable in later sessions?
Do agents degrade over long sequences? Does compaction predict quality drops?
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from scipy import stats as sp_stats
from ..models import SessionTranscript


def analyze_learning_curve(transcripts: list[SessionTranscript]) -> dict:
    """Analyze performance trends across session order within scenarios.

    Returns dict with:
      - per_scenario: per-scenario session-order trends (cost, turns, tool calls, coordination usage)
      - coordination_value_trend: does coordination overhead change across sessions?
      - compaction_analysis: sessions with compaction vs without -- impact on metrics
      - scaling_assessment: does this scenario scale to more sessions?
    """
    # Group by (scenario, condition), sort by task_index
    by_scenario_condition = defaultdict(list)
    for t in transcripts:
        by_scenario_condition[(t.scenario, t.condition)].append(t)

    for key in by_scenario_condition:
        by_scenario_condition[key].sort(key=lambda t: t.taskIndex)

    # Per-scenario analysis
    per_scenario = []
    for (scenario, condition), sessions in sorted(by_scenario_condition.items()):
        if len(sessions) < 2:
            continue

        indices = [t.taskIndex for t in sessions]
        costs = [t.tokenUsage.costUsd for t in sessions]
        turns = [t.numTurns for t in sessions]
        twining_calls = [sum(1 for tc in t.toolCalls if "twining" in tc.toolName) for t in sessions]
        total_calls = [len(t.toolCalls) for t in sessions]
        durations = [t.timing.durationMs for t in sessions]

        # Compute trends (slope of linear regression)
        cost_trend = _compute_trend(indices, costs)
        turns_trend = _compute_trend(indices, turns)
        twining_trend = _compute_trend(indices, twining_calls)

        per_scenario.append({
            "scenario": scenario,
            "condition": condition,
            "num_sessions": len(sessions),
            "session_trend": {
                "cost_per_session": [round(c, 3) for c in costs],
                "turns_per_session": turns,
                "twining_calls_per_session": twining_calls,
                "total_calls_per_session": total_calls,
                "duration_ms_per_session": durations,
            },
            "trends": {
                "cost_slope": round(cost_trend["slope"], 4),
                "cost_trend": cost_trend["direction"],
                "turns_slope": round(turns_trend["slope"], 2),
                "turns_trend": turns_trend["direction"],
                "twining_slope": round(twining_trend["slope"], 2),
                "twining_trend": twining_trend["direction"],
            },
        })

    # Coordination value trend: compare coordination overhead ratio across sessions
    coordination_value_trend = []
    for (scenario, condition), sessions in sorted(by_scenario_condition.items()):
        if len(sessions) < 2:
            continue
        overhead_ratios = []
        for t in sessions:
            total = len(t.toolCalls)
            twining = sum(1 for tc in t.toolCalls if "twining" in tc.toolName)
            overhead_ratios.append(twining / max(total, 1) * 100)
        trend = _compute_trend(list(range(len(overhead_ratios))), overhead_ratios)
        coordination_value_trend.append({
            "scenario": scenario,
            "condition": condition,
            "overhead_pct_per_session": [round(r, 1) for r in overhead_ratios],
            "overhead_trend": trend["direction"],
            "overhead_slope": round(trend["slope"], 2),
        })

    # Compaction analysis
    compacted = [t for t in transcripts if t.compactionCount > 0]
    non_compacted = [t for t in transcripts if t.compactionCount == 0]
    compaction_analysis = {
        "sessions_with_compaction": len(compacted),
        "sessions_without_compaction": len(non_compacted),
    }
    if compacted and non_compacted:
        compaction_analysis["compacted_avg_turns"] = round(float(np.mean([t.numTurns for t in compacted])), 1)
        compaction_analysis["non_compacted_avg_turns"] = round(float(np.mean([t.numTurns for t in non_compacted])), 1)
        compaction_analysis["compacted_avg_cost"] = round(float(np.mean([t.tokenUsage.costUsd for t in compacted])), 3)
        compaction_analysis["non_compacted_avg_cost"] = round(float(np.mean([t.tokenUsage.costUsd for t in non_compacted])), 3)
        # Which conditions trigger compaction most?
        compaction_by_condition = defaultdict(int)
        total_by_condition = defaultdict(int)
        for t in transcripts:
            total_by_condition[t.condition] += 1
            if t.compactionCount > 0:
                compaction_by_condition[t.condition] += 1
        compaction_analysis["compaction_rate_by_condition"] = {
            c: round(compaction_by_condition[c] / total_by_condition[c] * 100, 1)
            for c in sorted(total_by_condition)
        }

    return {
        "per_scenario": per_scenario,
        "coordination_value_trend": coordination_value_trend,
        "compaction_analysis": compaction_analysis,
    }


def _compute_trend(x: list, y: list) -> dict:
    """Compute linear trend (slope + direction)."""
    if len(x) < 2 or len(set(y)) < 2:
        return {"slope": 0.0, "direction": "flat", "r_squared": 0.0}
    slope, intercept, r, p, se = sp_stats.linregress(x, y)
    direction = "increasing" if slope > 0 and p < 0.1 else "decreasing" if slope < 0 and p < 0.1 else "flat"
    return {"slope": float(slope), "direction": direction, "r_squared": round(float(r ** 2), 3)}
