"""Core statistical functions for benchmark analysis."""
from __future__ import annotations
import math
import numpy as np
from scipy import stats as sp_stats
from .models import ConditionSummary


def cohens_d(a: list[float], b: list[float]) -> float:
    """Compute Hedges' g (bias-corrected Cohen's d) effect size: (B - A) / pooled_std.

    Applies the small-sample bias correction factor (Hedges & Olkin, 1985)
    so the returned value is Hedges' g rather than raw Cohen's d.
    """
    a_arr, b_arr = np.array(a, dtype=float), np.array(b, dtype=float)
    if len(a_arr) < 2 or len(b_arr) < 2:
        return float("nan")
    na, nb = len(a_arr), len(b_arr)
    var_a, var_b = np.var(a_arr, ddof=1), np.var(b_arr, ddof=1)
    pooled_std = math.sqrt(((na - 1) * var_a + (nb - 1) * var_b) / (na + nb - 2))
    if pooled_std == 0:
        return 0.0 if np.mean(a_arr) == np.mean(b_arr) else float("inf")
    d = float((np.mean(b_arr) - np.mean(a_arr)) / pooled_std)
    # Hedges' g small-sample bias correction
    df = na + nb - 2
    if df <= 1:
        return d
    correction = 1 - 3 / (4 * df - 1)
    return d * correction


def interpret_cohens_d(d: float) -> str:
    """Interpret Cohen's d as negligible/small/medium/large."""
    if math.isnan(d) or math.isinf(d):
        return "insufficient data"
    abs_d = abs(d)
    if abs_d < 0.2:
        return "negligible"
    elif abs_d < 0.5:
        return "small"
    elif abs_d < 0.8:
        return "medium"
    else:
        return "large"


def interpret_r(r: float) -> str:
    """Interpret a Pearson correlation coefficient by magnitude.

    Thresholds follow Cohen's (1988) conventions:
      <0.1 negligible, <0.3 weak, <0.5 moderate, <0.7 strong, >=0.7 very strong.
    """
    if math.isnan(r) or math.isinf(r):
        return "insufficient data"
    abs_r = abs(r)
    if abs_r < 0.1:
        return "negligible"
    elif abs_r < 0.3:
        return "weak"
    elif abs_r < 0.5:
        return "moderate"
    elif abs_r < 0.7:
        return "strong"
    else:
        return "very strong"


def cv(values: list[float]) -> float:
    """Coefficient of variation as a percentage: (std / |mean|) * 100.

    Returns 0.0 if the mean is zero or the input is empty.
    """
    if not values:
        return 0.0
    arr = np.array(values, dtype=float)
    mean = float(np.mean(arr))
    if mean == 0:
        return 0.0
    std = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
    return float(std / abs(mean) * 100)


def bootstrap_ci(
    data: list[float], confidence: float = 0.95, n_bootstrap: int = 10000,
    seed: int = 42,
) -> tuple[float, float]:
    """Compute bootstrap confidence interval."""
    if not data:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    arr = np.array(data, dtype=float)
    n = len(arr)
    if n < 2:
        return (float(arr[0]), float(arr[0]))
    boot_means = np.array([
        np.mean(rng.choice(arr, size=n, replace=True))
        for _ in range(n_bootstrap)
    ])
    alpha = 1 - confidence
    lower = float(np.percentile(boot_means, 100 * alpha / 2))
    upper = float(np.percentile(boot_means, 100 * (1 - alpha / 2)))
    return (lower, upper)


def holm_bonferroni(p_values: list[float]) -> list[float]:
    """Apply Holm-Bonferroni correction for multiple comparisons."""
    if not p_values:
        return []
    n = len(p_values)
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    corrected = [0.0] * n
    cumulative_max = 0.0
    for rank, (orig_idx, p) in enumerate(indexed):
        adjusted = p * (n - rank)
        cumulative_max = max(cumulative_max, adjusted)
        corrected[orig_idx] = min(cumulative_max, 1.0)
    return corrected


def mann_whitney_u(a: list[float], b: list[float]) -> float:
    """Mann-Whitney U test p-value (two-sided)."""
    if len(a) < 2 or len(b) < 2:
        return 1.0
    _, p = sp_stats.mannwhitneyu(a, b, alternative="two-sided")
    return float(p)


def welch_t_test(a: list[float], b: list[float]) -> float:
    """Welch's t-test p-value (two-sided, unequal variances)."""
    if len(a) < 2 or len(b) < 2:
        return 1.0
    _, p = sp_stats.ttest_ind(a, b, equal_var=False)
    return float(p)


def rope_test(
    a: list[float], b: list[float],
    rope: tuple[float, float] = (-5.0, 5.0),
    n_bootstrap: int = 10000, seed: int = 42,
) -> dict:
    """Region of Practical Equivalence test using bootstrap.

    Returns dict with:
      - prob_equivalent: P(difference in ROPE)
      - prob_different: P(difference outside ROPE)
      - decision: "equivalent", "different", or "undecided"
    """
    rng = np.random.default_rng(seed)
    a_arr, b_arr = np.array(a, dtype=float), np.array(b, dtype=float)

    diffs = []
    for _ in range(n_bootstrap):
        a_sample = rng.choice(a_arr, size=len(a_arr), replace=True)
        b_sample = rng.choice(b_arr, size=len(b_arr), replace=True)
        diffs.append(float(np.mean(b_sample) - np.mean(a_sample)))

    diffs_arr = np.array(diffs)
    in_rope = np.sum((diffs_arr >= rope[0]) & (diffs_arr <= rope[1]))
    prob_equivalent = float(in_rope / n_bootstrap)
    prob_different = 1.0 - prob_equivalent

    if prob_equivalent > 0.95:
        decision = "equivalent"
    elif prob_different > 0.95:
        decision = "different"
    else:
        decision = "undecided"

    return {
        "prob_equivalent": prob_equivalent,
        "prob_different": prob_different,
        "decision": decision,
        "rope": rope,
        "mean_diff": float(np.mean(diffs_arr)),
    }


def power_analysis(
    effect_size: float, n_per_group: int, alpha: float = 0.05,
) -> float:
    """Approximate prospective power for a two-sample t-test.

    Computes the probability of detecting the given effect size at the
    specified alpha and sample size.  This is prospective power at the
    observed effect size -- it is NOT post-hoc power (which is a
    statistical anti-pattern that conflates significance with power).
    """
    effect_size = abs(effect_size)
    if effect_size == 0 or n_per_group < 2:
        return 0.0
    if math.isinf(effect_size) or effect_size > 5:
        return 1.0  # Power is effectively 1 for very large effects
    df = 2 * n_per_group - 2
    ncp = effect_size * math.sqrt(n_per_group / 2)  # Non-centrality parameter
    t_crit = sp_stats.t.ppf(1 - alpha / 2, df)
    power = 1 - sp_stats.nct.cdf(t_crit, df, ncp) + sp_stats.nct.cdf(-t_crit, df, ncp)
    return float(power)


def required_sample_size(
    effect_size: float, power: float = 0.80, alpha: float = 0.05,
) -> int:
    """Estimate required n per group for two-sample t-test."""
    if effect_size == 0:
        return 999
    for n in range(2, 500):
        if power_analysis(effect_size, n, alpha) >= power:
            return n
    return 500


def minimum_detectable_effect(
    n_per_group: int, power: float = 0.80, alpha: float = 0.05,
) -> float:
    """Minimum detectable effect size (MDES) at given n and power.

    This answers the practical question: "with my current sample size,
    what's the smallest effect I can reliably detect?"

    For benchmark harness context:
      - Full 'all' run at 3 iterations: ~21 per condition → MDES ≈ 0.80
      - Full 'all' run at 5 iterations: ~35 per condition → MDES ≈ 0.62
    """
    if n_per_group < 3:
        return float("inf")
    # Binary search for smallest d where power >= target
    lo, hi = 0.01, 5.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if power_analysis(mid, n_per_group, alpha) >= power:
            hi = mid
        else:
            lo = mid
    return round(hi, 2)


def condition_summary(condition: str, values: list[float]) -> ConditionSummary:
    """Compute statistical summary for a condition."""
    if not values:
        raise ValueError("Cannot compute summary for empty values")
    arr = np.array(values, dtype=float)
    ci_lower, ci_upper = bootstrap_ci(values) if len(values) >= 2 else (float(arr[0]), float(arr[0]))
    return ConditionSummary(
        condition=condition,
        n=len(arr),
        mean=float(np.mean(arr)),
        std=float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0,
        median=float(np.median(arr)),
        ci_lower=ci_lower,
        ci_upper=ci_upper,
        min=float(np.min(arr)),
        max=float(np.max(arr)),
    )
