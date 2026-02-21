# Phase 0: Concept Validation

Phase 0 validates that the benchmark methodology produces meaningful, differentiable results before building the full harness. It answers: **"Do coordination conditions actually produce measurably different outcomes, or is LLM variance too noisy to detect a signal?"**

## Prerequisites

1. **Node.js 20+** installed
2. **Anthropic API key** set in environment:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Dependencies installed:
   ```bash
   npm install
   ```

## Running Phase 0

### Full run (all 3 conditions, 3 runs each = 9 total runs)

```bash
npm run phase0:run -- --scenario refactor --condition all --runs 3
```

Estimated time: 1-3 hours unattended.
Estimated cost: $5-30 depending on token usage.

### Single condition (for testing/iteration)

```bash
npm run phase0:run -- --scenario refactor --condition baseline --runs 1
```

### Verbose output

```bash
npm run phase0:run -- --scenario refactor --condition all --runs 3 --verbose
```

### Custom output directory

```bash
npm run phase0:run -- --scenario refactor --condition all --runs 3 --output ./my-results
```

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--scenario` | `refactor` | Scenario to run (only `refactor` supported in Phase 0) |
| `--condition` | `all` | Condition(s): `baseline`, `claude-md-only`, `full-twining`, or `all` |
| `--runs` | `3` | Number of runs per condition |
| `--output` | `benchmark-results/phase0` | Output directory |
| `--verbose` | `false` | Enable debug-level logging |

## Analyzing Results

After runs complete:

```bash
npm run phase0:analyze
```

Or with a custom input directory:

```bash
npm run phase0:analyze -- --input ./my-results
```

This produces:

- **`phase0-report.md`** — Full markdown report with comparison tables, effect sizes, cost projections, and go/no-go recommendation
- **`phase0-analysis.json`** — Structured analysis data for programmatic consumption

## What's Tested

### Scenario: Refactoring Handoff (FR-SCN-001)

1. **Agent A** extracts an `IUserRepository` interface and implements the repository pattern
2. **Agent B** adds a caching layer that should respect Agent A's architectural decisions

### Conditions

| Condition | Description |
|-----------|-------------|
| `baseline` | No coordination. Agents have only the codebase. |
| `claude-md-only` | CLAUDE.md with project conventions. No shared runtime state. |
| `full-twining` | Full Twining MCP server with blackboard, decisions, knowledge graph. |

### Metrics Scored

| Dimension | What it measures |
|-----------|-----------------|
| **Consistency** | Does Agent B's code align with Agent A's architectural choices? |
| **Rework** | Inverse of code churn — did B preserve A's work? |
| **Completion** | Did both agents complete their tasks? |
| **Composite** | Weighted average: 40% consistency + 30% rework + 30% completion |

### Statistical Analysis

- Cohen's d effect sizes between each condition pair
- Mann-Whitney U test for significance (p-values)
- 95% confidence intervals
- High-variance flagging (stddev > 20% of mean)
- Cost projection for full Phase 1+ suite

## Output Structure

```
benchmark-results/phase0/
  phase0-results.json       # Raw results from all runs
  phase0-report.md          # Markdown analysis report
  phase0-analysis.json      # Structured analysis data
  <run-id>/                 # Per-run data
    sessions/
      <session-id>/
        transcript.json     # Full agent transcript
        git-diff.patch      # Git changes
        coordination-artifacts.json
```

## Interpreting the Report

### Go/No-Go Signal

| Signal | Meaning | Action |
|--------|---------|--------|
| **GREEN** | Detectable signal found (effect size > 0.5, p < 0.10) | Proceed to Phase 1 |
| **YELLOW** | Marginal signal or high variance | Increase runs, adjust scenario, re-run |
| **RED** | No signal despite adequate runs | Reassess methodology or Twining's approach |

### Effect Size Interpretation (Cohen's d)

| |d| | Interpretation |
|-----|----------------|
| < 0.2 | Negligible |
| 0.2 - 0.5 | Small |
| 0.5 - 0.8 | Medium |
| > 0.8 | Large |

## Troubleshooting

### "No result received from SDK"
The agent session may have failed to start. Check that `ANTHROPIC_API_KEY` is set and valid.

### Timeout errors
Default timeout is 15 minutes per agent session. If agents consistently time out, the scenario may be too complex for the current model, or the target repo may have dependency issues.

### High variance across runs
LLM non-determinism is expected. If variance is too high (flagged in the report), increase the run count to 5-7 per condition.

### Cost exceeded expectations
Token usage depends on model behavior. Use `--runs 1` for a single-condition test run first to calibrate expectations.
