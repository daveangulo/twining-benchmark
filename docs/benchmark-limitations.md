# Benchmark Limitations

The following limitations should be considered when interpreting benchmark results.

## Scoring Methodology

- **Hand-designed CES weights** — The Coordination Effectiveness Score uses weights (consistency 0.25, integration 0.30, redundancy 0.20, coherence 0.15, overhead 0.10) that encode assumptions rather than empirical validation. Primary metrics (test pass rate, cost, time to completion) should be consulted alongside CES.
- **Provisional overhead penalty** — The smooth linear formula (`ratio x 100`) has not been calibrated from empirical data. It may over- or under-penalize coordination overhead.
- **Dual-rubric scoring is new** — The standalone quality rubrics have not been validated against human judgments. Coordination lift (CES minus standalone score) is an experimental metric.

## Evaluation Model

- **Same-family judge model** — The LLM-as-judge evaluator (Claude Sonnet 4) shares the same model family as the agents (Claude Sonnet 4). This can introduce model preference bias. Cross-model validation with GPT-4o or Gemini is planned but not yet implemented.
- **Blinded evaluation** — Judge evaluation strips condition identity and coordination artifacts to reduce bias. However, code style and patterns may still correlate with coordination approach, providing indirect signals.
- **No human calibration** — LLM judge scores have not been validated against human expert ratings. Judge-human correlation analysis is planned.

## Experimental Design

- **No factorial ablation** — The full Twining condition bundles multiple mechanisms (shared state, decision tracking, knowledge graph, semantic search). Results show whether the bundle helps but cannot isolate which component drives improvement.
- **Synthetic TypeScript target** — The default test target has clean architecture with discoverable design patterns, which may favor coordination-aware systems. Results on messy, real-world, or non-TypeScript codebases may differ.
- **Small sample sizes** — With 3 runs per scenario/condition pair, statistical power is limited. Bootstrap confidence intervals are planned but not yet implemented.
- **Fixed model version** — Results are specific to the model version used. Agent and coordination effectiveness may vary across model releases.

## Statistical Analysis

- **Multiple comparison correction** — Holm-Bonferroni correction is applied to pairwise p-values, but the independence assumption may not hold (same models, similar prompts, same repo family). Adjusted p-values may still be optimistic.
- **Non-IID runs** — Benchmark runs share model, prompts, and repository structure. They are not truly independent and identically distributed. This may overstate statistical confidence.
- **Effect sizes over p-values** — Cohen's d effect sizes are the primary measure of practical significance. P-values should be interpreted cautiously given the above limitations.

## Scope

- **TypeScript only** — All scenarios use TypeScript. Coordination effectiveness may differ for other languages.
- **Claude agents only** — All agents use Claude via the Agent SDK. Results may not generalize to other agent frameworks or models.
- **Sequential focus** — Most scenarios test sequential agent handoff. Only `concurrent-agents` tests parallel coordination.
