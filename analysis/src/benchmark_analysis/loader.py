"""Load benchmark results from disk into structured models."""
from __future__ import annotations
import json
from dataclasses import dataclass
from pathlib import Path

from .models import (
    ScoredResult, SessionTranscript, CoordinationArtifacts, RunMetadata,
    EnvironmentInfo, RunConfig,
)


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


def pool_runs(run_dirs: list[str | Path]) -> BenchmarkRun:
    """Load multiple benchmark runs and pool them into a single BenchmarkRun.

    Concatenates scores, transcripts, and session_data across runs. Returns a
    BenchmarkRun with synthetic metadata: union of scenarios/conditions, summed
    runsPerPair, latest timestamp, and the environment/config from the first run.

    Use this when analyzing aggregate data across repeated benchmark runs.
    """
    runs = [load_run(d) for d in run_dirs]
    if not runs:
        raise ValueError("pool_runs requires at least one run directory")
    if len(runs) == 1:
        return runs[0]

    all_scores: list[ScoredResult] = []
    all_transcripts: list[SessionTranscript] = []
    all_session_data: list[SessionData] = []
    all_scenarios: set[str] = set()
    all_conditions: set[str] = set()
    total_runs_per_pair = 0
    timestamps: list[str] = []
    ids: list[str] = []
    statuses: set[str] = set()

    for r in runs:
        all_scores.extend(r.scores)
        all_transcripts.extend(r.transcripts)
        all_session_data.extend(r.session_data)
        all_scenarios.update(r.metadata.scenarios)
        all_conditions.update(r.metadata.conditions)
        total_runs_per_pair += r.metadata.runsPerPair
        if r.metadata.timestamp:
            timestamps.append(r.metadata.timestamp)
        ids.append(r.metadata.id)
        if r.metadata.status:
            statuses.add(r.metadata.status)

    pooled_meta = RunMetadata(
        id=f"pooled-{len(runs)}-runs",
        timestamp=max(timestamps) if timestamps else "",
        status="pooled" if len(statuses) > 1 else (next(iter(statuses), "") or "pooled"),
        scenarios=sorted(all_scenarios),
        conditions=sorted(all_conditions),
        runsPerPair=total_runs_per_pair,
        seed=",".join(ids),
        duration=sum(r.metadata.duration for r in runs),
        environment=runs[0].metadata.environment,
        config=runs[0].metadata.config,
    )

    return BenchmarkRun(
        metadata=pooled_meta,
        scores=all_scores,
        transcripts=all_transcripts,
        session_data=all_session_data,
        path=Path(run_dirs[0]),
    )


def load_scores(scores_dir: str | Path) -> list[ScoredResult]:
    """Load all score JSON files from a scores directory."""
    scores_dir = Path(scores_dir)
    if not scores_dir.exists():
        return []
    results = []
    for f in sorted(scores_dir.glob("*.json")):
        with open(f) as fh:
            data = json.load(fh)
        results.append(ScoredResult.model_validate(data))
    return results


def load_sessions(sessions_dir: str | Path) -> list[SessionData]:
    """Load all sessions with transcripts and coordination artifacts."""
    sessions_dir = Path(sessions_dir)
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


def load_transcripts(sessions_dir: str | Path) -> list[SessionTranscript]:
    """Load all transcript.json files from a sessions directory (without artifacts).

    Convenience wrapper around :func:`load_sessions` -- prefer ``load_sessions``
    when you also need coordination artifacts.
    """
    return [sd.transcript for sd in load_sessions(sessions_dir)]


def load_coordination_artifacts(sessions_dir: str | Path) -> list[CoordinationArtifacts]:
    """Load all coordination-artifacts.json files from a sessions directory.

    Convenience wrapper around :func:`load_sessions` -- prefer ``load_sessions``
    when you also need transcripts paired with their artifacts.
    """
    return [sd.artifacts for sd in load_sessions(sessions_dir) if sd.artifacts is not None]


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
            "input_tokens": t.tokenUsage.input,
            "output_tokens": t.tokenUsage.output,
            "cache_read_tokens": t.tokenUsage.cacheRead,
            "cache_creation_tokens": t.tokenUsage.cacheCreation,
            "context_window_size": t.contextWindowSize,
            "duration_ms": t.timing.durationMs,
            "time_to_first_action_ms": t.timing.timeToFirstActionMs,
            "exit_reason": t.exitReason,
            "compaction_count": t.compactionCount,
            "file_changes": len(t.fileChanges),
        })

    return pd.DataFrame(rows)
