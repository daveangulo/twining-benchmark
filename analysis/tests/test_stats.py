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
