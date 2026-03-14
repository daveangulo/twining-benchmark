"""Tests for core statistical functions."""
import numpy as np
import pytest
from benchmark_analysis.stats import (
    cohens_d, bootstrap_ci, holm_bonferroni, rope_test,
    mann_whitney_u, condition_summary,
)


def test_cohens_d_identical():
    assert cohens_d([1, 2, 3], [1, 2, 3]) == 0.0


def test_cohens_d_large_effect():
    d = cohens_d([1, 2, 3], [10, 11, 12])
    assert d > 4.0  # Very large effect


def test_cohens_d_direction():
    d = cohens_d([1, 2, 3], [4, 5, 6])
    assert d > 0  # B > A → positive


def test_cohens_d_single_values():
    assert np.isnan(cohens_d([5], [5]))


def test_bootstrap_ci():
    data = [80, 85, 90, 75, 88]
    lower, upper = bootstrap_ci(data, confidence=0.95, n_bootstrap=1000)
    assert lower < np.mean(data) < upper
    assert lower > 60  # Sanity check
    assert upper < 100


def test_holm_bonferroni():
    p_values = [0.01, 0.04, 0.03, 0.20]
    corrected = holm_bonferroni(p_values)
    assert len(corrected) == 4
    assert all(c >= o for c, o in zip(corrected, p_values))
    assert corrected[0] <= 0.05  # Smallest should still be significant


def test_holm_bonferroni_empty():
    assert holm_bonferroni([]) == []


def test_rope_test_equivalent():
    result = rope_test([50, 50, 50], [51, 50, 49], rope=(-5, 5))
    assert result["decision"] == "equivalent"


def test_rope_test_different():
    result = rope_test([10, 12, 11], [90, 88, 91], rope=(-5, 5))
    assert result["decision"] == "different"


def test_mann_whitney_u():
    p = mann_whitney_u([1, 2, 3], [4, 5, 6])
    assert 0 <= p <= 1


def test_condition_summary():
    s = condition_summary("baseline", [80, 85, 90, 75, 88])
    assert s.condition == "baseline"
    assert s.n == 5
    assert 75 <= s.mean <= 90
    assert s.ci_lower < s.mean < s.ci_upper


# --- interpret_cohens_d ---

def test_interpret_cohens_d_negligible():
    from benchmark_analysis.stats import interpret_cohens_d
    assert interpret_cohens_d(0.0) == "negligible"
    assert interpret_cohens_d(0.19) == "negligible"

def test_interpret_cohens_d_small():
    from benchmark_analysis.stats import interpret_cohens_d
    assert interpret_cohens_d(0.2) == "small"
    assert interpret_cohens_d(0.49) == "small"

def test_interpret_cohens_d_medium():
    from benchmark_analysis.stats import interpret_cohens_d
    assert interpret_cohens_d(0.5) == "medium"

def test_interpret_cohens_d_large():
    from benchmark_analysis.stats import interpret_cohens_d
    assert interpret_cohens_d(0.8) == "large"
    assert interpret_cohens_d(5.0) == "large"

def test_interpret_cohens_d_nan():
    from benchmark_analysis.stats import interpret_cohens_d
    import math
    assert interpret_cohens_d(float('nan')) == "insufficient data"
    assert interpret_cohens_d(float('inf')) == "insufficient data"

def test_interpret_cohens_d_negative():
    from benchmark_analysis.stats import interpret_cohens_d
    assert interpret_cohens_d(-0.8) == "large"  # uses abs


# --- welch_t_test ---

def test_welch_t_test_basic():
    from benchmark_analysis.stats import welch_t_test
    p = welch_t_test([1, 2, 3], [100, 101, 102])
    assert 0 <= p <= 1
    assert p < 0.05  # clearly different groups

def test_welch_t_test_identical():
    from benchmark_analysis.stats import welch_t_test
    import math
    # When both groups have zero variance, scipy returns NaN
    p = welch_t_test([5, 5, 5], [5, 5, 5])
    assert math.isnan(p)  # zero variance in both groups yields NaN

def test_welch_t_test_small_n():
    from benchmark_analysis.stats import welch_t_test
    assert welch_t_test([1], [2]) == 1.0
    assert welch_t_test([], [1, 2]) == 1.0


# --- power_analysis ---

def test_power_analysis_large_effect():
    from benchmark_analysis.stats import power_analysis
    p = power_analysis(1.5, 30)
    assert p > 0.9  # large effect + large n = high power

def test_power_analysis_zero_effect():
    from benchmark_analysis.stats import power_analysis
    p = power_analysis(0.0, 30)
    assert p < 0.1  # zero effect = low power

def test_power_analysis_tiny_n():
    from benchmark_analysis.stats import power_analysis
    p = power_analysis(0.8, 2)
    assert 0 <= p <= 1


# --- required_sample_size ---

def test_required_sample_size_large_effect():
    from benchmark_analysis.stats import required_sample_size
    n = required_sample_size(1.0)
    assert isinstance(n, int)
    assert n < 50  # large effect needs fewer samples

def test_required_sample_size_small_effect():
    from benchmark_analysis.stats import required_sample_size
    n = required_sample_size(0.2)
    assert n > 100  # small effect needs many samples

def test_required_sample_size_zero():
    from benchmark_analysis.stats import required_sample_size
    n = required_sample_size(0.0)
    assert n >= 500  # returns max/fallback


# --- bootstrap_ci edge cases ---

def test_bootstrap_ci_single():
    lo, hi = bootstrap_ci([42.0])
    assert lo == 42.0
    assert hi == 42.0

def test_bootstrap_ci_empty():
    import math
    lo, hi = bootstrap_ci([])
    assert math.isnan(lo)
    assert math.isnan(hi)


# --- interpret_r ---

def test_interpret_r():
    from benchmark_analysis.stats import interpret_r
    assert interpret_r(0.05) == "negligible"
    assert interpret_r(0.25) == "weak"
    assert interpret_r(0.45) == "moderate"
    assert interpret_r(0.65) == "strong"
    assert interpret_r(0.85) == "very strong"
    assert interpret_r(-0.85) == "very strong"
    assert interpret_r(float('nan')) == "insufficient data"


# --- cv ---

def test_cv():
    from benchmark_analysis.stats import cv
    assert cv([10, 10, 10]) == 0.0  # no variance
    result = cv([10, 20, 30])
    assert result > 0  # has variance
    assert cv([]) == 0.0  # empty input
    assert cv([0, 0, 0]) == 0.0  # zero mean


# --- condition_summary empty ---

def test_condition_summary_empty():
    with pytest.raises(ValueError):
        condition_summary("test", [])
