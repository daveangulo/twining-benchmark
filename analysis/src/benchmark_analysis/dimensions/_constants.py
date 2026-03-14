"""Shared constants for all dimension analyzers.

Single source of truth for tool classification, condition sets, and threshold
values used across coordination, behavior-outcome, effect-decomposition,
sessions, and coordination-lift analyzers.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Productive (non-coordination) tools
# ---------------------------------------------------------------------------

PRODUCTIVE_TOOLS: frozenset[str] = frozenset({
    "Read", "Edit", "Write", "Bash", "Glob", "Grep",
    "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "LS",
})

# ---------------------------------------------------------------------------
# Twining operation categories (SHORT names -- no twining_ prefix)
# ---------------------------------------------------------------------------

ORIENTATION_OPS: frozenset[str] = frozenset({
    "assemble", "recent", "query", "status", "search_decisions",
    "read", "neighbors", "graph_query", "why", "what_changed",
})

RECORDING_OPS: frozenset[str] = frozenset({
    "decide", "post", "handoff", "register", "promote",
    "acknowledge", "verify", "link_commit",
})

GRAPH_OPS: frozenset[str] = frozenset({
    "add_entity", "add_relation", "neighbors", "graph_query", "prune_graph",
})

VERIFICATION_OPS: frozenset[str] = frozenset({"verify"})

COORDINATION_MGMT_OPS: frozenset[str] = frozenset({
    "register", "agents", "discover", "delegate", "handoff", "acknowledge",
})

SEARCH_OPS: frozenset[str] = frozenset({
    "search_decisions", "trace", "commits",
})

LIFECYCLE_OPS: frozenset[str] = frozenset({
    "archive", "export", "summarize",
})

DECISION_MGMT_OPS: frozenset[str] = frozenset({
    "reconsider", "override", "promote", "dismiss",
})

ALL_TWINING_OPS: frozenset[str] = frozenset(
    ORIENTATION_OPS | RECORDING_OPS | GRAPH_OPS | VERIFICATION_OPS
    | COORDINATION_MGMT_OPS | SEARCH_OPS | LIFECYCLE_OPS | DECISION_MGMT_OPS
)

# ---------------------------------------------------------------------------
# Mechanism categories (maps category name -> frozenset of short op names)
# Used by effect_decomposition and behavior_outcome.
# ---------------------------------------------------------------------------

MECHANISM_CATEGORIES: dict[str, frozenset[str]] = {
    "orientation": ORIENTATION_OPS,
    "recording": RECORDING_OPS,
    "graph_building": GRAPH_OPS,
    "verification": VERIFICATION_OPS,
    "coordination_mgmt": COORDINATION_MGMT_OPS,
    "search_retrieval": SEARCH_OPS,
    "lifecycle": LIFECYCLE_OPS,
    "decision_mgmt": DECISION_MGMT_OPS,
}

# ---------------------------------------------------------------------------
# Tool-name helpers
# ---------------------------------------------------------------------------

_PREFIXES = (
    "mcp__plugin_twining_twining__twining_",
    "twining__twining_",
    "twining_",
)


def normalize_tool_name(name: str) -> str:
    """Strip MCP / twining prefixes to get the short operation name.

    Examples:
        >>> normalize_tool_name("mcp__plugin_twining_twining__twining_assemble")
        'assemble'
        >>> normalize_tool_name("twining_decide")
        'decide'
        >>> normalize_tool_name("Read")
        'Read'
    """
    for prefix in _PREFIXES:
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def is_twining_tool(name: str) -> bool:
    """Return True if *name* refers to any Twining tool."""
    return "twining" in name.lower()


def classify_twining_op(name: str) -> str | None:
    """Return the mechanism category for a Twining tool, or None.

    The input may carry any prefix (MCP, twining_, etc.).
    """
    short = normalize_tool_name(name)
    for category, ops in MECHANISM_CATEGORIES.items():
        if short in ops:
            return category
    return None

# ---------------------------------------------------------------------------
# Condition sets
# ---------------------------------------------------------------------------

COORDINATED_CONDITIONS: frozenset[str] = frozenset({
    "full-twining", "twining-lite",
    "file-reload-structured", "file-reload-generic",
    "shared-markdown", "persistent-history",
})

UNCOORDINATED_CONDITIONS: frozenset[str] = frozenset({
    "baseline", "claude-md-only",
})

# ---------------------------------------------------------------------------
# Threshold constants
# ---------------------------------------------------------------------------

CEILING_MEAN: float = 95
CEILING_STD: float = 3
FLOOR_MEAN: float = 10
SIGNIFICANT_ALPHA: float = 0.05
TREND_ALPHA: float = 0.10
MIN_CORRELATION_N: int = 4
ENGAGEMENT_THRESHOLD: float = 0.5
HIGH_OVERHEAD_RATIO: float = 0.3
