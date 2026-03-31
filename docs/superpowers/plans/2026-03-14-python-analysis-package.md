# Python Analysis Package Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Python package (`analysis/`) that loads benchmark results and produces comprehensive statistical analysis across 16 dimensions, with Markdown, HTML, and JSON output. The analysis must support two research objectives: (1) comparing agent harness architectures (memory, context compression, communication) and (2) providing rigorous quantitative benchmark validation.

**Architecture:** Standalone Python package at `analysis/` with its own `pyproject.toml`. Loads data from `benchmark-results/<run-id>/` (scores/*.json, sessions/*/transcript.json, sessions/*/coordination-artifacts.json, metadata.json). Core pipeline: loader → pandas DataFrames → dimension analyzers → report generators. Each dimension analyzer is a pure function that takes DataFrames and returns structured results. CLI entry point at `python -m benchmark_analysis`.

**Tech Stack:** Python 3.12+, pandas, numpy, scipy (stats), matplotlib, plotly, jinja2, pydantic, pytest

---

## File Structure

```
analysis/
  pyproject.toml                          # Package config, dependencies, CLI entry point
  src/benchmark_analysis/
    __init__.py
    __main__.py                           # Enables `python -m benchmark_analysis`
    loader.py                             # Load run data into DataFrames
    models.py                             # Pydantic models for scores, metadata, analysis results
    stats.py                              # Core statistical functions (Cohen's d, bootstrap CI, Holm-Bonferroni, ROPE)
    dimensions/
      __init__.py
      scoring.py                          # Score distributions, composites, per-dimension breakdowns
      conditions.py                       # Condition comparisons, rankings, effect sizes
      scenarios.py                        # Scenario discrimination, ceiling/floor detection
      coordination.py                     # Tool call patterns, engagement, overhead ratios
      coordination_lift.py                # CoordinationLift: delta between standalone and coordinated scores
      cost.py                             # Token/cost efficiency analysis
      reliability.py                      # Variance, power analysis, sample size recommendations
      temporal.py                         # Cross-run trend analysis, regression detection
      recommendations.py                  # Synthesized improvement suggestions from all dimensions
      scorer_diagnostics.py               # Detect broken/insensitive scorers
      sessions.py                         # Per-session transcript deep dive
      behavior_outcome.py                 # Correlation between coordination behaviors and outcomes
      effect_decomposition.py             # Attribute lift to specific coordination mechanisms
      learning_curve.py                   # Session-order performance trends in multi-session scenarios
      interactions.py                     # Scenario × condition interaction effects
      construct_validity.py               # Scorer reliability, inter-dimension correlation, convergent validity
      harness_summary.py                  # Single harness comparison summary matrix
    reports/
      __init__.py
      markdown.py                         # Markdown report generator
      html.py                             # HTML + plotly interactive charts
      json_report.py                      # Structured JSON output
      templates/                          # Jinja2 templates for HTML reports
        report.html.j2
    cli.py                                # CLI: analyze, compare, report
  tests/
    __init__.py
    conftest.py                           # Shared fixtures (sample score data, sample transcripts)
    test_loader.py
    test_stats.py
    test_scoring.py
    test_conditions.py
    test_scenarios.py
    test_coordination.py
    test_cost.py
    test_reliability.py
    test_coordination_lift.py
    test_behavior_outcome.py
    test_effect_decomposition.py
    test_learning_curve.py
    test_interactions.py
    test_construct_validity.py
    test_harness_summary.py
    test_reports.py
```

---

## Chunk 1: Foundation — Package, Models, Loader, Stats

### Task 1: Scaffold the Python package

**Files:**
- Create: `analysis/pyproject.toml`
- Create: `analysis/src/benchmark_analysis/__init__.py`

- [ ] **Step 1: Create `analysis/pyproject.toml`**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "benchmark-analysis"
version = "0.1.0"
description = "Statistical analysis for Twining benchmark results"
requires-python = ">=3.12"
dependencies = [
    "pandas>=2.0",
    "numpy>=1.24",
    "scipy>=1.10",
    "matplotlib>=3.7",
    "plotly>=5.15",
    "pydantic>=2.0",
    "jinja2>=3.1",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-cov>=4.0",
]

[project.scripts]
benchmark-analysis = "benchmark_analysis.cli:main"

[tool.hatch.build.targets.wheel]
packages = ["src/benchmark_analysis"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 2: Create `analysis/src/benchmark_analysis/__init__.py`**

```python
"""Twining benchmark results analysis package."""
__version__ = "0.1.0"
```

- [ ] **Step 2b: Create `analysis/src/benchmark_analysis/__main__.py`**

```python
"""Enable `python -m benchmark_analysis`."""
from .cli import main

main()
```

- [ ] **Step 3: Create directory structure**

```bash
mkdir -p analysis/src/benchmark_analysis/dimensions
mkdir -p analysis/src/benchmark_analysis/reports/templates
mkdir -p analysis/tests
touch analysis/src/benchmark_analysis/dimensions/__init__.py
touch analysis/src/benchmark_analysis/reports/__init__.py
touch analysis/tests/__init__.py
```

- [ ] **Step 4: Install in dev mode and verify**

```bash
cd analysis && pip install -e ".[dev]" && python -c "import benchmark_analysis; print(benchmark_analysis.__version__)"
```
Expected: prints `0.1.0`

- [ ] **Step 5: Commit**

```bash
git add analysis/
git commit -m "feat(analysis): scaffold Python analysis package with pyproject.toml"
```

---

### Task 2: Pydantic models for benchmark data

**Files:**
- Create: `analysis/src/benchmark_analysis/models.py`
- Create: `analysis/tests/conftest.py`

- [ ] **Step 1: Create `analysis/src/benchmark_analysis/models.py`**

```python
"""Pydantic models for benchmark data structures."""
from __future__ import annotations
from pydantic import BaseModel
from typing import Any


class GitChurn(BaseModel):
    filesChanged: int
    linesAdded: int
    linesRemoved: int
    reverts: int


class RunMetrics(BaseModel):
    agentSessions: int
    totalTokens: int
    inputTokens: int
    outputTokens: int
    cacheReadTokens: int
    cacheCreationTokens: int
    costUsd: float
    wallTimeMs: int
    numTurns: int
    compactionCount: int
    contextUtilization: float
    gitChurn: GitChurn
    testsPass: int
    testsFail: int
    compiles: bool


class DimensionScore(BaseModel):
    value: float
    confidence: str
    method: str
    justification: str
    dataQuality: str | None = None


class ScoredResult(BaseModel):
    """A single scored iteration (one score file)."""
    runId: str
    scenario: str
    condition: str
    iteration: int
    composite: float
    scores: dict[str, DimensionScore]
    metrics: RunMetrics


class ToolCall(BaseModel):
    toolName: str
    parameters: dict[str, Any] = {}
    timestamp: str = ""
    durationMs: int = 0
    tokenUsage: dict[str, Any] | None = None  # Per-tool-call token usage (result omitted intentionally — can be very large)


class TokenUsage(BaseModel):
    input: int
    output: int
    cacheRead: int
    cacheCreation: int
    total: int
    costUsd: float


class TurnUsage(BaseModel):
    turnIndex: int
    type: str  # "message" or "compaction"
    inputTokens: int = 0
    outputTokens: int = 0
    cacheReadTokens: int = 0
    cacheCreationTokens: int = 0


class SessionTiming(BaseModel):
    startTime: str
    endTime: str
    durationMs: int
    timeToFirstActionMs: int


class FileChange(BaseModel):
    path: str
    changeType: str
    linesAdded: int
    linesRemoved: int
    diff: str | None = None


class SessionTranscript(BaseModel):
    """A single agent session transcript."""
    sessionId: str
    runId: str
    scenario: str
    condition: str
    taskIndex: int
    prompt: str = ""
    toolCalls: list[ToolCall] = []
    fileChanges: list[FileChange] = []
    tokenUsage: TokenUsage
    timing: SessionTiming
    exitReason: str
    numTurns: int
    compactionCount: int = 0
    stopReason: str | None = None
    contextWindowSize: int = 0
    turnUsage: list[TurnUsage] = []


class CoordinationArtifacts(BaseModel):
    """Pre/post Twining state captured per session."""
    preSessionState: dict[str, str] = {}
    postSessionState: dict[str, str] = {}
    changes: list[str] = []


class EnvironmentInfo(BaseModel):
    claudeModel: str = ""
    evaluatorModel: str = ""
    harnessCommitSha: str = ""
    harnessVersion: str = ""
    nodeVersion: str = ""
    platform: str = ""
    twiningMcpVersion: str = ""


class RunConfig(BaseModel):
    agentTimeoutMs: int = 0
    budgetDollars: float = 0
    defaultRuns: int = 0
    evaluatorModel: str = ""
    maxTurns: int = 0
    outputDirectory: str = ""
    retryCount: int = 0
    tokenBudgetPerRun: int = 0


class RunMetadata(BaseModel):
    """Top-level metadata for a benchmark run."""
    id: str
    timestamp: str
    status: str
    scenarios: list[str]
    conditions: list[str]
    runsPerPair: int
    seed: str = ""
    duration: int = 0
    environment: EnvironmentInfo = EnvironmentInfo()
    config: RunConfig = RunConfig()


# --- Analysis result models ---

class EffectSize(BaseModel):
    """Statistical effect size between two conditions."""
    condition_a: str
    condition_b: str
    metric: str
    cohens_d: float
    interpretation: str  # negligible, small, medium, large
    p_value: float
    p_value_corrected: float | None = None  # Holm-Bonferroni corrected
    significant: bool = False
    mean_a: float
    mean_b: float
    delta: float
    ci_lower: float = 0.0
    ci_upper: float = 0.0


class ConditionSummary(BaseModel):
    """Statistical summary for a condition across scenarios."""
    condition: str
    n: int
    mean: float
    std: float
    median: float
    ci_lower: float
    ci_upper: float
    min: float
    max: float


class DimensionAnalysis(BaseModel):
    """Analysis results for a single analysis dimension."""
    dimension: str
    summary: str
    details: dict[str, Any] = {}
```

- [ ] **Step 2: Create `analysis/tests/conftest.py` with shared fixtures**

```python
"""Shared test fixtures for benchmark analysis tests."""
import pytest
from benchmark_analysis.models import (
    ScoredResult, DimensionScore, RunMetrics, GitChurn,
    ToolCall, SessionTranscript, TokenUsage, SessionTiming,
    TurnUsage, CoordinationArtifacts,
    RunMetadata, EnvironmentInfo, RunConfig,
)


def make_score(value: float = 75.0, confidence: str = "medium") -> DimensionScore:
    return DimensionScore(
        value=value, confidence=confidence,
        method="automated", justification="test",
    )


def make_metrics(**overrides) -> RunMetrics:
    defaults = dict(
        agentSessions=2, totalTokens=1000000, inputTokens=50,
        outputTokens=20000, cacheReadTokens=900000, cacheCreationTokens=50000,
        costUsd=1.50, wallTimeMs=300000, numTurns=40,
        compactionCount=0, contextUtilization=0.0,
        gitChurn=GitChurn(filesChanged=5, linesAdded=200, linesRemoved=10, reverts=0),
        testsPass=95, testsFail=0, compiles=True,
    )
    defaults.update(overrides)
    return RunMetrics(**defaults)


def make_scored_result(
    scenario: str = "refactoring-handoff",
    condition: str = "baseline",
    iteration: int = 0,
    composite: float = 80.0,
    scores: dict[str, DimensionScore] | None = None,
    **metric_overrides,
) -> ScoredResult:
    if scores is None:
        scores = {"completion": make_score(100), "consistency": make_score(80), "rework": make_score(100)}
    return ScoredResult(
        runId="test-run", scenario=scenario, condition=condition,
        iteration=iteration, composite=composite,
        scores=scores, metrics=make_metrics(**metric_overrides),
    )


def make_tool_call(
    name: str = "Read",
    params: dict | None = None,
    timestamp: str = "2026-03-01T00:00:00Z",
) -> ToolCall:
    return ToolCall(
        toolName=name, parameters=params or {},
        timestamp=timestamp, durationMs=50,
    )


def make_transcript(
    scenario: str = "refactoring-handoff",
    condition: str = "baseline",
    task_index: int = 0,
    tool_calls: list[ToolCall] | None = None,
    num_turns: int = 20,
    cost: float = 1.0,
    duration_ms: int = 300000,
) -> SessionTranscript:
    return SessionTranscript(
        sessionId="test-session", runId="test-run",
        scenario=scenario, condition=condition,
        taskIndex=task_index, toolCalls=tool_calls or [],
        fileChanges=[], numTurns=num_turns,
        tokenUsage=TokenUsage(
            input=50, output=10000, cacheRead=500000,
            cacheCreation=25000, total=535050, costUsd=cost,
        ),
        timing=SessionTiming(
            startTime="2026-03-01T00:00:00Z",
            endTime="2026-03-01T00:05:00Z",
            durationMs=duration_ms, timeToFirstActionMs=10000,
        ),
        exitReason="completed",
    )


@pytest.fixture
def sample_scores() -> list[ScoredResult]:
    """A minimal dataset: 2 scenarios x 8 conditions x 3 iterations = 48 results."""
    results = []
    condition_bases = {
        "baseline": 75,
        "claude-md-only": 78,
        "shared-markdown": 80,
        "file-reload-generic": 82,
        "file-reload-structured": 85,
        "persistent-history": 83,
        "twining-lite": 88,
        "full-twining": 90,
    }
    for scenario in ["refactoring-handoff", "architecture-cascade"]:
        for condition, base in condition_bases.items():
            for i in range(3):
                noise = (i - 1) * 3  # -3, 0, +3
                results.append(make_scored_result(
                    scenario=scenario, condition=condition,
                    iteration=i, composite=base + noise,
                ))
    return results


@pytest.fixture
def sample_metadata() -> RunMetadata:
    return RunMetadata(
        id="test-run", timestamp="2026-03-01T00:00:00Z", status="completed",
        scenarios=["refactoring-handoff", "architecture-cascade"],
        conditions=["baseline", "claude-md-only", "shared-markdown", "file-reload-generic",
                    "file-reload-structured", "persistent-history", "twining-lite", "full-twining"],
        runsPerPair=3,
    )
```

- [ ] **Step 3: Run to verify models parse**

```bash
cd analysis && python -c "from benchmark_analysis.models import ScoredResult; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add analysis/
git commit -m "feat(analysis): add Pydantic models and test fixtures"
```

---

### Task 3: Data loader

**Files:**
- Create: `analysis/src/benchmark_analysis/loader.py`
- Create: `analysis/tests/test_loader.py`

- [ ] **Step 1: Write tests for the loader**

Create `analysis/tests/test_loader.py`:

```python
"""Tests for benchmark data loader."""
import json
import pytest
from pathlib import Path
from benchmark_analysis.loader import load_run, load_scores, load_sessions


@pytest.fixture
def sample_run_dir(tmp_path: Path) -> Path:
    """Create a minimal benchmark run directory structure."""
    run_dir = tmp_path / "test-run"
    scores_dir = run_dir / "scores"
    sessions_dir = run_dir / "sessions" / "session-1"
    scores_dir.mkdir(parents=True)
    sessions_dir.mkdir(parents=True)

    # metadata.json
    (run_dir / "metadata.json").write_text(json.dumps({
        "id": "test-run", "timestamp": "2026-03-01T00:00:00Z",
        "status": "completed", "scenarios": ["refactoring-handoff"],
        "conditions": ["baseline"], "runsPerPair": 1,
        "duration": 1000, "seed": "test",
        "environment": {}, "config": {},
    }))

    # One score file
    (scores_dir / "refactoring-handoff_baseline_0.json").write_text(json.dumps({
        "runId": "test-run", "scenario": "refactoring-handoff",
        "condition": "baseline", "iteration": 0, "composite": 92,
        "scores": {
            "completion": {"value": 100, "confidence": "high", "method": "automated", "justification": "done"},
        },
        "metrics": {
            "agentSessions": 2, "totalTokens": 1000000, "inputTokens": 50,
            "outputTokens": 20000, "cacheReadTokens": 900000, "cacheCreationTokens": 50000,
            "costUsd": 1.5, "wallTimeMs": 300000, "numTurns": 40,
            "compactionCount": 0, "contextUtilization": 0,
            "gitChurn": {"filesChanged": 5, "linesAdded": 200, "linesRemoved": 10, "reverts": 0},
            "testsPass": 95, "testsFail": 0, "compiles": True,
        },
    }))

    # One transcript
    (sessions_dir / "transcript.json").write_text(json.dumps({
        "sessionId": "session-1", "runId": "test-run",
        "scenario": "refactoring-handoff", "condition": "baseline",
        "taskIndex": 0, "prompt": "test", "toolCalls": [
            {"toolName": "Read", "parameters": {"file_path": "/tmp/foo.ts"},
             "timestamp": "2026-03-01T00:00:00Z", "durationMs": 50},
        ],
        "fileChanges": [], "numTurns": 20,
        "tokenUsage": {"input": 50, "output": 10000, "cacheRead": 500000,
                       "cacheCreation": 25000, "total": 535050, "costUsd": 1.0},
        "timing": {"startTime": "2026-03-01T00:00:00Z", "endTime": "2026-03-01T00:05:00Z",
                   "durationMs": 300000, "timeToFirstActionMs": 10000},
        "exitReason": "completed",
    }))

    # Coordination artifacts
    (sessions_dir / "coordination-artifacts.json").write_text(json.dumps({
        "preSessionState": {},
        "postSessionState": {"blackboard.json": "{\"entries\":[]}"},
        "changes": ["blackboard.json"],
    }))

    return run_dir


def test_load_run(sample_run_dir):
    run = load_run(sample_run_dir)
    assert run.metadata.id == "test-run"
    assert len(run.scores) == 1
    assert run.scores[0].composite == 92
    assert len(run.session_data) == 1
    assert run.session_data[0].artifacts is not None
    assert "blackboard.json" in run.session_data[0].artifacts.changes


def test_load_scores(sample_run_dir):
    scores = load_scores(sample_run_dir / "scores")
    assert len(scores) == 1
    assert scores[0].scenario == "refactoring-handoff"


def test_load_sessions(sample_run_dir):
    sessions = load_sessions(sample_run_dir / "sessions")
    assert len(sessions) == 1
    assert sessions[0].transcript.toolCalls[0].toolName == "Read"
    assert sessions[0].artifacts is not None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd analysis && python -m pytest tests/test_loader.py -v
```

- [ ] **Step 3: Implement the loader**

Create `analysis/src/benchmark_analysis/loader.py`:

```python
"""Load benchmark results from disk into structured models."""
from __future__ import annotations
import json
from dataclasses import dataclass
from pathlib import Path

from .models import ScoredResult, SessionTranscript, CoordinationArtifacts, RunMetadata


@dataclass
class SessionData:
    """A session transcript paired with its coordination artifacts."""
    transcript: SessionTranscript
    artifacts: CoordinationArtifacts | None = None


@dataclass
class BenchmarkRun:
    """A complete benchmark run with metadata, scores, and transcripts."""
    metadata: RunMetadata
    scores: list[ScoredResult]
    transcripts: list[SessionTranscript]
    session_data: list[SessionData]  # transcripts + coordination artifacts together
    path: Path


def load_run(run_dir: str | Path) -> BenchmarkRun:
    """Load a complete benchmark run from a directory."""
    run_dir = Path(run_dir)
    metadata = _load_metadata(run_dir / "metadata.json")
    scores = load_scores(run_dir / "scores")
    session_data = load_sessions(run_dir / "sessions")
    transcripts = [sd.transcript for sd in session_data]
    return BenchmarkRun(
        metadata=metadata, scores=scores, transcripts=transcripts,
        session_data=session_data, path=run_dir,
    )


def load_scores(scores_dir: Path) -> list[ScoredResult]:
    """Load all score JSON files from a scores directory."""
    if not scores_dir.exists():
        return []
    results = []
    for f in sorted(scores_dir.glob("*.json")):
        with open(f) as fh:
            data = json.load(fh)
        results.append(ScoredResult.model_validate(data))
    return results


def load_sessions(sessions_dir: Path) -> list[SessionData]:
    """Load all sessions with transcripts and coordination artifacts."""
    if not sessions_dir.exists():
        return []
    sessions = []
    for session_dir in sorted(sessions_dir.iterdir()):
        if not session_dir.is_dir():
            continue
        transcript_file = session_dir / "transcript.json"
        if not transcript_file.exists():
            continue
        with open(transcript_file) as fh:
            data = json.load(fh)
        transcript = SessionTranscript.model_validate(data)

        artifacts = None
        artifacts_file = session_dir / "coordination-artifacts.json"
        if artifacts_file.exists():
            with open(artifacts_file) as fh:
                artifacts = CoordinationArtifacts.model_validate(json.load(fh))

        sessions.append(SessionData(transcript=transcript, artifacts=artifacts))
    return sessions


def load_transcripts(sessions_dir: Path) -> list[SessionTranscript]:
    """Load all transcript.json files from a sessions directory (without artifacts)."""
    return [sd.transcript for sd in load_sessions(sessions_dir)]


def _load_metadata(path: Path) -> RunMetadata:
    """Load run metadata from metadata.json."""
    with open(path) as fh:
        data = json.load(fh)
    return RunMetadata.model_validate(data)


def scores_to_dataframe(scores: list[ScoredResult]):
    """Convert scored results to a pandas DataFrame for analysis."""
    import pandas as pd

    rows = []
    for s in scores:
        row = {
            "scenario": s.scenario,
            "condition": s.condition,
            "iteration": s.iteration,
            "composite": s.composite,
            "cost_usd": s.metrics.costUsd,
            "total_tokens": s.metrics.totalTokens,
            "wall_time_ms": s.metrics.wallTimeMs,
            "num_turns": s.metrics.numTurns,
            "tests_pass": s.metrics.testsPass,
            "tests_fail": s.metrics.testsFail,
            "lines_added": s.metrics.gitChurn.linesAdded,
            "lines_removed": s.metrics.gitChurn.linesRemoved,
            "files_changed": s.metrics.gitChurn.filesChanged,
            "compaction_count": s.metrics.compactionCount,
        }
        # Flatten dimension scores
        for dim_name, dim_score in s.scores.items():
            row[f"score_{dim_name}"] = dim_score.value
        rows.append(row)

    return pd.DataFrame(rows)


def transcripts_to_dataframe(transcripts: list[SessionTranscript]):
    """Convert transcripts to a pandas DataFrame for analysis."""
    import pandas as pd

    rows = []
    for t in transcripts:
        twining_calls = [tc for tc in t.toolCalls if "twining" in tc.toolName]
        rows.append({
            "session_id": t.sessionId,
            "scenario": t.scenario,
            "condition": t.condition,
            "task_index": t.taskIndex,
            "num_turns": t.numTurns,
            "total_tool_calls": len(t.toolCalls),
            "twining_tool_calls": len(twining_calls),
            "twining_pct": len(twining_calls) / max(len(t.toolCalls), 1) * 100,
            "cost_usd": t.tokenUsage.costUsd,
            "total_tokens": t.tokenUsage.total,
            "output_tokens": t.tokenUsage.output,
            "duration_ms": t.timing.durationMs,
            "time_to_first_action_ms": t.timing.timeToFirstActionMs,
            "exit_reason": t.exitReason,
            "compaction_count": t.compactionCount,
            "file_changes": len(t.fileChanges),
        })

    return pd.DataFrame(rows)
```

- [ ] **Step 4: Run tests**

```bash
cd analysis && python -m pytest tests/test_loader.py -v
```

- [ ] **Step 5: Verify loading real data**

```bash
cd analysis && python -c "
from benchmark_analysis.loader import load_run, scores_to_dataframe
run = load_run('../benchmark-results/4005bc41-8855-44da-b0f2-4dd047fe7acf')
print(f'Loaded {len(run.scores)} scores, {len(run.transcripts)} transcripts')
df = scores_to_dataframe(run.scores)
print(df.groupby(['scenario', 'condition'])['composite'].mean().unstack())
"
```

- [ ] **Step 6: Commit**

```bash
git add analysis/
git commit -m "feat(analysis): add data loader with DataFrame conversion"
```

---

### Task 4: Core statistics module

**Files:**
- Create: `analysis/src/benchmark_analysis/stats.py`
- Create: `analysis/tests/test_stats.py`

- [ ] **Step 1: Write tests**

Create `analysis/tests/test_stats.py`:

```python
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
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/stats.py`**

```python
"""Core statistical functions for benchmark analysis."""
from __future__ import annotations
import math
import numpy as np
from scipy import stats as sp_stats
from .models import ConditionSummary


def cohens_d(a: list[float], b: list[float]) -> float:
    """Compute Cohen's d effect size (B - A) / pooled_std."""
    a_arr, b_arr = np.array(a, dtype=float), np.array(b, dtype=float)
    if len(a_arr) < 2 or len(b_arr) < 2:
        return float("nan")
    na, nb = len(a_arr), len(b_arr)
    var_a, var_b = np.var(a_arr, ddof=1), np.var(b_arr, ddof=1)
    pooled_std = math.sqrt(((na - 1) * var_a + (nb - 1) * var_b) / (na + nb - 2))
    if pooled_std == 0:
        return 0.0 if np.mean(a_arr) == np.mean(b_arr) else float("inf")
    return float((np.mean(b_arr) - np.mean(a_arr)) / pooled_std)


def interpret_cohens_d(d: float) -> str:
    """Interpret Cohen's d as negligible/small/medium/large."""
    abs_d = abs(d)
    if abs_d < 0.2:
        return "negligible"
    elif abs_d < 0.5:
        return "small"
    elif abs_d < 0.8:
        return "medium"
    else:
        return "large"


def bootstrap_ci(
    data: list[float], confidence: float = 0.95, n_bootstrap: int = 10000,
    seed: int = 42,
) -> tuple[float, float]:
    """Compute bootstrap confidence interval."""
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
    """Approximate power for two-sample t-test given effect size and n."""
    if effect_size == 0 or n_per_group < 2:
        return 0.0
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


def condition_summary(condition: str, values: list[float]) -> ConditionSummary:
    """Compute statistical summary for a condition."""
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
```

- [ ] **Step 3: Run tests**

```bash
cd analysis && python -m pytest tests/test_stats.py -v
```

- [ ] **Step 4: Commit**

```bash
git add analysis/
git commit -m "feat(analysis): add core statistics module (Cohen's d, bootstrap CI, Holm-Bonferroni, ROPE)"
```

---

## Chunk 2: Dimension Analyzers

### Task 5: Scoring dimension analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/scoring.py`
- Create: `analysis/tests/test_scoring.py`

The scoring analyzer computes: per-scenario composite distributions, per-dimension score breakdowns, overall condition rankings.

- [ ] **Step 1: Write tests in `analysis/tests/test_scoring.py`**

Test: `analyze_scoring(scores)` returns a dict with `condition_rankings` (sorted by mean composite), `per_scenario` breakdown, and `dimension_breakdown` per scenario showing which dimensions differentiate conditions.

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/scoring.py`**

Key function: `analyze_scoring(scores: list[ScoredResult]) -> dict` that:
- Groups by scenario × condition, computes mean/std/CI for composites
- Ranks conditions overall and per-scenario
- For each scenario, breaks down per-dimension scores and flags dimensions with high variance or ceiling effects (mean > 95 or std < 2)
- Returns structured dict matching `DimensionAnalysis`

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_scoring.py -v
git add analysis/ && git commit -m "feat(analysis): add scoring dimension analyzer"
```

---

### Task 6: Conditions dimension analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/conditions.py`
- Create: `analysis/tests/test_conditions.py`

- [ ] **Step 1: Write tests**

Test: `analyze_conditions(scores)` returns `effect_sizes` (all pairwise comparisons with Holm-Bonferroni correction), `condition_summaries`, `rope_results` for each pair.

- [ ] **Step 2: Implement**

Key function: `analyze_conditions(scores, baseline="baseline")` that:
- Computes all pairwise effect sizes (Cohen's d) for composite scores
- Applies Holm-Bonferroni correction to p-values
- Runs ROPE test for each pair (rope=(-5, 5) on composite)
- Computes bootstrap CIs for each condition mean
- Runs power analysis: given observed effect size and n, what power do we have? What n would we need for 0.8 power?

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_conditions.py -v
git add analysis/ && git commit -m "feat(analysis): add conditions dimension analyzer with Holm-Bonferroni and ROPE"
```

---

### Task 7: Scenarios dimension analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/scenarios.py`
- Create: `analysis/tests/test_scenarios.py`

- [ ] **Step 1: Write tests**

Test: `analyze_scenarios(scores)` returns `discriminating_scenarios` (which scenarios best separate conditions), `ceiling_effects`, `floor_effects`.

- [ ] **Step 2: Implement**

Key function: `analyze_scenarios(scores)` that:
- For each scenario, compute the spread of condition means (max - min). Scenarios with larger spread discriminate better.
- Detect ceiling effects: any scenario×condition with mean > 95 and std < 3
- Detect floor effects: any scenario×condition with mean < 20
- Compute per-scenario effect sizes (best condition vs baseline)
- Flag high-variance pairs (CV > 30%)

- [ ] **Step 3: Run tests, commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add scenarios dimension analyzer"
```

---

### Task 8: Coordination behavior analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/coordination.py`
- Create: `analysis/tests/test_coordination.py`

- [ ] **Step 1: Write tests**

Test: `analyze_coordination(transcripts)` returns tool call breakdowns, engagement rates, overhead ratios per condition.

- [ ] **Step 2: Implement**

Key function: `analyze_coordination(session_data: list[SessionData])` that:
- Categorizes tool calls: productive (Read/Edit/Write/Bash/Glob/Grep), coordination (twining_*), and sub-categories (graph-building: add_entity/add_relation, orientation: assemble/recent/query, recording: decide/post)
- Computes per-condition: avg twining calls, twining %, engagement rate (sessions with ≥1 twining call / total sessions)
- Flags non-engagement: conditions where engagement rate < 50%
- Identifies graph-building overhead: % of twining calls that are add_entity/add_relation
- Computes overhead ratio per session: coordination calls / total calls
- When `CoordinationArtifacts` are available: counts entities/decisions added per session, measures Twining state growth (pre vs post state size delta)

- [ ] **Step 3: Run tests, commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add coordination behavior analyzer"
```

---

### Task 9a: Cost efficiency analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/cost.py`
- Create: `analysis/tests/test_cost.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_cost.py`**

```python
"""Tests for cost efficiency analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.cost import analyze_cost


def test_cost_per_point(sample_scores):
    result = analyze_cost(sample_scores)
    assert "per_condition" in result
    for entry in result["per_condition"]:
        assert "condition" in entry
        assert "mean_cost_usd" in entry
        assert "cost_per_composite_point" in entry


def test_cost_vs_baseline(sample_scores):
    result = analyze_cost(sample_scores)
    assert "vs_baseline" in result
    for entry in result["vs_baseline"]:
        assert "condition" in entry
        assert "marginal_cost_per_point_gained" in entry


def test_token_efficiency(sample_scores):
    result = analyze_cost(sample_scores)
    assert "token_efficiency" in result
    for entry in result["token_efficiency"]:
        assert "condition" in entry
        assert "tokens_per_composite_point" in entry
        assert "cache_hit_ratio" in entry
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/cost.py`**

```python
"""Cost and token efficiency analysis."""
from __future__ import annotations
from ..models import ScoredResult


def analyze_cost(scores: list[ScoredResult], baseline: str = "baseline") -> dict:
    """Analyze cost efficiency across conditions.

    Returns dict with:
      - per_condition: mean cost, cost per composite point for each condition
      - vs_baseline: marginal cost per point gained over baseline
      - token_efficiency: tokens per composite point, cache hit ratios
      - per_scenario: cost breakdown by scenario × condition
    """
    from collections import defaultdict
    import numpy as np

    by_condition = defaultdict(list)
    by_scenario_condition = defaultdict(list)
    for s in scores:
        by_condition[s.condition].append(s)
        by_scenario_condition[(s.scenario, s.condition)].append(s)

    # Per-condition summary
    per_condition = []
    baseline_mean_composite = 0.0
    baseline_mean_cost = 0.0
    for condition, items in sorted(by_condition.items()):
        composites = [s.composite for s in items]
        costs = [s.metrics.costUsd for s in items]
        mean_composite = float(np.mean(composites))
        mean_cost = float(np.mean(costs))
        if condition == baseline:
            baseline_mean_composite = mean_composite
            baseline_mean_cost = mean_cost
        per_condition.append({
            "condition": condition,
            "mean_cost_usd": round(mean_cost, 4),
            "mean_composite": round(mean_composite, 2),
            "cost_per_composite_point": round(mean_cost / max(mean_composite, 0.01), 4),
            "total_tokens_mean": int(np.mean([s.metrics.totalTokens for s in items])),
        })

    # Cost vs baseline
    vs_baseline = []
    for entry in per_condition:
        if entry["condition"] == baseline:
            continue
        delta_points = entry["mean_composite"] - baseline_mean_composite
        delta_cost = entry["mean_cost_usd"] - baseline_mean_cost
        vs_baseline.append({
            "condition": entry["condition"],
            "delta_composite": round(delta_points, 2),
            "delta_cost_usd": round(delta_cost, 4),
            "marginal_cost_per_point_gained": round(delta_cost / max(abs(delta_points), 0.01), 4),
        })

    # Token efficiency
    token_efficiency = []
    for condition, items in sorted(by_condition.items()):
        total_tokens = [s.metrics.totalTokens for s in items]
        cache_reads = [s.metrics.cacheReadTokens for s in items]
        composites = [s.composite for s in items]
        token_efficiency.append({
            "condition": condition,
            "tokens_per_composite_point": int(np.mean(total_tokens) / max(np.mean(composites), 0.01)),
            "cache_hit_ratio": round(float(np.mean(cache_reads)) / max(float(np.mean(total_tokens)), 1), 3),
        })

    return {
        "per_condition": per_condition,
        "vs_baseline": vs_baseline,
        "token_efficiency": token_efficiency,
    }
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_cost.py -v
git add analysis/ && git commit -m "feat(analysis): add cost efficiency analyzer"
```

---

### Task 9b: Reliability and power analysis

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/reliability.py`
- Create: `analysis/tests/test_reliability.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_reliability.py`**

```python
"""Tests for reliability analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.reliability import analyze_reliability


def test_variance_flags(sample_scores):
    result = analyze_reliability(sample_scores)
    assert "variance_flags" in result
    # No pair should have CV > 30% with our low-noise test data
    assert all(f["cv_pct"] < 30 for f in result["variance_flags"])


def test_power_analysis(sample_scores):
    result = analyze_reliability(sample_scores)
    assert "power_analysis" in result
    for entry in result["power_analysis"]:
        assert "comparison" in entry
        assert "observed_power" in entry
        assert "recommended_n" in entry
        assert 0 <= entry["observed_power"] <= 1


def test_sample_size_recommendations(sample_scores):
    result = analyze_reliability(sample_scores)
    assert "sample_size_recommendations" in result
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/reliability.py`**

```python
"""Reliability analysis: variance flags, power analysis, sample size recommendations."""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult
from ..stats import cohens_d, power_analysis, required_sample_size


def analyze_reliability(scores: list[ScoredResult], baseline: str = "baseline") -> dict:
    """Analyze statistical reliability of benchmark results.

    Returns dict with:
      - variance_flags: scenario×condition pairs with CV > 30%
      - power_analysis: observed power for each pairwise comparison
      - sample_size_recommendations: recommended n per group for 0.8 power
    """
    by_pair = defaultdict(list)
    by_condition = defaultdict(list)
    for s in scores:
        by_pair[(s.scenario, s.condition)].append(s.composite)
        by_condition[s.condition].append(s.composite)

    # Variance flags
    variance_flags = []
    for (scenario, condition), values in sorted(by_pair.items()):
        arr = np.array(values)
        mean = float(np.mean(arr))
        std = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
        cv = (std / mean * 100) if mean > 0 else 0.0
        variance_flags.append({
            "scenario": scenario, "condition": condition,
            "n": len(arr), "mean": round(mean, 2), "std": round(std, 2),
            "cv_pct": round(cv, 1), "high_variance": cv > 30,
        })

    # Power analysis for each non-baseline condition vs baseline
    baseline_values = by_condition.get(baseline, [])
    power_results = []
    sample_recs = []
    for condition, values in sorted(by_condition.items()):
        if condition == baseline or not baseline_values:
            continue
        d = cohens_d(baseline_values, values)
        if np.isnan(d):
            continue
        n = len(values)
        observed_power = power_analysis(abs(d), n)
        rec_n = required_sample_size(abs(d))
        power_results.append({
            "comparison": f"{baseline} vs {condition}",
            "cohens_d": round(d, 3),
            "n_per_group": n,
            "observed_power": round(observed_power, 3),
            "recommended_n": rec_n,
            "underpowered": observed_power < 0.8,
        })
        sample_recs.append({
            "comparison": f"{baseline} vs {condition}",
            "current_n": n,
            "recommended_n_for_80pct_power": rec_n,
            "additional_runs_needed": max(0, rec_n - n),
        })

    return {
        "variance_flags": variance_flags,
        "power_analysis": power_results,
        "sample_size_recommendations": sample_recs,
    }
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_reliability.py -v
git add analysis/ && git commit -m "feat(analysis): add reliability and power analysis"
```

---

### Task 9c: Temporal cross-run comparison

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/temporal.py`

- [ ] **Step 1: Implement `analysis/src/benchmark_analysis/dimensions/temporal.py`**

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add temporal cross-run comparison"
```

---

### Task 9d: Scorer diagnostics

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/scorer_diagnostics.py`

- [ ] **Step 1: Implement `analysis/src/benchmark_analysis/dimensions/scorer_diagnostics.py`**

```python
"""Detect broken or insensitive scorers."""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult


def analyze_scorers(scores: list[ScoredResult]) -> dict:
    """Detect problematic scoring dimensions.

    Returns dict with:
      - ceiling_effects: dimensions with mean > 95 across all conditions
      - floor_effects: dimensions with mean < 10 across all conditions
      - zero_variance: dimensions with std < 1 across all conditions
      - non_discriminating: dimensions where max condition mean - min condition mean < 5
      - bimodal_suspects: dimensions where values cluster into two groups (gap > 30 points between clusters)
    """
    # Collect per-dimension values by condition
    dim_by_condition = defaultdict(lambda: defaultdict(list))
    dim_all = defaultdict(list)
    for s in scores:
        for dim_name, dim_score in s.scores.items():
            dim_by_condition[dim_name][s.condition].append(dim_score.value)
            dim_all[dim_name].append(dim_score.value)

    ceiling_effects = []
    floor_effects = []
    zero_variance = []
    non_discriminating = []
    bimodal_suspects = []

    for dim_name, all_values in sorted(dim_all.items()):
        arr = np.array(all_values)
        mean_all = float(np.mean(arr))
        std_all = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0

        if mean_all > 95 and std_all < 3:
            ceiling_effects.append({"dimension": dim_name, "mean": round(mean_all, 1), "std": round(std_all, 2)})
        if mean_all < 10:
            floor_effects.append({"dimension": dim_name, "mean": round(mean_all, 1), "std": round(std_all, 2)})
        if std_all < 1:
            zero_variance.append({"dimension": dim_name, "mean": round(mean_all, 1), "std": round(std_all, 2)})

        # Discrimination: check spread of condition means
        condition_means = {c: float(np.mean(v)) for c, v in dim_by_condition[dim_name].items()}
        if condition_means:
            spread = max(condition_means.values()) - min(condition_means.values())
            if spread < 5:
                non_discriminating.append({"dimension": dim_name, "spread": round(spread, 2), "condition_means": {k: round(v, 1) for k, v in condition_means.items()}})

        # Simple bimodal detection: sort values, find largest gap
        sorted_vals = np.sort(arr)
        if len(sorted_vals) > 4:
            gaps = np.diff(sorted_vals)
            max_gap = float(np.max(gaps))
            if max_gap > 30:
                gap_idx = int(np.argmax(gaps))
                bimodal_suspects.append({
                    "dimension": dim_name, "gap_size": round(max_gap, 1),
                    "cluster_1_mean": round(float(np.mean(sorted_vals[:gap_idx+1])), 1),
                    "cluster_2_mean": round(float(np.mean(sorted_vals[gap_idx+1:])), 1),
                })

    return {
        "ceiling_effects": ceiling_effects,
        "floor_effects": floor_effects,
        "zero_variance": zero_variance,
        "non_discriminating": non_discriminating,
        "bimodal_suspects": bimodal_suspects,
    }
```

- [ ] **Step 2: Commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add scorer diagnostics"
```

---

### Task 9e: Session-level deep dive analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/sessions.py`

- [ ] **Step 1: Implement `analysis/src/benchmark_analysis/dimensions/sessions.py`**

```python
"""Per-session transcript deep dive analysis."""
from __future__ import annotations
from collections import defaultdict
from ..models import SessionTranscript


def analyze_sessions(transcripts: list[SessionTranscript]) -> dict:
    """Per-session deep dive analysis.

    Returns dict with:
      - per_session: tool call breakdown, cost, duration for each session
      - bottleneck_sessions: sessions with highest cost or duration relative to peers
      - compaction_events: sessions that triggered context compaction
      - exit_reasons: breakdown of session exit reasons
    """
    per_session = []
    by_scenario_condition = defaultdict(list)

    for t in transcripts:
        twining_calls = [tc for tc in t.toolCalls if "twining" in tc.toolName]
        productive_calls = [tc for tc in t.toolCalls if tc.toolName in {"Read", "Edit", "Write", "Bash", "Glob", "Grep"}]
        entry = {
            "session_id": t.sessionId,
            "scenario": t.scenario,
            "condition": t.condition,
            "task_index": t.taskIndex,
            "num_turns": t.numTurns,
            "total_tool_calls": len(t.toolCalls),
            "productive_tool_calls": len(productive_calls),
            "twining_tool_calls": len(twining_calls),
            "cost_usd": t.tokenUsage.costUsd,
            "duration_ms": t.timing.durationMs,
            "exit_reason": t.exitReason,
            "compaction_count": t.compactionCount,
        }
        per_session.append(entry)
        by_scenario_condition[(t.scenario, t.condition)].append(entry)

    # Identify bottleneck sessions (highest cost within their scenario×condition group)
    bottleneck_sessions = []
    for (scenario, condition), sessions in by_scenario_condition.items():
        if len(sessions) < 2:
            continue
        costs = [s["cost_usd"] for s in sessions]
        max_cost = max(costs)
        mean_cost = sum(costs) / len(costs)
        for s in sessions:
            if s["cost_usd"] == max_cost and max_cost > mean_cost * 1.5:
                bottleneck_sessions.append(s)

    # Compaction events
    compaction_events = [s for s in per_session if s["compaction_count"] > 0]

    # Exit reason breakdown
    exit_reasons = defaultdict(int)
    for t in transcripts:
        exit_reasons[t.exitReason] += 1

    return {
        "per_session": per_session,
        "bottleneck_sessions": bottleneck_sessions,
        "compaction_events": compaction_events,
        "exit_reasons": dict(exit_reasons),
    }
```

- [ ] **Step 2: Commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add session-level deep dive analyzer"
```

---

### Task 9f: Recommendation synthesizer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/recommendations.py`

- [ ] **Step 1: Implement `analysis/src/benchmark_analysis/dimensions/recommendations.py`**

```python
"""Synthesize improvement recommendations from all dimension analyses."""
from __future__ import annotations


def synthesize_recommendations(all_results: dict) -> dict:
    """Produce prioritized recommendations from all dimension analyzer outputs.

    Returns dict with:
      - items: list of {priority: "high"|"medium"|"low", category: str, message: str}
    """
    items = []

    # Check coordination engagement
    coord = all_results.get("coordination", {})
    for entry in coord.get("per_condition", []):
        if entry.get("engagement_rate", 1.0) < 0.5:
            items.append({
                "priority": "high",
                "category": "coordination",
                "message": f"Fix activation: Twining engagement rate is {entry['engagement_rate']:.0%} for {entry['condition']} — agents aren't using coordination tools",
            })
        if entry.get("graph_overhead_pct", 0) > 20:
            items.append({
                "priority": "medium",
                "category": "coordination",
                "message": f"Reduce graph ceremony: {entry['graph_overhead_pct']:.0f}% of twining calls in {entry['condition']} are graph-building (add_entity/add_relation)",
            })

    # Check if full-twining underperforms twining-lite
    scoring = all_results.get("scoring", {})
    rankings = {r["condition"]: r["mean"] for r in scoring.get("condition_rankings", [])}
    if rankings.get("full-twining", 100) < rankings.get("twining-lite", 0):
        items.append({
            "priority": "high",
            "category": "tool-surface",
            "message": f"Reduce tool surface area: full-twining ({rankings['full-twining']:.1f}) scores lower than twining-lite ({rankings['twining-lite']:.1f})",
        })

    # Check ceiling effects from scenarios
    scenarios = all_results.get("scenarios", {})
    for ce in scenarios.get("ceiling_effects", []):
        items.append({
            "priority": "medium",
            "category": "scenarios",
            "message": f"Scenario '{ce['scenario']}' × '{ce['condition']}' has ceiling effect (mean={ce['mean']:.1f}, std={ce['std']:.1f}) — consider redesigning for more discrimination",
        })

    # Check power from reliability
    reliability = all_results.get("reliability", {})
    for pa in reliability.get("power_analysis", []):
        if pa.get("observed_power", 1.0) < 0.5:
            items.append({
                "priority": "high",
                "category": "reliability",
                "message": f"Underpowered comparison: {pa['comparison']} has power={pa['observed_power']:.2f} — need {pa['recommended_n']} runs per group (currently {pa['n_per_group']})",
            })
        elif pa.get("underpowered", False):
            items.append({
                "priority": "medium",
                "category": "reliability",
                "message": f"Low power: {pa['comparison']} has power={pa['observed_power']:.2f} — consider {pa['recommended_n']} runs per group",
            })

    # Check scorer diagnostics
    scorer = all_results.get("scorer_diagnostics", {})
    for d in scorer.get("zero_variance", []):
        items.append({
            "priority": "high",
            "category": "scoring",
            "message": f"Broken scorer: dimension '{d['dimension']}' has zero variance (always {d['mean']:.0f}) — fix or remove",
        })
    for d in scorer.get("non_discriminating", []):
        items.append({
            "priority": "medium",
            "category": "scoring",
            "message": f"Insensitive scorer: dimension '{d['dimension']}' has only {d['spread']:.1f}-point spread across conditions",
        })

    # Check coordination lift
    lift = all_results.get("coordination_lift", {})
    if lift.get("summary", {}).get("overall_lift_significant") is False:
        items.append({
            "priority": "high",
            "category": "coordination-lift",
            "message": "No statistically significant coordination lift detected — coordination tools may not be providing measurable value",
        })

    # Check behavior-outcome correlations — flag overhead candidates
    behavior = all_results.get("behavior_outcome", {})
    for np_entry in behavior.get("non_predictive_behaviors", []):
        if np_entry.get("behavior_metric") in ("graph_calls", "verification_calls") and np_entry.get("outcome_metric") == "composite":
            items.append({
                "priority": "medium",
                "category": "behavior-outcome",
                "message": f"Overhead candidate: {np_entry['behavior_metric']} has negligible correlation with composite (r={np_entry['pearson_r']:.2f})",
            })

    # Check effect decomposition — lite vs full
    decomp = all_results.get("effect_decomposition", {})
    lvf = decomp.get("lite_vs_full", {})
    if lvf.get("conclusion") == "lite sufficient":
        items.append({
            "priority": "high",
            "category": "tool-surface",
            "message": f"Twining-lite ({lvf['twining_lite_mean']:.1f}) matches full-twining ({lvf['full_twining_mean']:.1f}) — extra tools add complexity without benefit",
        })

    # Check interactions — disordinal warnings
    interactions = all_results.get("interactions", {})
    for d in interactions.get("disordinal_interactions", []):
        items.append({
            "priority": "medium",
            "category": "interactions",
            "message": f"Interaction effect: {d['condition_a']} vs {d['condition_b']} ranking reverses across scenarios — no universal winner",
        })
    for entry in interactions.get("worst_scenario_for_coordination", []):
        if entry.get("coordination_hurts"):
            items.append({
                "priority": "high",
                "category": "interactions",
                "message": f"Coordination hurts in '{entry['scenario']}': {entry['worst_condition']} scores {entry['worst_lift']:.1f} points below baseline",
            })

    # Check construct validity — unreliable dimensions
    validity = all_results.get("construct_validity", {})
    unreliable = [ic for ic in validity.get("internal_consistency", []) if not ic.get("reliable", True)]
    if unreliable:
        dims = set(ic["dimension"] for ic in unreliable)
        items.append({
            "priority": "medium",
            "category": "construct-validity",
            "message": f"High scorer variance (CV>20%) in {len(unreliable)} scenario×condition pairs for dimensions: {', '.join(sorted(dims))}",
        })

    # Check learning curve — escalating costs
    lc = all_results.get("learning_curve", {})
    for entry in lc.get("per_scenario", []):
        if entry.get("trends", {}).get("cost_trend") == "increasing":
            items.append({
                "priority": "low",
                "category": "scaling",
                "message": f"Escalating cost in '{entry['scenario']}' × '{entry['condition']}': cost increases across sessions (slope={entry['trends']['cost_slope']:.3f})",
            })

    # Sort by priority
    priority_order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda x: priority_order.get(x["priority"], 3))

    return {"items": items}
```

- [ ] **Step 2: Commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add recommendation synthesizer"
```

---

### Task 9g: Coordination lift analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/coordination_lift.py`
- Create: `analysis/tests/test_coordination_lift.py`

This is the most important dimension — it measures the delta between coordination-aided and unaided performance, which is the project's core metric.

- [ ] **Step 1: Write tests in `analysis/tests/test_coordination_lift.py`**

```python
"""Tests for coordination lift analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.coordination_lift import analyze_coordination_lift


def test_lift_computed(sample_scores):
    result = analyze_coordination_lift(sample_scores)
    assert "pairwise_lift" in result
    # Should have comparisons for each coordinated condition vs baseline
    coordinated = [e for e in result["pairwise_lift"] if e["baseline"] == "baseline"]
    assert len(coordinated) > 0


def test_lift_direction(sample_scores):
    """Higher-scoring conditions should show positive lift."""
    result = analyze_coordination_lift(sample_scores)
    for entry in result["pairwise_lift"]:
        if entry["condition"] == "full-twining" and entry["baseline"] == "baseline":
            assert entry["lift_points"] > 0


def test_lift_per_scenario(sample_scores):
    result = analyze_coordination_lift(sample_scores)
    assert "per_scenario" in result
    for entry in result["per_scenario"]:
        assert "scenario" in entry
        assert "best_condition" in entry
        assert "lift_vs_baseline" in entry


def test_lift_summary(sample_scores):
    result = analyze_coordination_lift(sample_scores)
    assert "summary" in result
    assert "overall_lift_significant" in result["summary"]
    assert "best_coordinated_condition" in result["summary"]
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/coordination_lift.py`**

```python
"""CoordinationLift: measures delta between coordinated and uncoordinated performance.

This is the core metric for the Twining benchmark — does coordination
actually improve multi-agent outcomes?
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult
from ..stats import cohens_d, interpret_cohens_d, bootstrap_ci, welch_t_test, holm_bonferroni

# Conditions that use explicit inter-agent coordination mechanisms.
# claude-md-only provides project conventions but no inter-agent state sharing.
# persistent-history shares conversation context implicitly (no coordination tools/files).
COORDINATED_CONDITIONS = {
    "full-twining", "twining-lite",
    "file-reload-structured", "file-reload-generic",
    "shared-markdown", "persistent-history",
}
UNCOORDINATED_CONDITIONS = {"baseline", "claude-md-only"}


def analyze_coordination_lift(
    scores: list[ScoredResult],
    baseline: str = "baseline",
) -> dict:
    """Analyze the lift provided by coordination tools.

    Returns dict with:
      - pairwise_lift: for each coordinated condition vs baseline, the lift in composite points with effect size and significance
      - per_scenario: which scenarios benefit most from coordination
      - per_dimension: which scoring dimensions show most lift
      - summary: overall assessment of coordination value
    """
    by_condition = defaultdict(list)
    by_scenario_condition = defaultdict(list)
    for s in scores:
        by_condition[s.condition].append(s.composite)
        by_scenario_condition[(s.scenario, s.condition)].append(s)

    baseline_values = by_condition.get(baseline, [])
    if not baseline_values:
        return {"pairwise_lift": [], "per_scenario": [], "per_dimension": [], "summary": {}}

    # Pairwise lift vs baseline
    pairwise_lift = []
    p_values = []
    for condition, values in sorted(by_condition.items()):
        if condition == baseline:
            continue
        d = cohens_d(baseline_values, values)
        p = welch_t_test(baseline_values, values)
        p_values.append(p)
        bl_ci = bootstrap_ci(baseline_values)
        cond_ci = bootstrap_ci(values)
        pairwise_lift.append({
            "baseline": baseline,
            "condition": condition,
            "is_coordinated": condition in COORDINATED_CONDITIONS,
            "baseline_mean": round(float(np.mean(baseline_values)), 2),
            "condition_mean": round(float(np.mean(values)), 2),
            "lift_points": round(float(np.mean(values)) - float(np.mean(baseline_values)), 2),
            "lift_pct": round((float(np.mean(values)) - float(np.mean(baseline_values))) / max(float(np.mean(baseline_values)), 0.01) * 100, 1),
            "cohens_d": round(d, 3) if not np.isnan(d) else None,
            "interpretation": interpret_cohens_d(d) if not np.isnan(d) else "insufficient data",
            "p_value": round(p, 4),
            "condition_ci": [round(cond_ci[0], 2), round(cond_ci[1], 2)],
        })

    # Apply Holm-Bonferroni correction
    if p_values:
        corrected = holm_bonferroni(p_values)
        for i, entry in enumerate(pairwise_lift):
            entry["p_value_corrected"] = round(corrected[i], 4)
            entry["significant"] = corrected[i] < 0.05

    # Per-scenario lift
    scenarios = set(s.scenario for s in scores)
    per_scenario = []
    for scenario in sorted(scenarios):
        baseline_scenario = [s.composite for s in by_scenario_condition.get((scenario, baseline), [])]
        if not baseline_scenario:
            continue
        best_condition = baseline
        best_lift = 0.0
        for condition in by_condition:
            if condition == baseline:
                continue
            cond_values = [s.composite for s in by_scenario_condition.get((scenario, condition), [])]
            if not cond_values:
                continue
            lift = float(np.mean(cond_values)) - float(np.mean(baseline_scenario))
            if lift > best_lift:
                best_lift = lift
                best_condition = condition
        per_scenario.append({
            "scenario": scenario,
            "baseline_mean": round(float(np.mean(baseline_scenario)), 2),
            "best_condition": best_condition,
            "best_condition_mean": round(float(np.mean(baseline_scenario)) + best_lift, 2),
            "lift_vs_baseline": round(best_lift, 2),
        })

    # Per-dimension lift (which scoring dimensions benefit most)
    dim_lifts = defaultdict(lambda: defaultdict(list))
    for s in scores:
        for dim_name, dim_score in s.scores.items():
            dim_lifts[dim_name][s.condition].append(dim_score.value)

    per_dimension = []
    for dim_name, by_cond in sorted(dim_lifts.items()):
        bl_vals = by_cond.get(baseline, [])
        if not bl_vals:
            continue
        best_lift = 0.0
        best_cond = baseline
        for cond, vals in by_cond.items():
            if cond == baseline:
                continue
            lift = float(np.mean(vals)) - float(np.mean(bl_vals))
            if lift > best_lift:
                best_lift = lift
                best_cond = cond
        per_dimension.append({
            "dimension": dim_name,
            "baseline_mean": round(float(np.mean(bl_vals)), 2),
            "best_condition": best_cond,
            "lift": round(best_lift, 2),
        })

    # Summary
    coordinated_lifts = [e for e in pairwise_lift if e["is_coordinated"]]
    any_significant = any(e.get("significant", False) for e in coordinated_lifts)
    best = max(coordinated_lifts, key=lambda e: e["lift_points"]) if coordinated_lifts else None

    summary = {
        "overall_lift_significant": any_significant,
        "best_coordinated_condition": best["condition"] if best else None,
        "best_lift_points": best["lift_points"] if best else 0,
        "best_effect_size": best["interpretation"] if best else None,
        "num_conditions_tested": len(pairwise_lift),
        "num_significant": sum(1 for e in pairwise_lift if e.get("significant", False)),
    }

    return {
        "pairwise_lift": pairwise_lift,
        "per_scenario": per_scenario,
        "per_dimension": per_dimension,
        "summary": summary,
    }
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_coordination_lift.py -v
git add analysis/ && git commit -m "feat(analysis): add coordination lift analyzer"
```

---

## Chunk 3: Research-Grade Analyzers

These analyzers transform the package from a benchmark reporter into a research tool for comparing agent harness architectures and validating benchmark rigor.

### Task 10: Behavior-outcome correlation analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/behavior_outcome.py`
- Create: `analysis/tests/test_behavior_outcome.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_behavior_outcome.py`**

```python
"""Tests for behavior-outcome correlation analyzer."""
import pytest
from tests.conftest import make_scored_result, make_transcript, make_tool_call
from benchmark_analysis.dimensions.behavior_outcome import analyze_behavior_outcome


def test_correlations_computed(sample_scores):
    transcripts = [
        make_transcript(scenario="refactoring-handoff", condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("Read")] * 5,
                       cost=2.0),
        make_transcript(scenario="refactoring-handoff", condition="baseline",
                       tool_calls=[make_tool_call("Read")] * 10,
                       cost=1.0),
    ]
    result = analyze_behavior_outcome(sample_scores, transcripts)
    assert "correlations" in result
    assert len(result["correlations"]) > 0
    for c in result["correlations"]:
        assert "behavior_metric" in c
        assert "outcome_metric" in c
        assert "pearson_r" in c
        assert -1 <= c["pearson_r"] <= 1


def test_predictive_behaviors(sample_scores):
    transcripts = [
        make_transcript(scenario=s, condition=c,
                       tool_calls=[make_tool_call("twining_assemble")] * (10 if c == "full-twining" else 0))
        for s in ["refactoring-handoff", "architecture-cascade"]
        for c in ["baseline", "full-twining"]
        for _ in range(3)
    ]
    result = analyze_behavior_outcome(sample_scores, transcripts)
    assert "predictive_behaviors" in result
    assert "non_predictive_behaviors" in result
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/behavior_outcome.py`**

```python
"""Correlation between coordination behaviors and outcomes.

Answers: which specific agent behaviors predict better scores?
This is the key explanatory analysis for harness comparison.
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from scipy import stats as sp_stats
from ..models import ScoredResult, SessionTranscript

# Behavior categories for tool calls
ORIENTATION_TOOLS = {"twining_assemble", "twining_recent", "twining_query", "twining_why", "twining_read"}
RECORDING_TOOLS = {"twining_decide", "twining_post", "twining_link_commit"}
GRAPH_TOOLS = {"twining_add_entity", "twining_add_relation", "twining_neighbors", "twining_graph_query"}
VERIFICATION_TOOLS = {"twining_verify"}
PRODUCTIVE_TOOLS = {"Read", "Edit", "Write", "Bash", "Glob", "Grep"}


def analyze_behavior_outcome(
    scores: list[ScoredResult],
    transcripts: list[SessionTranscript],
) -> dict:
    """Correlate coordination behaviors with outcome scores.

    Returns dict with:
      - correlations: list of {behavior_metric, outcome_metric, pearson_r, p_value, n, significant}
      - predictive_behaviors: behaviors with |r| > 0.3 and p < 0.05
      - non_predictive_behaviors: behaviors with |r| < 0.1 (overhead candidates)
      - regression_model: multivariate summary (which behaviors together predict composite)
    """
    # Aggregate transcript behaviors per scenario×condition×iteration
    # Match to scores by (scenario, condition) — average across sessions within a run
    behavior_by_key = defaultdict(lambda: defaultdict(list))
    for t in transcripts:
        key = (t.scenario, t.condition)
        tools = [tc.toolName for tc in t.toolCalls]
        behavior_by_key[key]["total_tool_calls"].append(len(tools))
        behavior_by_key[key]["twining_calls"].append(sum(1 for tn in tools if "twining" in tn))
        behavior_by_key[key]["orientation_calls"].append(sum(1 for tn in tools if tn in ORIENTATION_TOOLS))
        behavior_by_key[key]["recording_calls"].append(sum(1 for tn in tools if tn in RECORDING_TOOLS))
        behavior_by_key[key]["graph_calls"].append(sum(1 for tn in tools if tn in GRAPH_TOOLS))
        behavior_by_key[key]["verification_calls"].append(sum(1 for tn in tools if tn in VERIFICATION_TOOLS))
        behavior_by_key[key]["productive_calls"].append(sum(1 for tn in tools if tn in PRODUCTIVE_TOOLS))
        behavior_by_key[key]["twining_pct"].append(
            sum(1 for tn in tools if "twining" in tn) / max(len(tools), 1) * 100
        )
        behavior_by_key[key]["num_turns"].append(t.numTurns)
        behavior_by_key[key]["compaction_count"].append(t.compactionCount)

    # Aggregate behaviors to means per (scenario, condition) to match score granularity
    agg_behaviors = {}
    for key, metrics in behavior_by_key.items():
        agg_behaviors[key] = {m: float(np.mean(v)) for m, v in metrics.items()}

    # Build paired arrays: behavior metric values vs outcome values
    behavior_metrics = [
        "twining_calls", "orientation_calls", "recording_calls", "graph_calls",
        "verification_calls", "twining_pct", "productive_calls", "num_turns",
        "compaction_count", "total_tool_calls",
    ]
    outcome_metrics = ["composite", "cost_usd"]

    # Collect paired data points
    score_by_key = defaultdict(list)
    for s in scores:
        score_by_key[(s.scenario, s.condition)].append(s)

    correlations = []
    for behavior_metric in behavior_metrics:
        for outcome_metric in outcome_metrics:
            behavior_vals = []
            outcome_vals = []
            for key in agg_behaviors:
                if key not in score_by_key:
                    continue
                b_val = agg_behaviors[key].get(behavior_metric, 0)
                if outcome_metric == "composite":
                    o_vals = [s.composite for s in score_by_key[key]]
                elif outcome_metric == "cost_usd":
                    o_vals = [s.metrics.costUsd for s in score_by_key[key]]
                else:
                    continue
                for o_val in o_vals:
                    behavior_vals.append(b_val)
                    outcome_vals.append(o_val)

            if len(behavior_vals) < 4:
                continue

            r, p = sp_stats.pearsonr(behavior_vals, outcome_vals)
            correlations.append({
                "behavior_metric": behavior_metric,
                "outcome_metric": outcome_metric,
                "pearson_r": round(float(r), 3),
                "p_value": round(float(p), 4),
                "n": len(behavior_vals),
                "significant": p < 0.05,
                "interpretation": _interpret_r(r),
            })

    # Classify behaviors
    predictive = [c for c in correlations if abs(c["pearson_r"]) > 0.3 and c["significant"]]
    non_predictive = [c for c in correlations if abs(c["pearson_r"]) < 0.1]

    return {
        "correlations": correlations,
        "predictive_behaviors": predictive,
        "non_predictive_behaviors": non_predictive,
    }


def _interpret_r(r: float) -> str:
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
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_behavior_outcome.py -v
git add analysis/ && git commit -m "feat(analysis): add behavior-outcome correlation analyzer"
```

---

### Task 11: Effect decomposition analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/effect_decomposition.py`
- Create: `analysis/tests/test_effect_decomposition.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_effect_decomposition.py`**

```python
"""Tests for effect decomposition analyzer."""
import pytest
from tests.conftest import make_scored_result, make_transcript, make_tool_call
from benchmark_analysis.dimensions.effect_decomposition import analyze_effect_decomposition


def test_mechanism_attribution(sample_scores):
    transcripts = [
        make_transcript(scenario="refactoring-handoff", condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble")] * 5 + [make_tool_call("twining_add_entity")] * 3),
        make_transcript(scenario="refactoring-handoff", condition="twining-lite",
                       tool_calls=[make_tool_call("twining_assemble")] * 5),
        make_transcript(scenario="refactoring-handoff", condition="baseline",
                       tool_calls=[]),
    ]
    result = analyze_effect_decomposition(sample_scores, transcripts)
    assert "mechanism_attribution" in result
    for entry in result["mechanism_attribution"]:
        assert "mechanism" in entry
        assert "lift_contribution" in entry


def test_tool_utilization(sample_scores):
    transcripts = [
        make_transcript(condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("twining_decide"),
                                   make_tool_call("twining_verify")]),
    ]
    result = analyze_effect_decomposition(sample_scores, transcripts)
    assert "tool_utilization" in result
    assert "never_called" in result["tool_utilization"]


def test_lite_vs_full_delta():
    """Identify what full-twining adds over twining-lite."""
    full_scores = [make_scored_result(condition="full-twining", composite=88 + i) for i in range(3)]
    lite_scores = [make_scored_result(condition="twining-lite", composite=90 + i) for i in range(3)]
    base_scores = [make_scored_result(condition="baseline", composite=75 + i) for i in range(3)]
    transcripts = [
        make_transcript(condition="full-twining",
                       tool_calls=[make_tool_call("twining_assemble"), make_tool_call("twining_add_entity")] * 5),
        make_transcript(condition="twining-lite",
                       tool_calls=[make_tool_call("twining_assemble")] * 5),
        make_transcript(condition="baseline", tool_calls=[]),
    ]
    result = analyze_effect_decomposition(full_scores + lite_scores + base_scores, transcripts)
    assert "lite_vs_full" in result
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/effect_decomposition.py`**

```python
"""Attribute coordination lift to specific mechanisms.

Answers: what portion of the lift comes from orientation vs recording vs
graph-building? Which tools are overhead with no measurable benefit?
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from ..models import ScoredResult, SessionTranscript

# Tool categories (same as behavior_outcome, shared constants)
MECHANISM_CATEGORIES = {
    "orientation": {"twining_assemble", "twining_recent", "twining_query", "twining_why", "twining_read",
                    "twining_status", "twining_what_changed"},
    "recording": {"twining_decide", "twining_post", "twining_link_commit"},
    "graph_building": {"twining_add_entity", "twining_add_relation", "twining_neighbors", "twining_graph_query",
                       "twining_prune_graph"},
    "verification": {"twining_verify"},
    "coordination_mgmt": {"twining_register", "twining_agents", "twining_discover", "twining_delegate",
                          "twining_handoff", "twining_acknowledge"},
    "search_retrieval": {"twining_search_decisions", "twining_trace", "twining_commits"},
    "lifecycle": {"twining_archive", "twining_export", "twining_summarize"},
    "decision_mgmt": {"twining_reconsider", "twining_override", "twining_promote", "twining_dismiss"},
}

# All known twining tools (union of above)
ALL_TWINING_TOOLS = set()
for tools in MECHANISM_CATEGORIES.values():
    ALL_TWINING_TOOLS |= tools


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

    for t in transcripts:
        tool_names = [tc.toolName for tc in t.toolCalls]
        for mechanism, tool_set in MECHANISM_CATEGORIES.items():
            count = sum(1 for tn in tool_names if tn in tool_set)
            mechanism_usage[t.condition][mechanism].append(count)
        for tn in tool_names:
            if tn in ALL_TWINING_TOOLS:
                tool_counts[t.condition][tn] += 1
                tools_ever_called.add(tn)

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
            "lift_contribution": round(heavy_mean - non_mean, 2),
            "avg_calls_per_session": round(
                float(np.mean([u for u in usage_by_condition.values() if u > 0])) if any(
                    u > 0 for u in usage_by_condition.values()) else 0, 1),
        })

    # Tool utilization
    never_called = sorted(ALL_TWINING_TOOLS - tools_ever_called)
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
            "conclusion": "full adds value" if condition_means["full-twining"] > condition_means["twining-lite"] + 2
                          else "lite sufficient" if condition_means["twining-lite"] >= condition_means["full-twining"] - 2
                          else "marginal difference",
        }

    return {
        "mechanism_attribution": sorted(mechanism_attribution, key=lambda x: -abs(x["lift_contribution"])),
        "tool_utilization": {
            "tools_ever_called": sorted(tools_ever_called),
            "never_called": never_called,
            "per_tool_counts": per_tool,
        },
        "lite_vs_full": lite_vs_full,
    }
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_effect_decomposition.py -v
git add analysis/ && git commit -m "feat(analysis): add effect decomposition analyzer"
```

---

### Task 12: Learning curve / session-order analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/learning_curve.py`
- Create: `analysis/tests/test_learning_curve.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_learning_curve.py`**

```python
"""Tests for learning curve / session-order analyzer."""
import pytest
from tests.conftest import make_transcript, make_tool_call
from benchmark_analysis.dimensions.learning_curve import analyze_learning_curve


def test_session_order_metrics():
    """Sessions later in sequence should show measurable trend data."""
    transcripts = [
        make_transcript(scenario="multi-session-build", condition="full-twining",
                       task_index=i, num_turns=20 + i * 5, cost=1.0 + i * 0.5,
                       tool_calls=[make_tool_call("twining_assemble")] * (i + 1))
        for i in range(5)
    ]
    result = analyze_learning_curve(transcripts)
    assert "per_scenario" in result
    msb = [s for s in result["per_scenario"] if s["scenario"] == "multi-session-build"]
    assert len(msb) > 0
    assert "session_trend" in msb[0]


def test_coordination_value_over_sessions():
    """Track whether coordination becomes more/less valuable over sessions."""
    transcripts = []
    for i in range(4):
        # Coordinated condition uses more twining in later sessions
        transcripts.append(make_transcript(
            scenario="evolving-requirements", condition="full-twining",
            task_index=i, num_turns=15,
            tool_calls=[make_tool_call("twining_assemble")] * (i + 1) + [make_tool_call("Read")] * 10,
            cost=1.0 + i * 0.3))
        # Baseline has no coordination
        transcripts.append(make_transcript(
            scenario="evolving-requirements", condition="baseline",
            task_index=i, num_turns=20 + i * 3,
            tool_calls=[make_tool_call("Read")] * 10,
            cost=0.8 + i * 0.4))
    result = analyze_learning_curve(transcripts)
    assert "coordination_value_trend" in result


def test_compaction_impact():
    """Sessions with compaction should show detectable patterns."""
    transcripts = [
        make_transcript(task_index=0, num_turns=20),
        make_transcript(task_index=1, num_turns=40),  # no compaction
    ]
    # Manually set compaction on second
    transcripts[1].compactionCount = 2
    result = analyze_learning_curve(transcripts)
    assert "compaction_analysis" in result
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/learning_curve.py`**

```python
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
      - compaction_analysis: sessions with compaction vs without — impact on metrics
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
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_learning_curve.py -v
git add analysis/ && git commit -m "feat(analysis): add learning curve / session-order analyzer"
```

---

### Task 13: Scenario × condition interaction analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/interactions.py`
- Create: `analysis/tests/test_interactions.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_interactions.py`**

```python
"""Tests for scenario × condition interaction analyzer."""
import pytest
from tests.conftest import make_scored_result
from benchmark_analysis.dimensions.interactions import analyze_interactions


def test_interaction_matrix(sample_scores):
    result = analyze_interactions(sample_scores)
    assert "matrix" in result
    assert len(result["matrix"]) > 0
    for entry in result["matrix"]:
        assert "scenario" in entry
        assert "condition" in entry
        assert "mean_composite" in entry


def test_disordinal_detection():
    """Detect when condition A beats B in scenario X but loses in scenario Y."""
    scores = [
        # Scenario 1: full-twining wins
        make_scored_result(scenario="refactoring-handoff", condition="baseline", composite=70),
        make_scored_result(scenario="refactoring-handoff", condition="full-twining", composite=90),
        # Scenario 2: full-twining loses (coordination overhead hurts simple task)
        make_scored_result(scenario="bug-investigation", condition="baseline", composite=85),
        make_scored_result(scenario="bug-investigation", condition="full-twining", composite=75),
    ]
    result = analyze_interactions(scores)
    assert "disordinal_interactions" in result
    assert len(result["disordinal_interactions"]) > 0


def test_scenario_characteristics():
    """Identify which scenario features predict coordination benefit."""
    result = analyze_interactions([
        make_scored_result(scenario="multi-session-build", condition="baseline", composite=60),
        make_scored_result(scenario="multi-session-build", condition="full-twining", composite=85),
        make_scored_result(scenario="bug-investigation", condition="baseline", composite=80),
        make_scored_result(scenario="bug-investigation", condition="full-twining", composite=82),
    ])
    assert "best_scenario_for_coordination" in result
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/interactions.py`**

```python
"""Scenario × condition interaction effects.

Answers: are there scenarios where coordination hurts? Which scenario
characteristics predict coordination benefit?
"""
from __future__ import annotations
from collections import defaultdict
from itertools import combinations
import numpy as np
from ..models import ScoredResult
from ..stats import cohens_d, interpret_cohens_d


def analyze_interactions(
    scores: list[ScoredResult],
    baseline: str = "baseline",
) -> dict:
    """Analyze interaction effects between scenarios and conditions.

    Returns dict with:
      - matrix: scenario × condition mean composite (for heatmap)
      - disordinal_interactions: cases where condition ranking reverses across scenarios
      - best_scenario_for_coordination: scenarios with largest coordination lift
      - worst_scenario_for_coordination: scenarios where coordination hurts or doesn't help
      - scenario_difficulty: scenarios ranked by baseline performance (harder = lower baseline)
    """
    by_pair = defaultdict(list)
    for s in scores:
        by_pair[(s.scenario, s.condition)].append(s.composite)

    scenarios = sorted(set(s.scenario for s in scores))
    conditions = sorted(set(s.condition for s in scores))

    # Build matrix
    matrix = []
    pair_means = {}
    for scenario in scenarios:
        for condition in conditions:
            values = by_pair.get((scenario, condition), [])
            if values:
                mean = float(np.mean(values))
                pair_means[(scenario, condition)] = mean
                matrix.append({
                    "scenario": scenario,
                    "condition": condition,
                    "mean_composite": round(mean, 2),
                    "std": round(float(np.std(values, ddof=1)), 2) if len(values) > 1 else 0.0,
                    "n": len(values),
                })

    # Detect disordinal interactions
    # For each pair of conditions, check if their ranking reverses across scenarios
    disordinal = []
    for c1, c2 in combinations(conditions, 2):
        c1_wins = []
        c2_wins = []
        for scenario in scenarios:
            m1 = pair_means.get((scenario, c1))
            m2 = pair_means.get((scenario, c2))
            if m1 is not None and m2 is not None:
                if m1 > m2 + 2:  # meaningful difference threshold
                    c1_wins.append(scenario)
                elif m2 > m1 + 2:
                    c2_wins.append(scenario)
        if c1_wins and c2_wins:
            disordinal.append({
                "condition_a": c1,
                "condition_b": c2,
                "a_wins_in": c1_wins,
                "b_wins_in": c2_wins,
                "interpretation": f"{c1} and {c2} have reversed rankings across scenarios — no single condition is universally better",
            })

    # Best/worst scenarios for coordination (vs baseline)
    scenario_lift = []
    for scenario in scenarios:
        baseline_mean = pair_means.get((scenario, baseline))
        if baseline_mean is None:
            continue
        best_lift = 0.0
        best_condition = baseline
        worst_lift = 0.0
        worst_condition = baseline
        for condition in conditions:
            if condition == baseline:
                continue
            cond_mean = pair_means.get((scenario, condition))
            if cond_mean is None:
                continue
            lift = cond_mean - baseline_mean
            if lift > best_lift:
                best_lift = lift
                best_condition = condition
            if lift < worst_lift:
                worst_lift = lift
                worst_condition = condition
        scenario_lift.append({
            "scenario": scenario,
            "baseline_mean": round(baseline_mean, 2),
            "best_lift": round(best_lift, 2),
            "best_condition": best_condition,
            "worst_lift": round(worst_lift, 2),
            "worst_condition": worst_condition,
            "coordination_helps": best_lift > 5,
            "coordination_hurts": worst_lift < -5,
        })

    scenario_lift.sort(key=lambda x: -x["best_lift"])
    best = [s for s in scenario_lift if s["coordination_helps"]]
    worst = [s for s in scenario_lift if s["coordination_hurts"]]

    # Scenario difficulty ranking
    scenario_difficulty = []
    for scenario in scenarios:
        bl = pair_means.get((scenario, baseline))
        if bl is not None:
            scenario_difficulty.append({"scenario": scenario, "baseline_mean": round(bl, 2)})
    scenario_difficulty.sort(key=lambda x: x["baseline_mean"])

    return {
        "matrix": matrix,
        "disordinal_interactions": disordinal,
        "best_scenario_for_coordination": best,
        "worst_scenario_for_coordination": worst,
        "scenario_difficulty": scenario_difficulty,
    }
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_interactions.py -v
git add analysis/ && git commit -m "feat(analysis): add scenario × condition interaction analyzer"
```

---

### Task 14: Construct validity / scorer reliability analyzer

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/construct_validity.py`
- Create: `analysis/tests/test_construct_validity.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_construct_validity.py`**

```python
"""Tests for construct validity analyzer."""
import pytest
from tests.conftest import make_scored_result, make_score
from benchmark_analysis.dimensions.construct_validity import analyze_construct_validity


def test_dimension_intercorrelation(sample_scores):
    result = analyze_construct_validity(sample_scores)
    assert "dimension_correlations" in result
    for entry in result["dimension_correlations"]:
        assert "dim_a" in entry
        assert "dim_b" in entry
        assert "pearson_r" in entry


def test_score_consistency():
    """Same scenario×condition across iterations should be reasonably consistent."""
    scores = [
        make_scored_result(iteration=0, composite=80, scores={
            "completion": make_score(90), "consistency": make_score(70)}),
        make_scored_result(iteration=1, composite=82, scores={
            "completion": make_score(92), "consistency": make_score(72)}),
        make_scored_result(iteration=2, composite=78, scores={
            "completion": make_score(88), "consistency": make_score(68)}),
    ]
    result = analyze_construct_validity(scores)
    assert "internal_consistency" in result
    # Low variance across iterations = good consistency
    for entry in result["internal_consistency"]:
        assert entry["cv_pct"] < 20


def test_confidence_distribution(sample_scores):
    result = analyze_construct_validity(sample_scores)
    assert "confidence_distribution" in result
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/construct_validity.py`**

```python
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


def analyze_construct_validity(scores: list[ScoredResult]) -> dict:
    """Analyze measurement quality and construct validity.

    Returns dict with:
      - dimension_correlations: pairwise Pearson r between scoring dimensions
      - internal_consistency: per-dimension CV within scenario×condition pairs (test-retest reliability)
      - confidence_distribution: breakdown of scorer confidence levels and whether they predict accuracy
      - method_agreement: comparison of automated vs llm-judge scoring methods where both exist
      - composite_validity: does composite correlate with individual dimensions as expected?
    """
    # Collect per-dimension values
    dim_values = defaultdict(list)
    dim_pairs = defaultdict(lambda: defaultdict(list))  # scenario×condition → dim → values
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
        if len(paired_v1) >= 4:
            r, p = sp_stats.pearsonr(paired_v1, paired_v2)
            dimension_correlations.append({
                "dim_a": d1, "dim_b": d2,
                "pearson_r": round(float(r), 3),
                "p_value": round(float(p), 4),
                "n": len(paired_v1),
                "interpretation": "redundant" if abs(r) > 0.9 else
                                  "strongly related" if abs(r) > 0.7 else
                                  "moderately related" if abs(r) > 0.4 else
                                  "weakly related" if abs(r) > 0.2 else "independent",
            })

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

    # Method agreement: where automated and llm-judge scores exist for same dimension
    method_comparison = defaultdict(lambda: {"automated": [], "llm-judge": []})
    for s in scores:
        for dim_name, dim_score in s.scores.items():
            if dim_score.method in ("automated", "llm-judge"):
                method_comparison[dim_name][dim_score.method].append(dim_score.value)

    method_agreement = []
    for dim_name, methods in sorted(method_comparison.items()):
        if methods["automated"] and methods["llm-judge"]:
            min_n = min(len(methods["automated"]), len(methods["llm-judge"]))
            if min_n >= 3:
                r, p = sp_stats.pearsonr(methods["automated"][:min_n], methods["llm-judge"][:min_n])
                method_agreement.append({
                    "dimension": dim_name,
                    "pearson_r": round(float(r), 3),
                    "automated_mean": round(float(np.mean(methods["automated"])), 1),
                    "llm_judge_mean": round(float(np.mean(methods["llm-judge"])), 1),
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
        if len(composites) >= 4:
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
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_construct_validity.py -v
git add analysis/ && git commit -m "feat(analysis): add construct validity / scorer reliability analyzer"
```

---

### Task 15: Harness comparison summary matrix

**Files:**
- Create: `analysis/src/benchmark_analysis/dimensions/harness_summary.py`
- Create: `analysis/tests/test_harness_summary.py`

- [ ] **Step 1: Write tests in `analysis/tests/test_harness_summary.py`**

```python
"""Tests for harness comparison summary matrix."""
import pytest
from benchmark_analysis.dimensions.harness_summary import generate_harness_summary


def test_summary_matrix(sample_scores):
    # Simulate a minimal all_results dict
    all_results = {
        "scoring": {"condition_rankings": [
            {"rank": 1, "condition": "full-twining", "mean": 90},
            {"rank": 2, "condition": "baseline", "mean": 75},
        ]},
        "coordination_lift": {"pairwise_lift": [
            {"condition": "full-twining", "baseline": "baseline",
             "lift_points": 15, "significant": True, "cohens_d": 1.2, "interpretation": "large"},
        ]},
        "cost": {"per_condition": [
            {"condition": "full-twining", "mean_cost_usd": 2.0, "cost_per_composite_point": 0.022},
            {"condition": "baseline", "mean_cost_usd": 1.0, "cost_per_composite_point": 0.013},
        ]},
        "interactions": {"best_scenario_for_coordination": [], "worst_scenario_for_coordination": []},
    }
    result = generate_harness_summary(all_results)
    assert "matrix" in result
    assert len(result["matrix"]) >= 2
    for row in result["matrix"]:
        assert "condition" in row
        assert "composite_mean" in row
        assert "lift_vs_baseline" in row
        assert "cost_usd" in row


def test_summary_includes_all_conditions(sample_scores):
    all_results = {
        "scoring": {"condition_rankings": [
            {"rank": i + 1, "condition": c, "mean": 75 + i * 2}
            for i, c in enumerate(["baseline", "claude-md-only", "shared-markdown",
                                    "file-reload-generic", "file-reload-structured",
                                    "persistent-history", "twining-lite", "full-twining"])
        ]},
        "coordination_lift": {"pairwise_lift": []},
        "cost": {"per_condition": []},
        "interactions": {"best_scenario_for_coordination": [], "worst_scenario_for_coordination": []},
    }
    result = generate_harness_summary(all_results)
    assert len(result["matrix"]) == 8
```

- [ ] **Step 2: Implement `analysis/src/benchmark_analysis/dimensions/harness_summary.py`**

```python
"""Single harness comparison summary matrix.

Produces the one table a researcher looks at first: each harness (condition)
as a row, key metrics as columns, with significance indicators.
"""
from __future__ import annotations


def generate_harness_summary(all_results: dict) -> dict:
    """Generate the master harness comparison matrix.

    Returns dict with:
      - matrix: list of rows, one per condition, with columns:
        condition, rank, composite_mean, lift_vs_baseline, lift_significant,
        effect_size, cost_usd, cost_per_point, best_scenario, worst_scenario,
        coordination_overhead_pct
      - headline: one-sentence summary of top finding
    """
    rankings = {r["condition"]: r for r in all_results.get("scoring", {}).get("condition_rankings", [])}
    lift_data = {e["condition"]: e for e in all_results.get("coordination_lift", {}).get("pairwise_lift", [])}
    cost_data = {e["condition"]: e for e in all_results.get("cost", {}).get("per_condition", [])}

    # Best/worst scenarios per condition from interactions
    interactions = all_results.get("interactions", {})
    best_scenarios = {}
    worst_scenarios = {}
    for entry in interactions.get("best_scenario_for_coordination", []):
        best_scenarios[entry.get("best_condition", "")] = entry.get("scenario", "")
    for entry in interactions.get("worst_scenario_for_coordination", []):
        worst_scenarios[entry.get("worst_condition", "")] = entry.get("scenario", "")

    # Coordination overhead from coordination analysis
    coord = all_results.get("coordination", {})
    overhead_data = {e["condition"]: e for e in coord.get("per_condition", [])} if coord else {}

    matrix = []
    for condition, ranking in sorted(rankings.items(), key=lambda x: x[1].get("rank", 99)):
        lift = lift_data.get(condition, {})
        cost = cost_data.get(condition, {})
        overhead = overhead_data.get(condition, {})

        matrix.append({
            "condition": condition,
            "rank": ranking.get("rank", "?"),
            "composite_mean": ranking.get("mean", 0),
            "lift_vs_baseline": lift.get("lift_points", 0),
            "lift_significant": lift.get("significant", False),
            "effect_size": lift.get("interpretation", "N/A"),
            "cohens_d": lift.get("cohens_d", None),
            "cost_usd": cost.get("mean_cost_usd", 0),
            "cost_per_point": cost.get("cost_per_composite_point", 0),
            "best_scenario": best_scenarios.get(condition, "—"),
            "worst_scenario": worst_scenarios.get(condition, "—"),
            "coordination_overhead_pct": overhead.get("twining_pct", 0),
        })

    # Generate headline
    headline = ""
    if matrix:
        top = matrix[0]
        if top["lift_significant"]:
            headline = (f"{top['condition']} ranks #1 with {top['composite_mean']:.1f} composite "
                       f"(+{top['lift_vs_baseline']:.1f} vs baseline, {top['effect_size']} effect, p<0.05)")
        else:
            headline = (f"{top['condition']} ranks #1 with {top['composite_mean']:.1f} composite "
                       f"but lift is not statistically significant (need more runs)")

    return {
        "matrix": matrix,
        "headline": headline,
    }
```

- [ ] **Step 3: Run tests, commit**

```bash
cd analysis && python -m pytest tests/test_harness_summary.py -v
git add analysis/ && git commit -m "feat(analysis): add harness comparison summary matrix"
```

---

## Chunk 4: Reports and CLI

### Task 16: Report generators

**Files:**
- Create: `analysis/src/benchmark_analysis/reports/markdown.py`
- Create: `analysis/src/benchmark_analysis/reports/html.py`
- Create: `analysis/src/benchmark_analysis/reports/json_report.py`
- Create: `analysis/src/benchmark_analysis/reports/templates/report.html.j2`
- Create: `analysis/tests/test_reports.py`

- [ ] **Step 1: Implement JSON report** — simplest, just serializes analysis results to JSON.

```python
# json_report.py
def generate_json_report(analysis_results: dict, output_path: Path) -> None:
    """Write analysis results as structured JSON."""
```

- [ ] **Step 2: Implement Markdown report** — generates tables and sections for each dimension.

```python
# markdown.py
def generate_markdown_report(analysis_results: dict, metadata: RunMetadata) -> str:
    """Generate a comprehensive Markdown report."""
```

Sections: Executive Summary, Harness Comparison Matrix, Coordination Lift, Behavior-Outcome Correlations, Effect Decomposition, Per-Scenario Breakdown, Interaction Effects, Learning Curves, Effect Sizes, Coordination Behavior, Cost Analysis, Construct Validity, Reliability, Recommendations.

- [ ] **Step 3: Implement HTML report** — uses Jinja2 template + plotly for interactive charts.

```python
# html.py
def generate_html_report(analysis_results: dict, metadata: RunMetadata, output_path: Path) -> None:
    """Generate an interactive HTML report with plotly charts."""
```

Charts: composite score bar chart by condition, per-scenario × condition heatmap (interaction plot), effect size forest plot, behavior-outcome correlation heatmap, cost vs quality scatter, coordination overhead pie chart, learning curve line charts (per-scenario session-order trends), mechanism attribution bar chart.

- [ ] **Step 4: Create Jinja2 template** at `analysis/src/benchmark_analysis/reports/templates/report.html.j2`

- [ ] **Step 5: Write tests**

Test: JSON report is valid JSON. Markdown report contains expected sections. HTML report is valid HTML.

- [ ] **Step 6: Commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add Markdown, HTML, and JSON report generators"
```

---

### Task 17: CLI entry point

**Files:**
- Create: `analysis/src/benchmark_analysis/cli.py`

- [ ] **Step 1: Implement CLI**

```python
"""CLI for benchmark analysis."""
import argparse
import sys
from pathlib import Path

from .loader import load_run, scores_to_dataframe, transcripts_to_dataframe
from .dimensions import (
    scoring, conditions, scenarios, coordination, coordination_lift,
    cost, reliability, scorer_diagnostics, sessions,
    behavior_outcome, effect_decomposition, learning_curve,
    interactions, construct_validity, harness_summary,
    recommendations,
)
from .reports import markdown, html, json_report


def main():
    parser = argparse.ArgumentParser(description="Analyze Twining benchmark results")
    subparsers = parser.add_subparsers(dest="command")

    # analyze <run-dir>
    analyze_parser = subparsers.add_parser("analyze", help="Analyze a single run")
    analyze_parser.add_argument("run_dir", type=Path, help="Path to benchmark run directory")
    analyze_parser.add_argument("--format", choices=["markdown", "html", "json", "all"], default="all")
    analyze_parser.add_argument("--output", type=Path, help="Output directory (default: run_dir/analysis/)")

    # compare <run-dir-1> <run-dir-2>
    compare_parser = subparsers.add_parser("compare", help="Compare two runs")
    compare_parser.add_argument("run_dirs", nargs=2, type=Path)
    compare_parser.add_argument("--format", choices=["markdown", "json"], default="markdown")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "analyze":
        run_analyze(args)
    elif args.command == "compare":
        run_compare(args)


def run_analyze(args):
    """Run full analysis on a single benchmark run."""
    run = load_run(args.run_dir)
    scores_df = scores_to_dataframe(run.scores)
    transcripts_df = transcripts_to_dataframe(run.transcripts)

    print(f"Loaded run {run.metadata.id}: {len(run.scores)} scores, {len(run.transcripts)} transcripts")

    results = {
        "scoring": scoring.analyze_scoring(run.scores),
        "conditions": conditions.analyze_conditions(run.scores),
        "scenarios": scenarios.analyze_scenarios(run.scores),
        "coordination": coordination.analyze_coordination(run.session_data),
        "coordination_lift": coordination_lift.analyze_coordination_lift(run.scores),
        "cost": cost.analyze_cost(run.scores),
        "reliability": reliability.analyze_reliability(run.scores),
        "scorer_diagnostics": scorer_diagnostics.analyze_scorers(run.scores),
        "sessions": sessions.analyze_sessions(run.transcripts),
        "behavior_outcome": behavior_outcome.analyze_behavior_outcome(run.scores, run.transcripts),
        "effect_decomposition": effect_decomposition.analyze_effect_decomposition(run.scores, run.transcripts),
        "learning_curve": learning_curve.analyze_learning_curve(run.transcripts),
        "interactions": interactions.analyze_interactions(run.scores),
        "construct_validity": construct_validity.analyze_construct_validity(run.scores),
    }
    results["harness_summary"] = harness_summary.generate_harness_summary(results)
    results["recommendations"] = recommendations.synthesize_recommendations(results)

    output_dir = args.output or (args.run_dir / "analysis")
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.format in ("json", "all"):
        json_report.generate_json_report(results, output_dir / "analysis.json")
        print(f"  JSON report: {output_dir / 'analysis.json'}")

    if args.format in ("markdown", "all"):
        md = markdown.generate_markdown_report(results, run.metadata)
        (output_dir / "analysis.md").write_text(md)
        print(f"  Markdown report: {output_dir / 'analysis.md'}")

    if args.format in ("html", "all"):
        html.generate_html_report(results, run.metadata, output_dir / "analysis.html")
        print(f"  HTML report: {output_dir / 'analysis.html'}")

    # Print summary to terminal
    _print_terminal_summary(results)


def run_compare(args):
    """Compare two benchmark runs."""
    from .dimensions.temporal import analyze_temporal
    runs = [load_run(d) for d in args.run_dirs]
    comparison = analyze_temporal(runs)

    if args.format == "json":
        import json
        print(json.dumps(comparison, indent=2, default=str))
    else:
        _print_comparison(comparison, runs)


def _print_terminal_summary(results: dict):
    """Print a concise terminal summary."""
    # Headline
    headline = results.get("harness_summary", {}).get("headline", "")
    if headline:
        print(f"\n>>> {headline}")

    # Harness comparison matrix
    print("\n=== HARNESS COMPARISON MATRIX ===")
    print(f"  {'Condition':<28s} {'Rank':>4s} {'Mean':>6s} {'Lift':>6s} {'Sig':>4s} {'d':>6s} {'Cost':>7s}")
    print(f"  {'-'*28} {'-'*4} {'-'*6} {'-'*6} {'-'*4} {'-'*6} {'-'*7}")
    for row in results.get("harness_summary", {}).get("matrix", []):
        sig = " *" if row.get("lift_significant") else "  "
        d_str = f"{row['cohens_d']:+.2f}" if row.get("cohens_d") is not None else "  N/A"
        print(f"  {row['condition']:<28s} {row['rank']:>4} {row['composite_mean']:>6.1f} "
              f"{row['lift_vs_baseline']:>+6.1f}{sig} {d_str} ${row['cost_usd']:>6.2f}")

    # Predictive behaviors
    predictive = results.get("behavior_outcome", {}).get("predictive_behaviors", [])
    if predictive:
        print("\n=== PREDICTIVE BEHAVIORS ===")
        for p in predictive[:5]:
            print(f"  {p['behavior_metric']:<25s} → {p['outcome_metric']:<12s} r={p['pearson_r']:+.2f} ({p['interpretation']})")

    # Interaction warnings
    disordinal = results.get("interactions", {}).get("disordinal_interactions", [])
    if disordinal:
        print("\n=== INTERACTION WARNINGS ===")
        for d in disordinal[:3]:
            print(f"  {d['condition_a']} vs {d['condition_b']}: ranking reverses across scenarios")

    # Key effect sizes
    print("\n=== KEY EFFECT SIZES (vs baseline) ===")
    for es in results["conditions"].get("effect_sizes", []):
        if es.get("condition_a") == "baseline":
            sig = "*" if es.get("significant") else ""
            print(f"  {es['condition_b']:<30s} d={es['cohens_d']:+.2f} ({es['interpretation']}){sig}")

    print("\n=== RECOMMENDATIONS ===")
    for rec in results.get("recommendations", {}).get("items", []):
        print(f"  [{rec.get('priority', '?')}] {rec.get('message', '')}")


def _print_comparison(comparison: dict, runs):
    """Print a terminal comparison of two runs."""
    print(f"\n=== COMPARING RUNS ===")
    print(f"  Run A: {runs[0].metadata.id} ({runs[0].metadata.timestamp})")
    print(f"  Run B: {runs[1].metadata.id} ({runs[1].metadata.timestamp})")
    for item in comparison.get("changes", []):
        direction = "+" if item["delta"] > 0 else ""
        print(f"  {item['condition']:<30s} {item['previous_mean']:5.1f} → {item['current_mean']:5.1f} ({direction}{item['delta']:.1f})")
    if comparison.get("regressions"):
        print("\n  REGRESSIONS:")
        for r in comparison["regressions"]:
            print(f"    {r['condition']}: {r['delta']:+.1f} points")
    if comparison.get("improvements"):
        print("\n  IMPROVEMENTS:")
        for r in comparison["improvements"]:
            print(f"    {r['condition']}: {r['delta']:+.1f} points")
```

- [ ] **Step 2: Test CLI with real data**

```bash
cd analysis && python -m benchmark_analysis analyze ../benchmark-results/4005bc41-8855-44da-b0f2-4dd047fe7acf --format json
```

- [ ] **Step 3: Commit**

```bash
git add analysis/ && git commit -m "feat(analysis): add CLI with analyze and compare commands"
```

---

### Task 18: Integration test with real data

- [ ] **Step 1: Run full analysis on the existing benchmark run**

```bash
cd analysis && python -m benchmark_analysis analyze ../benchmark-results/4005bc41-8855-44da-b0f2-4dd047fe7acf --format all
```

- [ ] **Step 2: Verify outputs exist and contain coordination lift**

```bash
ls ../benchmark-results/4005bc41-8855-44da-b0f2-4dd047fe7acf/analysis/
```
Expected: `analysis.json`, `analysis.md`, `analysis.html`

```bash
cd analysis && python -c "
import json
with open('../benchmark-results/4005bc41-8855-44da-b0f2-4dd047fe7acf/analysis/analysis.json') as f:
    data = json.load(f)
for key in ['coordination_lift', 'behavior_outcome', 'effect_decomposition',
            'learning_curve', 'interactions', 'construct_validity', 'harness_summary']:
    assert key in data, f'Missing {key} dimension'
print('Headline:', data['harness_summary']['headline'])
print('Coordination lift:', json.dumps(data['coordination_lift']['summary'], indent=2))
print(f'Predictive behaviors: {len(data[\"behavior_outcome\"][\"predictive_behaviors\"])}')
print(f'Disordinal interactions: {len(data[\"interactions\"][\"disordinal_interactions\"])}')
"
```

- [ ] **Step 3: Run full test suite**

```bash
cd analysis && python -m pytest tests/ -v --tb=short
```

- [ ] **Step 4: Final commit**

```bash
git add analysis/ && git commit -m "feat(analysis): complete Python analysis package with 16 dimensions and reports"
```
