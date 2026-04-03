# Twining Benchmark Harness

A CLI-driven benchmark execution engine that quantitatively compares multi-agent coordination strategies. It answers the question: **does [Twining](https://github.com/daveangulo/twining-mcp) actually help AI agents work together, and by how much?**

The harness runs controlled experiments where multiple Claude agents collaborate on a shared codebase under different coordination conditions — from no coordination through static docs, shared files, structured frameworks, and full Twining MCP — then scores the results using dual-rubric LLM-as-judge evaluation, automated analysis, and statistical comparison.

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)
- **Authentication** (one of):
  - Anthropic API key (`ANTHROPIC_API_KEY` environment variable), or
  - Claude Max/Pro subscription (`claude auth login` — no API key needed, flat monthly cost)

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

# Run all scenarios against all conditions (5 runs each, ~$470, ~37 hours)
npx twining-bench run --scenario all --condition all --budget 500

# Use a seed for reproducible execution order
npx twining-bench run --scenario all --condition all --seed benchmark-v1

# Dry run — validate config and estimate cost without executing
npx twining-bench run --scenario all --condition all --dry-run

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

### Analyze Results (Python)

A standalone Python analysis package provides 20-dimension statistical analysis with interactive reports:

```bash
cd analysis
uv venv && uv pip install -e .

# Full analysis of a benchmark run (JSON, Markdown, HTML reports)
python -m benchmark_analysis analyze ../benchmark-results/<run-id>

# Compare two runs for regressions/improvements
python -m benchmark_analysis compare ../benchmark-results/<run-id-1> ../benchmark-results/<run-id-2>
```

See [`analysis/README.md`](analysis/README.md) for the full list of analyses performed.

## Cloud Execution (Fly.io)

The harness can run on Fly.io for long-running benchmark suites.

### Setup

```bash
# Deploy to Fly.io (requires fly CLI installed)
npx twining-bench cloud deploy

# Set your API key as a secret (only needed for API mode, not subscription plans)
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### Running Benchmarks on Fly

```bash
# Quick smoke test to verify config
fly ssh console -a twining-benchmark -C "node dist/cli/index.js smoke-test --timeout 10 --budget 10"

# Full benchmark run (detached via tmux)
fly ssh console -a twining-benchmark -C "apt-get update -qq && apt-get install -y -qq tmux"
fly ssh console -a twining-benchmark -C "tmux new-session -d -s bench 'node dist/cli/index.js run --scenario all --condition all --budget 500 --seed benchmark-v1 --output /data/benchmark-results 2>&1 | tee /data/benchmark-results/full-run.log'"

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
| `full-twining` | Twining plugin installed (same as a real user). Plugin provides MCP server (32 tools), hooks, skills, and behavioral instructions. No extra harness guidance. |
| `twining-lite` | Twining plugin installed with allowedTools restricted to 8 core tools: blackboard, decisions, and handoff. Tests whether the full tool suite is necessary. |
| `persistent-history` | Agents share accumulated conversation context instead of starting fresh. Tests whether the /clear pattern helps or hurts. |

### Scoring

#### Sprint-Simulation Scoring (Primary Scenario)

The sprint-simulation scenario scores 5 dimensions, each weighted equally at 20%:

| Dimension | Weight | What It Measures | Method |
|-----------|--------|-----------------|--------|
| decisionConsistency | 20% | Do later sessions follow session 1's architectural pattern? | Automated (multi-signal pattern detection) |
| assumptionHandling | 20% | Did agents detect and respond to the session 8 requirement change? | Automated (graduated: explicit flag → restructure → routing) |
| cumulativeRework | 20% | Lines reworked / lines added across all sessions (lower = better) | Automated (git diff analysis) |
| contextRecovery | 20% | How effectively do later sessions recover prior context? | Automated (coordination tool usage + efficiency + time-to-first-write) |
| finalQuality | 20% | Components present, tests pass, test coverage depth, API consistency | Automated (6 sub-dimensions) |

**Composite** = weighted average of all 5 dimensions (0-100 scale).

#### LLM-as-Judge Evaluation

When an evaluator model is configured, `finalQuality` uses LLM-as-judge instead of automated scoring. LLM evaluation uses **blind mode** — condition identity and coordination artifacts are stripped to prevent bias.

#### Blinded Evaluation

LLM-as-judge evaluation uses **blind mode** to prevent bias:
- Condition identity (name, tool names) is stripped from the context
- Coordination artifacts (`.twining/`, `COORDINATION.md`, etc.) are removed
- Standalone quality evaluation always runs fully blinded
- The judge evaluates code quality without knowing which coordination system produced it

#### Statistical Analysis

The harness is designed for realistic sample sizes (n=21-35 per condition at 3-5 iterations across 7 scenarios). Statistical methods are calibrated accordingly:

- **Hedges' g** (primary): Bias-corrected effect size — leads all comparison tables. Small-sample correction prevents the ~19% overestimate of raw Cohen's d at n<10.
- **Minimum Detectable Effect Size (MDES)**: Reports what effects are detectable at your actual sample size, replacing misleading "need N runs" guidance. At 5 iterations × 7 scenarios: MDES = d≥0.62.
- **ROPE analysis** (primary decision framework): Region of Practical Equivalence testing — classifies differences as "equivalent", "different", or "undecided" based on practical significance (default ±5 composite points), better suited to small samples than p-values alone.
- **Holm-Bonferroni correction**: Adjusted p-values control family-wise error rate across all pairwise comparisons.
- **Mann-Whitney U**: Non-parametric significance test. Note: at n<10, exact p-value resolution is coarse.
- **Bootstrap 95% CIs**: For condition means and mean differences (delta). Fixed seed for reproducibility.
- **Spearman rank correlation**: Used for behavior-outcome analysis (robust to non-normality of count data).
- **Variance flagging**: Scenario×condition cells with CV > 30% are flagged as high-variance.

### Test Targets

**Synthetic (default): TaskFlow Pro** — A 28-file TypeScript project with repository pattern, event-driven notifications, 2 seeded bugs, and 70 passing tests.

**Generated (`--target-type generated`)** — Deterministic repo generator controlled by config (file count, modules, dependency depth, test coverage). Same seed = byte-identical output.

**External (`--target-type external`)** — Adapter for real-world repositories via git clone with user-supplied ground truth manifest.

## Development

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run lint          # Type-check
npm run build         # Compile to dist/

# End-to-end smoke test (~10 min, ~$5 on API or free on subscription)
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
│   │   ├── test-runner.ts            # Post-iteration tsc + vitest execution
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
│   ├── unit/                         # 43 test files
│   ├── integration/                  # 2 integration test files
│   └── e2e/                          # CI-gated smoke test
├── analysis/                          # Python analysis package (20 dimensions, 3 report formats)
├── scripts/                          # Smoke test, analysis, and rescore scripts
├── Dockerfile                        # Multi-stage build for Fly.io
├── fly.toml                          # Fly.io config (4 CPU, 4GB RAM)
└── PRD.md                            # Full product requirements
```

## Configuration

`twining-bench.config.ts` at the project root:

```typescript
const config: BenchmarkConfig = {
  targetPath: './targets/synthetic',
  defaultRuns: 5,                         // 5 iterations per pair (detects d≥0.62 at full matrix)
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
| `ANTHROPIC_API_KEY` | API key for agent sessions and LLM-as-judge. Not required if authenticated via `claude auth login`. |
| `TWINING_PLUGIN_PATH` | Override path to Twining plugin directory. Set automatically in Docker (`/opt/twining-plugin/plugin`). |
| `RUN_E2E` | Set to `true` to enable CI-gated end-to-end tests. |

## Extending the Harness

### Adding a Condition

Implement `BaseCondition` and register in `src/conditions/registry.ts`. See existing conditions for patterns — from simple (`baseline.ts`) to complex (`full-twining.ts` with MCP server).

### Adding a Scenario

Extend `BaseScenario` and register in `src/scenarios/registry.ts`. Set `executionMode: 'parallel'` for concurrent agent scenarios. See `concurrent-agents.ts` for the parallel pattern.

### Adding a Target

Implement `ITestTarget` from `src/targets/target.interface.ts`.

## Known Limitations

See [`docs/benchmark-limitations.md`](docs/benchmark-limitations.md) for a full list of known limitations that should accompany published results, including: hand-designed CES weights, same-family judge model, synthetic TypeScript target, and small sample sizes.

## License

MIT
