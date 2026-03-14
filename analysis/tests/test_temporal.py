"""Tests for temporal cross-run comparison analyzer."""
from dataclasses import dataclass
from pathlib import Path
from tests.conftest import make_scored_result
from benchmark_analysis.models import RunMetadata
from benchmark_analysis.dimensions.temporal import analyze_temporal


@dataclass
class FakeRun:
    metadata: RunMetadata
    scores: list
    transcripts: list
    session_data: list
    path: Path


def _make_run(run_id, timestamp, condition_composites):
    """Create a fake BenchmarkRun with given condition->composite mappings."""
    scores = []
    for condition, composite in condition_composites.items():
        scores.append(make_scored_result(
            scenario="s1", condition=condition, composite=composite,
        ))
    metadata = RunMetadata(
        id=run_id, timestamp=timestamp, status="completed",
        scenarios=["s1"], conditions=list(condition_composites.keys()),
        runsPerPair=1,
    )
    return FakeRun(
        metadata=metadata, scores=scores,
        transcripts=[], session_data=[], path=Path("/tmp"),
    )


def test_temporal_detects_regression():
    run1 = _make_run("run1", "2026-03-01T00:00:00Z", {"baseline": 80, "treatment": 90})
    run2 = _make_run("run2", "2026-03-02T00:00:00Z", {"baseline": 80, "treatment": 70})
    result = analyze_temporal([run1, run2])
    assert len(result["regressions"]) == 1
    assert result["regressions"][0]["condition"] == "treatment"


def test_temporal_detects_improvement():
    run1 = _make_run("run1", "2026-03-01T00:00:00Z", {"baseline": 70, "treatment": 70})
    run2 = _make_run("run2", "2026-03-02T00:00:00Z", {"baseline": 70, "treatment": 85})
    result = analyze_temporal([run1, run2])
    assert len(result["improvements"]) == 1
    assert result["improvements"][0]["condition"] == "treatment"


def test_temporal_single_run_returns_empty():
    run1 = _make_run("run1", "2026-03-01T00:00:00Z", {"baseline": 80})
    result = analyze_temporal([run1])
    assert result["runs"] == []
    assert result["changes"] == []
