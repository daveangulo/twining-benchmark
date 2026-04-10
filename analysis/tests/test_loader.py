"""Tests for benchmark data loader."""
import json
import pytest
from pathlib import Path
from benchmark_analysis.loader import load_run, load_scores, load_sessions, pool_runs


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


def test_load_run_transcripts_match_session_data(sample_run_dir):
    run = load_run(sample_run_dir)
    assert len(run.transcripts) == len(run.session_data)
    assert run.transcripts[0].sessionId == run.session_data[0].transcript.sessionId


def test_load_scores_missing_dir(tmp_path):
    scores = load_scores(tmp_path / "nonexistent")
    assert scores == []


def test_load_sessions_missing_dir(tmp_path):
    sessions = load_sessions(tmp_path / "nonexistent")
    assert sessions == []


def _make_run_dir(base: Path, name: str, condition: str, composite: float) -> Path:
    """Create a minimal run dir with one score + one transcript."""
    run_dir = base / name
    scores_dir = run_dir / "scores"
    sessions_dir = run_dir / "sessions" / f"session-{name}"
    scores_dir.mkdir(parents=True)
    sessions_dir.mkdir(parents=True)

    (run_dir / "metadata.json").write_text(json.dumps({
        "id": name, "timestamp": f"2026-03-0{name[-1]}T00:00:00Z",
        "status": "completed", "scenarios": ["refactoring-handoff"],
        "conditions": [condition], "runsPerPair": 1,
        "duration": 1000, "seed": name,
        "environment": {}, "config": {},
    }))
    (scores_dir / f"refactoring-handoff_{condition}_0.json").write_text(json.dumps({
        "runId": name, "scenario": "refactoring-handoff",
        "condition": condition, "iteration": 0, "composite": composite,
        "scores": {
            "completion": {"value": composite, "confidence": "high", "method": "automated", "justification": "done"},
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
    (sessions_dir / "transcript.json").write_text(json.dumps({
        "sessionId": f"session-{name}", "runId": name,
        "scenario": "refactoring-handoff", "condition": condition,
        "taskIndex": 0, "prompt": "test", "toolCalls": [],
        "fileChanges": [], "numTurns": 20,
        "tokenUsage": {"input": 50, "output": 10000, "cacheRead": 500000,
                       "cacheCreation": 25000, "total": 535050, "costUsd": 1.0},
        "timing": {"startTime": "2026-03-01T00:00:00Z", "endTime": "2026-03-01T00:05:00Z",
                   "durationMs": 300000, "timeToFirstActionMs": 10000},
        "exitReason": "completed",
    }))
    return run_dir


def test_pool_runs_concatenates_data(tmp_path):
    """pool_runs should concatenate scores/transcripts/session_data across runs."""
    run_a = _make_run_dir(tmp_path, "run1", "baseline", 80)
    run_b = _make_run_dir(tmp_path, "run2", "twining-default", 90)
    run_c = _make_run_dir(tmp_path, "run3", "twining-default", 92)

    pooled = pool_runs([run_a, run_b, run_c])

    assert len(pooled.scores) == 3
    assert len(pooled.transcripts) == 3
    assert len(pooled.session_data) == 3
    # Synthetic metadata
    assert pooled.metadata.id == "pooled-3-runs"
    assert sorted(pooled.metadata.conditions) == ["baseline", "twining-default"]
    assert pooled.metadata.runsPerPair == 3
    assert "run1" in pooled.metadata.seed and "run3" in pooled.metadata.seed


def test_pool_runs_single_returns_original(tmp_path):
    """pool_runs with a single directory should return the run as-is."""
    run = _make_run_dir(tmp_path, "run1", "baseline", 80)
    pooled = pool_runs([run])
    assert pooled.metadata.id == "run1"
    assert len(pooled.scores) == 1


def test_pool_runs_empty_raises(tmp_path):
    with pytest.raises(ValueError):
        pool_runs([])


def test_load_sessions_no_artifacts(tmp_path):
    """Sessions without coordination-artifacts.json should still load."""
    sessions_dir = tmp_path / "sessions" / "session-1"
    sessions_dir.mkdir(parents=True)
    (sessions_dir / "transcript.json").write_text(json.dumps({
        "sessionId": "session-1", "runId": "test-run",
        "scenario": "refactoring-handoff", "condition": "baseline",
        "taskIndex": 0, "prompt": "test", "toolCalls": [],
        "fileChanges": [], "numTurns": 5,
        "tokenUsage": {"input": 10, "output": 100, "cacheRead": 0,
                       "cacheCreation": 0, "total": 110, "costUsd": 0.01},
        "timing": {"startTime": "2026-03-01T00:00:00Z", "endTime": "2026-03-01T00:01:00Z",
                   "durationMs": 60000, "timeToFirstActionMs": 1000},
        "exitReason": "completed",
    }))
    sessions = load_sessions(tmp_path / "sessions")
    assert len(sessions) == 1
    assert sessions[0].artifacts is None


def test_scores_to_dataframe(sample_run_dir):
    from benchmark_analysis.loader import scores_to_dataframe
    scores = load_scores(sample_run_dir / "scores")
    df = scores_to_dataframe(scores)
    assert len(df) == 1
    assert "composite" in df.columns
    assert "cost_usd" in df.columns
    assert "score_completion" in df.columns
    assert df.iloc[0]["composite"] == 92


def test_transcripts_to_dataframe(sample_run_dir):
    from benchmark_analysis.loader import transcripts_to_dataframe, load_transcripts
    transcripts = load_transcripts(sample_run_dir / "sessions")
    df = transcripts_to_dataframe(transcripts)
    assert len(df) == 1
    assert "session_id" in df.columns
    assert "twining_pct" in df.columns
    assert df.iloc[0]["total_tool_calls"] == 1
