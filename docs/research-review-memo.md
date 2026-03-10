# Twining Benchmark Harness — Research Review Memo

**Prepared for:** Twining Benchmark Maintainers
**Perspective:** Senior Researcher in Generative AI Systems
**Date:** 2026-03-09

---

## Executive Summary

The Twining Benchmark Harness is a serious and thoughtfully engineered benchmark infrastructure for evaluating multi-agent coordination strategies. It is currently stronger as a product evaluation harness than as a research-grade benchmark. Several methodological issues should be addressed before the benchmark can support strong scientific claims.

## Major Strengths

- **Right research question** — compares coordination mechanisms, not models
- **Multi-condition comparison** — avoids strawman baselines with 8 plausible alternatives
- **Multiple scenarios** — improves external validity
- **Strong instrumentation** — token, cost, timing, git churn, transcripts, coordination artifacts
- **Reproducible target generation** — deterministic seeded repo generator with ground truth manifest

## Major Issues to Address

### 1. Coordination Mechanisms Are Bundled
Full Twining bundles shared state, decision tracking, knowledge graph, semantic search, and MCP tools. If it outperforms, the benchmark cannot identify which component caused the improvement. Needs factorial ablation experiments.

### 2. CES Is Hand-Designed
Weights are arbitrary (not empirically validated). Composite metrics hide cost/quality tradeoffs. Should treat CES as secondary; surface primary metrics (test pass rate, cost, time, bug rate) prominently.

### 3. LLM-as-Judge Risks
- **Artifact leakage** — judge sees coordination artifacts, may reward documentation quality over engineering quality
- **Prompt bias** — rubrics embed coordination-favorable assumptions
- **Same-family judge** — model preference bias when judge and agents share model family
Needs blinded evaluation, artifact-blind scoring, cross-model judges, human calibration.

### 4. Statistical Limitations
- Independence assumption (runs not truly IID)
- No multiple comparison correction
- Effect sizes computed but not emphasized over p-values
Needs bootstrap CIs, paired design, Bonferroni/Holm correction.

### 5. Benchmark Validity
Synthetic repo has clean architecture favoring coordination-aware systems. Needs scenarios where coordination should NOT help, ambiguous specs, incomplete codebases, non-TypeScript targets.

### 6. Reproducibility Metadata
Should capture: agent model version, judge model version, prompt snapshots, tool schemas, harness commit SHA, MCP toolset versions.
