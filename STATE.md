# twining-benchmark-harness — STATE

_Last updated: 2026-04-24 (grounded from `.twining/decisions/index.json` through 2026-04-24, blackboard through 2026-04-10, two pooled analyses, and recent session transcripts)_

This file is the human-and-LLM-readable snapshot of current reality for the benchmark harness. Update when results, methodology, or open questions change materially. The **decision index** (`.twining/decisions/index.json`) is the primary queryable record of methodology and architecture decisions — read it first for any "under what methodology was run X produced?" question. The blackboard (`.twining/blackboard.jsonl`) holds findings, warnings, and session statuses. Analysis artifacts live under `benchmark-results/*/analysis/`.

## TL;DR

- **Decision index is healthy.** 89 decisions tracked, 85 active / 4 superseded / 0 provisional. Last decision recorded 2026-04-24. Explicit supersession chains exist for at least one cross-repo-relevant case (the twining-mcp v1.16.0 `--version` fix that superseded the harness's `npm list` workaround). This is tight dogfooding discipline — stronger than the twining-mcp product's own.
- Condition set was **renamed mid-April** (`twining-lite` → `twining-default`, `full-twining` → `twining-full`). Old names persist as aliases; new benchmarks should use `baseline, shared-markdown, twining-default, twining-full`. **Rename is not yet recorded as an explicit decision in the index** — a gap worth closing.
- Most recent **6-scenario pooled analysis** (2026-04-04, n=5/pair across 6 scenarios, old names): twining-lite #1 at 75.8 (+10.3, d=0.65, p<0.05), full-twining #2 at 74.5 (+9.0, d=0.59, p<0.05), shared-markdown +3.7 (d=0.19, n.s.).
- Most recent **sprint-simulation pooled run** (2026-04-08, n=16/pair, new names): twining-full #1 at 78.7 (+11.5, d=2.12, p<0.05), twining-default #2 at 76.4 (+9.2, d=1.19, n.s.), shared-markdown +4.4 (d=0.54, n.s.).
- Current methodology: Hedges' g correction (01KKPP9B), pseudo-replication fixed, pooled-analysis enabled, CLI stream-json token capture (01KNK5E0/01KNK6MD), plugin-as-deployed-unit via CLI subprocess. Full decision chain in index.
- **Research direction committed 2026-04-24: multi-sprint, multi-release 
  coordination benchmark for sustained software engineering work.** 
  The benchmark's unit of evaluation is the macro loop — codebases 
  accumulating decisions, debt, and architectural constraints across 
  multiple sprints and releases — not single sessions or single 
  sprints. Current 892-session results are directional pilot evidence; 
  the contribution is the evaluation methodology for a category that 
  does not currently exist in the field. Agent Teams is reframed as a 
  tool inside the inner loop (orthogonal axis, not a condition). Phase 
  2 gated on two parallel research subtasks (scorer design, 
  cost/methodology) with 2-week budget. See "Research direction" 
  section below.

## Condition set

Source: `src/conditions/` + `src/conditions/registry.ts`.

| Condition | Purpose | Plugin config | Notes |
| --- | --- | --- | --- |
| `baseline` | No coordination beyond CLAUDE.md | none | Keeps project CLAUDE.md (decision 01KKJRET, 2026-03-13). |
| `shared-markdown` | File-based coordination via COORDINATION.md | none | No MCP. First-tool bias: `Read`. |
| `twining-default` (alias: `twining-lite`) | 5-tool Twining plugin surface | plugin default (no `full_surface`) | System prompt references `twining_record`. |
| `twining-full` (alias: `full-twining`) | Expanded plugin surface | `full_surface: true` in `.twining/config.yml` | System prompt includes `twining_verify`. |

**Methodological commitment (current mechanism as of decisions 01KMRYVW → 01KMWPVY → 01KN21MB → 01KNK5E05, 2026-03-28 through 2026-04-07):** Twining conditions are tested by spawning `claude` CLI as a subprocess per session, configured with `--plugin-dir` pointing at the twining-mcp plugin, `--setting-sources ''` for isolation from user-installed plugins, `--allowedTools` for per-condition tool restriction, and `--output-format stream-json` for per-turn telemetry parsing. This exercises the plugin's hooks, skills, BEHAVIORS.md, and tool surface **as-shipped** — the full surface a real user gets by installing the plugin into Claude Code. The CLI-subprocess path is the only path that can test skills and plugin-shipped config end-to-end; the SDK path (referenced in the earlier decision 01KKAVJDMSXB, 2026-03-10) could not, which is why the runner was migrated late March. Any future ablation that bypasses the CLI-plus-plugin path — e.g., direct API calls without the plugin, or a plugin variant with hooks/skills stripped — breaks this commitment and must be explicitly justified as a methodology departure, not a condition tweak.

## Decision index

Source: `.twining/decisions/index.json` (89 decisions as of 2026-04-24).

**Shape:** 85 active, 4 superseded, 0 provisional. Date range 2026-02-21 to 2026-04-24. Domain breakdown: 57 `implementation`, 17 `architecture`, 5 `data-model`, 4 `testing`, 3 `deployment`, 2 `security`, 1 `api-design`.

**Reading the domain skew.** The heavy weighting toward analysis-layer decisions (scorers, statistical methodology, report generation) relative to running-layer decisions (orchestration, condition setup, session lifecycle) reflects workflow history, not what the codebase actually is. Until recently, agent sessions with the harness focused on *building* the code; actual benchmark runs were executed manually in a separate terminal from commands the agent produced. So the decision index captures architectural choices the agent was involved in — disproportionately the analysis subsystem. As of 2026-04-24 the workflow is shifting: the agent now orchestrates runs directly, which means running-layer decisions (retry policy, parallelism, cost management, scheduling, failure handling) will start landing in the index going forward. The index will become a more representative picture of the harness over time rather than an artifact of how it was built.

**Superseded decisions and their chains:**

| ID | Date | Scope | Summary | Superseded by |
| --- | --- | --- | --- | --- |
| 01KJ5YJY11J0KCS | 2026-02-23 | `src/runner/orchestrator.ts` | Scoring + ResultsStore integration | (later decisions in orchestrator) |
| 01KN0W3E6MMZKJK | 2026-03-31 | `src/scenarios/sprint-simulation/` | Fix 3 broken sprint-sim scorers | 01KNFxxx (2026-04-03 scorer redesigns) |
| 01KN21MNKFN3FAC | 2026-03-31 | `src/scenarios/sprint-simulation/` | Remove process checks from scoreAssumptionHandling | 2026-04-03 graduate-scoreAssumptionHandling decision |
| 01KNFRR0N307V27 | 2026-04-05 | `src/runner/orchestrator.ts` | `npm list` + 3s timeout workaround for hanging `twining-mcp --version` | 2026-04-24 supersession record (twining-mcp v1.16.0 fixed this upstream) |

**Cross-repo dogfooding observation:** The 2026-04-24 supersession of 01KNFRR0N307V27 references "twining-mcp v1.16.0 added proper --version support" — meaning a decision *about the product* is recorded in the harness index because that's where the work was done. The twining-mcp product's own decision index has a gap here. See twining-mcp STATE.md for the broader discussion of this as a Twining-product limitation (single-repo coordination substrate doesn't cleanly handle cross-repo decisions).

**Known decision-recording gaps:**
- **Condition rename** (`twining-lite` → `twining-default`, `full-twining` → `twining-full`, mid-April 2026) is not recorded as a decision in the index, despite being a methodologically significant change that affects reproducibility of pre-rename runs. Worth recording retroactively with the rename rationale.
- **Exploration-efficiency metrics** (Coord ROI, Effectiveness) added 2026-04-08 are recorded as several small implementation decisions but not as one architecture decision defining the new analytical framing. Either approach is defensible; worth deciding which is canonical.

## Scenarios

Source: `src/scenarios/`.

| Scenario | What it measures | Status |
| --- | --- | --- |
| `sprint-simulation` | Multi-session additive feature build (12 sessions) | Stable; most-run scenario |
| `conflict-resolution` | 3 agents with contradictory architectures (EventBus vs CallbackRegistry groups) | Stable; highest between-condition spread (36.4) |
| `context-recovery` | Interrupted handoff (Agent A 3-min timeout, 2026-03-13 fix) | Stable |
| `multi-session-build` | 5 sequential sessions building on each other | Ceiling effect on shared-markdown (mean 96.4, std 2.5) |
| `evolving-requirements` | Mid-stream requirement changes (4 sessions) | High variance on baseline/shared-markdown/twining-lite (CV 38–53%) |
| `architecture-cascade` | A decides pattern, B/C must follow (pattern-group scoring + decisionDiscovery metric) | Stable; small spread (7.5) |

All 6 scenarios are included in the `pooled-all-valid` analysis. The April-8 pooled-3-runs analysis is sprint-simulation only — **do not cite it as a cross-scenario result.**

## Current headline results

### 6-scenario pooled (2026-04-04, `pooled-all-valid`)

n=5/pair × 6 scenarios = n=39 per condition after pooling. Power sufficient only for twining-lite comparison at current n.

| Rank | Condition (old name) | Mean | Lift | d | Sig | Cost | $/pt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | twining-lite | 75.8 | +10.3 | +0.65 | ✓ | $5.52 | $0.073 |
| 2 | full-twining | 74.5 | +9.0 | +0.59 | ✓ | $4.48 | $0.060 |
| 3 | shared-markdown | 69.1 | +3.7 | +0.19 | — | $4.89 | $0.071 |
| 4 | baseline | 65.5 | 0.0 | — | — | $5.38 | $0.082 |

**Per-scenario winners** (spread is max-min condition mean):

| Scenario | Spread | Winner | Loser (with score) |
| --- | --- | --- | --- |
| conflict-resolution | 36.4 | twining-lite (82.2) | shared-markdown (45.8) |
| evolving-requirements | 18.9 | full-twining (72.7) | baseline (53.7) |
| context-recovery | 12.2 | full-twining (66.5) | shared-markdown (54.3) |
| multi-session-build | 11.4 | shared-markdown (96.4, ceiling) | full-twining (85.0) |
| sprint-simulation | 10.9 | twining-lite (81.4) | baseline (70.5) |
| architecture-cascade | 7.5 | twining-lite (65.6) | full-twining (58.1) |

**Disordinal interactions across all 5 condition pairs** — no universal winner across scenarios.

### Sprint-simulation pooled-3-runs (2026-04-08)

n=16/pair on sprint-simulation only, with new condition names.

| Rank | Condition (new name) | Mean | Lift | d | Sig |
| --- | --- | --- | --- | --- | --- |
| 1 | twining-full | 78.7 | +11.5 | +2.12 | ✓ |
| 2 | twining-default | 76.4 | +9.2 | +1.19 | — |
| 3 | shared-markdown | 71.6 | +4.4 | +0.54 | — |
| 4 | baseline | 67.2 | 0.0 | — | — |

_Note on power-analysis labeling: the report lists "N per condition: 5 (pooled across scenarios)" which is inconsistent with the header's "Runs per pair: 16". Reconcile before external citation — likely a report-generator bug since only one scenario is present._

## Key findings (with current evidence status)

1. **Twining produces real lift over baseline.** twining-default/lite: d=0.65, p<0.05 at n=39. twining-full/full-twining: d=0.59–2.12 depending on scope. **Status: established.**
2. **Shared-markdown does not produce detectable lift.** d=0.19 (6-scenario), d=0.54 (sprint-sim only). Inconclusive at current n; cannot claim "no effect" but cannot claim "positive effect" either. **Status: weak null, needs more n to convert to a real null.**
3. **Shared-markdown actively hurts in conflict-heavy and recovery scenarios.** Scores 45.8 (vs baseline 52.8) in conflict-resolution and 54.3 (vs 59.9) in context-recovery — both called out as high-severity recommendations by the analyzer. **Status: suggestive, but conflict-resolution baseline itself has CV 49% and shared-markdown CV 73% — high-variance cells. Needs n per cell to confirm.**
4. **No universal winner across scenarios.** All 5 condition pairs show disordinal interactions (ranking reversals). **Status: established.**
5. **Agents use a narrow tool subset regardless of surface size.** Of the full-twining surface (~29 tools including plugin-adjacent), only `assemble`, `record`/`decide`/`post`, `verify`, `why` see meaningful use. ~18 tools are never called in the 6-scenario run; ~30 never called in sprint-only. **Status: established at usage level. Effect on score is confounded — twining-full beats twining-default on sprint-sim (d=2.12 vs 1.19), so "more surface = no benefit" is NOT supported by current data.** Earlier claim that lite matches full is **not current**.
6. **Exploration efficiency is where coordination ROI varies most.** On sprint-simulation: twining-full 44.0× coord ROI (1,208 coord bytes → 53,181 exploration savings), twining-default 14.2×, shared-markdown 3.7×. **Status: novel, single-scenario, worth replicating across the full 6-scenario matrix.**
7. **GraphAutoPopulator / transparent coordination.** Tool-call data confirms agents never call explicit graph tools (`add_entity`, `graph_query`, `neighbors` — all 0–2 total calls) yet the graph is populated via `decide`/`record`/`post`/`link_commit` side effects. **Status: design contribution, confirmed by behavior logs, separate from the outcome claims above.**

## Open research questions

- **Does the conflict-recovery shared-markdown penalty survive n=20+ per cell?** Current CV in those cells (49% / 73%) is high enough that the effect could shrink. Running more iterations on conflict-resolution and context-recovery specifically (not the full matrix) is the cheapest way to convert this from "suggestive" to "established."
- **Phase 1 status (being answered 2026-04-24 through ~2026-05-01):** 
  Does the exploration-efficiency ROI pattern (44× / 14× / 3.7× on 
  sprint-sim) generalize across the full 6-scenario matrix as a 
  context-reconstitution-cost proxy? Replication criteria locked in 
  Research direction section.
- **Why do baseline and shared-markdown have such high CV in conflict-resolution and evolving-requirements?** Scorer noise, scenario ambiguity, or real agent variance? Tracing this matters for any publishable effect size.

## Research direction (committed 2026-04-24)

**Scope claim.** Multi-sprint, multi-release coordination benchmark for 
sustained software engineering work. The unit of evaluation is the 
macro loop: what persists and compounds across sprints and releases on 
a codebase that accumulates real debt and real constraints. Agent 
Teams and similar intra-loop parallelism tools are *inside* the inner 
loop; substrate choice (none / shared-markdown / Twining / future 
alternatives) governs the macro loop.

**Why this scope.** No existing benchmark measures this. LongMemEval 
and LoCoMo measure long-conversation retrieval. τ-bench and 
CooperBench measure tool-use and task completion. REP measures 
non-coding coordination. Memory-framework comparisons (Mem0, Zep, 
Letta, OMEGA) report retrieval scores on conversational data, not 
task outcomes on sustained codebases. The vectorize.io review of the 
space names the gap directly: "Does accumulated memory actually 
improve task outcomes? [...] Until benchmarks catch up, treat 
published scores as necessary-but-not-sufficient."

**Why not the alternatives:**
- *Exploration-efficiency ROI as primary wedge* (earlier finding #6): 
  demoted to Phase 1 supporting result. It's a useful proxy for 
  context reconstitution cost, which is one dimension of the macro-
  loop scorecard, not the whole scorecard.
- *Shared-markdown-hurts-in-conflict/recovery* (earlier finding #3): 
  absorbed as one finding inside a broader scorecard.
- *Minimal coordination budget / lite-matches-full* (earlier finding 
  #5): weakened by current sprint-sim n=16 data (twining-full d=2.12 
  vs twining-default d=1.19). Not anchored here.
- *Agent Teams as primary condition*: wrong layer. It's intra-loop 
  parallelism, not sprint-over-sprint coordination. Tested later as 
  orthogonal axis in one scenario, not promoted to condition.

**Phase 1 — exploration-efficiency on existing data (1 week).** 
Compute Coord ROI, Effectiveness, coord_bytes, exploration_savings for 
every session in pooled-all-valid (n=5/pair × 6 scenarios × 4 
conditions = 120 sessions). No new runs. Produces pilot-quality 
evidence on one dimension (context reconstitution cost) of what the 
macro-loop scorecard will eventually measure. Replication criteria 
locked before analysis: ratio ordering `twining-full ≥ twining-default 
> shared-markdown` holds on ≥4/6 scenarios AND pooled cross-scenario 
gap between twining-default and shared-markdown ≥2x AND absolute 
exploration_savings ≥10KB in scenarios counted toward replication 
(sprint-sim clears this at 53KB). Scenarios with ratio holding but 
absolute <10KB flagged as "low-absolute regime" and not counted. 
`multi-session-build × shared-markdown` reported separately due to 
ceiling effect (96.4). Phase 1 outputs a pilot finding regardless of 
outcome; becomes a supporting result in whatever paper lands.

**Phase 2 — two research subtasks in parallel (2 weeks total, 
LLM-leveraged).** Each produces a gated deliverable; flagship scenario 
cannot run until both documents are complete.

Subtask 2A — scorer design document. Defines measurement dimensions 
for sustained-codebase work. Starting candidates: regression rate 
(sprint N breaks functionality from sprints 1..N-1), rework ratio 
(fraction of later-sprint work re-implementing or undoing earlier 
work), decision compliance (when prior decision exists, does agent 
honor / re-derive / contradict), context reconstitution cost (tokens 
and time spent rediscovering vs doing new work), architectural 
coherence across sprints. Research step is to validate these and 
surface dimensions not yet on the list. Document specifies 
operational definitions, computation from session artifacts, and 
validation plan (how we know each scorer measures what it claims).

Subtask 2B — methodology document. Defines fixture-branching design, 
statistical treatment of non-independent branched runs (within-
fixture correlation can't be ignored), mixed-rigor claim boundaries 
(one flagship scenario at full rigor + supporting scenarios at 
current rigor), power analysis for the flagship run.

**Known methodology risk — called out for methodology document to 
address.** Fixture-branching assumes end-of-sprint-1 state differs 
meaningfully across conditions. If twining-default and 
shared-markdown produce similar sprint-1 states in practice, 
single-fixture branching collapses and per-condition fixtures become 
necessary. This roughly halves the cost savings from branching and 
changes the stats treatment. Methodology document must (a) quantify 
how different sprint-1 states actually are across existing data as a 
dry run, (b) state the per-condition fixture fallback plan, (c) 
define the decision criterion for which approach to use before 
flagship run starts. If branching is invalidated, Phase 4 (flagship) 
cost estimate increases and may require scope reduction.

**External review during Phase 2 is optional.** Time-to-commitment is 
the binding constraint. If a natural opportunity arises to send 
scorer-design or methodology documents to an external reviewer (e.g., 
Anthropic contact), take it, but do not gate Phase 3 on external 
feedback.

**Phase 3 — scenario design (1–2 weeks, after Phase 2 completes).** 
Design the flagship long-horizon scenario (3 sprints, 3–5 inner-loop 
cycles per sprint, ~500 sessions total per condition at target n) and 
decide which existing scenarios remain as supporting evidence and 
which get deprecated. Likely candidates for flagship: an extension of 
conflict-resolution or architecture-cascade to multi-sprint horizon. 
Sprint-simulation and multi-session-build stay as shorter supporting 
scenarios only if scorer design supports meaningful cross-sprint 
measurement on them.

**Phase 4 — flagship run + supporting runs.** Cost estimate pending 
Phase 2 methodology doc. Current rough estimate: ~500 sessions for 
flagship, ~200 for supporting scenarios at existing rigor. Pinned to 
specific Claude Code version; version pin documented as a decision 
before flagship run starts.

**Named risks:**
1. Scorer design fails to produce dimensions that distinguish 
   conditions on sustained-codebase work. Mitigation: scorer design 
   document must include validation plan, including dry run against 
   existing data to check that candidate scorers distinguish 
   conditions on at least the shorter-horizon data we already have.
2. Fixture-branching collapses (see methodology risk above).
3. Claude Code version drift during multi-week flagship run. 
   Mitigation: version pin, documented as decision, run flagship on 
   dedicated infrastructure with CC version locked.
4. LLM-leveraged research in Phase 2 produces plausible-looking but 
   shallow scorer design. Mitigation: explicit validation-plan 
   requirement in scorer design document; validation dry run on 
   existing data before Phase 3 commits.

**Decision records.** This direction committed via two decisions 
under new `research/direction` scope: one for scope/reframe, one for 
methodology approach. Recorded 2026-04-24.

## Parked / out of scope

- **Ablation on tool surface size (1-tool, 3-tool conditions).** Feasible under current CLI-subprocess methodology via `--allowedTools` restriction (same mechanism that already produces `twining-default`'s 5-tool surface). Not immediately scheduled because (a) current data already shows usage converges to a narrow subset regardless of surface size, so the interesting question has shifted from "does more surface help?" to "does radical restriction hurt exploration efficiency?", and (b) the full 6-scenario rerun at n=16 for existing conditions is the higher-priority use of compute. Worth revisiting after (6).
- **Scenario-taxonomy paper** (which kinds of work benefit from which coordination). Interesting but crowded (τ-bench, CooperBench). Not the sharpest wedge given current data.
- **Agent Teams as primary condition.** Explicitly parked. Tested 
  later as orthogonal intra-loop axis in at most one scenario. 
  Committed 2026-04-24 as part of macro-loop reframe — see Research 
  direction section.

## Methodology version

- Runner: `claude` CLI subprocess per session (migrated from SDK late March 2026, decisions 01KMRYVW/01KMWPVY/01KN21MB). Each session launched with `--plugin-dir`, `--mcp-config`, `--setting-sources ''`, `--allowedTools` (when condition requires restriction), `--output-format stream-json`. CLAUDECODE/CLAUDE_CODE_ENTRYPOINT env vars stripped from subprocess env (01KK80RG, 2026-03-09, originally for SDK path; still applicable to CLI subprocess).
- Statistical: Hedges' g correction, pseudo-replication fixed, CI computation fixed, Holm-Bonferroni multiple comparison correction applied (01KKPP9B, 2026-03-14). Non-parametric Mann-Whitney U for significance, Cohen's d for effect size.
- Telemetry: Per-turn token usage captured by parsing CLI `stream-json` output (input/output/cache_read/cache_creation from assistant-message `usage` blocks, buffered and flushed on turn boundaries per 01KNK6MD). Tool response bytes linked via `tool_use_id`. `result.usage.iterations[]` from CLI is unreliable (always empty in multi-turn sessions per 01KNK5E0JX) — per-turn data must be reconstructed from individual assistant events. Previous bug where `turnUsage` was empty is fixed as of 2026-04-10 (commit 9b10436).
- Scoring: Composite follows PRD §9.2. Blinded judge strips `.twining/`, COORDINATION.md, and `twining_*` tool names from diffs for standalone quality evaluation.
- Infrastructure filtering: `.twining/` and `node_modules/` excluded from code-level file-change metrics via three-pronged fix (gitignore in fixtures, enrichAndSave split, inter-session git checkpoints — decision 01KJ3AR8, 2026-02-22).

## Known issues

- **Broken scorer: `completion` dimension has zero variance (always 93).** Flagged as high-severity by analyzer. Fix or remove before next major run.
- **Scorer sensitivity: `finalQuality` spread only 3.2 points across conditions** on sprint-sim. May need reweighting or replacement.
- **Power-analysis report labeling inconsistency** in pooled-3-runs analysis (N=5 vs runs=16). Report-generator bug, not a data bug.
- **Ceiling effect: multi-session-build × shared-markdown** (mean 96.4, std 2.5). Redesign scenario for more discrimination.
- **High CV (>20%) in 36 scenario × condition cells** across assumptionHandling, decisionConsistency, architecturalDrift, and ~15 other dimensions. Some of this is real agent variance, some is scorer noise; not yet decomposed.
- **Escalating cost across sessions** in 8 scenario × condition pairs (slopes 0.028–0.226). Likely context accumulation; worth investigating for long-horizon scenarios.

## Pointers

- **Decision index (recommended entry point): `.twining/decisions/index.json`** — 89 structured decisions with status tracking. Primary record of methodology and architecture evolution.
- Raw append-only log: `.twining/blackboard.jsonl` (findings, warnings, session statuses; noisier than the decision index)
- Analysis outputs: `benchmark-results/<run-id>/analysis/analysis.md`
- Pooled analyses: `benchmark-results/<parent>/pooled-analysis-N-runs/analysis.md`
- Condition configs: `src/conditions/`
- Scenario configs: `src/scenarios/`
- Composite scorer: `src/analyzer/composite-scorer.ts`
- LLM judge: `src/analyzer/llm-judge.ts`
- CHANGELOG: `CHANGELOG.md`

## Recent material changes (last ~2 weeks)

- **2026-04-10**: Token capture overhaul + analysis pipeline updates + file-based coordination detection for shared-markdown + exploration-efficiency metrics (6 commits, session f1ca48aa).
- **2026-04-09**: `pool_runs()` added to `loader.py`; `analyze` CLI accepts multiple run_dirs for pooled analysis. Default pooled output: `<parent>/pooled-analysis-N-runs/`.
- **2026-04-08**: Bytes-based overhead metrics (coordination_bytes, overhead_bytes_ratio), Coord ROI, Effectiveness metrics added.
- **Mid-April (exact date TBD from session 2287353b)**: Condition rename `twining-lite` → `twining-default`, `full-twining` → `twining-full`. Old names aliased, not removed.
- **2026-04-07**: Most recent benchmark run at scale (892 sessions across the 4 conditions × 6 scenarios × 5 iterations = ~120 iterations, plus partial data).
