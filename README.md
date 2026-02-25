# Twining Benchmark Harness

A CLI-driven benchmark execution engine that quantitatively compares multi-agent coordination strategies. It answers the question: **does [Twining](https://github.com/twining-mcp/twining-mcp) actually help AI agents work together, and by how much?**

The harness runs controlled experiments where multiple Claude agents collaborate on a shared codebase under different coordination conditions (no coordination, CLAUDE.md only, shared markdown, file-based reload, structured frameworks, full Twining MCP), then scores the results using automated analysis and statistical comparison.

## Current Status: Phase 2 Complete (Scenarios, Scoring & KPI Reporting)

Phase 0 (concept validation) and Phase 1 (end-to-end CLI execution) are complete. Phase 2 adds all 5 benchmark scenarios with full scoring, paired statistical tests, a programmatic repo generator, external repo adapter, and the complete KPI summary display (Section 9.3 template with verdict, confidence, ranking tables, and significance indicators).

The CLI `twining-bench run` is the primary entry point. Phase 0's standalone runner (`phase0-runner.ts`) remains available for quick validation.

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- An Anthropic API key (set as `ANTHROPIC_API_KEY` environment variable)
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)

### Install

```bash
git clone <repo-url>
cd twining-benchmark-harness
npm install
```

### Run Benchmarks (CLI)

```bash
# Run a single scenario/condition pair
npx twining-bench run --scenario refactoring-handoff --condition baseline --runs 1

# Run all scenarios against all conditions
npx twining-bench run --scenario all --condition all --runs 3

# Dry run — validate config and estimate cost without executing
npx twining-bench run --scenario all --condition all --runs 3 --dry-run

# Set a budget ceiling (default: $100)
npx twining-bench run --scenario all --condition all --runs 3 --budget 50

# Use a generated repo target (deterministic from seed)
npx twining-bench run --scenario scale-stress-test --condition baseline \
  --target-type generated --generator-config ./my-generator.json --runs 1

# Use an external repo target
npx twining-bench run --scenario refactoring-handoff --condition all \
  --target-type external --external-config ./my-repo.json --runs 3
```

Results are written to `benchmark-results/<run-id>/` with structured subdirectories for metadata, scores, transcripts, and artifacts.

### View Results

```bash
# Show full KPI summary for the latest run (Section 9.3 template)
npx twining-bench results show latest

# Show results for a specific run
npx twining-bench results show <run-id>

# Compare two runs side-by-side with significance testing
npx twining-bench results compare <run-id-1> <run-id-2>
```

The results display includes a VERDICT (whether Twining helps), CONFIDENCE level, condition ranking table with significance indicators, pairwise comparisons, and auto-generated key findings.

### Run Phase 0 (Standalone)

```bash
# Run all 3 conditions, 3 iterations each (9 total runs, ~1-2 hours)
npx tsx src/phase0/phase0-runner.ts --scenario refactor --condition all --runs 3

# Run a single condition for quick testing
npx tsx src/phase0/phase0-runner.ts --scenario refactor --condition baseline --runs 1

# Specify a custom output directory
npx tsx src/phase0/phase0-runner.ts --condition all --runs 3 --output ./my-results
```

### Analyze Results

```bash
# Generate the comparison report (reads from default output dir)
npx tsx src/phase0/phase0-analyze.ts

# Point at a custom results directory
npx tsx src/phase0/phase0-analyze.ts --input ./my-results
```

This produces:
- `phase0-report.md` -- Full markdown report with rankings, effect sizes, and go/no-go recommendation
- `phase0-analysis.json` -- Machine-readable analysis data for downstream tooling

### npm Scripts

```bash
npm run phase0:run      # Alias for phase0-runner.ts
npm run phase0:analyze  # Alias for phase0-analyze.ts
npm test                # Run the test suite (vitest)
npm run test:watch      # Run tests in watch mode
npm run build           # Compile TypeScript
npm run lint            # Type-check without emitting
```

## How It Works

### The Experiment

Each benchmark run executes this sequence:

1. **Target Setup** -- A synthetic TypeScript project ("TaskFlow Pro") is copied to an isolated temp directory with a fresh git repo
2. **Condition Setup** -- Coordination artifacts are injected per condition (e.g., CLAUDE.md files, Twining MCP server, structured framework files)
3. **Agent Execution** -- Claude agents execute tasks sequentially via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk), with per-condition tool/MCP configuration
4. **Data Collection** -- Git diffs, token usage, timing, and tool call transcripts are captured per session
5. **Scoring** -- LLM-as-judge and automated analysis score consistency, integration, redundancy, and coherence into a Coordination Effectiveness Score (CES)
6. **Teardown** -- Temp directories and MCP servers are cleaned up

### Scenarios

The harness includes 5 scenarios testing different multi-agent coordination challenges:

| Scenario | Agents | What It Tests |
|----------|--------|---------------|
| `refactoring-handoff` | 2 | Agent A refactors, Agent B extends. Does B respect A's architecture? |
| `architecture-cascade` | 3 | A chain of 3 agents propagating architectural decisions downstream. |
| `bug-investigation` | 2 | Agent A investigates planted bugs, Agent B fixes them from A's findings. |
| `multi-session-build` | 5 | Five sequential agents building a feature end-to-end. |
| `scale-stress-test` | 2-10 | Parameterized stress test with configurable scale factor (1-5). |

### Scoring Dimensions

Each scenario scores 4 dimensions using automated analysis and LLM-as-judge evaluation:

| Dimension | What It Measures | Method |
|-----------|-----------------|--------|
| **Consistency** (0-100) | Do agents align with each other's architectural choices? | LLM-judge evaluation |
| **Integration** (0-100) | Does the combined output compile, pass tests, and integrate? | Automated (tsc, test runner, git) |
| **Redundancy** (0-100, inverse) | How much redundant or duplicated work occurred? | LLM-judge evaluation |
| **Coherence** (0-100) | Is the final codebase architecturally coherent? | LLM-judge evaluation |

These are combined into a **Coordination Effectiveness Score (CES)** using the PRD formula:

```
CES = 0.25*Consistency + 0.30*Integration + 0.20*Redundancy + 0.15*Coherence - 0.10*OverheadPenalty
```

The overhead penalty kicks in when coordination overhead exceeds 10% of total work: `max(0, (ratio - 0.10)) * 200`.

Additional metrics captured per run: input/output/cache-read/cache-creation token breakdown, SDK-reported cost, wall time, turn count, compaction count, context utilization, lines added/removed, files changed, test pass/fail counts, compilation status.

### The Conditions

All 6 coordination conditions are implemented and runnable:

| Condition | Available to Agents |
|-----------|-------------------|
| `baseline` | Codebase only. No coordination files, no shared state. |
| `claude-md-only` | Codebase + CLAUDE.md with project conventions and instructions. |
| `shared-markdown` | CLAUDE.md + shared COORDINATION.md for freeform agent notes. |
| `file-reload-generic` | Simulates `/clear` + CONTEXT.md reload. Zero conversation history. |
| `file-reload-structured` | GSD/BMAD-style framework: role files, STATE.md, PLAN.md, decisions.md, handoff.md. |
| `full-twining` | Full Twining MCP server: blackboard, decisions, knowledge graph, semantic search. |

### Test Targets

Three target types are available:

**Synthetic (default): TaskFlow Pro** -- A 28-file TypeScript project with a 3-layer architecture:

- **Repository layer**: `BaseRepository` -> `UserRepository` / `OrderRepository` -> `Database`
- **Event system**: `EventBus` with typed events, `NotificationService` as listener
- **Two seeded bugs**: Pagination off-by-one (cross-page duplicates), floating-point total calculation
- **Two architectural decisions** agents must discover: repository pattern for data access, event-driven notifications
- 70 passing tests in the fixture project

**Generated (`--target-type generated`)** -- Deterministic repo generator controlled by a config file:

- `fileCount` (10-100), `moduleCount` (2-10), `dependencyDepth` (1-5)
- `testCoverage` (0-100%), `documentationLevel` (none/minimal/thorough)
- `seed` for reproducibility -- same seed produces byte-identical output
- Generates a module DAG with services, repositories, models, configs, and tests
- Returns an `ArchitecturalManifest` documenting embedded decisions for ground-truth scoring

**External (`--target-type external`)** -- Adapter for real-world repositories:

- Clones a git repo, runs setup commands, creates an isolated working copy
- Ground truth provided via a user-supplied manifest in the config file
- Each run gets a fresh clone for isolation

## Statistical Analysis

The analysis pipeline computes:

- **Per-condition summaries**: Mean, median, standard deviation, min/max, 95% confidence interval for every metric
- **Pairwise effect sizes**: Cohen's d between every pair of conditions, with interpretation (small/medium/large)
- **Significance testing**: Mann-Whitney U (unpaired), paired t-test, and Wilcoxon signed-rank test
- **Pairwise comparisons**: Every condition pair compared with effect size, p-value, and significance indicator
- **Variance flagging**: Metrics where standard deviation exceeds 20% of the mean are flagged as high-variance
- **Efficacy score**: Quantifies Twining's advantage over the best non-Twining condition
- **Auto-generated key findings**: Extracted from pairwise comparisons and ranking data

### Significance Indicators

Results display uses color-coded significance levels:

| Indicator | Meaning |
|-----------|---------|
| Green | p < 0.05 (statistically significant) |
| Yellow | p < 0.10 (suggestive) |
| Red | p >= 0.10 (not significant) |

### Cost Tracking

Token costs are reported using the SDK's `total_cost_usd` field, which reflects actual per-token pricing including cache discounts. The analysis report breaks down input, output, cache-read, and cache-creation tokens separately, along with context health metrics (turns, compactions, context window utilization). A legacy cost estimator (Sonnet 4 rates, $3/MTok input, $15/MTok output) is used as a fallback for older results that predate SDK cost reporting.

## Project Structure

```
twining-benchmark-harness/
├── src/
│   ├── phase0/
│   │   ├── phase0-runner.ts          # Phase 0 execution script
│   │   └── phase0-analyze.ts         # Phase 0 analysis & report generator
│   ├── runner/
│   │   ├── orchestrator.ts           # Run orchestration logic
│   │   ├── agent-session.ts          # Claude Agent SDK wrapper
│   │   ├── data-collector.ts         # Git diff, transcript, artifact capture
│   │   └── error-handler.ts          # Failure classification & retry logic
│   ├── targets/
│   │   ├── target.interface.ts       # ITestTarget contract
│   │   ├── synthetic-repo/
│   │   │   ├── index.ts              # SyntheticRepoTarget (TaskFlow Pro)
│   │   │   └── fixtures/             # The pre-built test project files
│   │   ├── generator/
│   │   │   ├── index.ts              # GeneratedRepoTarget (deterministic from seed)
│   │   │   ├── rng.ts                # Seeded PRNG (mulberry32)
│   │   │   ├── templates.ts          # Code generation templates
│   │   │   └── manifest-builder.ts   # ArchitecturalManifest builder
│   │   └── external/
│   │       └── index.ts              # ExternalRepoTarget (git clone adapter)
│   ├── conditions/
│   │   ├── condition.interface.ts    # BaseCondition abstract class
│   │   ├── registry.ts              # Condition registry & resolver
│   │   ├── baseline.ts              # No coordination
│   │   ├── claude-md-only.ts        # CLAUDE.md only
│   │   ├── shared-markdown.ts       # Shared COORDINATION.md
│   │   ├── file-reload-generic.ts   # /clear + CONTEXT.md
│   │   ├── file-reload-structured.ts # GSD/BMAD-style framework
│   │   └── full-twining.ts          # Full Twining MCP
│   ├── scenarios/
│   │   ├── scenario.interface.ts    # BaseScenario abstract class
│   │   ├── registry.ts             # Scenario registry & resolver
│   │   ├── refactoring-handoff.ts  # Phase 0 scenario (2 agents)
│   │   ├── architecture-cascade.ts # 3-agent decision propagation
│   │   ├── bug-investigation.ts    # Planted bug handoff
│   │   ├── multi-session-build.ts  # 5-session feature build
│   │   └── scale-stress-test.ts    # Parameterised stress test
│   ├── analyzer/
│   │   ├── statistics.ts           # Statistical aggregation (simple-statistics)
│   │   ├── code-analysis.ts        # Git churn, AST analysis (ts-morph)
│   │   ├── llm-judge.ts            # LLM-as-judge evaluation
│   │   └── composite-scorer.ts     # Weighted composite scoring
│   ├── results/
│   │   ├── store.ts                # Filesystem results CRUD
│   │   ├── index-manager.ts        # Run registry management
│   │   └── exporter.ts             # Markdown & CSV export
│   ├── cli/
│   │   ├── index.ts                # Commander.js CLI entry point
│   │   ├── commands/               # run, scenarios, conditions, results, export, dashboard, init, clean
│   │   └── utils/
│   │       ├── logger.ts           # Structured logger
│   │       └── progress.ts         # Progress display
│   └── types/                      # All TypeScript interfaces
├── tests/
│   ├── unit/                        # 32 test files
│   └── integration/                 # 2 integration test files
├── benchmark-results/              # Default output directory
├── twining-bench.config.ts         # Default configuration
├── tsconfig.json
├── vitest.config.ts
└── PRD.md                          # Full product requirements
```

## Output Structure

### CLI Runs (`twining-bench run`)

```
benchmark-results/
└── <run-id>/
    ├── metadata.json                 # Run configuration, status, timing
    ├── scores/                       # Scored results per iteration
    │   └── <scenario>_<condition>_<iteration>.json
    ├── raw/                          # Agent session transcripts
    │   └── <session-id>.json
    └── artifacts/                    # Coordination artifact snapshots
```

### Phase 0 Runs (standalone)

```
benchmark-results/phase0/
├── phase0-results.json               # All run results (incrementally saved)
├── phase0-report.md                  # Analysis report (after running analyze)
├── phase0-analysis.json              # Machine-readable analysis data
└── <run-id>/
    └── sessions/
        └── <session-id>/
            ├── transcript.json       # Full agent transcript
            ├── git-diff.patch        # File changes as unified diff
            └── coordination-artifacts.json  # Pre/post coordination state
```

## Configuration

`twining-bench.config.ts` at the project root:

```typescript
const config: BenchmarkConfig = {
  targetPath: './targets/synthetic',     // Default test target
  defaultRuns: 3,                        // Runs per scenario/condition pair
  agentTimeoutMs: 15 * 60 * 1000,       // 15 min per agent session
  tokenBudgetPerRun: 500_000,           // Token budget per run
  budgetDollars: 100,                    // Hard cost ceiling
  outputDirectory: './benchmark-results',
  maxTurns: 50,                          // Max agent turns per session
  retryCount: 0,                         // Retries on failure
  dashboardPort: 3838,                   // Web dashboard port
  evaluatorModel: 'claude-sonnet-4-5-20250929',  // LLM-as-judge model
};
```

CLI flags override config file values. Environment variables:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Required. API key for Claude agent sessions and LLM-as-judge evaluation. |

## Extending the Harness

### Adding a Condition

Implement `BaseCondition` and register in `src/conditions/registry.ts`:

```typescript
import { BaseCondition } from './condition.interface.js';

export class MyCondition extends BaseCondition {
  readonly name = 'my-condition' as ConditionName;
  readonly description = 'Description of coordination strategy';

  protected async doSetup(workingDir: string): Promise<string[]> {
    // Create coordination files, start services, etc.
    return ['files-created.md'];
  }

  protected buildAgentConfig(): AgentConfiguration {
    return {
      systemPrompt: 'Instructions for agents under this condition',
      allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
      mcpServers: {},
      permissionMode: 'bypassPermissions',
    };
  }

  protected async doTeardown(): Promise<void> {
    // Clean up resources
  }
}
```

### Adding a Scenario

Extend `BaseScenario` and register in `src/scenarios/registry.ts`:

```typescript
import { BaseScenario } from './scenario.interface.js';

export class MyScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'my-scenario',
      description: 'What this scenario tests',
      estimatedDurationMinutes: 30,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 2,
      scoringDimensions: ['dimension-a', 'dimension-b'],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: 'Agent 1 task at {{repo_path}}...',
        role: 'agent-1-role',
        sequenceOrder: 0,
        maxTurns: 50,
      },
      // ...
    ];
  }

  protected async doScore(rawResults, groundTruth): Promise<ScoredResults> {
    // Score the agent outputs against ground truth
  }
}
```

### Adding a Target

Implement `ITestTarget` from `src/targets/target.interface.ts`:

```typescript
export interface ITestTarget {
  readonly name: string;
  setup(): Promise<WorkingDirectory>;
  validate(): Promise<ValidationResult>;
  getGroundTruth(): ArchitecturalManifest;
  reset(): Promise<void>;
  teardown(): Promise<void>;
}
```

## Technical Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Language | TypeScript (strict) | Type safety, consistency with Twining |
| Agent Orchestration | `@anthropic-ai/claude-agent-sdk` | Programmatic Claude sessions with MCP injection |
| CLI | Commander.js | CLI framework |
| Statistics | simple-statistics | Mean, median, stddev, Mann-Whitney U, t-tests |
| AST Analysis | ts-morph | Pattern detection in TypeScript code |
| Git Operations | simple-git | Diffs, churn analysis, repo management |
| Process Management | execa | Child process execution (test runners, builds) |
| Testing | Vitest | 466 tests across 34 files |
| Dashboard (planned) | React + Vite + Recharts | Web-based results visualization |

## Development

```bash
npm test              # Run all 466 tests
npm run test:watch    # Watch mode
npm run lint          # Type-check
npm run build         # Compile to dist/
```

### Verifying Everything Works

The Phase 2 exit criterion integration test exercises the full pipeline:

```bash
npx vitest run tests/integration/phase2-exit-criterion.test.ts
```

It verifies all 5 scenarios and 6 conditions resolve, CES calculation matches the PRD formula, the KPI template renders correctly, paired statistical tests work, and all target types can be instantiated.

## Roadmap

- **Phase 0**: Concept validation -- **Complete** (9 runs, GREEN go/no-go)
- **Phase 1**: End-to-end CLI execution -- **Complete** (scoring + results store wired, all 6 conditions, budget enforcement)
- **Phase 2**: Scenarios, scoring & KPI reporting -- **Complete** (5 scenarios, CES formula, paired stats, generated/external targets, full Section 9.3 template)
- **Phase 3**: Web dashboard with comparison charts, trend views, and Markdown/CSV export

## License

MIT
