# Benchmark Analysis Package

Standalone Python package that loads benchmark results and produces 20-dimension statistical analysis with Markdown, HTML, and JSON reports. Designed for comparing agent coordination strategies at realistic sample sizes.

## Install

Requires Python 3.12+.

```bash
cd analysis
uv venv && uv pip install -e .

# Or with pip
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

## Quick Start

```bash
# Full analysis of a benchmark run
benchmark-analysis analyze ../benchmark-results/<run-id>

# Filter failed sessions (rate-limited, crashed)
benchmark-analysis analyze ../benchmark-results/<run-id> --min-tokens 1000

# Pooled analysis across multiple runs (full 20-dimension report on aggregated data)
benchmark-analysis analyze \
  ../benchmark-results/<id1> ../benchmark-results/<id2> ../benchmark-results/<id3>

# Lightweight cross-run condition comparison (effect sizes only)
benchmark-analysis compare-conditions \
  --runs ../benchmark-results/<id1> ../benchmark-results/<id2> \
  --conditions baseline,shared-markdown,full-twining
```

## Commands

### `analyze` — Single or pooled run analysis

```bash
benchmark-analysis analyze <run-dir> [<run-dir>...] [options]
```

| Option | Description |
|--------|------------|
| `--format` | Output format: `json`, `markdown`, `html`, or `all` (default: `all`) |
| `--output` | Output directory (default: `<run-dir>/analysis/` for single run, `<parent>/pooled-analysis-N-runs/` for multi-run) |
| `--min-tokens` | Exclude sessions with fewer total tokens (filters crashed sessions) |

Produces `analysis.json`, `analysis.md`, and `analysis.html` in the output directory.

**Pooled analysis:** Passing multiple run directories concatenates their scores, transcripts, and session data, then runs the full 20-dimension pipeline on the combined dataset. Synthetic metadata lists the component run IDs in the report header. This is the preferred way to get more statistical power from repeated runs — it runs everything `analyze` does, just with more samples. Use `compare-conditions` instead only when you want a quick effect-size table without the full report.

### `compare` — Two-run comparison

```bash
benchmark-analysis compare <run-dir-1> <run-dir-2> [--format markdown|json]
```

Detects regressions and improvements between two benchmark runs. Reports per-condition score changes.

### `compare-conditions` — Cross-run condition comparison

```bash
benchmark-analysis compare-conditions --runs <dir1> <dir2> [<dir3>...] [options]
```

| Option | Description |
|--------|------------|
| `--runs` | Two or more run directories to pool |
| `--conditions` | Comma-separated condition filter (default: all) |
| `--format` | Output format: `markdown` or `json` |

Pools iterations across multiple runs to increase sample size. Computes per-condition means with per-dimension breakdowns and pairwise Hedges' g effect sizes. Use this when you have data from separate runs that should be combined.

Example: after running sprint-simulation three times with different conditions each time:
```bash
benchmark-analysis compare-conditions \
  --runs benchmark-results/run1 benchmark-results/run2 benchmark-results/run3 \
  --conditions baseline,shared-markdown,full-twining,twining-lite
```

## What It Produces

Terminal output:

```
>>> shared-markdown ranks #1 with 85.4 composite (+11.5 vs baseline, p<0.05)

=== HARNESS COMPARISON MATRIX ===
  Condition                    Rank   Mean   Lift  Sig      d    Cost
  shared-markdown                 1   85.4  +11.5 * +2.57 $ 19.14
  baseline                        2   73.8   +0.0     N/A $ 23.41

=== STATISTICAL DESIGN ===
  3 iterations/pair, 1 scenarios -> n=3/condition, MDES=d≥3.07
```

## Analyses Performed (20 Dimensions)

### Core Comparisons

**Scoring** — Per-scenario composite distributions, per-dimension score breakdowns, overall condition rankings.

**Conditions** — All pairwise condition comparisons with Hedges' g effect sizes, Holm-Bonferroni corrected p-values, ROPE analysis (practical equivalence), and bootstrap 95% CIs.

**Coordination Lift** — Delta between coordinated and uncoordinated conditions. Reports lift in points, percentage, and per-scenario/per-dimension breakdowns.

### Session Health & Behavior (NEW)

**Session Health** — Per-condition diagnostics: completed/timed-out/errored sessions, zero-tool-call sessions (crashes), Twining tool engagement rate, plugin load validation. Flags conditions where plugin likely failed to load.

**Behavioral Profiles** — What does each condition's agent do first? Shows first-tool distribution, first-3-tool patterns by task index, coordination file interaction counts, and efficiency metrics (tools/session, lines/session).

**Work Leverage** — Measures how effectively agents build on prior work. Per-condition rework ratio (lines deleted by next agent / lines added), line survival rate (fraction of work that endures to final state), and continuation index (fraction of code referencing predecessor's symbols). All computed from git diffs.

**Cost Efficiency** — Cost per quality point, cost per iteration, cost per session, lines of code per dollar, tool calls per dollar. The key ROI metric for comparing coordination approaches.

### Explanatory Analysis

**Behavior-Outcome Correlations** — Spearman rank correlations between agent behaviors (orientation calls, recording calls, etc.) and outcomes (composite score, cost). Identifies which behaviors predict better scores.

**Effect Decomposition** — Attributes score differences to specific coordination mechanisms: orientation, recording, graph building, verification. When all mechanisms show identical values (same conditions use all tools), collapses into a summary note. Also renders lite-vs-full comparison (delta, conclusion, tool overlap), per-tool utilization counts, and never-called tools list.

**Interactions** — Scenario × condition heatmap. Detects disordinal interactions (ranking reversals across scenarios).

### Session-Level Analysis

**Learning Curve** — Performance trends across session order within multi-session scenarios. Cost, turns, and coordination overhead trends.

**Sessions** — Per-session deep dive: tool call breakdowns, cost, duration, exit reasons. Identifies bottleneck sessions.

**Coordination Behavior** — Tool call classification (productive vs coordination), engagement rates, graph-building overhead.

### Cost & Efficiency

**Cost** — Cost per composite point. Marginal cost per point gained vs baseline. Token efficiency and cache hit ratios.

**Token Usage Breakdown** — Per-condition input / output / cache-read / cache-creation token means, plus cache-hit %. Session-level totals are billing-correct (extracted from the CLI result message); per-turn values in raw transcripts are per-API-call snapshots that should not be summed.

**Exploration Efficiency** — Decomposes per-condition response bytes into `task_bytes` (productive tool work: file reads, greps, edits) and `coord_bytes` (coordination overhead). Computes exploration savings vs baseline, coord ROI (bytes of exploration eliminated per byte of coordination), and effectiveness (score per 10KB of task work). Coordination detection is apples-to-apples across mechanisms: Twining tool calls AND reads/writes of COORDINATION.md / CONTEXT.md / HANDOFF.md / .twining/ all count as coord_bytes, so file-based conditions like `shared-markdown` pay an honest coordination cost.

### Benchmark Validity

**Reliability** — Variance flags, power analysis with MDES, design guidance for sample size planning.

**Construct Validity** — Dimension intercorrelations, internal consistency, composite validity.

**Scorer Diagnostics** — Detects broken scorers: ceiling/floor effects, zero-variance dimensions, non-discriminating dimensions. Includes discrimination summary showing which dimensions provide signal.

**Scenarios** — Scenario discrimination: which scenarios best separate conditions? Ceiling/floor detection.

### Synthesis

**Harness Summary** — One row per condition: rank, mean, lift vs baseline, significance, effect size, cost. One-sentence headline.

**Recommendations** — Prioritized improvement suggestions synthesized from all dimensions.

## Statistical Methods

| Method | Where Used | Notes |
|--------|-----------|-------|
| Hedges' g | All effect sizes | Bias-corrected Cohen's d; prevents ~19% overestimate at small n |
| ROPE | Conditions | Region of Practical Equivalence (default ±5 pts) |
| MDES | Reliability | Minimum Detectable Effect Size at current n |
| Mann-Whitney U | Conditions | Non-parametric significance |
| Holm-Bonferroni | Conditions, correlations | Family-wise error rate correction |
| Spearman r | Behavior-outcome | Rank correlation; robust to non-normal data |
| Bootstrap CI | Conditions, lift | 10k resamples, fixed seed |

**Key principle**: Effect sizes and ROPE are primary outputs. P-values are reported but not the basis for recommendations.

## User Guide

### Typical Workflow

1. **Run a benchmark**:
   ```bash
   npx tsx src/cli/index.ts run --scenario sprint-simulation \
     --condition baseline,shared-markdown,full-twining --runs 3 --model claude-opus-4-6
   ```

2. **Analyze the run**:
   ```bash
   benchmark-analysis analyze benchmark-results/<run-id> --min-tokens 1000
   ```
   Check the terminal summary first. If the headline says "lift is not statistically significant", check the MDES — you may need more iterations.

3. **Check session health first**:
   Open `analysis.md` and scroll to **Session Health**. Look for:
   - High timeout rates (>10%) — increase `--timeout` or check if tasks are too large
   - Zero Twining engagement for Twining conditions — plugin may not have loaded
   - Zero-tool sessions — agent SDK/API failures

4. **Read the comparison matrix**:
   The harness comparison matrix is the key table. Check:
   - **Lift**: points above baseline (positive = coordination helps)
   - **Sig**: `*` means p<0.05 (but check MDES — underpowered tests may miss real effects)
   - **d**: Cohen's d effect size (small=0.2, medium=0.5, large=0.8)
   - **Cost**: lower is better; check $/pt for ROI

5. **Understand the mechanisms**:
   - **Behavioral Profiles**: "What does each condition do differently?"
   - **Work Leverage**: "Do agents build on each other's work?"
   - **Effect Decomposition**: "Which coordination mechanisms drive the lift?"

6. **Combine runs for more power**:
   ```bash
   benchmark-analysis compare-conditions \
     --runs benchmark-results/<id1> benchmark-results/<id2> \
     --conditions baseline,shared-markdown
   ```
   Pooling across runs increases N per condition, lowering MDES.

### Interpreting Results

**"Lift is not statistically significant"** — Doesn't mean coordination doesn't help. At small N (3 iterations), only very large effects (d≥3.0) are detectable. Look at the effect size and direction instead. Consistent positive lift across multiple runs is more convincing than a single p-value.

**High cost for a Twining condition** — Twining tool calls add tokens. Check the Cost Efficiency section — if $/point is high despite good scores, the overhead may not be justified.

**Zero Twining engagement** — If a Twining condition shows 0% engagement, check Session Health warnings. The plugin may have failed to load (silent failure in SDK mode). Verify by checking if any session's tool calls include `twining_*` tools.

**Rankings reverse across scenarios** — Check the Interactions section. If condition A beats B in one scenario but loses in another, there's no universal winner. The coordination mechanism may only help with certain task types.

**Work leverage is similar across conditions** — If rework ratio and continuation index are the same for baseline and coordination conditions, the coordination mechanism isn't improving how agents build on each other's work — it may only help with specific handoff moments (like requirement changes).

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| All Twining conditions score 0 | Plugin didn't load | Check Session Health warnings; verify `npx twining-mcp` works |
| Timeouts >50% for one condition | Task too large for timeout | Increase scenario timeout or reduce task scope |
| Zero-variance dimension | Scorer bug or too-generous thresholds | Check Scorer Diagnostics; dimension needs redesign |
| MDES is very high (>2.0) | Too few iterations | Run more iterations or pool across runs |
| Identical scores across conditions | Scorer not discriminating | Check if dimension measures outcomes or just process compliance |

## Running Tests

```bash
cd analysis
python -m pytest tests/ -v          # 226 tests
python -m pytest tests/ -x -q       # Quick: stop on first failure
```

## Data Format

The package reads from `benchmark-results/<run-id>/`:

```
<run-id>/
  metadata.json                      # Run config, environment, timing
  scores/
    <scenario>_<condition>_<iter>.json   # Composite + per-dimension scores + metrics
  sessions/
    <session-id>/
      transcript.json                # Full agent transcript (tool calls, tokens, timing)
      coordination-artifacts.json    # Pre/post coordination state diffs
```

## Architecture

```
src/benchmark_analysis/
  __init__.py, __main__.py
  models.py          # Pydantic models matching benchmark JSON schemas
  loader.py          # Load single run or pool_runs() for multi-run aggregates
  stats.py           # Core statistics (Hedges' g, bootstrap CI, ROPE, MDES, power)
  cli.py             # CLI entry point (analyze, compare, compare-conditions)
  dimensions/
    _constants.py    # Shared tool categories, condition sets, thresholds
    session_health.py       # NEW: Session diagnostics and plugin validation
    behavioral_profile.py   # NEW: Per-condition first-action patterns
    work_leverage.py        # NEW: Rework ratio, line survival, continuation
    cost_efficiency.py      # NEW: $/point, lines/$, time/iteration
    (16 existing analyzer modules)
  reports/
    json_report.py   # Structured JSON
    markdown.py      # Markdown tables and sections
    html.py          # Interactive HTML with plotly charts
```
