# Twining Benchmark Harness

A CLI-driven benchmark execution engine that quantitatively compares multi-agent coordination strategies. It answers the question: **does [Twining](https://github.com/daveangulo/twining-mcp) actually help AI agents work together, and by how much?**

The harness runs controlled experiments where multiple Claude agents collaborate on a shared codebase under different coordination conditions — from no coordination through static docs, shared files, structured frameworks, and full Twining MCP — then scores the results using dual-rubric LLM-as-judge evaluation, automated analysis, and statistical comparison.

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- An Anthropic API key (set as `ANTHROPIC_API_KEY` environment variable)
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)

### Install

```bash
git clone https://github.com/daveangulo/twining-benchmark.git
cd twining-benchmark-harness
npm install
npm run build
```

### Run Benchmarks

```bash
# Run a single scenario/condition pair
npx twining-bench run --scenario refactoring-handoff --condition baseline --runs 1

# Run all scenarios against all conditions (3 runs each for statistical significance)
npx twining-bench run --scenario all --condition all --runs 3 --budget 500

# Use a seed for reproducible execution order
npx twining-bench run --scenario all --condition all --runs 3 --seed benchmark-v1

# Dry run — validate config and estimate cost without executing
npx twining-bench run --scenario all --condition all --runs 3 --dry-run

# Smoke test — quick end-to-end validation (2 conditions, ~10 min)
npx twining-bench smoke-test
```

Results are written to `benchmark-results/<run-id>/` with structured subdirectories for metadata, scores, transcripts, and artifacts.

### View Results

```bash
# Show full KPI summary for the latest run
npx twining-bench results show latest

# Compare two runs side-by-side with significance testing
npx twining-bench results compare <run-id-1> <run-id-2>

# Export results as markdown or CSV
npx twining-bench export <run-id> --format markdown
npx twining-bench export <run-id> --format csv
```

The results display includes a VERDICT (whether Twining helps), CONFIDENCE level, condition ranking table with significance indicators, pairwise comparisons, and auto-generated key findings.

## Cloud Execution (Fly.io)

The harness can run on Fly.io for long-running benchmark suites.

### Setup

```bash
# Deploy to Fly.io (requires fly CLI installed)
npx twining-bench cloud deploy

# Set your API key as a secret
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### Running Benchmarks on Fly

```bash
# Quick smoke test to verify config
fly ssh console -a twining-benchmark -C "node dist/cli/index.js smoke-test --timeout 10 --budget 10"

# Full benchmark run (detached via tmux)
fly ssh console -a twining-benchmark -C "apt-get update -qq && apt-get install -y -qq tmux"
fly ssh console -a twining-benchmark -C "tmux new-session -d -s bench 'node dist/cli/index.js run --scenario all --condition all --runs 3 --budget 500 --seed benchmark-v1 --output /data/benchmark-results 2>&1 | tee /data/benchmark-results/full-run.log'"

# Check progress
fly ssh console -a twining-benchmark -C "tail -20 /data/benchmark-results/full-run.log"

# Reattach to session
fly ssh console -a twining-benchmark -C "tmux attach -t bench"

# Pull results to local machine
npx twining-bench cloud pull
```

### Dashboard

The deployed app serves a web dashboard at `https://twining-benchmark.fly.dev/` for viewing results, comparing conditions, and exploring metrics.

## How It Works

### The Experiment

Each benchmark run executes this sequence:

1. **Target Setup** — A synthetic TypeScript project ("TaskFlow Pro") is copied to an isolated temp directory with a fresh git repo
2. **Condition Setup** — Coordination artifacts are injected per condition (e.g., CLAUDE.md files, Twining MCP server, structured framework files)
3. **Agent Execution** — Claude agents execute tasks via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk), with per-condition tool/MCP configuration
4. **Data Collection** — Git diffs, token usage, timing, and tool call transcripts are captured per session
5. **Scoring** — Dual-rubric LLM-as-judge (coordination quality + standalone quality) and automated analysis produce scores
6. **Teardown** — Temp directories and MCP servers are cleaned up

When `--seed` is provided, execution order is randomized using a seeded Fisher-Yates shuffle to control for order effects.

### Scenarios

The harness includes 8 scenarios testing different multi-agent coordination challenges:

| Scenario | Agents | What It Tests |
|----------|--------|---------------|
| `refactoring-handoff` | 2 | Agent A refactors, Agent B extends. Does B respect A's architecture? |
| `architecture-cascade` | 3 | A chain of 3 agents propagating architectural decisions downstream. |
| `bug-investigation` | 2 | Agent A investigates planted bugs (with hard timeout), Agent B fixes from A's findings. |
| `multi-session-build` | 5 | Five sequential agents building a feature end-to-end. |
| `concurrent-agents` | 3+1 | Three agents work in parallel (caching, audit, validation), then a merge agent integrates. |
| `conflict-resolution` | 3 | Two agents given contradictory architectural preferences, a third resolves the conflict. |
| `context-recovery` | 2 | Agent A is interrupted mid-task, Agent B recovers context and completes the work. |
| `scale-stress-test` | 2-10 | Parameterized stress test with configurable scale factor (1-5). Excluded from `--scenario all`. |

### Conditions

All 8 coordination conditions form a progression from no coordination to full Twining:

| Condition | Available to Agents |
|-----------|-------------------|
| `baseline` | Codebase only. No coordination files, no shared state. |
| `claude-md-only` | Codebase + CLAUDE.md with project conventions and instructions. |
| `shared-markdown` | CLAUDE.md + shared COORDINATION.md for freeform agent notes. |
| `file-reload-generic` | Simulates `/clear` + CONTEXT.md reload. Zero conversation history per agent. |
| `file-reload-structured` | GSD/BMAD-style framework: role files, STATE.md, PLAN.md, decisions.md, handoff.md. |
| `full-twining` | Full Twining MCP server (26 tools): blackboard, decisions, knowledge graph, verification, handoff. Agents follow explicit lifecycle gates (assemble → decide → verify → handoff). |
| `twining-lite` | Twining MCP with 8 core tools only: blackboard (post/read/query/recent), decisions (decide/search), and handoff (handoff/acknowledge). Tests whether the full suite is necessary. |
| `persistent-history` | Agents share accumulated conversation context instead of starting fresh. Tests whether the /clear pattern helps or hurts. |

### Scoring

#### Dual-Rubric Evaluation

Each run produces two independent scores:

**Coordination Score (CES)** — Evaluates inter-agent coordination quality using 4 dimensions:

| Dimension | Weight | What It Measures | Method |
|-----------|--------|-----------------|--------|
| Consistency | 0.25 | Do agents align with each other's architectural choices? | LLM-judge |
| Integration | 0.30 | Does the combined output compile, pass tests, and integrate? | Automated |
| Redundancy | 0.20 | How much redundant or duplicated work occurred? (inverse) | LLM-judge |
| Coherence | 0.15 | Is the final codebase architecturally coherent? | LLM-judge |
| Overhead | -0.10 | Penalty for coordination overhead (smooth linear: `ratio × 100`) | Automated |

**Standalone Quality Score** — Evaluates output quality independent of coordination (no mention of agents or shared state):

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| Correctness | 0.25 | Does the code work? Edge cases handled? |
| Architectural Soundness | 0.25 | Clean separation of concerns, consistent patterns? |
| Maintainability | 0.25 | Readable, well-named, testable code? |
| Completeness | 0.25 | Were all requirements implemented? |

**Coordination Lift** = CES - Standalone Score. Positive means coordination helped; negative means overhead hurt net quality.

#### Statistical Analysis

- **Mann-Whitney U** (primary): Non-parametric significance test, appropriate for small samples
- **Z-test** (secondary reference): Reported alongside for familiarity, flagged as inappropriate for N < 30
- **Cohen's d**: Effect size magnitude between condition pairs
- **95% confidence intervals**: For all metrics
- **Variance flagging**: Metrics where stddev exceeds 20% of mean

### Test Targets

**Synthetic (default): TaskFlow Pro** — A 28-file TypeScript project with repository pattern, event-driven notifications, 2 seeded bugs, and 70 passing tests.

**Generated (`--target-type generated`)** — Deterministic repo generator controlled by config (file count, modules, dependency depth, test coverage). Same seed = byte-identical output.

**External (`--target-type external`)** — Adapter for real-world repositories via git clone with user-supplied ground truth manifest.

## Development

```bash
npm test              # Run all 627 tests
npm run test:watch    # Watch mode
npm run lint          # Type-check
npm run build         # Compile to dist/

# End-to-end smoke test (requires ANTHROPIC_API_KEY, ~10 min, ~$5)
npx twining-bench smoke-test

# CI-gated e2e test
RUN_E2E=true npx vitest run tests/e2e/
```

### Project Structure

```
twining-benchmark-harness/
├── src/
│   ├── runner/
│   │   ├── orchestrator.ts           # Run orchestration with seeded order
│   │   ├── agent-session.ts          # Claude Agent SDK wrapper
│   │   ├── smoke-test.ts             # E2E smoke test runner
│   │   ├── shuffle.ts                # Seeded Fisher-Yates shuffle
│   │   ├── data-collector.ts         # Git diff, transcript, artifact capture
│   │   └── error-handler.ts          # Failure classification
│   ├── conditions/                   # 8 coordination conditions
│   ├── scenarios/                    # 8 benchmark scenarios
│   ├── analyzer/
│   │   ├── statistics.ts             # Mann-Whitney U, Cohen's d, paired tests
│   │   ├── code-analysis.ts          # Git churn, AST pattern detection
│   │   ├── llm-judge.ts              # Dual-rubric evaluation (8 templates)
│   │   └── composite-scorer.ts       # CES calculation, ranking
│   ├── targets/                      # Synthetic, generated, external targets
│   ├── results/                      # Store, index manager, exporter
│   ├── cli/                          # Commander.js CLI (11 commands)
│   ├── dashboard/                    # React + Vite web dashboard
│   └── types/                        # TypeScript interfaces
├── tests/
│   ├── unit/                         # 38 test files
│   ├── integration/                  # 2 integration test files
│   └── e2e/                          # CI-gated smoke test
├── Dockerfile                        # Multi-stage build for Fly.io
├── fly.toml                          # Fly.io config (4 CPU, 4GB RAM)
└── PRD.md                            # Full product requirements
```

## Configuration

`twining-bench.config.ts` at the project root:

```typescript
const config: BenchmarkConfig = {
  targetPath: './targets/synthetic',
  defaultRuns: 3,
  agentTimeoutMs: 15 * 60 * 1000,       // 15 min per agent session
  tokenBudgetPerRun: 500_000,
  budgetDollars: 100,                    // Hard cost ceiling
  outputDirectory: './benchmark-results',
  maxTurns: 50,
  retryCount: 0,
  dashboardPort: 3838,
  evaluatorModel: 'claude-sonnet-4-5-20250929',
};
```

CLI flags override config values. Use `--budget` to set cost ceiling for full runs.

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Required. API key for agent sessions and LLM-as-judge. |
| `RUN_E2E` | Set to `true` to enable CI-gated end-to-end tests. |

## Extending the Harness

### Adding a Condition

Implement `BaseCondition` and register in `src/conditions/registry.ts`. See existing conditions for patterns — from simple (`baseline.ts`) to complex (`full-twining.ts` with MCP server).

### Adding a Scenario

Extend `BaseScenario` and register in `src/scenarios/registry.ts`. Set `executionMode: 'parallel'` for concurrent agent scenarios. See `concurrent-agents.ts` for the parallel pattern.

### Adding a Target

Implement `ITestTarget` from `src/targets/target.interface.ts`.

## License

MIT
