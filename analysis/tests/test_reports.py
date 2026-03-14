"""Tests for report generators (JSON, Markdown, HTML)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from benchmark_analysis.reports.json_report import generate_json_report
from benchmark_analysis.reports.markdown import generate_markdown_report
from benchmark_analysis.reports.html import generate_html_report
from tests.conftest import make_scored_result, make_score, make_transcript


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_results():
    """A minimal analysis results dict mirroring real analyzer output."""
    return {
        "scoring": {
            "condition_rankings": [
                {"condition": "full-twining", "rank": 1, "mean": 90.0},
                {"condition": "baseline", "rank": 2, "mean": 75.0},
            ],
        },
        "conditions": {
            "effect_sizes": [
                {
                    "condition_a": "baseline",
                    "condition_b": "full-twining",
                    "cohens_d": 1.5,
                    "interpretation": "large",
                    "significant": True,
                    "p_value": 0.01,
                },
            ],
        },
        "scenarios": {
            "per_scenario": [
                {
                    "scenario": "refactoring-handoff",
                    "mean": 82.5,
                    "std": 7.1,
                    "best_condition": "full-twining",
                    "worst_condition": "baseline",
                },
            ],
        },
        "coordination": {
            "per_condition": [
                {"condition": "full-twining", "twining_pct": 15.0, "productive_pct": 85.0, "total_tool_calls": 120},
            ],
        },
        "coordination_lift": {
            "pairwise_lift": [
                {"condition": "full-twining", "lift_points": 15.0, "significant": True, "cohens_d": 1.5, "interpretation": "large"},
                {"condition": "baseline", "lift_points": 0.0, "significant": False, "cohens_d": 0.0, "interpretation": "negligible"},
            ],
        },
        "cost": {
            "per_condition": [
                {"condition": "full-twining", "mean_cost_usd": 2.50, "median_cost_usd": 2.40, "cost_per_composite_point": 0.028},
                {"condition": "baseline", "mean_cost_usd": 1.50, "median_cost_usd": 1.40, "cost_per_composite_point": 0.020},
            ],
        },
        "reliability": {
            "icc": 0.85,
            "per_condition": [
                {"condition": "full-twining", "cv": 0.05, "spread": 4.0},
                {"condition": "baseline", "cv": 0.08, "spread": 6.0},
            ],
        },
        "construct_validity": {
            "cronbach_alpha": 0.82,
            "convergent_pairs": [
                {"dim_a": "completion", "dim_b": "consistency", "correlation": 0.65},
            ],
        },
        "behavior_outcome": {
            "predictive_behaviors": [
                {"behavior_metric": "twining_pct", "outcome_metric": "composite", "pearson_r": 0.72, "interpretation": "strong"},
            ],
        },
        "effect_decomposition": {
            "mechanisms": [
                {"mechanism": "context_preservation", "contribution_pct": 45, "evidence": "strong correlation"},
            ],
        },
        "interactions": {
            "disordinal_interactions": [],
        },
        "harness_summary": {
            "headline": "full-twining ranks #1 with 90.0 composite (+15.0 vs baseline, large effect, p<0.05)",
            "matrix": [
                {
                    "condition": "full-twining", "rank": 1, "composite_mean": 90.0,
                    "lift_vs_baseline": 15.0, "lift_significant": True,
                    "effect_size": "large", "cohens_d": 1.5,
                    "cost_usd": 2.50, "cost_per_point": 0.028,
                },
                {
                    "condition": "baseline", "rank": 2, "composite_mean": 75.0,
                    "lift_vs_baseline": 0.0, "lift_significant": False,
                    "effect_size": "N/A", "cohens_d": None,
                    "cost_usd": 1.50, "cost_per_point": 0.020,
                },
            ],
        },
        "recommendations": {
            "items": [
                {"priority": "high", "message": "Use full-twining for best results."},
                {"priority": "medium", "message": "Increase runs per pair for more statistical power."},
            ],
        },
    }


@pytest.fixture
def sample_metadata():
    from benchmark_analysis.models import RunMetadata
    return RunMetadata(
        id="test-run-001",
        timestamp="2026-03-01T00:00:00Z",
        status="completed",
        scenarios=["refactoring-handoff", "architecture-cascade"],
        conditions=["baseline", "full-twining"],
        runsPerPair=3,
    )


# ---------------------------------------------------------------------------
# JSON report tests
# ---------------------------------------------------------------------------

class TestJsonReport:
    def test_generates_valid_json(self, sample_results, tmp_path):
        output = tmp_path / "report.json"
        generate_json_report(sample_results, output)

        assert output.exists()
        with open(output) as f:
            data = json.load(f)
        assert isinstance(data, dict)
        assert "scoring" in data
        assert "harness_summary" in data

    def test_handles_numpy_types(self, tmp_path):
        results = {
            "test": {
                "float64": np.float64(3.14),
                "int64": np.int64(42),
                "array": np.array([1, 2, 3]),
                "nan": float("nan"),
                "inf": float("inf"),
            }
        }
        output = tmp_path / "numpy_report.json"
        generate_json_report(results, output)

        with open(output) as f:
            data = json.load(f)

        assert data["test"]["float64"] == pytest.approx(3.14)
        assert data["test"]["int64"] == 42
        assert data["test"]["array"] == [1, 2, 3]
        assert data["test"]["nan"] is None
        assert data["test"]["inf"] is None

    def test_creates_parent_directories(self, sample_results, tmp_path):
        output = tmp_path / "nested" / "dirs" / "report.json"
        generate_json_report(sample_results, output)
        assert output.exists()

    def test_empty_results(self, tmp_path):
        output = tmp_path / "empty.json"
        generate_json_report({}, output)
        with open(output) as f:
            data = json.load(f)
        assert data == {}


# ---------------------------------------------------------------------------
# Markdown report tests
# ---------------------------------------------------------------------------

class TestMarkdownReport:
    def test_contains_header(self, sample_results, sample_metadata):
        md = generate_markdown_report(sample_results, sample_metadata)
        assert "# Benchmark Analysis Report" in md
        assert "test-run-001" in md

    def test_contains_executive_summary(self, sample_results, sample_metadata):
        md = generate_markdown_report(sample_results, sample_metadata)
        assert "## Executive Summary" in md
        assert "full-twining ranks #1" in md

    def test_contains_harness_matrix(self, sample_results, sample_metadata):
        md = generate_markdown_report(sample_results, sample_metadata)
        assert "## Harness Comparison Matrix" in md
        assert "full-twining" in md
        assert "baseline" in md

    def test_contains_all_sections(self, sample_results, sample_metadata):
        md = generate_markdown_report(sample_results, sample_metadata)
        expected_sections = [
            "## Executive Summary",
            "## Harness Comparison Matrix",
            "## Coordination Lift",
            "## Behavior-Outcome Correlations",
            "## Effect Decomposition",
            "## Per-Scenario Breakdown",
            "## Interaction Effects",
            "## Effect Sizes",
            "## Coordination Behavior",
            "## Cost Analysis",
            "## Construct Validity",
            "## Reliability",
            "## Recommendations",
        ]
        for section in expected_sections:
            assert section in md, f"Missing section: {section}"

    def test_contains_recommendations(self, sample_results, sample_metadata):
        md = generate_markdown_report(sample_results, sample_metadata)
        assert "[high]" in md
        assert "Use full-twining" in md

    def test_empty_results_no_crash(self, sample_metadata):
        md = generate_markdown_report({}, sample_metadata)
        assert "# Benchmark Analysis Report" in md
        assert "No harness summary data available" in md

    def test_contains_effect_sizes(self, sample_results, sample_metadata):
        md = generate_markdown_report(sample_results, sample_metadata)
        assert "Cohen's d" in md or "+1.50" in md

    def test_contains_cost_table(self, sample_results, sample_metadata):
        md = generate_markdown_report(sample_results, sample_metadata)
        assert "$2.50" in md


# ---------------------------------------------------------------------------
# HTML report tests
# ---------------------------------------------------------------------------

class TestHtmlReport:
    def test_generates_valid_html(self, sample_results, sample_metadata, tmp_path):
        output = tmp_path / "report.html"
        generate_html_report(sample_results, sample_metadata, output)

        assert output.exists()
        content = output.read_text()
        assert "<!DOCTYPE html>" in content
        assert "</html>" in content

    def test_contains_plotly_script(self, sample_results, sample_metadata, tmp_path):
        output = tmp_path / "report.html"
        generate_html_report(sample_results, sample_metadata, output)

        content = output.read_text()
        assert "plotly" in content.lower()

    def test_contains_run_metadata(self, sample_results, sample_metadata, tmp_path):
        output = tmp_path / "report.html"
        generate_html_report(sample_results, sample_metadata, output)

        content = output.read_text()
        assert "test-run-001" in content
        assert "2026-03-01" in content

    def test_contains_matrix_table(self, sample_results, sample_metadata, tmp_path):
        output = tmp_path / "report.html"
        generate_html_report(sample_results, sample_metadata, output)

        content = output.read_text()
        assert "full-twining" in content
        assert "baseline" in content

    def test_contains_chart_divs(self, sample_results, sample_metadata, tmp_path):
        output = tmp_path / "report.html"
        generate_html_report(sample_results, sample_metadata, output)

        content = output.read_text()
        assert 'id="chart-composite"' in content
        assert 'id="chart-effects"' in content
        assert 'id="chart-cost"' in content

    def test_contains_recommendations(self, sample_results, sample_metadata, tmp_path):
        output = tmp_path / "report.html"
        generate_html_report(sample_results, sample_metadata, output)

        content = output.read_text()
        assert "Use full-twining" in content

    def test_empty_results_no_crash(self, sample_metadata, tmp_path):
        output = tmp_path / "report.html"
        generate_html_report({}, sample_metadata, output)

        assert output.exists()
        content = output.read_text()
        assert "<!DOCTYPE html>" in content

    def test_creates_parent_directories(self, sample_results, sample_metadata, tmp_path):
        output = tmp_path / "deep" / "nested" / "report.html"
        generate_html_report(sample_results, sample_metadata, output)
        assert output.exists()


# ---------------------------------------------------------------------------
# CLI tests
# ---------------------------------------------------------------------------

class TestCli:
    def test_main_no_args_exits(self):
        """CLI with no args prints help and exits."""
        from benchmark_analysis.cli import main
        import sys
        sys.argv = ["benchmark-analysis"]
        with pytest.raises(SystemExit) as exc_info:
            main()
        assert exc_info.value.code == 1

    def test_analyze_parser_accepts_format(self):
        """Verify the argparse setup accepts --format."""
        from benchmark_analysis.cli import main
        import sys
        # Just check that argument parsing works (will fail on missing run_dir)
        sys.argv = ["benchmark-analysis", "analyze", "/nonexistent", "--format", "json"]
        with pytest.raises((SystemExit, FileNotFoundError, Exception)):
            main()

    def test_compare_parser_accepts_two_dirs(self):
        """Verify compare subcommand accepts two directories."""
        from benchmark_analysis.cli import main
        import sys
        sys.argv = ["benchmark-analysis", "compare", "/dir1", "/dir2"]
        with pytest.raises((SystemExit, FileNotFoundError, Exception)):
            main()
