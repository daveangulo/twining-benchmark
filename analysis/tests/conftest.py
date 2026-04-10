"""Shared test fixtures for benchmark analysis tests."""
import itertools
import pytest
from benchmark_analysis.models import (
    ScoredResult, DimensionScore, RunMetrics, GitChurn,
    ToolCall, SessionTranscript, TokenUsage, SessionTiming,
    TurnUsage, CoordinationArtifacts,
    RunMetadata, EnvironmentInfo, RunConfig,
)

_session_counter = itertools.count(1)


def make_score(value: float = 75.0, confidence: str = "medium") -> DimensionScore:
    return DimensionScore(
        value=value, confidence=confidence,
        method="automated", justification="test",
    )


def make_metrics(**overrides) -> RunMetrics:
    defaults = dict(
        agentSessions=2, inputTokens=50,
        outputTokens=20000, cacheReadTokens=900000, cacheCreationTokens=50000,
        costUsd=1.50, wallTimeMs=300000, numTurns=40,
        compactionCount=0, contextUtilization=0.0,
        gitChurn=GitChurn(filesChanged=5, linesAdded=200, linesRemoved=10, reverts=0),
        testsPass=95, testsFail=0, compiles=True,
    )
    defaults.update(overrides)
    # Compute totalTokens from components if not explicitly overridden
    if "totalTokens" not in overrides:
        defaults["totalTokens"] = (
            defaults["inputTokens"] + defaults["outputTokens"]
            + defaults["cacheReadTokens"] + defaults["cacheCreationTokens"]
        )
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
    response_bytes: int = 0,
) -> ToolCall:
    return ToolCall(
        toolName=name, parameters=params or {},
        timestamp=timestamp, durationMs=50,
        responseBytes=response_bytes,
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
        sessionId=f"test-session-{next(_session_counter)}", runId="test-run",
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
        "baseline": (75, 1.00),
        "claude-md-only": (78, 1.10),
        "shared-markdown": (80, 1.30),
        "file-reload-generic": (82, 1.50),
        "file-reload-structured": (85, 1.70),
        "persistent-history": (83, 1.60),
        "twining-lite": (88, 2.00),
        "full-twining": (90, 2.50),
    }
    for scenario in ["refactoring-handoff", "architecture-cascade"]:
        for condition, (base, cost) in condition_bases.items():
            for i in range(3):
                noise = (i - 1) * 3  # -3, 0, +3
                results.append(make_scored_result(
                    scenario=scenario, condition=condition,
                    iteration=i, composite=base + noise,
                    costUsd=cost,
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
