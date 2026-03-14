"""Construct validity: are the benchmark measurements reliable and meaningful?

Answers: do scoring dimensions that should correlate actually correlate?
Are scores consistent across iterations? Are confidence levels informative?
"""
from __future__ import annotations
from collections import defaultdict
from itertools import combinations
import numpy as np
from scipy import stats as sp_stats
from ..models import ScoredResult
from ..stats import holm_bonferroni


def analyze_construct_validity(scores: list[ScoredResult]) -> dict:
    """Analyze measurement quality and construct validity.

    Returns dict with:
      - dimension_correlations: pairwise Pearson r between scoring dimensions
      - internal_consistency: per-dimension CV within scenario x condition pairs (test-retest reliability)
      - confidence_distribution: breakdown of scorer confidence levels and whether they predict accuracy
      - method_agreement: comparison of automated vs llm-judge scoring methods where both exist
      - composite_validity: does composite correlate with individual dimensions as expected?
    """
    # Collect per-dimension values
    dim_values = defaultdict(list)
    dim_pairs = defaultdict(lambda: defaultdict(list))  # scenario x condition -> dim -> values
    confidence_counts = defaultdict(int)
    method_counts = defaultdict(int)

    for s in scores:
        for dim_name, dim_score in s.scores.items():
            dim_values[dim_name].append(dim_score.value)
            dim_pairs[(s.scenario, s.condition)][dim_name].append(dim_score.value)
            confidence_counts[dim_score.confidence] += 1
            method_counts[dim_score.method] += 1

    # Dimension intercorrelations
    dim_names = sorted(dim_values.keys())
    dimension_correlations = []
    for d1, d2 in combinations(dim_names, 2):
        # Only correlate dimensions that co-occur in the same results
        paired_v1, paired_v2 = [], []
        for s in scores:
            if d1 in s.scores and d2 in s.scores:
                paired_v1.append(s.scores[d1].value)
                paired_v2.append(s.scores[d2].value)
        if len(paired_v1) >= 4 and len(set(paired_v1)) > 1 and len(set(paired_v2)) > 1:
            r, p = sp_stats.pearsonr(paired_v1, paired_v2)
            dimension_correlations.append({
                "dim_a": d1, "dim_b": d2,
                "pearson_r": round(float(r), 3),
                "p_value": round(float(p), 4),
                "p_value_corrected": None,  # will be set after Holm-Bonferroni
                "n": len(paired_v1),
                "interpretation": "redundant" if abs(r) > 0.9 else
                                  "strongly related" if abs(r) > 0.7 else
                                  "moderately related" if abs(r) > 0.4 else
                                  "weakly related" if abs(r) > 0.2 else "independent",
            })

    # Apply Holm-Bonferroni correction to dimension correlations
    if dimension_correlations:
        raw_ps = [dc["p_value"] for dc in dimension_correlations]
        corrected_ps = holm_bonferroni(raw_ps)
        for dc, cp in zip(dimension_correlations, corrected_ps):
            dc["p_value_corrected"] = round(cp, 4)

    # Internal consistency (test-retest across iterations)
    internal_consistency = []
    for (scenario, condition), dims in sorted(dim_pairs.items()):
        for dim_name, values in sorted(dims.items()):
            if len(values) < 2:
                continue
            arr = np.array(values)
            mean = float(np.mean(arr))
            std = float(np.std(arr, ddof=1))
            cv = (std / mean * 100) if mean > 0 else 0.0
            internal_consistency.append({
                "scenario": scenario, "condition": condition, "dimension": dim_name,
                "n": len(values), "mean": round(mean, 1), "std": round(std, 2),
                "cv_pct": round(cv, 1),
                "reliable": cv < 20,
            })

    # Confidence distribution
    total_scores = sum(confidence_counts.values())
    confidence_distribution = {
        level: {"count": count, "pct": round(count / max(total_scores, 1) * 100, 1)}
        for level, count in sorted(confidence_counts.items())
    }

    # Method agreement: collect PAIRED values where the SAME ScoredResult has
    # both automated and llm-judge scores for the same dimension.
    method_paired = defaultdict(lambda: {"automated": [], "llm-judge": []})
    for s in scores:
        for dim_name, dim_score in s.scores.items():
            if dim_score.method in ("automated", "llm-judge"):
                method_paired[dim_name][dim_score.method].append((id(s), dim_score.value))

    method_agreement = []
    for dim_name in sorted(method_paired.keys()):
        auto_map = {sid: val for sid, val in method_paired[dim_name]["automated"]}
        llm_map = {sid: val for sid, val in method_paired[dim_name]["llm-judge"]}
        # Only keep values where the same ScoredResult has both methods
        common_ids = set(auto_map.keys()) & set(llm_map.keys())
        if len(common_ids) >= 3:
            paired_auto = [auto_map[sid] for sid in sorted(common_ids)]
            paired_llm = [llm_map[sid] for sid in sorted(common_ids)]
            if len(set(paired_auto)) > 1 and len(set(paired_llm)) > 1:
                r, p = sp_stats.pearsonr(paired_auto, paired_llm)
                method_agreement.append({
                    "dimension": dim_name,
                    "pearson_r": round(float(r), 3),
                    "n_paired": len(common_ids),
                    "automated_mean": round(float(np.mean(paired_auto)), 1),
                    "llm_judge_mean": round(float(np.mean(paired_llm)), 1),
                    "agreement": "good" if abs(r) > 0.7 else "moderate" if abs(r) > 0.4 else "poor",
                })

    # Composite validity: does composite correlate with dimension scores?
    composite_validity = []
    for dim_name in dim_names:
        composites, dim_vals = [], []
        for s in scores:
            if dim_name in s.scores:
                composites.append(s.composite)
                dim_vals.append(s.scores[dim_name].value)
        if len(composites) >= 4 and len(set(composites)) > 1 and len(set(dim_vals)) > 1:
            r, p = sp_stats.pearsonr(composites, dim_vals)
            composite_validity.append({
                "dimension": dim_name,
                "correlation_with_composite": round(float(r), 3),
                "p_value": round(float(p), 4),
                "contributes_to_composite": abs(r) > 0.3,
            })

    return {
        "dimension_correlations": dimension_correlations,
        "internal_consistency": internal_consistency,
        "confidence_distribution": confidence_distribution,
        "method_agreement": method_agreement,
        "composite_validity": composite_validity,
        "method_distribution": dict(method_counts),
    }
