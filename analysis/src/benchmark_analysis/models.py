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
    id: str = ""
    responseBytes: int = 0
    isError: bool = False


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
