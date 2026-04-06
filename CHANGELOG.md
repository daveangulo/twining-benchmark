# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
