# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Per-turn token usage and tool response bytes** captured from the Claude CLI stream-json output. The CLI path in `executeTask()` previously zeroed all token fields except `costUsd`; now extracts full token breakdown from `result.usage`, `contextWindowSize` from `result.modelUsage`, and per-turn usage from buffered assistant events (flushed on turn boundaries to dedupe streaming partials).
- `ToolCall.responseBytes` and `ToolCall.isError` populated by linking `tool_result` blocks to `tool_use` via `tool_use_id`.
- **Pooled multi-run analysis** — `benchmark-analysis analyze` accepts multiple run directories and runs the full 20-dimension pipeline on concatenated data. Synthetic metadata preserves component run IDs in the report header.
- `loader.pool_runs()` helper for programmatic multi-run aggregation.
- **Exploration Efficiency** section in the analysis report (replaces the misleading bytes-overhead ratio table). Decomposes per-condition bytes into `task_bytes` vs `coord_bytes`, computes exploration savings vs baseline, coord ROI, and effectiveness (score per 10KB of task work).
- File-based coordination detection: reads/writes of `COORDINATION.md`, `CONTEXT.md`, `HANDOFF.md`, and `.twining/` now count as coordination bytes for non-Twining tools. Makes conditions like `shared-markdown` pay an honest coordination cost in the efficiency metrics.
- **Token Usage Breakdown** section with per-condition input/output/cache breakdown and cache-hit ratio.
- Full token breakdown and `context_window_size` exposed through `loader.transcripts_to_dataframe`, `cost.py`, `cost_efficiency.py`, `sessions.py`.
- Bytes-weighted mechanism attribution in `effect_decomposition.py` alongside the existing count-based attribution.

### Fixed

- `record` and `housekeeping` were missing from `ALL_TWINING_OPS`, causing tool utilization tables to report 0 calls for `twining_record` and `twining_housekeeping`.

### Documentation

- **`STATE.md`** — top-level human-and-LLM-readable snapshot of harness reality: decision index health, condition set, current pooled results with caveats, key findings with evidence status, committed macro-loop research direction, known scorer issues, parked work, methodology version. Update when results, methodology, or open questions change materially.

### Internal

- `.twining/` housekeeping pass: 2 stale provisionals promoted (scorer fixes, analysis bugs) after verifying against code; 1 superseded (`npm list` workaround reverted in `69818b8` after `twining-mcp` v1.16.0 added clean `--version` exit). Macro-loop research direction and Phase 2 gates recorded under new `research/direction` scope. 70 archived blackboard entries, 218 metrics rotated. State: 0 provisionals, 0 unresolved warnings.

## [0.1.0] - 2026-04-05

### Added

- Benchmark harness with CLI (`npx twining-bench run`)
- 8 coordination conditions: baseline, claude-md-only, shared-markdown, file-reload-generic, file-reload-structured, persistent-history, twining-lite, full-twining
- 12 scenarios: sprint-simulation, context-recovery, architecture-cascade, bug-investigation, multi-session-build, conflict-resolution, evolving-requirements, iterative-feature-build, decision-volume-recovery, refactoring-handoff, concurrent-agents, scale-stress-test
- Synthetic TypeScript target (TaskFlow Pro) with repository pattern architecture
- Per-scenario scorers computed from git diffs (no process-based scoring)
- Python analysis package with 20 dimensions, 3 report formats (JSON/Markdown/HTML)
- Cross-run pooling via `compare-conditions` command
- Rescore utility (`scripts/rescore.ts`) for re-scoring existing data with updated scorers
- Cost estimation and budget controls
- Live dashboard for monitoring runs
- Cloud execution support (Fly.io)

### Fixed

- Plugin isolation via `--setting-sources ''` (bddefdf)
- twining-lite tool restriction enforcement (0ff8b25)
- Rate-limited session detection and retry (22f7eb4)
- Graduated assumptionHandling scorer (e10b9d1)
- Multi-signal decisionConsistency detection (b9271ec)
- finalQuality test coverage depth + API consistency (e24edab)
- Equal 20% composite weights (23f20e6)
- scipy NaN in power analysis (41d5019)
- Tool name prefix normalization (41d5019)
- CLI hang from `twining-mcp --version` in captureEnvironment (41d5019)
- Scorer discrimination: completion zero-variance, cumulativeRework 3pt spread, orientation-efficiency 3.4pt spread (41d5019)

### Research Data

- 7 valid runs, 5 scenarios, n=31-36 per condition
- Pooled results: twining-lite 77.2, full-twining 77.2, shared-markdown 70.4, baseline 66.5
- Both Twining conditions statistically significant (p<0.05)
