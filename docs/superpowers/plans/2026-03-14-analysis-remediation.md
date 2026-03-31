# Analysis Package Remediation Plan

> Fixes all issues found in 4-perspective code review (correctness, tests, architecture, statistics).

## Workstream 1: Shared Constants Module (fixes DRY + tool name mismatch)

**Create `analysis/src/benchmark_analysis/dimensions/_constants.py`**

- Extract PRODUCTIVE_TOOLS (union of all current definitions: Read, Edit, Write, Bash, Glob, Grep, MultiEdit, NotebookEdit, WebFetch, WebSearch, LS)
- Extract Twining tool categories with ONE authoritative classification: ORIENTATION_TOOLS, RECORDING_TOOLS, GRAPH_TOOLS, VERIFICATION_TOOLS, COORDINATION_MGMT_TOOLS, SEARCH_TOOLS, LIFECYCLE_TOOLS, DECISION_MGMT_TOOLS
- Add `normalize_tool_name(name: str) -> str` that strips MCP prefix (`mcp__plugin_twining_twining__`) to enable matching
- Add `is_twining_tool(name: str) -> bool` using substring match
- Add `classify_tool(name: str) -> str` returning category
- Extract COORDINATED_CONDITIONS and UNCOORDINATED_CONDITIONS
- Extract threshold constants: CEILING_MEAN_THRESHOLD=95, CEILING_STD_THRESHOLD=3, FLOOR_THRESHOLD=10, MIN_CORRELATION_N=4, SIGNIFICANT_ALPHA=0.05, TREND_ALPHA=0.10
- Update all dimension modules to import from _constants.py instead of defining locally

## Workstream 2: stats.py Fixes

- **Empty input guards**: bootstrap_ci([]) returns (nan, nan), condition_summary with empty values raises ValueError
- **Hedges' g correction**: Apply small-sample correction factor (1 - 3/(4*(n1+n2-2) - 1)) to Cohen's d. Rename function to `effect_size_d` or add parameter
- **interpret_cohens_d NaN handling**: Return "insufficient data" for NaN/inf input
- **Rename post-hoc power**: Rename to `prospective_power_at_observed_effect` or add docstring caveat that this is NOT post-hoc power
- **Add `interpret_r(r)` function** for correlation interpretation (move from behavior_outcome._interpret_r)
- **Add `cv(values)` utility** for coefficient of variation with abs(mean) denominator
- **Add sample size warnings**: Functions should note when n < 5

## Workstream 3: Markdown Report Key Fixes

- Fix `decomp.get("mechanisms")` → `decomp.get("mechanism_attribution")`
- Fix `m.get("contribution_pct")` → `m.get("lift_contribution")`
- Fix `m.get("evidence")` → construct from `m.get("heavy_user_conditions")`
- Fix `validity.get("cronbach_alpha")` → use `validity.get("internal_consistency")`
- Fix `p.get("correlation")` → `p.get("pearson_r")`
- Fix `reliability.get("icc")` → use `reliability.get("variance_flags")`
- Fix `c.get("median_cost_usd")` → use `c.get("mean_cost_usd")` or remove column
- Remove dead code branch in html.py heatmap (list path never taken)

## Workstream 4: Statistical Methodology Fixes

- **behavior_outcome.py**: Fix pseudo-replication by aggregating outcomes to cell means (not repeating behavior means). Use Spearman instead of Pearson. Apply Holm-Bonferroni across all correlations. Rename "predictive_behaviors" to "correlated_behaviors"
- **construct_validity.py**: Fix method agreement by pairing by ScoredResult (same scenario+condition+iteration). Apply Holm-Bonferroni to dimension correlations
- **effect_decomposition.py**: Rename "lift_contribution" to "associated_difference". Add caveats about confounding. Label analysis as "descriptive/exploratory"
- **conditions.py**: Fix CI to be CI of the delta (bootstrap the difference), not CI of condition A mean
- **coordination_lift.py**: Use consistent test (same as conditions.py). Fix best_lift initialization to -inf
- **learning_curve.py**: Add minimum n=4 check before linregress. Fix _compute_trend for duplicate x-values
- **interactions.py**: Fix best/worst lift initialization to -inf/+inf
- **cost.py**: Return None for marginal_cost when delta_points near zero instead of clamping
- **reliability.py**: Use harmonic mean of group sizes for power analysis

## Workstream 5: Test Improvements

- Add empty-input edge case tests for all analyzers
- Add direct tests for untested stats.py functions: interpret_cohens_d, welch_t_test, power_analysis, required_sample_size
- Strengthen weak assertions in test_coordination_lift, test_behavior_outcome, test_cost, test_learning_curve
- Fix conftest.py: auto-increment sessionId, compute totalTokens from components, vary costs across conditions
- Fix test_temporal.py to use real BenchmarkRun or at least match its interface
- Add test for bootstrap_ci with single element and empty list

## Workstream 6: Minor Cleanups

- Remove dead code: unused top-level `from dataclasses import asdict` in cli.py
- Remove dead functions load_transcripts() and load_coordination_artifacts() from loader.py (or document as public API)
- Standardize imports to relative throughout dimensions/
- Move numpy import to module level in conditions.py, cost.py
- Fix harness_summary headline when baseline ranks #1
