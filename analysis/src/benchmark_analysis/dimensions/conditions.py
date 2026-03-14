"""Conditions dimension analyzer: pairwise effect sizes, Holm-Bonferroni, ROPE, bootstrap CIs, power."""
from __future__ import annotations
from itertools import combinations

from benchmark_analysis.models import ScoredResult, EffectSize, ConditionSummary, DimensionAnalysis
from benchmark_analysis.stats import (
    cohens_d,
    interpret_cohens_d,
    bootstrap_ci,
    holm_bonferroni,
    mann_whitney_u,
    condition_summary,
    rope_test,
    power_analysis,
    required_sample_size,
)


def analyze_conditions(
    scores: list[ScoredResult],
    baseline: str = "baseline",
    rope: tuple[float, float] = (-5.0, 5.0),
) -> DimensionAnalysis:
    """Analyze all pairwise condition comparisons on composite scores.

    For each ordered pair of conditions:
    - Computes Cohen's d effect size
    - Applies Holm-Bonferroni correction across all pairs
    - Runs ROPE test (prob equivalent / different)
    - Computes bootstrap 95% CI for each condition mean
    - Runs power analysis: observed power and required n for 0.8

    Args:
        scores: list of ScoredResult (typically from load_results).
        baseline: name of the baseline condition (used for ordering in output).
        rope: (lower, upper) bounds for practical equivalence on composite scale.

    Returns:
        DimensionAnalysis with:
            dimension = "conditions"
            summary = human-readable headline
            details = {
                "effect_sizes": [EffectSize, ...],        # all pairwise, corrected
                "condition_summaries": [ConditionSummary, ...],
                "rope_results": {
                    "cond_a|cond_b": {rope_test dict + power dict}, ...
                },
            }
    """
    # ── 1. Group composite scores by condition ────────────────────────────────
    condition_values: dict[str, list[float]] = {}
    for r in scores:
        condition_values.setdefault(r.condition, []).append(r.composite)

    conditions = sorted(condition_values.keys())

    # ── 2. Condition summaries with bootstrap CIs ─────────────────────────────
    summaries: list[ConditionSummary] = [
        condition_summary(c, condition_values[c]) for c in conditions
    ]

    # ── 3. Enumerate all unordered pairs ─────────────────────────────────────
    pairs = list(combinations(conditions, 2))
    if not pairs:
        return DimensionAnalysis(
            dimension="conditions",
            summary="Insufficient conditions for comparison.",
            details={
                "effect_sizes": [],
                "condition_summaries": [s.model_dump() for s in summaries],
                "rope_results": {},
            },
        )

    # Raw p-values in pair order (Mann-Whitney U)
    raw_p_values: list[float] = []
    for a, b in pairs:
        raw_p_values.append(mann_whitney_u(condition_values[a], condition_values[b]))

    corrected_p_values = holm_bonferroni(raw_p_values)

    # ── 4. Build EffectSize objects ───────────────────────────────────────────
    effect_sizes: list[EffectSize] = []
    for i, (a, b) in enumerate(pairs):
        vals_a = condition_values[a]
        vals_b = condition_values[b]
        d = cohens_d(vals_a, vals_b)
        raw_p = raw_p_values[i]
        corr_p = corrected_p_values[i]

        # Bootstrap CI for the mean difference (delta)
        import numpy as np
        mean_a = float(np.mean(vals_a))
        mean_b = float(np.mean(vals_b))
        delta = mean_b - mean_a

        # Bootstrap CI of means for condition A (stored on the effect object for convenience)
        ci_a = bootstrap_ci(vals_a)

        effect_sizes.append(EffectSize(
            condition_a=a,
            condition_b=b,
            metric="composite",
            cohens_d=d,
            interpretation=interpret_cohens_d(d),
            p_value=raw_p,
            p_value_corrected=corr_p,
            significant=(corr_p < 0.05),
            mean_a=mean_a,
            mean_b=mean_b,
            delta=delta,
            ci_lower=ci_a[0],
            ci_upper=ci_a[1],
        ))

    # ── 5. ROPE tests + power for each pair ──────────────────────────────────
    rope_results: dict[str, dict] = {}
    for a, b in pairs:
        vals_a = condition_values[a]
        vals_b = condition_values[b]
        key = f"{a}|{b}"

        rope_res = rope_test(vals_a, vals_b, rope=rope)

        n_per_group = min(len(vals_a), len(vals_b))
        d = cohens_d(vals_a, vals_b)
        abs_d = abs(d)
        obs_power = power_analysis(abs_d, n_per_group)
        req_n = required_sample_size(abs_d)

        rope_results[key] = {
            **rope_res,
            "power": {
                "observed_power": obs_power,
                "n_per_group": n_per_group,
                "required_n_for_0_8_power": req_n,
                "effect_size": d,
            },
        }

    # ── 6. Headline summary ───────────────────────────────────────────────────
    sig_count = sum(1 for e in effect_sizes if e.significant)
    total_pairs = len(effect_sizes)
    baseline_effects = [e for e in effect_sizes if e.condition_a == baseline or e.condition_b == baseline]
    baseline_sig = sum(1 for e in baseline_effects if e.significant)

    summary = (
        f"{sig_count}/{total_pairs} condition pairs significantly different after Holm-Bonferroni "
        f"correction; {baseline_sig}/{len(baseline_effects)} pairs vs '{baseline}' are significant."
    )

    return DimensionAnalysis(
        dimension="conditions",
        summary=summary,
        details={
            "effect_sizes": [e.model_dump() for e in effect_sizes],
            "condition_summaries": [s.model_dump() for s in summaries],
            "rope_results": rope_results,
        },
    )
