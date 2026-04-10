"""Attribute coordination lift to specific mechanisms.

Answers: what portion of the lift comes from orientation vs recording vs
graph-building? Which tools are overhead with no measurable benefit?
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult, SessionTranscript
from ._constants import (
    MECHANISM_CATEGORIES,
    ALL_TWINING_OPS,
    normalize_tool_name,
    is_twining_tool,
)


def analyze_effect_decomposition(
    scores: list[ScoredResult],
    transcripts: list[SessionTranscript],
    baseline: str = "baseline",
) -> dict:
    """Decompose coordination lift by mechanism.

    Returns dict with:
      - mechanism_attribution: per-mechanism estimated lift contribution
      - tool_utilization: which tools are actually called, which are never used
      - lite_vs_full: what full-twining adds over twining-lite
      - overhead_candidates: tools called frequently but not correlated with outcomes
    """
    # Compute mechanism usage rates per condition
    mechanism_usage = defaultdict(lambda: defaultdict(list))
    tool_counts = defaultdict(lambda: defaultdict(int))
    tools_ever_called = set()

    # Bytes per mechanism per condition (for bytes-weighted attribution)
    mechanism_bytes: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for t in transcripts:
        tool_names = [tc.toolName for tc in t.toolCalls]
        short_names = [normalize_tool_name(tn) for tn in tool_names]
        for mechanism, tool_set in MECHANISM_CATEGORIES.items():
            count = sum(1 for sn in short_names if sn in tool_set)
            mechanism_usage[t.condition][mechanism].append(count)
        for tc in t.toolCalls:
            sn = normalize_tool_name(tc.toolName)
            if sn in ALL_TWINING_OPS:
                tool_counts[t.condition][sn] += 1
                tools_ever_called.add(sn)
                for mechanism, tool_set in MECHANISM_CATEGORIES.items():
                    if sn in tool_set:
                        mechanism_bytes[t.condition][mechanism] += tc.responseBytes

    # Compute mean composite per condition
    condition_composites = defaultdict(list)
    for s in scores:
        condition_composites[s.condition].append(s.composite)
    condition_means = {c: float(np.mean(v)) for c, v in condition_composites.items()}
    baseline_mean = condition_means.get(baseline, 0)

    # Mechanism attribution: for each mechanism, compare conditions that use it heavily
    # vs those that don't, relative to baseline lift
    mechanism_attribution = []
    for mechanism in MECHANISM_CATEGORIES:
        usage_by_condition = {}
        for condition, mech_data in mechanism_usage.items():
            if mechanism in mech_data:
                usage_by_condition[condition] = float(np.mean(mech_data[mechanism]))
            else:
                usage_by_condition[condition] = 0.0

        # Conditions that use this mechanism vs those that don't
        heavy_users = [c for c, u in usage_by_condition.items() if u > 1.0 and c != baseline]
        non_users = [c for c, u in usage_by_condition.items() if u < 0.5 and c != baseline]

        heavy_mean = float(np.mean([condition_means[c] for c in heavy_users])) if heavy_users else baseline_mean
        non_mean = float(np.mean([condition_means[c] for c in non_users])) if non_users else baseline_mean

        mechanism_attribution.append({
            "mechanism": mechanism,
            "heavy_user_conditions": heavy_users,
            "non_user_conditions": non_users,
            "heavy_user_mean_composite": round(heavy_mean, 2),
            "non_user_mean_composite": round(non_mean, 2),
            "associated_difference": round(heavy_mean - non_mean, 2),
            "caveat": "Descriptive only -- differences are confounded across mechanisms",
            "avg_calls_per_session": round(
                float(np.mean([u for u in usage_by_condition.values() if u > 0])) if any(
                    u > 0 for u in usage_by_condition.values()) else 0, 1),
        })

    # Tool utilization
    never_called = sorted(ALL_TWINING_OPS - tools_ever_called)
    per_tool = []
    for condition, counts in sorted(tool_counts.items()):
        for tool, count in sorted(counts.items(), key=lambda x: -x[1]):
            per_tool.append({"condition": condition, "tool": tool, "count": count})

    # Lite vs full comparison
    lite_vs_full = {}
    if "twining-lite" in condition_means and "full-twining" in condition_means:
        full_only_tools = set()
        lite_tools_used = set(tool_counts.get("twining-lite", {}).keys())
        full_tools_used = set(tool_counts.get("full-twining", {}).keys())
        full_only_tools = full_tools_used - lite_tools_used
        lite_vs_full = {
            "twining_lite_mean": round(condition_means["twining-lite"], 2),
            "full_twining_mean": round(condition_means["full-twining"], 2),
            "delta": round(condition_means["full-twining"] - condition_means["twining-lite"], 2),
            "full_only_tools": sorted(full_only_tools),
            "shared_tools": sorted(full_tools_used & lite_tools_used),
            "conclusion": "full-twining scored higher" if condition_means["full-twining"] > condition_means["twining-lite"] + 2
                          else "twining-lite scored comparably" if condition_means["twining-lite"] >= condition_means["full-twining"] - 2
                          else "marginal difference observed",
        }

    # Bytes-weighted mechanism attribution
    mechanism_bytes_summary = []
    for mechanism in MECHANISM_CATEGORIES:
        bytes_by_cond = {c: mechanism_bytes[c].get(mechanism, 0)
                         for c in mechanism_bytes if mechanism_bytes[c].get(mechanism, 0) > 0}
        mechanism_bytes_summary.append({
            "mechanism": mechanism,
            "total_bytes": sum(bytes_by_cond.values()),
            "bytes_by_condition": dict(sorted(bytes_by_cond.items())),
        })

    return {
        "mechanism_attribution": sorted(mechanism_attribution, key=lambda x: -abs(x["associated_difference"])),
        "mechanism_attribution_bytes": sorted(mechanism_bytes_summary, key=lambda x: -x["total_bytes"]),
        "tool_utilization": {
            "tools_ever_called": sorted(tools_ever_called),
            "never_called": never_called,
            "per_tool_counts": per_tool,
        },
        "lite_vs_full": lite_vs_full,
    }
