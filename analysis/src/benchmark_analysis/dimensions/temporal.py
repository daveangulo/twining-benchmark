"""Cross-run trend analysis and regression detection."""
from __future__ import annotations
from typing import TYPE_CHECKING
import numpy as np
from collections import defaultdict

if TYPE_CHECKING:
    from ..loader import BenchmarkRun


def analyze_temporal(runs: list[BenchmarkRun]) -> dict:
    """Compare two or more runs to detect regressions and improvements.

    Returns dict with:
      - runs: metadata summary for each run
      - changes: per-condition composite score changes across runs
      - regressions: conditions that got worse
      - improvements: conditions that improved
    """
    if len(runs) < 2:
        return {"runs": [], "changes": [], "regressions": [], "improvements": []}

    run_summaries = []
    for run in runs:
        by_condition = defaultdict(list)
        for s in run.scores:
            by_condition[s.condition].append(s.composite)
        condition_means = {c: float(np.mean(v)) for c, v in by_condition.items()}
        run_summaries.append({
            "run_id": run.metadata.id,
            "timestamp": run.metadata.timestamp,
            "condition_means": condition_means,
        })

    # Compare last two runs
    prev, curr = run_summaries[-2], run_summaries[-1]
    changes = []
    regressions = []
    improvements = []
    all_conditions = set(prev["condition_means"]) | set(curr["condition_means"])
    for condition in sorted(all_conditions):
        prev_mean = prev["condition_means"].get(condition)
        curr_mean = curr["condition_means"].get(condition)
        if prev_mean is not None and curr_mean is not None:
            delta = curr_mean - prev_mean
            entry = {
                "condition": condition,
                "previous_mean": round(prev_mean, 2),
                "current_mean": round(curr_mean, 2),
                "delta": round(delta, 2),
            }
            changes.append(entry)
            if delta < -5:
                regressions.append(entry)
            elif delta > 5:
                improvements.append(entry)

    return {
        "runs": run_summaries,
        "changes": changes,
        "regressions": regressions,
        "improvements": improvements,
    }
