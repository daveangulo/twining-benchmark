# Contributing to Twining Benchmark Harness

## Architecture Overview

The harness has four pluggable extension points. Each uses an abstract base class + registry pattern:

```
Target (codebase)  -->  Condition (coordination strategy)  -->  Scenario (agent tasks)  -->  Scorer (metrics)
```

All four are decoupled. Any target works with any condition and any scenario.

## Extension Points

### Conditions (`src/conditions/`)

A condition defines what coordination tools are available to agents during a run.

1. Extend `BaseCondition` from `condition.interface.ts`
2. Implement `doSetup()`, `buildAgentConfig()`, `doTeardown()`
3. Add a `ConditionName` union member in `src/types/condition.ts`
4. Register in `src/conditions/registry.ts`
5. Add tests in `tests/unit/conditions/`

Key design rules:
- `setup()` / `teardown()` must be idempotent
- `buildAgentConfig()` returns the `AgentConfiguration` that controls what the Claude Agent SDK session receives: system prompt, allowed tools, MCP servers, permission mode
- `getCoordinationFilePaths()` returns paths to files that should be snapshot before/after sessions (for artifact diffing)

### Scenarios (`src/scenarios/`)

A scenario defines a multi-agent task sequence with scoring criteria.

1. Extend `BaseScenario` from `scenario.interface.ts`
2. Implement `buildMetadata()`, `buildAgentTasks()`, `getGroundTruth()`, `doSetup()`, `doScore()`, `doTeardown()`
3. Add a `ScenarioName` union member in `src/types/scenario.ts`
4. Register in `src/scenarios/registry.ts`
5. Add tests in `tests/unit/scenarios/`

Key design rules:
- Agent prompts use `{{variable}}` template syntax, resolved at setup
- Prompts must be identical across conditions -- only available tools differ
- `doScore()` receives raw results (transcripts, final working dir) and ground truth, returns `ScoredResults`
- Set `excludeFromAll: true` in metadata for expensive scenarios (they won't run with `--scenario all`)

### Targets (`src/targets/`)

A target is a codebase that scenarios operate on.

1. Implement `ITestTarget` from `target.interface.ts`
2. `setup()` must create an isolated temp directory with a git repo
3. `getGroundTruth()` returns an `ArchitecturalManifest` documenting the known architecture
4. `reset()` restores to initial state (typically `git checkout` + `git clean`)
5. `teardown()` cleans up the temp directory

### Scorers (`src/analyzer/`)

Scoring modules are not pluggable via registry (yet), but are composable:

- `statistics.ts` -- Pure statistical functions (mean, CI, Cohen's d, Mann-Whitney U)
- `code-analysis.ts` -- Git churn, AST pattern detection, test execution
- `llm-judge.ts` -- LLM evaluation with rubric-based prompts
- `composite-scorer.ts` -- Weighted composite from individual dimensions

## Code Style

- **Strict TypeScript**: No `any`. Enable all strict checks.
- **ES Modules**: Use `.js` extensions in imports (Node16 resolution).
- **Testing**: Every module has corresponding tests. Use Vitest.
- **Atomic commits**: One functional unit per commit.
- **No documentation bloat**: Don't add JSDoc to trivial code. Comments explain *why*, not *what*.

## Running Tests

```bash
npm test                # Full suite (355 tests, ~40s)
npm run test:watch      # Watch mode
npm run lint            # Type-check without emit
```

Tests that involve git operations or filesystem setup are slower (~3-5s each). The synthetic-repo tests are the slowest (~40s total) because they set up real npm projects in temp directories.

## Key Types

All interfaces live in `src/types/`. The main ones:

- `AgentTranscript` -- Full record of an agent session (tool calls, timing, tokens, file changes)
- `ScoredResults` -- Per-run scores with dimensions, metrics, and composite
- `AgentConfiguration` -- What the agent SDK session receives (prompt, tools, MCP servers)
- `ConditionContext` -- What a condition provides after setup
- `WorkingDirectory` -- Handle to an isolated repo copy with cleanup function
- `ArchitecturalManifest` -- Ground truth about a target's architecture

## Phase 0 vs Full Harness

Phase 0 (`src/phase0/`) is a standalone runner that bypasses the CLI and orchestrator for simplicity. It directly wires:

```
SyntheticRepoTarget -> CONDITION_REGISTRY -> RefactoringHandoffScenario -> AgentSessionManager -> DataCollector
```

The full harness (`src/cli/` + `src/runner/orchestrator.ts`) will use the same components but add: budget controls, suite resume, multi-scenario orchestration, and the web dashboard.
