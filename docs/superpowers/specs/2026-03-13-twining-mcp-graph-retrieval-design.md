# Twining MCP: Graph-Powered Retrieval & Overhead Reduction

**Date:** 2026-03-13
**Project:** twining-mcp (`/Users/dave/Code/twining-mcp`)
**Motivation:** Benchmark run `4005bc41` shows twining-lite outperforms full-twining in 3/4 scenarios. Root causes: graph is manually built but never effectively queried, assemble gives graph only 10% weight, agents spend 28% of coordination calls on post-task graph bookkeeping, and Twining doesn't activate in continuity (non-agentic) framing.

## Problem Summary

1. **Graph-building is manual overhead.** Agents call `add_entity`/`add_relation` 10-12 times at session end. No downstream agent queries the graph directly. The blackboard carries all useful coordination.
2. **Assemble under-uses the graph.** `computeGraphConnectivity` does substring entity matching + 1-hop BFS overlap counting at 10% weight. Similarity search (MiniLM embeddings) at 30% weight dominates retrieval. The graph's typed relations (`decided_by`, `depends_on`, `implements`) are wasted.
3. **Relationship data is available but not extracted.** `twining_decide` already auto-populates `decided_by` relations. But `twining_post`, `twining_handoff`, `twining_link_commit`, `twining_register`, and `twining_reconsider` all contain structured relationship data that is discarded.
4. **Stop hook forces graph ceremony.** The hook blocks session exit until `twining_handoff` is called and decisions are recorded — but it also implicitly encourages the graph-building workflow from BEHAVIORS.md Gate 3.
5. **SessionStart hook triggers on agent framing, not project continuity.** The prompt says "register as an agent" — useless when the user is just resuming prior work.

## Design

### Change 1: Auto-extract relations from all tool calls

Extend the pattern already in `decisions.ts:264-303` (which auto-populates from `decide`) to extract entities and relations from every tool call that carries relationship data.

#### Prerequisite: Expand type unions in `src/utils/types.ts`

The `Entity["type"]` and `Relation["type"]` unions must be expanded to support auto-extracted data:

**Entity type** (add `"agent"` and `"commit"`):
```ts
type: "module" | "function" | "class" | "file" | "concept" | "pattern" | "dependency" | "api_endpoint" | "agent" | "commit"
```

**Relation type** (add 3 new types):
```ts
type: "depends_on" | "implements" | "decided_by" | "affects" | "tested_by" | "calls" | "imports" | "related_to" | "supersedes" | "produces" | "challenged"
```

Design choice: we keep the union closed (not `string`) for type safety. These 3 new relation types are the minimum needed — several candidate types are mapped to existing types instead:
- `found_in` → `affects` (a finding in a scope affects that scope — same structural relationship as `warning_about`)
- `warning_about` → `affects` (a warning affects a scope)
- `reconsidered` / `overrides` → `challenged` with `properties: { action: "reconsider" | "override" }` (both are "agent challenges decision" with different severity — same pattern used for `hands_off_to` below)
- `posted_by` → not created (agent→entry relations are low-value noise; the `agent_id` field on the blackboard entry suffices)
- `hands_off_to` → `related_to` with `properties: { type: "handoff" }`
- `implemented_by` → `decided_by` reversed (commit `decided_by` decision — reuses existing type since the commit is the subject being "decided for")

#### Per-tool extraction

**`twining_decide`** (already partially implemented):
- Current: creates `concept` entity for decision, `file` entities for `affected_files`, `function` entities for `affected_symbols`, all with `decided_by` relations.
- Add: `depends_on` decision IDs → `depends_on` relations between decision concept nodes. `supersedes` → `supersedes` relation. `commit_hash` → `commit` entity with `decided_by` relation (commit decided_by decision).

**`twining_post`**:
- `scope` (when it looks like a file path — contains `/` AND has a file extension like `.ts`/`.js`/`.json`) → `file` entity. Directory-like scopes (ending in `/` with no extension) → `module` entity.
- `relates_to` IDs → look up existing blackboard entries, create `related_to` relations between the new entry's scope entity and the related entries' scope entities
- `entry_type == "warning"` with file-like scope → `affects` relation from warning concept to scope entity
- `entry_type == "finding"` with file-like scope → `affects` relation from finding concept to scope entity (same structural relationship as warnings)

**`twining_handoff`**:
- `source_agent` → `agent` entity
- `target_agent` → `agent` entity
- `source_agent` → `target_agent` via `related_to` relation with `properties: { type: "handoff" }`
- `results[].artifacts` (file paths) → `file` entities with `produces` relation from `source_agent`
- `scope` → scope entity with `affects` relation from handoff

**`twining_link_commit`**:
- `commit_hash` → `commit` entity
- `decision_id` → existing decision concept entity
- Relation: commit `decided_by` decision (reuses existing relation type)

**`twining_register`**:
- `agent_id` → `agent` entity with `capabilities` and `role` as properties
- No relations needed — just entity upsert

**`twining_reconsider`**:
- Relation: agent entity `challenged` decision entity with `properties: { action: "reconsider" }`

**`twining_override`**:
- Relation: agent entity `challenged` decision entity with `properties: { action: "override" }`

#### `tested_by` relation auto-extraction

Currently Gate 3 instructs agents to manually call `twining_add_relation` with type `tested_by`. To replace this, add auto-extraction to `verify.ts`:

When `twining_verify` runs the `test_coverage` check and finds decisions with `affected_files`, scan the graph for test file entities (names matching `*.test.ts`, `*.spec.ts`) that were created by `onPost` or `onDecide`. For each affected file entity that has a corresponding test file entity, auto-create a `tested_by` relation. This keeps test coverage tracking working without manual graph calls.

Add `src/engine/verify.ts` to the Files Changed table.

#### Implementation approach

Create a new `GraphAutoPopulator` class in `src/engine/graph-auto-populator.ts` that:
- Accepts a `GraphEngine` instance via constructor injection
- Exposes methods: `onDecide(input, decisionId)`, `onPost(entry)`, `onHandoff(handoff)`, `onLinkCommit(decisionId, commitHash)`, `onRegister(agentId, capabilities, role)`, `onChallenge(agentId, decisionId, action: "reconsider" | "override")`
- Each method is independently try/catch wrapped — failures are logged but never propagated

The existing auto-population code in `decisions.ts:264-303` moves into `onDecide()`. Each engine file calls the appropriate method after its primary operation succeeds.

**Implementation order:** Change 1 must complete before Change 2, since `computeGraphReachability` depends on the new relation types existing in the graph. Changes 3-5 are independent and can proceed in parallel.

All graph auto-population remains best-effort (wrapped in try/catch, non-fatal errors logged). The graph is an optimization layer, not a correctness requirement.

### Change 2: Graph-powered retrieval in `assemble`

Replace `computeGraphConnectivity` with `computeGraphReachability` in `context-assembler.ts`.

**Current approach** (10% weight):
```
1. Substring-match entities by scope name
2. For each decision's affected_files, find matching entities
3. Count how many 1-hop BFS neighbors overlap with scope entities
4. Log-scale normalize
```

**New approach** (35% weight):
```
1. Find entities matching scope using GraphEngine.query() (existing substring match),
   then filter results to those whose name starts with the scope prefix.
   Do NOT change query() itself — other consumers depend on substring behavior.
2. For each scope entity, do typed BFS traversal (max depth 3):
   - Follow: depends_on, decided_by, implements, affects, produces, challenged
   - Collect all decision concept nodes reachable via these paths
3. Score each reachable decision by:
   - Path length: 1-hop = 1.0, 2-hop = 0.7, 3-hop = 0.4
   - Relation type bonus: decided_by/affects = 1.0, depends_on/implements = 0.8, related_to = 0.5
   - Combined: path_score * relation_bonus (take max across all paths)
4. Normalize to 0.0-1.0
```

**New scoring weights in `config.ts`** (must sum to 1.0 — add validation):
```
recency:              0.20  (was 0.30)
relevance:            0.20  (was 0.30) — embeddings still useful for novel connections
decision_confidence:  0.15  (was 0.20)
warning_boost:        0.10  (unchanged)
graph_connectivity:   0.35  (was 0.10) — renamed to graph_reachability
                      ----
                      1.00
```

Add a startup validation in `config.ts` that asserts `Object.values(weights).reduce((a,b) => a+b) === 1.0` and throws if not. Also add `tools: { mode: "full" as const }` to `DEFAULT_CONFIG` so the new `tools.mode` key is present for `deepMerge` (which only merges keys that exist in the target).

**Adaptive weight fallback for sparse graphs:** When `computeGraphReachability` returns 0 for all candidate decisions (empty or sparse graph), redistribute the `graph_reachability` weight proportionally across the other signals. This prevents the 35% weight from compressing the effective score range for users who haven't built up graph data yet. Implementation: after computing all scores, if `max(graph_scores) === 0`, recalculate the non-graph weights to sum to 1.0 by multiplying each by `1.0 / (1.0 - graph_weight)`. This is a runtime adjustment, not a config change — the configured weights remain the target distribution.

The key insight: graph traversal finds structurally connected decisions that similarity search might miss (e.g., a decision about `EventBus` is relevant to `src/notifications/` because `NotificationHandler` `depends_on` `EventBus` `decided_by` that decision — a 2-hop path that embedding similarity might rank low).

**Relevance path annotation:** Add an optional `relevance_path` field to assembled decisions:
```ts
interface AssembledDecision {
  id: string;
  summary: string;
  rationale: string;
  confidence: string;
  affected_files: string[];
  relevance_path?: string;  // e.g., "src/notifications/ → depends_on → EventBus → decided_by → this"
}
```

This helps the consuming agent understand *why* a decision was surfaced.

### Change 3: Remove manual graph-building from mandatory gates

**`instructions.ts`** — Gate 3 changes:
```
Current Gate 3:
  Call twining_verify on your scope before finishing.
  Link tests to decisions via twining_add_relation with type tested_by.
  Post a status entry summarizing what you did.
  Link commits via twining_link_commit.

New Gate 3:
  Call twining_verify on your scope before finishing.
  Post a status entry summarizing what you did.
  Link commits via twining_link_commit.
```

Remove the `twining_add_relation` instruction. The `tested_by` relation will be auto-extracted: when `twining_verify` runs and finds test files, or when the agent posts a finding about test coverage, the auto-populator creates the relation.

**Stop hook (`stop-hook.sh`)** — Remove the requirement that graph tools must be called. The hook should only check:
1. Decisions recorded (if code changes exist after last `twining_decide` or `twining_post`)
2. Status posted (a `twining_post` with `entry_type: "status"` exists)

Remove the handoff requirement from the Stop hook entirely. `twining_handoff` is valuable but should not block session exit — the status post captures enough for continuity.

**BEHAVIORS.md** — Move graph-building workflows (`twining-map` skill) to a "Power User" section. Remove `add_entity`/`add_relation` from the standard orient/decide/verify workflow tables. Downgrade GEN-04 ("Always call `twining_handoff` before ending") from MUST to SHOULD — the enforcement mechanism (Stop hook) is being removed, and a MUST rule without enforcement creates a false contract. The status post requirement via GEN-03 remains MUST.

### Change 4: Fix SessionStart hook for continuity framing

**Current SessionStart prompt:**
> "Twining coordination is active. BEFORE reading code or making changes: 1) Call `twining_register` with a descriptive agent_id and your capabilities so other agents can discover you. 2) Call `twining_assemble` with your task description and scope to gather prior decisions, warnings, and context that prevent repeated mistakes."

**New SessionStart prompt:**
> "Twining project memory is active. BEFORE reading code or making changes, call `twining_assemble` with your task description and scope to check for prior decisions, warnings, and context from previous sessions. This prevents redoing work and repeating mistakes."

Changes:
- Lead with `assemble`, not `register`. Registration is optional and can happen implicitly.
- Frame as "project memory" not "coordination" — this activates for solo developers resuming work, not just multi-agent scenarios.
- Remove the `register` instruction from the mandatory first step. Move it to BEHAVIORS.md as a "when working with other agents" guideline.

### Change 5: Lite mode config option

Add a `tools.mode` option to `.twining/config.yml`:

```yaml
tools:
  mode: full  # or "lite"
```

When `mode: lite`, the MCP server only registers the 9 core tools: `assemble`, `post`, `read`, `query`, `recent`, `decide`, `search_decisions`, `handoff`, `acknowledge`. Graph tools, lifecycle tools, and coordination tools are not registered. `assemble` is essential — the SessionStart hook directs agents to call it first.

The graph auto-population from Change 1 still runs internally (it's triggered by `decide`/`post`/`handoff` engine code, not by tool calls), so even lite-mode users benefit from graph-powered retrieval in `assemble`.

This matches the benchmark finding: twining-lite's 8 tools + behavioral guidance outperforms full-twining's 31 tools.

## Files Changed

| File | Change |
|------|--------|
| `src/engine/graph-auto-populator.ts` | **New.** Centralized auto-extraction logic for all tool calls |
| `src/engine/decisions.ts` | Move L264-303 graph code to GraphAutoPopulator, call `populator.onDecide()` |
| `src/engine/blackboard.ts` | Add `populator.onPost()` call after successful post |
| `src/engine/coordination.ts` | Add `populator.onHandoff()`, `populator.onRegister()` calls |
| `src/engine/context-assembler.ts` | Replace `computeGraphConnectivity` with `computeGraphReachability`, update scoring weights, add `relevance_path` to output |
| `src/config.ts` | Update default weights, add `tools.mode` config |
| `src/server.ts` | Conditionally register tools based on `tools.mode` |
| `src/instructions.ts` | Update Gate 3 text, remove `add_relation` mandate |
| `src/utils/types.ts` | Expand `Entity["type"]` union (+`agent`, `commit`), expand `Relation["type"]` union (+`supersedes`, `produces`, `challenged`), add `relevance_path` to `AssembledContext` decision type |
| `src/engine/verify.ts` | Add `tested_by` auto-extraction: scan for test file entities matching decision affected_files |
| Plugin: `hooks/hooks.json` | Update SessionStart prompt text |
| Plugin: `hooks/stop-hook.sh` | Remove handoff requirement, remove graph-call check |
| Plugin: `BEHAVIORS.md` | Move graph workflows to power-user section, update standard workflows |
| Plugin: `skills/twining-orient/SKILL.md` | Lead with `assemble`, make `register` optional |
| Tests: `tests/` | Unit tests for GraphAutoPopulator, updated context-assembler tests, updated stop-hook tests |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Graph auto-population adds latency to `decide`/`post` | Already best-effort with try/catch. Graph writes are append-only JSON, <1ms per operation |
| Changing scoring weights breaks existing users' retrieval quality | Adaptive weight fallback: when graph reachability returns 0 for all candidates (sparse/empty graph), redistribute the 35% weight proportionally to other signals at runtime. Configured weights remain the target; fallback ensures no score compression for upgrading users |
| Removing Stop hook handoff check means agents skip handoffs | The status post requirement remains. Handoffs are encouraged in BEHAVIORS.md but not enforced |
| Lite mode fragments the user experience | Default remains `full`. Lite is opt-in for users who want lower overhead |

## Success Criteria

1. In a repeat of the benchmark, full-twining composite scores should match or exceed twining-lite (currently ~7 points behind)
2. Manual `add_entity`/`add_relation` calls per session should drop to near-zero
3. `assemble` should return decisions reachable via graph traversal that similarity search alone would miss
4. Context-recovery scenario sessions should show non-zero Twining tool calls (assemble at minimum)
