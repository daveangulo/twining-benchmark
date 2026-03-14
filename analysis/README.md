# Benchmark Analysis Package

Standalone Python package that loads benchmark results and produces 16-dimension statistical analysis with Markdown, HTML, and JSON reports. Designed for comparing agent coordination harnesses at realistic sample sizes (n=20-35 per condition).

## Install

Requires Python 3.12+.

```bash
cd analysis
uv venv && uv pip install -e .

# Or with pip
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

## Usage

```bash
# Full analysis of a benchmark run
python -m benchmark_analysis analyze ../benchmark-results/<run-id>

# Specify output format (json, markdown, html, or all)
python -m benchmark_analysis analyze ../benchmark-results/<run-id> --format markdown

# Custom output directory
python -m benchmark_analysis analyze ../benchmark-results/<run-id> --output ./my-reports

# Compare two runs (detect regressions/improvements)
python -m benchmark_analysis compare ../benchmark-results/<run-id-1> ../benchmark-results/<run-id-2>
```

Output is written to `<run-dir>/analysis/` by default: `analysis.json`, `analysis.md`, and `analysis.html` (with interactive plotly charts).

## What It Produces

The terminal output looks like this:

```
>>> file-reload-structured ranks #1 with 73.2 composite (lift not statistically significant)

=== HARNESS COMPARISON MATRIX ===
  Condition                    Rank   Mean   Lift  Sig      d    Cost
  file-reload-structured          1   73.2   +9.0        +0.42 $  1.72
  twining-lite                    2   72.7   +8.5        +0.40 $  1.66
  baseline                        5   64.2   +0.0          N/A $  1.15

=== STATISTICAL DESIGN ===
  3 iterations/pair, 4 scenarios -> n=12/condition, MDES=d>=1.20
  At 5 iterations/pair: n=20/condition, MDES=d>=0.91

=== KEY EFFECT SIZES (vs baseline) ===
  file-reload-structured         d=+0.42 (small) [below MDES]
  twining-lite                   d=+0.40 (small) [below MDES]

=== RECOMMENDATIONS ===
  [medium] At 3 iterations/pair, only large effects (d>=1.2) are detectable...
```

## Analyses Performed (16 Dimensions)

### Core Comparisons

**Scoring** (`scoring.py`) -- Per-scenario composite distributions, per-dimension score breakdowns, overall condition rankings. Entry point for "which harness performs best?"

**Conditions** (`conditions.py`) -- All pairwise condition comparisons with Hedges' g effect sizes, Holm-Bonferroni corrected p-values, ROPE analysis (practical equivalence testing), and bootstrap 95% CIs of the mean difference.

**Coordination Lift** (`coordination_lift.py`) -- The core metric: measures the delta between coordinated and uncoordinated conditions. Reports lift in absolute points, as percentage, and per-scenario/per-dimension breakdowns. Classifies conditions as coordinated vs uncoordinated.

### Explanatory Analysis

**Behavior-Outcome Correlations** (`behavior_outcome.py`) -- Which specific agent behaviors predict better scores? Computes Spearman rank correlations between coordination behaviors (orientation calls, recording calls, graph building, etc.) and outcomes (composite score, cost). Applies Holm-Bonferroni correction across all tests. Identifies correlated and uncorrelated behaviors.

**Effect Decomposition** (`effect_decomposition.py`) -- Attributes score differences to specific coordination mechanisms: orientation (assemble/query), recording (decide/post), graph building (add_entity/add_relation), verification. Compares twining-lite vs full-twining tool utilization. Identifies tools that are never called. Results are labeled as descriptive/exploratory (not causal) due to confounding across mechanisms.

**Scenario x Condition Interactions** (`interactions.py`) -- Builds the full scenario x condition heatmap. Detects disordinal interactions (condition A beats B in one scenario but loses in another). Identifies best/worst scenarios for coordination. Ranks scenario difficulty by baseline performance.

### Session-Level Analysis

**Learning Curve** (`learning_curve.py`) -- Tracks performance trends across session order within multi-session scenarios. Does coordination become more or less valuable in later sessions? Computes cost, turns, and coordination overhead trends. Analyzes compaction events and their impact. Requires n>=4 sessions for trend computation.

**Sessions** (`sessions.py`) -- Per-session deep dive: tool call breakdowns, cost, duration, exit reasons. Identifies bottleneck sessions (highest cost relative to peers). Tracks compaction events.

**Coordination Behavior** (`coordination.py`) -- Tool call classification (productive vs coordination), engagement rates per condition, graph-building overhead ratios. Loads coordination artifacts (pre/post Twining state) to measure state growth per session.

### Cost & Efficiency

**Cost** (`cost.py`) -- Cost per composite point for each condition. Marginal cost per point gained vs baseline (returns None when delta is too small to be meaningful). Token efficiency and cache hit ratios.

### Benchmark Validity

**Reliability** (`reliability.py`) -- Variance flags for high-CV cells. Power analysis with Minimum Detectable Effect Size (MDES) at current sample size. Design guidance: what effects are detectable at your n, and what you'd gain from more iterations. Uses harmonic mean of group sizes for unbalanced comparisons.

**Construct Validity** (`construct_validity.py`) -- Dimension intercorrelations (are dimensions measuring distinct things?). Internal consistency (test-retest reliability via CV within scenario x condition pairs). Method agreement between automated and LLM-judge scores (paired by ScoredResult). Composite validity (do individual dimensions correlate with composite as expected?).

**Scorer Diagnostics** (`scorer_diagnostics.py`) -- Detects broken scorers: ceiling effects (mean > 95, std < 3), floor effects (mean < 10), zero-variance dimensions, non-discriminating dimensions (spread < 5 across conditions), bimodal distributions.

**Scenarios** (`scenarios.py`) -- Scenario discrimination analysis: which scenarios best separate conditions? Ceiling/floor effect detection per scenario x condition. Per-scenario effect sizes.

### Synthesis

**Harness Summary** (`harness_summary.py`) -- The one table a researcher reads first: one row per harness (condition), columns for rank, mean composite, lift vs baseline, significance, effect size, cost, and best/worst scenario. Generates a one-sentence headline.

**Recommendations** (`recommendations.py`) -- Prioritized improvement suggestions synthesized from all other dimensions. Rules include: low coordination engagement, graph overhead, full-twining underperforming lite, ceiling effects, MDES-based design guidance, interaction warnings, scorer problems, escalating session costs.

**Temporal** (`temporal.py`) -- Cross-run comparison: detects regressions and improvements between two benchmark runs. Reports per-condition score changes and flags significant deltas.

## Statistical Methods

The package is calibrated for realistic benchmark scale (n=20-35 per condition, pooled across 7 scenarios at 5 iterations each).

| Method | Where Used | Notes |
|--------|-----------|-------|
| Hedges' g | All effect sizes | Bias-corrected Cohen's d; prevents ~19% overestimate at small n |
| ROPE | Conditions | Region of Practical Equivalence (default +/-5 pts); primary decision framework |
| MDES | Reliability | Minimum Detectable Effect Size at current n; replaces "need N runs" |
| Mann-Whitney U | Conditions | Non-parametric significance; coarse p-value resolution at n<10 |
| Holm-Bonferroni | Conditions, correlations | Family-wise error rate correction for multiple comparisons |
| Spearman r | Behavior-outcome | Rank correlation; robust to non-normal count data |
| Bootstrap CI | Conditions, lift | 10k resamples, fixed seed; CI of mean difference (not single group) |
| Welch's t | Coordination lift | Parametric; normality assumption untestable at small n |
| Linear regression | Learning curve | Session-order trends; requires n>=4 data points |
| Permutation-safe | All | Functions return graceful results (NaN, None, empty) for insufficient data |

**Key design principle**: Effect sizes and ROPE are the primary outputs. P-values are reported but not the basis for recommendations. At typical benchmark sample sizes, most comparisons are underpowered for traditional significance testing but effect sizes remain interpretable.

## Running Tests

```bash
cd analysis
python -m pytest tests/ -v          # 216 tests
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
      coordination-artifacts.json    # Pre/post Twining state diffs
```

## Architecture

```
src/benchmark_analysis/
  __init__.py, __main__.py
  models.py          # 16 Pydantic models matching benchmark JSON schemas
  loader.py          # Load runs into BenchmarkRun (scores + transcripts + artifacts)
  stats.py           # Core statistics (Hedges' g, bootstrap CI, ROPE, MDES, power)
  cli.py             # CLI entry point (analyze, compare)
  dimensions/
    _constants.py    # Shared tool categories, condition sets, thresholds
    (16 analyzer modules — each a pure function: data in, dict out)
  reports/
    json_report.py   # Structured JSON
    markdown.py      # Markdown tables and sections
    html.py          # Interactive HTML with plotly charts
```
