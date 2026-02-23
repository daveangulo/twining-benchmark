# Twining Benchmark Harness

A CLI-driven benchmark execution engine that quantitatively compares multi-agent coordination strategies. It answers the question: **does [Twining](https://github.com/twining-mcp/twining-mcp) actually help AI agents work together, and by how much?**

The harness runs controlled experiments where multiple Claude agents collaborate on a shared codebase under different coordination conditions (no coordination, CLAUDE.md only, shared markdown, file-based reload, structured frameworks, full Twining MCP), then scores the results using automated analysis and statistical comparison.

## Current Status: Phase 0 (Concept Validation)

Phase 0 validates that the methodology produces meaningful, differentiable results before investing in the full harness. It runs the **refactoring-handoff** scenario under three max-contrast conditions (baseline, CLAUDE.md only, full Twining) and produces a statistical comparison report with go/no-go recommendation.

The full architecture (5 scenarios, 6 conditions, web dashboard) is scaffolded but not yet wired for production use. Phase 0 is the operational entry point.

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

### Run Phase 0

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
5. **Scoring** -- Automated analysis scores consistency, rework, completion, and produces a composite score
6. **Teardown** -- Temp directories and MCP servers are cleaned up

### The Scenario: Refactoring Handoff

The Phase 0 scenario tests a common multi-agent pattern:

- **Agent A** (refactorer): Extracts an `IUserRepository` interface from the UserService, implementing the repository pattern
- **Agent B** (extender): Adds a caching layer to user data access, building on Agent A's architecture

The key question: does Agent B discover and respect Agent A's decisions? Or does it introduce conflicting patterns?

### Scoring Dimensions

| Dimension | What It Measures | Method |
|-----------|-----------------|--------|
| **Consistency** (0-100) | Does Agent B align with Agent A's architectural choices? | Automated pattern detection + heuristics |
| **Rework** (0-100) | How much of Agent A's code did Agent B revert or rewrite? | Git churn analysis (inverse of reverts) |
| **Completion** (0-100) | Did both agents complete their assigned tasks? | Exit status + file change detection |
| **Composite** (0-100) | Weighted aggregate of all dimensions | `0.35 * consistency + 0.25 * rework + 0.40 * completion` |

Additional metrics captured per run: input/output/cache-read/cache-creation token breakdown, SDK-reported cost, wall time, turn count, compaction count, context utilization, lines added/removed, files changed, test pass/fail counts, compilation status.

### The Conditions

Phase 0 tests three conditions. The full harness defines six.

| Condition | Available to Agents | Phase 0 |
|-----------|-------------------|---------|
| `baseline` | Codebase only. No coordination files, no shared state. | Yes |
| `claude-md-only` | Codebase + CLAUDE.md with project conventions and instructions. | Yes |
| `shared-markdown` | CLAUDE.md + shared COORDINATION.md for freeform agent notes. | No |
| `file-reload-generic` | Simulates `/clear` + CONTEXT.md reload. Zero conversation history. | No |
| `file-reload-structured` | GSD/BMAD-style framework: role files, STATE.md, PLAN.md, decisions.md, handoff.md. | No |
| `full-twining` | Full Twining MCP server: blackboard, decisions, knowledge graph, semantic search. | Yes |

### The Test Target: TaskFlow Pro

A 28-file TypeScript project with a 3-layer architecture:

- **Repository layer**: `BaseRepository` -> `UserRepository` / `OrderRepository` -> `Database`
- **Event system**: `EventBus` with typed events, `NotificationService` as listener
- **Two seeded bugs**: Pagination off-by-one (cross-page duplicates), floating-point total calculation
- **Two architectural decisions** agents must discover: repository pattern for data access, event-driven notifications
- 70 passing tests in the fixture project

## Statistical Analysis

The analysis pipeline (`phase0-analyze.ts`) computes:

- **Per-condition summaries**: Mean, median, standard deviation, min/max, 95% confidence interval for every metric
- **Pairwise effect sizes**: Cohen's d between every pair of conditions, with interpretation (small/medium/large)
- **Significance testing**: Mann-Whitney U test (non-parametric, appropriate for small sample sizes) with p-values
- **Variance flagging**: Metrics where standard deviation exceeds 20% of the mean are flagged as high-variance
- **Go/No-Go recommendation**: Automated assessment based on effect size and significance thresholds

### Go/No-Go Criteria

| Signal | Criteria | Action |
|--------|----------|--------|
| **GREEN** | Large effect (d > 0.8) + significant (p < 0.05), or medium effect (d > 0.5) + suggestive (p < 0.10) | Proceed to Phase 1 |
| **YELLOW** | Medium effect but not significant, or insufficient runs, or high variance | Increase runs or adjust scenario difficulty |
| **RED** | No detectable effect (d < 0.5) on any primary KPI | Reassess methodology or Twining's approach |

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
│   │   └── synthetic-repo/
│   │       ├── index.ts              # SyntheticRepoTarget (TaskFlow Pro)
│   │       └── fixtures/             # The pre-built test project files
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
│   │   ├── commands/               # run, scenarios, conditions, results, dashboard, init, clean
│   │   └── utils/
│   │       ├── logger.ts           # Structured logger
│   │       └── progress.ts         # Progress display
│   └── types/                      # All TypeScript interfaces
├── tests/
│   └── unit/                       # 358 tests across 25 files
├── benchmark-results/              # Default output directory
├── twining-bench.config.ts         # Default configuration
├── tsconfig.json
├── vitest.config.ts
└── PRD.md                          # Full product requirements
```

## Output Structure

Each Phase 0 run produces:

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
| Testing | Vitest | 358 unit tests |
| Dashboard (planned) | React + Vite + Recharts | Web-based results visualization |

## Development

```bash
npm test              # Run all 358 tests
npm run test:watch    # Watch mode
npm run lint          # Type-check
npm run build         # Compile to dist/
```

## Roadmap

Phase 0 is complete. Subsequent phases (pending Phase 0 go/no-go result):

- **Phase 1**: Full CLI (`twining-bench run`), all 6 conditions wired for production, agent session management with budget controls
- **Phase 2**: All 5 scenarios scored, LLM-as-judge evaluation framework, full statistical reporting
- **Phase 3**: Web dashboard with comparison charts, trend views, and Markdown/CSV export
- **Phase 4**: Programmatic repo generator, external repo adapter, `--dry-run`, suite resume

## License

MIT
