# Product Requirements Document: Twining Benchmark Harness

**Product Name:** Twining Benchmark Harness (codename: `twining-bench`)
**Version:** 1.0
**Author:** Dave (Product Owner) / Claude (PM)
**Date:** 2026-02-20
**Status:** Draft — Ready for Architecture & Implementation

---

## 1. Executive Summary

### 1.1 Problem Statement

Twining is a multi-agent coordination MCP server designed to reduce rework, preserve decision context, and improve consistency across AI agent sessions. To validate these claims and demonstrate value to adopters, we need a rigorous, repeatable benchmarking system that quantitatively and qualitatively measures Twining's impact compared to alternative coordination strategies.

No such tool exists today. Teams evaluating multi-agent coordination have no standardized way to compare approaches, and anecdotal evidence is insufficient for adoption decisions.

### 1.2 Product Vision

A CLI-driven benchmark execution engine paired with a web-based results dashboard that enables anyone to run controlled, reproducible experiments comparing multi-agent coordination strategies — and clearly see whether Twining delivers on its promises.

### 1.3 Success Criteria

- A developer can run a full benchmark suite in a single CLI command and view results in a browser within 30 minutes of setup.
- Results are reproducible: two runs of the same scenario with the same seed produce statistically comparable results (within defined variance thresholds).
- The tool produces publication-quality evidence sufficient for a blog post, README, or technical paper.
- Claude Code can use this PRD to independently architect and implement the system.

---

## 2. User Personas

### 2.1 Primary: Twining Developer (Dave)

- Needs to validate design decisions during development
- Wants to run benchmarks locally during iteration
- Cares about detailed, granular metrics
- Will use CLI directly

### 2.2 Secondary: Potential Adopter / Evaluator

- Wants to see evidence that Twining works before integrating
- Cares about summary metrics and visual comparisons
- Will view the web dashboard or published results
- May clone the repo and run benchmarks themselves

### 2.3 Scale & Performance Tester

- Needs to understand how coordination strategies degrade as project size, agent count, and session count increase
- Wants to identify breaking points: at what scale does a given coordination pattern start losing coherence, accumulating latency, or consuming disproportionate tokens on orientation vs. productive work?
- Tests two dimensions: (a) **strategy degradation at scale** — does the coordination pattern hold up with 10+ agents, 50+ sessions, or 10k+ line codebases? (b) **infrastructure performance** — does Twining's MCP server maintain acceptable latency, memory usage, and throughput under load?
- Use cases: capacity planning before adopting Twining for a large team, identifying when to consolidate/prune coordination state, benchmarking Twining releases for performance regressions
- Will use CLI with extended parameters (`--agents`, `--scale-factor`) and monitor infrastructure metrics in the dashboard

### 2.4 Tertiary: Contributor / Researcher

- Wants to add new test scenarios or coordination conditions
- Needs a pluggable architecture to extend
- Cares about methodology rigor and reproducibility

---

## 3. System Architecture Overview

The system consists of four major subsystems:

```
┌─────────────────────────────────────────────────────┐
│                   twining-bench                      │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  CLI      │  │  Test Runner │  │  Analyzer     │  │
│  │  Engine   │──│  & Executor  │──│  & Scorer     │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
│       │              │                    │           │
│       │        ┌─────┴──────┐      ┌─────┴──────┐   │
│       │        │ Test       │      │ Results    │   │
│       │        │ Targets    │      │ Store      │   │
│       │        │ (pluggable)│      │ (JSON/DB)  │   │
│       │        └────────────┘      └─────┬──────┘   │
│       │                                  │           │
│  ┌────┴─────────────────────────────────┴────────┐  │
│  │              Web Dashboard                     │  │
│  │         (Results Viewer & Comparisons)         │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 4. Functional Requirements

### 4.1 CLI Engine (`twining-bench`)

#### FR-CLI-001: Benchmark Execution Command

The CLI must provide a primary command to execute benchmark runs.

```bash
twining-bench run \
  --scenario <scenario-name|all> \
  --condition <condition-name|all> \
  --target <target-config-path> \
  --runs <number> \
  --seed <optional-seed> \
  --output <output-directory> \
  --budget <max-dollars> \
  --dry-run
```

**Acceptance Criteria:**

- [ ] `twining-bench run --scenario refactor --condition all --runs 3` executes the "refactor" scenario under all coordination conditions, 3 times each, and exits with code 0 on success.
- [ ] If `--seed` is provided, the same seed produces identical agent prompts and task orderings across runs.
- [ ] If `--scenario all` is specified, all registered scenarios are executed sequentially. Note: `all` excludes the scale stress test — it must be explicitly specified with `--scenario scale-stress`.
- [ ] `--budget <dollars>` sets a hard ceiling on API spend (default: $100). Before execution, the harness estimates total cost and aborts if projected cost exceeds budget. During execution, cumulative spend is tracked and the run aborts gracefully if the budget is exceeded.
- [ ] `--dry-run` validates all configuration, estimates cost (showing projected input/output tokens and dollar amount at current Sonnet 4 rates), and exits without executing agent sessions.
- [ ] Progress is reported to stdout with: current scenario, condition, run number, and elapsed time.
- [ ] If a run fails (e.g., agent crash, timeout), it is logged as a failed run with error details, and execution continues to the next run.
- [ ] Total execution time is reported at completion.

#### FR-CLI-002: Scenario Listing

```bash
twining-bench scenarios list
```

**Acceptance Criteria:**

- [ ] Lists all registered scenarios with: name, description, estimated duration, and required target type.
- [ ] Output is formatted as a table to stdout.

#### FR-CLI-003: Condition Listing

```bash
twining-bench conditions list
```

**Acceptance Criteria:**

- [ ] Lists all registered coordination conditions with: name, description, and what coordination tools/files are available to agents.

#### FR-CLI-004: Results Summary

```bash
twining-bench results show <run-id|latest>
twining-bench results compare <run-id-1> <run-id-2>
```

**Acceptance Criteria:**

- [ ] `results show latest` displays a formatted summary table of the most recent benchmark run, including all metrics per condition.
- [ ] `results compare` displays a side-by-side delta comparison between two runs, with percentage improvements/regressions highlighted.
- [ ] All numerical results include mean, standard deviation, and min/max across runs.

#### FR-CLI-005: Dashboard Launch

```bash
twining-bench dashboard [--port <port>]
```

**Acceptance Criteria:**

- [ ] Starts a local web server serving the results dashboard on the specified port (default: 3838).
- [ ] Opens the user's default browser automatically.
- [ ] The dashboard reads from the same results store as the CLI.

#### FR-CLI-006: Configuration File

The CLI must support a `twining-bench.config.ts` (or `.json`) file for persistent configuration.

**Acceptance Criteria:**

- [ ] Config file supports: default target path, default number of runs, custom scenario directories, agent timeout, and token budget limits.
- [ ] CLI flags override config file values.
- [ ] A default config is generated via `twining-bench init`.

---

### 4.2 Test Targets (Pluggable Codebases)

#### FR-TGT-001: Pre-built Synthetic Repository

A purpose-built TypeScript project ships with the tool as the default test target.

**Acceptance Criteria:**

- [ ] The repo contains at least 15 files across 4+ directories with realistic structure (src/, tests/, config/, docs/).
- [ ] The repo includes at least 3 interconnected modules with explicit dependencies (e.g., a service layer calling a data layer calling a utility layer).
- [ ] The repo includes at least 2 intentional architectural decisions that agents must discover or respect (e.g., "we use the repository pattern" documented in a design doc, or "events are preferred over direct calls" visible in the code).
- [ ] The repo compiles and all existing tests pass before any benchmark scenario begins.
- [ ] The repo complexity is calibrated so that benchmark scenarios complete within 5-15 minutes per run.

#### FR-TGT-002: Programmatic Repository Generator

A generator that creates repos with configurable complexity parameters.

**Acceptance Criteria:**

- [ ] Generator accepts parameters: `fileCount` (10-100), `moduleCount` (2-10), `dependencyDepth` (1-5), `testCoverage` (0-100%), and `documentationLevel` (none|minimal|thorough).
- [ ] Generated repos are valid TypeScript projects that compile and have passing tests.
- [ ] Two repos generated with the same seed and parameters are byte-identical.
- [ ] Generated repos include realistic patterns: interfaces, dependency injection, error handling, and configuration files.
- [ ] Generator outputs a manifest file documenting the "ground truth" architectural decisions embedded in the repo (used for scoring).

#### FR-TGT-003: External Repository Adapter

Support for using real open-source projects as test targets.

**Acceptance Criteria:**

- [ ] A configuration schema allows specifying: git URL, branch, setup commands, and a "ground truth" manifest of known architectural decisions/patterns.
- [ ] The adapter clones the repo to a temporary directory, runs setup commands, and validates the repo is in a usable state before benchmarks begin.
- [ ] The adapter creates an isolated working copy per run to prevent cross-contamination.
- [ ] If setup fails, the adapter reports a clear error and skips the run.

#### FR-TGT-004: Target Interface Contract

All target types must conform to a common interface.

**Acceptance Criteria:**

- [ ] Interface includes: `setup(): Promise<WorkingDirectory>`, `validate(): Promise<ValidationResult>`, `getGroundTruth(): ArchitecturalManifest`, `reset(): Promise<void>`, and `teardown(): Promise<void>`.
- [ ] Any new target type implementing this interface is automatically usable with all scenarios and conditions.
- [ ] Target interface is documented with JSDoc and a reference implementation.

---

### 4.3 Coordination Conditions

Each condition defines what coordination tools and files are available to agents during a benchmark run.

#### FR-CND-001: Baseline (No Coordination)

**Description:** Agents have access only to the codebase itself. No shared state, no CLAUDE.md, no coordination files.

**Acceptance Criteria:**

- [ ] Agent sessions are initialized with only the repo working directory.
- [ ] No CLAUDE.md file is present in the repo root.
- [ ] No shared files, blackboards, or MCP servers are available.
- [ ] Agents cannot communicate except through code changes committed to the repo.

#### FR-CND-002: CLAUDE.md Only

**Description:** Agents have the codebase plus a CLAUDE.md file with project conventions and instructions, but no shared runtime state.

**Acceptance Criteria:**

- [ ] A CLAUDE.md file is generated or provided containing: project overview, coding conventions, architectural principles, and task management instructions.
- [ ] The CLAUDE.md content is consistent across all runs of this condition.
- [ ] No shared state, blackboard, or MCP server is available.
- [ ] CLAUDE.md is the only coordination artifact beyond the codebase.

#### FR-CND-003: Manual Shared Markdown

**Description:** Agents have CLAUDE.md plus a shared `COORDINATION.md` file they can read and write to. Simulates ad-hoc coordination without tooling.

**Acceptance Criteria:**

- [ ] A `COORDINATION.md` file exists in the repo root, initially empty or with a template header.
- [ ] Agent prompts instruct them to read and update `COORDINATION.md` with decisions, status, and context.
- [ ] No structured format is enforced — agents write freeform markdown.
- [ ] No search, indexing, or graph capabilities are available.
- [ ] The file is shared across all agent sessions within a single run.

#### FR-CND-004: Generic File-Based Context Reload (/clear Pattern)

**Description:** Simulates the workflow where developers use `/clear` to reset context window, then the agent reloads state from structured files. This tests whether file-based context rotation (reading from a coordination file after clearing accumulated context) is sufficient to maintain coherence — the key question being whether "reload from file" can approximate persistent coordination.

This condition models the generic version of the pattern: a single `CONTEXT.md` file that the agent writes to at session end and reads from at session start. Each agent session starts with a simulated `/clear` — meaning the agent has no conversation history, only the repo state and the context file.

**Acceptance Criteria:**

- [ ] Each agent session starts with zero conversation history (simulating `/clear`).
- [ ] A `CONTEXT.md` file exists in the repo root. At session start, the agent is prompted to read this file first.
- [ ] At session end, the agent is prompted to update `CONTEXT.md` with: what was done, key decisions made, what's left, and any warnings for the next agent.
- [ ] The context file is unstructured markdown — the agent decides what to write.
- [ ] Agent prompts explicitly instruct the "read context → do work → write context" loop.
- [ ] No MCP servers, no search, no tooling beyond file read/write.
- [ ] The critical measurement is: does a fresh context window with file-based reload preserve enough signal for downstream agents to avoid rework?

#### FR-CND-005: Structured Framework Context Reload (GSD/BMAD Pattern)

**Description:** Simulates structured multi-agent frameworks where agents operate with predefined roles, spec-driven planning artifacts, and fresh context windows per task. This condition models the core patterns from real-world frameworks like GSD (Get Shit Done) and BMAD (Breakthrough Method for Agile AI-Driven Development).

**Key patterns modeled from GSD:**
- **Fresh subagent contexts:** Each task runs in a clean context window (simulating `/clear` or subagent spawn), preventing context rot. Task 50 has the same quality as Task 1.
- **Spec-driven execution:** Agents read structured PLAN.md files that serve as executable instructions, not just documentation.
- **Aggressive atomicity:** Plans are small (2-3 tasks each), designed to fit in ~50% of a fresh context window.
- **State tracking:** A central STATE.md tracks progress, phase completion, and what's next.
- **Atomic commits:** Each task produces its own commit, making work traceable and revertable.

**Key patterns modeled from BMAD:**
- **Specialized agent personas:** Each agent session has a role-specific system prompt (e.g., "You are the Architect agent," "You are the Developer agent").
- **Workflow artifacts:** Structured handoff through story files and planning artifacts (PRD → Architecture → Stories → Implementation).
- **Status tracking:** A workflow status file (`.yaml` or `.md`) tracks which phases/stories are complete, in-progress, or pending.
- **Agent coordination through files:** Agents pass notes through structured story/task files, not conversation history.

**Condition Setup:**

A `coordination/` directory exists containing:
- `STATE.md` — Project state tracking: current phase, completed tasks, next actions (modeled on GSD's STATE.md)
- `PLAN.md` — Structured task plan with status markers, verification steps, and acceptance criteria per task (modeled on GSD's plan files that serve as executable instructions for subagents)
- `decisions.md` — Structured decisions log with fields: decision, rationale, date, agent-role
- `handoff.md` — Structured handoff document: what was done, key findings, blockers, next steps (modeled on BMAD's story file handoff pattern)
- `roles/agent-N.md` — Role-specific instructions for each agent in the sequence, including persona, responsibilities, and what files to read first (modeled on BMAD's specialized agent definitions)

**Acceptance Criteria:**

- [ ] Each agent session starts with zero conversation history (simulating `/clear` or fresh subagent spawn).
- [ ] Agent sessions receive a role-specific system prompt from `roles/agent-N.md` that establishes their persona and responsibilities.
- [ ] Agent prompts instruct the agent to: (1) read its role file, (2) read STATE.md for current project status, (3) read PLAN.md for their assigned tasks, (4) read handoff.md for context from previous agent, (5) execute assigned tasks, (6) update STATE.md with completion status, (7) update handoff.md with findings and context for next agent, (8) commit each completed task atomically.
- [ ] PLAN.md uses a structured format with verification steps per task (modeled on GSD's plan format where the plan IS the executable instruction).
- [ ] Templates enforce a consistent structure (headers, fields, status markers `[ ]`, `[x]`, `[~]`) — unlike the freeform shared markdown condition.
- [ ] No MCP servers or semantic search — this is purely file-based but with imposed structure and role specialization.
- [ ] The critical measurements are: (a) does imposed structure + role specialization close the gap with Twining's dynamic coordination? (b) does the fresh-context-per-task pattern (preventing context rot) outperform continuous-context approaches on longer scenarios? (c) does the lack of search/graph/semantic capabilities still leave meaningful value for Twining?

#### FR-CND-006: Full Twining MCP

**Description:** Agents have CLAUDE.md plus a fully configured Twining MCP server with all capabilities: blackboard, decision tracking, knowledge graph, and semantic search.

**Acceptance Criteria:**

- [ ] A Twining MCP server instance is started and configured for the run.
- [ ] Agent sessions are configured with the Twining MCP server connection.
- [ ] Agent prompts include Twining usage instructions (orientation, decision recording, etc.).
- [ ] All Twining tools are available: status, decisions, blackboard, knowledge graph, search.
- [ ] The Twining data directory is isolated per run.

#### FR-CND-007: Condition Interface Contract

**Acceptance Criteria:**

- [ ] Interface includes: `setup(workingDir): Promise<ConditionContext>`, `getAgentConfig(): AgentConfiguration`, `teardown(): Promise<void>`, and `collectArtifacts(): Promise<CoordinationArtifacts>`.
- [ ] New conditions can be added by implementing this interface and registering in the condition registry.
- [ ] Condition setup/teardown is idempotent.

---

### 4.4 Test Scenarios

Each scenario defines a multi-agent task with specific objectives and scoring criteria.

#### FR-SCN-001: Refactoring Handoff

**Description:** Agent A refactors a core module (e.g., extracts an interface, renames methods). Agent B then extends a dependent module. Measures whether B respects A's changes and rationale.

**Task Flow:**

1. Agent A receives: "Refactor the UserService to extract an IUserRepository interface and implement the repository pattern. Document your decisions."
2. Agent A completes work and session ends.
3. Agent B receives: "Add a caching layer to the user data access. Build on the existing architecture."
4. Agent B completes work and session ends.

**Scoring Dimensions:**

- **Consistency Score (0-100):** Does Agent B's code align with Agent A's architectural choices? Measured by: correct interface usage, pattern adherence, no contradictory patterns introduced.
- **Rework Score (0-100):** Inverse of code churn. 100 = no reverts or rewrites of A's code. 0 = A's work was effectively discarded.
- **Completion Score (0-100):** Did both agents complete their assigned tasks? Partial credit for partial completion.

**Acceptance Criteria:**

- [ ] Scenario completes within the configured timeout (default: 15 minutes per agent session).
- [ ] All three scoring dimensions produce a numerical score with justification text.
- [ ] The scenario can be run against any target that has a service-with-dependency pattern (validated at setup).
- [ ] Agent prompts are identical across conditions — only available tools differ.

#### FR-SCN-002: Architecture Decision Cascade

**Description:** Agent A makes a significant architectural decision (e.g., event-driven vs. direct calls). Agents B and C independently build features that should respect that decision.

**Task Flow:**

1. Agent A receives: "The notification system needs to be decoupled from the order processing module. Choose an approach, implement the decoupling, and document your architectural decision with rationale."
2. Agent B receives: "Add email notifications when an order status changes. Integrate with the existing notification architecture."
3. Agent C receives: "Add a webhook system that fires on order events. Integrate with the existing notification architecture."
4. Agents B and C work in separate sessions (not concurrent).

**Scoring Dimensions:**

- **Decision Propagation Score (0-100):** Did B and C both discover and follow A's architectural decision? 100 = both aligned. 50 = one aligned. 0 = neither aligned.
- **Pattern Consistency Score (0-100):** Do B and C's implementations use the same integration pattern as each other? Measures whether coordination produces uniform outcomes.
- **Decision Quality Score (0-100):** Expert evaluation of whether A's decision was well-reasoned (rubric-scored against ground truth options).

**Acceptance Criteria:**

- [ ] Three distinct agent sessions are executed sequentially.
- [ ] Agent B and C prompts do not reference Agent A's specific decision — they must discover it.
- [ ] Scoring includes automated pattern detection (e.g., detecting event emitter usage vs. direct function calls) and LLM-as-judge evaluation for nuanced consistency.
- [ ] Ground truth manifest defines the acceptable architectural patterns for the scenario.

#### FR-SCN-003: Bug Investigation Handoff

**Description:** Agent A investigates a planted bug partway, then Agent B picks up the investigation. Measures how much ground Agent B re-covers.

**Task Flow:**

1. A known bug is planted in the test target (e.g., an off-by-one error in a data transformation that causes incorrect pagination).
2. Agent A receives: "Users report that page 2 of search results sometimes shows duplicates. Investigate and document your findings. You have 5 minutes."
3. Agent A's session is terminated after 5 minutes (mid-investigation).
4. Agent B receives: "Continue the investigation into the search results pagination bug. Fix it and add a regression test."

**Scoring Dimensions:**

- **Context Recovery Score (0-100):** How much of Agent A's investigation did Agent B successfully leverage? Measured by: did B start from where A left off, or restart from scratch?
- **Redundant Investigation Score (0-100):** Inverse of duplicated investigation steps. 100 = no re-investigation. 0 = complete restart.
- **Resolution Score (0-100):** Did Agent B successfully fix the bug and add a passing test?
- **Time-to-Resolution (seconds):** Wall clock time from Agent B's session start to bug fix commit.

**Acceptance Criteria:**

- [ ] Agent A's session is hard-terminated at the configured time limit, regardless of progress.
- [ ] The planted bug is deterministic and has exactly one correct fix.
- [ ] Redundant investigation is measured by comparing Agent B's file access patterns and tool calls against Agent A's — overlap percentage is calculated.
- [ ] The regression test must catch the original bug (validated by running it against the pre-fix code).

#### FR-SCN-004: Multi-Session Feature Build

**Description:** A feature is built across 4-5 sequential agent sessions, simulating a realistic multi-day development workflow. Measures drift, coherence, and cumulative efficiency.

**Task Flow:**

1. Session 1: "Design and scaffold the API for a new analytics dashboard. Create the route structure, data models, and write a brief design doc."
2. Session 2: "Implement the data aggregation service for the analytics dashboard. Follow the design from Session 1."
3. Session 3: "Add unit tests for the aggregation service and fix any issues you discover."
4. Session 4: "Implement the API endpoint handlers, connecting them to the aggregation service."
5. Session 5: "Write integration tests for the full analytics pipeline and ensure everything works end-to-end."

**Scoring Dimensions:**

- **Architectural Drift Score (0-100):** How much does the final implementation diverge from Session 1's design? 100 = perfect adherence. 0 = completely different architecture.
- **Cumulative Rework Score (0-100):** Total code churn across all sessions. Measures how much each session undoes or redoes previous work.
- **Final Quality Score (0-100):** Does the end result compile, pass tests, and meet the feature requirements?
- **Total Token Cost (number):** Sum of all tokens consumed across all sessions.
- **Total Wall Time (seconds):** Sum of all session durations.

**Acceptance Criteria:**

- [ ] Exactly 5 sequential agent sessions are executed.
- [ ] Each session receives only its specific task prompt — no summary of previous sessions is injected (coordination must come from the condition's tools).
- [ ] Architectural drift is measured by comparing the Session 1 design doc against the final code structure using both automated analysis and LLM-as-judge.
- [ ] Token costs are captured per-session and in aggregate.

#### FR-SCN-005: Scale Stress Test

**Description:** Tests how coordination strategies degrade as the number of agents, sessions, and codebase size increase. This is not a single task but a parameterised scenario that can be run at different scale factors to produce a degradation curve.

**Task Flow (at scale factor S):**

1. A generated repo of size S × baseline complexity is created.
2. A feature is built across S × 4 sequential agent sessions (e.g., scale 1 = 4 sessions, scale 3 = 12 sessions).
3. Each session adds a component, and later sessions must integrate with earlier work.
4. At the end, integration tests validate the full feature.

**Scale Dimensions Tested:**

- **Agent count scaling:** 4 → 8 → 12 → 16 sessions for the same feature, measuring when coordination breaks down
- **Codebase size scaling:** 2k → 5k → 10k → 20k line repos, measuring orientation overhead
- **Coordination state scaling:** After 50+ decisions and 20+ blackboard entries, does Twining's search remain effective?

**Scoring Dimensions:**

- **Coherence Degradation Rate:** Plot coherence score against scale factor. The slope of degradation is the key metric — a flatter slope = better scalability.
- **Orientation Overhead Ratio:** Tokens spent on orientation (reading context, searching decisions) as a percentage of total tokens, plotted against scale. Increasing ratio = coordination overhead is growing faster than productive work.
- **Integration Success Rate:** Percentage of integration tests passing at each scale factor.
- **Infrastructure Metrics (Twining only):** MCP server response latency (p50, p95, p99), memory usage, and search query time at each scale factor.

**Acceptance Criteria:**

- [ ] Scenario accepts a `--scale-factor` parameter (1-5, default 1).
- [ ] Scale factor linearly increases: session count, repo size, and task complexity.
- [ ] Results include per-scale-factor metrics, enabling degradation curve plotting.
- [ ] Infrastructure metrics are collected via Twining MCP server instrumentation (latency, memory, query count).
- [ ] Dashboard renders degradation curves (metric vs. scale factor) per condition.
- [ ] A "break point" is identified and reported: the scale factor at which a condition's coherence score drops below 60% or orientation overhead exceeds 40%.

#### FR-SCN-006: Scenario Interface Contract

**Acceptance Criteria:**

- [ ] Interface includes: `getMetadata(): ScenarioMetadata`, `setup(target, condition): Promise<ScenarioContext>`, `getAgentTasks(): AgentTask[]`, `execute(runner): Promise<RawResults>`, `score(rawResults, groundTruth): Promise<ScoredResults>`, and `teardown(): Promise<void>`.
- [ ] Each `AgentTask` specifies: prompt text, timeout, required capabilities, and sequence order.
- [ ] New scenarios can be added by implementing this interface and placing them in the scenarios directory.

---

### 4.5 Test Runner & Executor

#### FR-RUN-001: Agent Session Management

**Implementation:** The harness uses the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` for TypeScript) to programmatically invoke agent sessions. This provides full control over MCP server injection, system prompts, tool permissions, and structured output — without shelling out to the CLI.

**Acceptance Criteria:**

- [ ] Agent sessions are invoked via the Claude Agent SDK `query()` function with `ClaudeAgentOptions`.
- [ ] Each agent session is configured with:
  - `cwd` set to the isolated working directory (copy of target)
  - `mcp_servers` injected per-condition (e.g., Twining MCP for the `twining-full` condition, empty for baseline)
  - `allowed_tools` set per-condition (e.g., `["Read", "Edit", "Bash", "mcp__twining__*"]` for Twining)
  - `permission_mode` set to `"acceptEdits"` to allow autonomous operation
  - `max_turns` set per-scenario (default: 50)
  - `output_format` set to `"json"` for structured transcript capture
  - `system_prompt` set per-condition with coordination instructions (e.g., "Use Twining tools for orientation" or "Read CONTEXT.md first")
- [ ] Agent sessions stream messages, and the harness captures each message (tool calls, text, token usage) in real time.
- [ ] Sessions have configurable timeouts (default: 15 minutes). The harness cancels the session if the timeout is exceeded.
- [ ] Token usage (input, output, total) is extracted from SDK response metadata per-session.
- [ ] Session transcripts are saved as structured JSON for post-analysis, including all tool calls with parameters and results.

**SDK Integration Pattern:**

```typescript
import { query, ClaudeAgentOptions } from '@anthropic-ai/claude-agent-sdk';

const options: ClaudeAgentOptions = {
  system_prompt: condition.getSystemPrompt(),
  mcp_servers: condition.getMcpServers(),
  allowed_tools: condition.getAllowedTools(),
  permission_mode: 'acceptEdits',
  max_turns: scenario.getMaxTurns(),
  cwd: workingDirectory,
  output_format: 'json',
};

const transcript: Message[] = [];
for await (const message of query(prompt, options)) {
  transcript.push(message);
  collector.recordMessage(message);
}
```

#### FR-RUN-002: Run Orchestration

**Acceptance Criteria:**

- [ ] Runs execute in the order: setup target → setup condition → execute scenario tasks sequentially → collect results → teardown condition → teardown target.
- [ ] Multiple runs of the same scenario/condition pair execute sequentially (not concurrently) to avoid resource contention.
- [ ] Each run has a unique ID (UUID) and timestamp.
- [ ] Partial results are saved incrementally — if a benchmark suite is interrupted, completed runs are preserved.

#### FR-RUN-003: Data Collection

The runner must capture the following raw data per agent session:

**Acceptance Criteria:**

- [ ] **Git data:** Full diff of all file changes (additions, modifications, deletions), commit messages, and file access log.
- [ ] **Token data:** Input tokens, output tokens, and total tokens per session, broken down by tool call.
- [ ] **Timing data:** Session start time, end time, wall clock duration, and time-to-first-action (first meaningful file change).
- [ ] **Tool usage data:** List of all tool calls made by the agent, with timestamps and parameters.
- [ ] **Coordination data:** For conditions with shared state (markdown, Twining), capture the state of coordination artifacts at session start and end.
- [ ] All raw data is saved as JSON files in the run output directory.

#### FR-RUN-004: Error Handling & Retries

**Acceptance Criteria:**

- [ ] If an agent session fails (crash, timeout, API error), the runner logs the failure with full error context.
- [ ] Failed runs are marked as `failed` in results (not silently dropped).
- [ ] Configurable retry count (default: 0). If retries > 0, failed runs are re-attempted up to the retry limit.
- [ ] A run is considered failed if: the agent exceeds the timeout, the agent produces no file changes, or the target repo is left in a non-compiling state with no commits.

---

### 4.6 Analyzer & Scorer

#### FR-ANL-001: Automated Code Analysis

**Acceptance Criteria:**

- [ ] **Git churn analysis:** Calculate lines added, lines removed, lines modified, number of reverts, and net effective changes per session and cumulative.
- [ ] **Pattern detection:** Identify specific code patterns (e.g., event emitter usage, interface implementation, repository pattern) in the final codebase using AST analysis or regex-based heuristics.
- [ ] **Test result analysis:** Run the target's test suite and capture pass/fail/skip counts and coverage delta.
- [ ] **Compilation check:** Verify the codebase compiles after each agent session.
- [ ] All automated analysis results are saved as structured JSON.

#### FR-ANL-002: LLM-as-Judge Evaluation

For nuanced quality assessments that cannot be fully automated.

**Acceptance Criteria:**

- [ ] An evaluator prompt template is defined for each scoring dimension that requires judgment (e.g., "Does Agent B's implementation align with Agent A's architectural decision?").
- [ ] The evaluator receives: the ground truth manifest, the relevant code diffs, coordination artifacts, and a structured rubric.
- [ ] The evaluator outputs: a numerical score (0-100), a confidence level (low/medium/high), and a justification paragraph.
- [ ] Each evaluation is run 3 times and the median score is used, to reduce LLM evaluation variance.
- [ ] Evaluator prompts are versioned and stored alongside the scenario definition.
- [ ] The evaluator model is configurable (default: Claude Sonnet for cost efficiency).

#### FR-ANL-003: Statistical Aggregation

**Acceptance Criteria:**

- [ ] For each metric, across N runs of the same scenario/condition pair, calculate: mean, median, standard deviation, min, max, and 95% confidence interval.
- [ ] Flag results where standard deviation exceeds 20% of the mean as "high variance" requiring more runs.
- [ ] Calculate percentage improvement/regression between conditions (e.g., "Twining reduced rework by 43% ± 8% compared to baseline").
- [ ] Perform and report basic statistical significance testing (paired t-test or Wilcoxon signed-rank) for key comparisons, with p-values.

#### FR-ANL-004: Composite Scoring

**Acceptance Criteria:**

- [ ] Each scenario produces a composite "Coordination Effectiveness Score" (0-100) that is a weighted average of its scoring dimensions.
- [ ] Default weights are defined per scenario but can be overridden in config.
- [ ] An overall "Twining Efficacy Score" is calculated as the weighted average across all scenarios, comparing Twining condition vs. baseline.
- [ ] Score breakdowns are available at every level: overall → per-scenario → per-dimension → per-run.

---

### 4.7 Results Store

#### FR-RST-001: Storage Format

**Acceptance Criteria:**

- [ ] Results are stored as JSON files in a configurable output directory (default: `./benchmark-results/`).
- [ ] Directory structure: `benchmark-results/<run-id>/metadata.json`, `benchmark-results/<run-id>/raw/`, `benchmark-results/<run-id>/scores/`, `benchmark-results/<run-id>/artifacts/`.
- [ ] A top-level `benchmark-results/index.json` maintains a registry of all runs with: run ID, timestamp, scenarios executed, conditions tested, and summary scores.
- [ ] Results are git-trackable: no binary blobs, deterministic JSON formatting (sorted keys, 2-space indent).

#### FR-RST-002: Data Retention

**Acceptance Criteria:**

- [ ] Raw agent transcripts are stored but can be excluded from git via `.gitignore` patterns (they can be large).
- [ ] Scored results and metadata are always retained.
- [ ] A `twining-bench clean --keep-latest <N>` command removes old runs, keeping the N most recent.

---

### 4.8 Web Dashboard

#### FR-DSH-001: Run Overview

**Acceptance Criteria:**

- [ ] Dashboard displays a list of all benchmark runs with: date, scenarios, conditions, and overall scores.
- [ ] Runs are sortable by date and filterable by scenario.
- [ ] Clicking a run navigates to its detail view.

#### FR-DSH-002: Condition Comparison View

The primary visualization: side-by-side comparison of coordination conditions.

**Acceptance Criteria:**

- [ ] For a selected scenario, display a grouped bar chart comparing all conditions across each scoring dimension.
- [ ] Each bar shows the mean score with error bars representing standard deviation.
- [ ] A summary table below the chart shows exact numbers: mean, std dev, and percentage delta vs. baseline.
- [ ] Color coding: green for improvements over baseline, red for regressions, gray for baseline itself.

#### FR-DSH-003: Metric Deep Dive

**Acceptance Criteria:**

- [ ] Clicking on any metric opens a detail panel showing: all individual run scores (scatter plot or box plot), the statistical test result (p-value, significance), and the LLM-as-judge justification text for qualitative scores.
- [ ] Token usage and wall time are shown as separate charts with per-session breakdowns.

#### FR-DSH-004: Trend View

**Acceptance Criteria:**

- [ ] If multiple benchmark runs exist over time (e.g., as Twining is developed), display a line chart showing score trends over time per condition.
- [ ] This allows tracking whether Twining's efficacy improves as the product develops.

#### FR-DSH-005: Export

**Acceptance Criteria:**

- [ ] Results can be exported as: Markdown report (suitable for README or blog post), CSV (for custom analysis), and PNG charts (for presentations).
- [ ] The Markdown export includes: methodology summary, key findings, chart images, and data tables.
- [ ] Export is triggered via a button in the dashboard UI and also available as a CLI command: `twining-bench export --format <md|csv|png> --run <run-id>`.

#### FR-DSH-006: Technology & Implementation

**Acceptance Criteria:**

- [ ] Dashboard is a single-page application built with React and TypeScript.
- [ ] Charts use a standard library (Recharts, Chart.js, or D3).
- [ ] Dashboard reads results from the local filesystem via API routes served by the CLI's built-in server.
- [ ] No external database is required — the JSON results store is the source of truth.
- [ ] Dashboard is responsive and usable on screens ≥ 1024px wide.

---

## 5. Non-Functional Requirements

### NFR-001: Performance

- [ ] A single scenario/condition run (1 iteration) completes within 20 minutes maximum.
- [ ] A full benchmark suite (5 scenarios × 6 conditions × 3 runs = 90 runs) completes within 16 hours.
- [ ] The dashboard loads and renders results for 50+ runs within 3 seconds.
- [ ] Analyzer scoring for a single run completes within 2 minutes.

### NFR-002: Reliability

- [ ] The harness handles agent API rate limits gracefully with exponential backoff.
- [ ] Interrupted benchmark suites can be resumed from the last completed run.
- [ ] No data is lost if the process is killed — incremental saves after each run.

### NFR-003: Extensibility

- [ ] Adding a new scenario requires: creating a single file implementing the scenario interface and placing it in the `scenarios/` directory. No core code changes.
- [ ] Adding a new condition requires: creating a single file implementing the condition interface and placing it in the `conditions/` directory. No core code changes.
- [ ] Adding a new target type requires: implementing the target interface. No core code changes.
- [ ] All interfaces are documented with TypeScript types and JSDoc.

### NFR-004: Reproducibility

- [ ] All agent prompts are logged verbatim.
- [ ] Random elements (e.g., repo generation) are seeded and deterministic.
- [ ] The exact versions of all dependencies (including Claude API model version) are recorded per run.
- [ ] A `twining-bench reproduce <run-id>` command re-runs a historical run with the same configuration.

### NFR-005: Developer Experience

- [ ] `npm install` followed by `twining-bench run --scenario refactor --condition all` works with zero additional configuration beyond API key.
- [ ] Clear, actionable error messages for common issues: missing API key, target setup failure, timeout exceeded.
- [ ] A `--dry-run` flag that validates configuration and scenario setup without executing agent sessions.
- [ ] A `--verbose` flag for detailed logging during execution.

### NFR-006: Security

- [ ] API keys are read from environment variables, never stored in config files or results.
- [ ] Agent sessions are sandboxed: they cannot access the host filesystem outside their working directory.
- [ ] No sensitive data is included in results JSON (API keys, tokens are redacted).

---

## 6. Technical Stack

| Component | Technology | Rationale |
|---|---|---|
| Language | TypeScript | Consistency with Twining, type safety |
| CLI Framework | Commander.js or Yargs | Mature, well-documented |
| Agent Orchestration | `@anthropic-ai/claude-agent-sdk` | Official SDK for programmatic Claude Code sessions with MCP injection, streaming, and structured output |
| AST Analysis | ts-morph | TypeScript-native AST manipulation |
| Dashboard | React + Vite | Fast dev server, same language |
| Charts | Recharts | React-native, good defaults |
| Statistics | simple-statistics (npm) | Lightweight, no native deps |
| Process Management | execa | Modern child process management (for git ops, test execution) |
| File Watching | chokidar (for dashboard live reload) | Mature, cross-platform |

---

## 7. Data Models

### 7.1 Run Metadata

```typescript
interface RunMetadata {
  id: string;                    // UUID
  timestamp: string;             // ISO 8601
  config: BenchmarkConfig;       // Full config snapshot
  scenarios: string[];           // Scenario names executed
  conditions: string[];          // Condition names tested
  runsPerPair: number;           // Number of runs per scenario/condition pair
  seed?: string;                 // Random seed if provided
  environment: {
    nodeVersion: string;
    platform: string;
    claudeModel: string;         // Exact model string used
    twiningVersion?: string;     // Twining version (if applicable)
  };
  status: 'running' | 'completed' | 'partial' | 'failed';
  duration: number;              // Total wall time in ms
}
```

### 7.2 Scored Results

```typescript
interface ScoredResults {
  runId: string;
  scenario: string;
  condition: string;
  iteration: number;
  scores: {
    [dimensionName: string]: {
      value: number;             // 0-100
      confidence: 'low' | 'medium' | 'high';
      method: 'automated' | 'llm-judge' | 'hybrid';
      justification: string;
    };
  };
  metrics: {
    totalTokens: number;
    wallTimeMs: number;
    agentSessions: number;
    gitChurn: {
      linesAdded: number;
      linesRemoved: number;
      filesChanged: number;
      reverts: number;
    };
    testsPass: number;
    testsFail: number;
    compiles: boolean;
  };
  composite: number;             // Weighted composite score
}
```

### 7.3 Agent Session Transcript

```typescript
interface AgentTranscript {
  sessionId: string;
  runId: string;
  scenario: string;
  condition: string;
  taskIndex: number;
  prompt: string;                // Exact prompt sent to agent
  toolCalls: ToolCall[];         // All tool invocations
  fileChanges: FileChange[];     // All file modifications
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  timing: {
    startTime: string;
    endTime: string;
    durationMs: number;
    timeToFirstActionMs: number;
  };
  exitReason: 'completed' | 'timeout' | 'error' | 'manual';
  error?: string;
}
```

---

## 8. Project Structure

```
twining-bench/
├── package.json
├── tsconfig.json
├── twining-bench.config.ts          # Default config
├── README.md
├── src/
│   ├── cli/
│   │   ├── index.ts                 # CLI entry point
│   │   ├── commands/
│   │   │   ├── run.ts
│   │   │   ├── scenarios.ts
│   │   │   ├── conditions.ts
│   │   │   ├── results.ts
│   │   │   ├── dashboard.ts
│   │   │   ├── export.ts
│   │   │   ├── init.ts
│   │   │   └── clean.ts
│   │   └── utils/
│   │       ├── logger.ts
│   │       └── progress.ts
│   ├── runner/
│   │   ├── orchestrator.ts          # Run orchestration logic
│   │   ├── agent-session.ts         # Agent session management
│   │   ├── data-collector.ts        # Raw data capture
│   │   └── error-handler.ts
│   ├── targets/
│   │   ├── target.interface.ts      # Target contract
│   │   ├── synthetic-repo/
│   │   │   ├── index.ts
│   │   │   └── fixtures/            # Pre-built repo files
│   │   ├── generator/
│   │   │   ├── index.ts
│   │   │   └── templates/
│   │   └── external/
│   │       └── index.ts
│   ├── conditions/
│   │   ├── condition.interface.ts   # Condition contract
│   │   ├── baseline.ts
│   │   ├── claude-md-only.ts
│   │   ├── shared-markdown.ts
│   │   ├── file-reload-generic.ts   # /clear + CONTEXT.md reload
│   │   ├── file-reload-structured.ts # /clear + GSD/BMAD-style framework
│   │   └── full-twining.ts
│   ├── scenarios/
│   │   ├── scenario.interface.ts    # Scenario contract
│   │   ├── refactoring-handoff.ts
│   │   ├── architecture-cascade.ts
│   │   ├── bug-investigation.ts
│   │   ├── multi-session-build.ts
│   │   └── scale-stress-test.ts
│   ├── analyzer/
│   │   ├── code-analysis.ts         # Git churn, AST analysis
│   │   ├── llm-judge.ts             # LLM evaluation engine
│   │   ├── statistics.ts            # Statistical aggregation
│   │   └── composite-scorer.ts
│   ├── results/
│   │   ├── store.ts                 # Results read/write
│   │   ├── index-manager.ts         # Run index management
│   │   └── exporter.ts              # MD/CSV/PNG export
│   └── dashboard/
│       ├── server.ts                # Express/Fastify server
│       └── app/                     # React SPA
│           ├── index.html
│           ├── App.tsx
│           ├── components/
│           │   ├── RunList.tsx
│           │   ├── ConditionComparison.tsx
│           │   ├── MetricDeepDive.tsx
│           │   ├── TrendView.tsx
│           │   └── ExportButton.tsx
│           └── hooks/
│               └── useResults.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
└── benchmark-results/               # Default output directory
    └── .gitkeep
```

---

## 9. KPI Interpretation Guide — How to Read the Results

This section exists so that anyone reviewing benchmark output — not just the person who ran it — can understand what the numbers mean, which condition "won," and how confident they should be in that conclusion.

### 9.1 Decision Framework: "Which Coordination Strategy Should I Use?"

The benchmark produces a matrix of **conditions × metrics**. Not every condition will win on every metric. The KPI framework below provides a structured way to interpret trade-offs and reach a recommendation.

#### Step 1: Check Statistical Validity

Before interpreting any metric, verify:

- **Minimum runs completed:** At least 3 per condition. Results from fewer runs are directional only.
- **Variance check:** If the standard deviation for a metric exceeds 25% of the mean, the result is flagged as "high variance" and should not be used for definitive conclusions. More runs are needed.
- **Significance check:** Pairwise comparisons include a p-value. Only differences with p < 0.05 are considered statistically significant. Results with p = 0.05–0.10 are "suggestive." Results with p > 0.10 are "not distinguishable."

The dashboard displays these as traffic lights: 🟢 Significant | 🟡 Suggestive | 🔴 Not distinguishable.

#### Step 2: Evaluate Primary KPIs (Must-Win Metrics)

These are the metrics that directly measure whether coordination is working. A coordination strategy must perform well on these to be considered effective.

| KPI | What It Tells You | How to Compare | "Good" Threshold |
|-----|-------------------|----------------|-----------------|
| **Decision Contradiction Rate** | Are agents making conflicting choices? | Lower is better. Compare each condition against baseline. | < 10% = excellent, 10-25% = acceptable, > 25% = coordination is failing |
| **Integration Test Pass Rate** | Does the final output actually work? | Higher is better. This is the ultimate quality gate. | > 90% = excellent, 70-90% = usable, < 70% = the coordination strategy is not producing working software |
| **Redundant Work %** | Are agents re-doing each other's work? | Lower is better. This directly measures coordination efficiency. | < 15% = excellent, 15-30% = some waste, > 30% = agents are substantially duplicating effort |
| **Coherence Score** | Does the codebase feel like one person wrote it? | Higher is better (1-5 scale, automated heuristic). | > 4.0 = excellent, 3.0-4.0 = acceptable, < 3.0 = noticeable inconsistency |

**Interpretation rule:** If Twining does not beat the baseline on at least 3 of these 4 metrics with statistical significance, the benchmark does not support the claim that Twining improves coordination.

#### Step 3: Evaluate Efficiency KPIs (Cost of Coordination)

Even if a strategy improves quality, it must do so at a reasonable cost.

| KPI | What It Tells You | How to Compare | "Good" Threshold |
|-----|-------------------|----------------|-----------------|
| **Total Token Consumption** | How expensive is this approach? | Lower is better, BUT only meaningful when quality metrics are comparable. A strategy that uses 50% more tokens but produces 40% fewer contradictions may be worth it. | Compare the "cost per quality point": tokens / composite score. Lower ratio = more efficient. |
| **Time-to-First-Meaningful-Action** | How long does the agent spend orienting before doing useful work? | Lower is better. This measures coordination overhead. | < 5% of session tokens on orientation = excellent. > 20% = the coordination mechanism is expensive to consume. |
| **Coordination Overhead Ratio** | What fraction of total work is "about coordination" vs. "about the task"? | Lower is better. Calculated as: (tokens on reading/writing coordination state) / (total tokens). | < 10% overhead = lean. 10-20% = acceptable. > 20% = coordination mechanism may be too heavy. |

**Interpretation rule:** If a strategy's coordination overhead exceeds 20% AND it doesn't beat simpler strategies on primary KPIs, it is "too expensive for its benefit."

#### Step 4: Evaluate the /clear + File Reload Dimension

This is the key comparison for teams currently using GSD, BMAD, or similar file-based frameworks.

| Comparison | What It Answers |
|-----------|-----------------|
| **File Reload (generic) vs. Baseline** | Does any form of context reload help, or are agents fine with just the codebase? |
| **File Reload (structured) vs. File Reload (generic)** | Does imposing structure on coordination files improve outcomes, or is freeform sufficient? |
| **File Reload (structured) vs. Shared Markdown** | Is the /clear + reload pattern better or worse than continuous context with shared files? This isolates the impact of context rotation. |
| **File Reload (structured) vs. Twining** | Does Twining's dynamic search, graph, and structured tooling outperform structured file-based coordination? This is the key value proposition question for teams already using frameworks. |
| **Twining vs. ALL file-based conditions** | Is there a meaningful gap between the best file-based approach and Twining? If the gap is small, Twining's value prop is primarily convenience. If the gap is large, Twining provides capabilities that files cannot replicate. |

**Interpretation rule:** The dashboard should produce a clear ranking of all 6 conditions per scenario, with pairwise significance tests for adjacent pairs in the ranking. This lets a reader see exactly where each approach falls and whether the differences are real.

#### Step 5: Evaluate Scale Degradation (Scale Stress Test Only)

For the scale stress test scenario, metrics are plotted against scale factor. The key question is: **at what scale does each strategy break down?**

| KPI | What to Look For |
|-----|-----------------|
| **Coherence degradation slope** | A flat line = scales well. A steep drop = breaks down at scale. Compare slopes between conditions. |
| **Orientation overhead growth** | If orientation % grows linearly with scale, the strategy has linear overhead. If it grows super-linearly, it will become prohibitive at scale. |
| **Break point** | The scale factor at which coherence drops below 60% or orientation exceeds 40%. Higher break point = better scalability. |
| **Twining infrastructure metrics** | MCP latency p95 should stay under 500ms. Memory should grow sub-linearly with state size. If either spikes, Twining has a performance bottleneck. |

### 9.2 Composite Score Calculation

Each scenario produces a **Coordination Effectiveness Score (CES)** per condition:

```
CES = (w₁ × contradiction_score) + (w₂ × integration_score) + (w₃ × redundancy_score) + (w₄ × coherence_score) - (w₅ × overhead_penalty)
```

Where:
- `contradiction_score` = 100 - (contradiction_rate × 100)
- `integration_score` = test_pass_rate × 100
- `redundancy_score` = 100 - (redundant_work_% × 100)
- `coherence_score` = (architectural_coherence / 5) × 100
- `overhead_penalty` = max(0, (coordination_overhead_ratio - 0.10)) × 200 (penalty kicks in above 10% overhead)

Default weights: w₁=0.25, w₂=0.30, w₃=0.20, w₄=0.15, w₅=0.10 (configurable per scenario).

The **Overall Twining Efficacy Score** is the average CES advantage of Twining over the best non-Twining condition across all scenarios:

```
Efficacy = mean(CES_twining - max(CES_other_conditions)) across scenarios
```

A positive efficacy score means Twining outperforms all alternatives. The magnitude indicates by how much.

### 9.3 Results Summary Template

The benchmark report (CLI and dashboard) should present a summary in this format:

```
═══════════════════════════════════════════════════════════════
  TWINING BENCHMARK RESULTS — Run 2026-02-20-143052
═══════════════════════════════════════════════════════════════

  VERDICT: Twining outperforms all alternatives by +18.3 points (CES)
  CONFIDENCE: High (p < 0.01, 5 runs, low variance)

  RANKING (by Composite Effectiveness Score):
  ┌────┬──────────────────────────────┬───────┬──────────┐
  │ #  │ Condition                     │  CES  │ vs. Best │
  ├────┼──────────────────────────────┼───────┼──────────┤
  │ 1  │ Full Twining MCP              │ 82.4  │   —      │
  │ 2  │ Structured Framework Reload   │ 64.1  │ -18.3 🟢│
  │ 3  │ Shared Markdown               │ 58.7  │ -23.7 🟢│
  │ 4  │ Generic File Reload           │ 53.2  │ -29.2 🟢│
  │ 5  │ CLAUDE.md Only                │ 41.8  │ -40.6 🟢│
  │ 6  │ No Coordination (Baseline)    │ 28.5  │ -53.9 🟢│
  └────┴──────────────────────────────┴───────┴──────────┘
  🟢 = statistically significant (p < 0.05)
  🟡 = suggestive (p < 0.10)
  🔴 = not distinguishable

  KEY FINDINGS:
  • Twining reduced decision contradictions by 67% vs. baseline
  • Structured file reload closed 58% of the gap between baseline and Twining
  • Context rotation (/clear + reload) was 12% less effective than continuous
    shared markdown — suggesting context window continuity has measurable value
  • At scale factor 3, file-based strategies degraded sharply while Twining
    maintained coherence (break point: file=2.5, Twining=4.2)
```

**Acceptance Criteria:**

- [ ] The results summary template above (or equivalent) is produced by `twining-bench results show`
- [ ] The verdict line states the direction and magnitude of the result
- [ ] The confidence line references p-value, run count, and variance status
- [ ] The ranking table is sorted by CES and includes pairwise significance indicators
- [ ] Key findings are auto-generated from the most significant metric differences
- [ ] The summary is also rendered in the dashboard overview page

---

## 10. Implementation Phases

### Phase 0: Concept Validation (Semi-Automated Pilot)

**Goal:** Validate that the benchmark methodology produces meaningful, differentiable results before building the full harness. Answer the question: "Do coordination conditions actually produce measurably different outcomes, or is LLM variance too noisy to detect a signal?"

**Rationale:** Building a full benchmark harness is a significant investment. Phase 0 de-risks this by running a minimal experiment with lightweight automation. Now that the Claude Agent SDK is confirmed available, Phase 0 can automate agent session execution directly — the human's role is primarily oversight and review, not manual session triggering.

**What's Automated in Phase 0:**

- Repo reset to clean starting state (git checkout)
- Condition environment setup (copy CLAUDE.md, create coordination files, start Twining MCP)
- **Agent session execution via Claude Agent SDK** (`query()` with per-condition `ClaudeAgentOptions`)
- Token usage and transcript capture from SDK streaming output
- Metric collection from git diffs, token counts, and test results
- Statistical comparison of conditions
- Markdown report generation

**What's Manual in Phase 0:**

- Reviewing agent transcripts for qualitative sanity checks (did the agent actually follow instructions?)
- Verifying that the pre-built test repo's scenarios are appropriately calibrated (not too easy/hard)
- Interpreting the results report and deciding go/no-go for Phase 1

**Phase 0 Deliverables:**

1. **`phase0-runner.ts`** — A TypeScript script that:
   - Accepts: `--scenario`, `--condition`, `--runs`
   - Resets the repo to the scenario starting state
   - Sets up the condition environment (files, CLAUDE.md, Twining MCP if applicable)
   - Executes all agent sessions for the scenario sequentially via the Claude Agent SDK
   - Captures git diff, runs tests, collects metrics per session
   - Saves structured results JSON per run

2. **`phase0-analyze.ts`** — A script that:
   - Reads all results from Phase 0 runs
   - Computes all primary KPIs across conditions
   - Produces a markdown report with comparison tables
   - Identifies whether there's a detectable signal (effect size > 0.5) between conditions
   - Estimates variance to determine how many runs Phase 1+ will need
   - Reports cost-per-run for budget planning

3. **Pre-built test repo** — The same repo that will be used in Phase 1, ready for the `refactor-handoff` scenario

4. **Three conditions tested:** Baseline (no coordination), CLAUDE.md only, and Full Twining MCP — the max-contrast comparison

5. **Minimum 3 runs per condition** (9 total runs, approximately 1-2 hours of unattended execution)

**Phase 0 Success Criteria:**

- [ ] `phase0-runner.ts --scenario refactor --condition baseline --runs 3` executes all 6 agent sessions (3 runs × 2 agents) autonomously and produces results JSON
- [ ] Total unattended execution time for all 9 runs (3 conditions × 3 runs) is under 3 hours
- [ ] Human review effort is under 30 minutes (scanning transcripts + reading the report)
- [ ] `phase0-analyze.ts` produces a markdown report comparing conditions on all primary KPIs
- [ ] The report includes effect sizes (Cohen's d) for each KPI comparison
- [ ] The report includes actual cost per run and projected cost for a full Phase 1+ suite
- [ ] At least one primary KPI shows a detectable difference (effect size > 0.5) between Twining and baseline — validating that the methodology can detect a signal
- [ ] If no signal is detected, the report identifies whether this is due to: (a) high LLM variance (need more runs), (b) the scenario not being differentiating enough (need harder scenarios), or (c) Twining genuinely not helping (valuable negative result)
- [ ] Phase 0 results inform Phase 1 decisions: required run count, scenario difficulty calibration, and which KPIs are most differentiating

**Phase 0 Exit Gate:**

Phase 0 must produce one of these outcomes before proceeding to Phase 1:

1. **Green light:** Detectable signal found. Proceed to Phase 1 with methodology validated.
2. **Yellow light:** Marginal signal. Adjust scenarios for more complexity or increase run count, then re-run Phase 0.
3. **Red light:** No signal despite adequate runs. Reassess the benchmark methodology and/or Twining's approach before investing in full automation.

### Phase 1: Foundation (Estimated: 1-2 weeks)

**Deliverables:**

- CLI skeleton with `init`, `run`, `scenarios list`, `conditions list` commands
- Target interface + pre-built synthetic repo
- Condition interface + all 6 conditions implemented (baseline, CLAUDE.md, shared markdown, generic file reload, structured framework reload, full Twining)
- Agent session management (start, monitor, terminate, capture output)
- Basic data collection (git diffs, token counts, timing)

**Exit Criteria:**

- [ ] `twining-bench run --scenario refactor --condition baseline --runs 1` executes end-to-end and produces a results JSON file.

### Phase 2: Scenarios & Scoring (Estimated: 1-2 weeks)

**Deliverables:**

- All 5 scenarios implemented (including scale stress test)
- Automated code analysis (churn, pattern detection, test results)
- LLM-as-judge evaluation framework
- Statistical aggregation
- Composite scoring and KPI interpretation report

**Exit Criteria:**

- [ ] All 5 scenarios produce scored results across all 6 conditions.
- [ ] `twining-bench results show latest` displays the full KPI summary template from Section 9.3.

### Phase 3: Dashboard & Export (Estimated: 1 week)

**Deliverables:**

- Web dashboard with all views (run list, comparison, deep dive, trend)
- Markdown and CSV export
- `twining-bench dashboard` command

**Exit Criteria:**

- [ ] Dashboard renders comparison charts for a completed benchmark suite.
- [ ] Exported Markdown report is publication-ready.

### Phase 4: Advanced Targets & Polish (Estimated: 1 week)

**Deliverables:**

- Programmatic repo generator
- External repo adapter
- `--dry-run`, `reproduce`, `clean` commands
- Resume interrupted suites
- Documentation and contributor guide

**Exit Criteria:**

- [ ] Generated repos produce comparable benchmark results to the pre-built repo.
- [ ] An external repo (e.g., a small open-source TypeScript project) can be used as a target.

---

## 10. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| LLM non-determinism makes results noisy | High | High | Phase 0 validates signal detectability first. Multiple runs per pair, statistical aggregation, seed control, report confidence intervals |
| ~~Claude Code CLI may not support programmatic session management~~ | ~~High~~ | ~~Medium~~ | **RESOLVED.** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) provides full programmatic control with MCP injection, streaming, and structured output. |
| LLM-as-judge evaluation is itself variable | Medium | High | Triple evaluation with median, versioned rubrics, calibration against human-scored examples |
| Token costs for full suite may be high (~5M+ tokens for 6 conditions) | Medium | Medium | Phase 0 estimates costs. Cost estimation in `--dry-run`, budget caps in config, option to run subset of scenarios |
| Twining itself may not be stable enough for benchmarking | Medium | Medium | Phase 0 tests Twining condition. Phase 1 benchmarks use baseline/CLAUDE.md/markdown. Full Twining condition added when stable |
| File-based conditions (GSD/BMAD pattern) are hard to standardise — real frameworks have very different structures | Medium | Medium | Keep the structured condition generic (checklist + handoff + decisions) rather than mimicking a specific framework. Document that it represents the pattern, not a specific tool |
| Scale stress test is expensive and time-consuming | Medium | High | Scale test runs only at explicit request (`--scenario scale-stress`), not included in default "all scenarios" |
| Phase 0 shows no detectable signal | High | Low | This is a valuable result. It either means we need harder scenarios (Yellow), or Twining's benefits don't manifest in these tasks (Red). Either way, it prevents wasted investment |
| Benchmark gaming: optimizing Twining for benchmarks not real use | Low | Low | Scenarios designed from real-world patterns, external repo target as reality check |

---

## 11. Resolved Questions

1. ~~**Claude Code programmatic API:**~~ **RESOLVED.** Claude Code exposes both a CLI headless mode (`claude -p` with `--mcp-config`) and a full Agent SDK (`@anthropic-ai/claude-agent-sdk`) with programmatic MCP server injection, streaming, permission callbacks, and structured output. **Decision: Use the TypeScript Agent SDK** (`@anthropic-ai/claude-agent-sdk`) for all agent session management. The SDK provides `query()` with `ClaudeAgentOptions` supporting inline MCP server definitions, custom system prompts, tool allowlists, and JSON output format — exactly what the harness needs. This eliminates the highest-risk open question.
2. ~~**Cost budgeting:**~~ **RESOLVED.** Claude Pro subscription cannot handle 5-8M token runs (daily limits). **Decision: API-only execution.** At Sonnet 4 rates ($3/MTok input, $15/MTok output), a single full suite run costs roughly $15-60+ depending on input/output mix. The harness must use the Anthropic API directly (not a subscription), with the SDK configured for API access. `--dry-run` must include a cost estimate before execution. A `--budget` flag should set a hard ceiling (default: $100) and abort if projected cost exceeds it.
3. ~~**Comparison publishing:**~~ **RESOLVED.** **Decision: Both.** Summary results in the Twining repo README (badge-style scores + headline findings). Detailed methodology, full results, and interactive dashboard hosted on a separate docs site. The `twining-bench export` command produces both formats.
4. ~~**Community scenarios:**~~ **RESOLVED.** **Decision: Future extension.** The plugin architecture (scenario interface contract) supports community scenarios by design, but the scenario registry, contribution guidelines, and validation pipeline are deferred to a post-v1 milestone.
5. ~~**GSD/BMAD fidelity:**~~ **RESOLVED.** **Decision: Model real patterns from both frameworks.** The structured framework condition (FR-CND-005) is now based on actual GSD and BMAD implementation patterns: fresh subagent contexts, spec-driven PLAN.md files as executable instructions, role-specific agent personas, STATE.md progress tracking, atomic commits, and structured handoff through story/task files. The condition is a faithful synthesis of both frameworks' core coordination patterns, not a generic approximation. Source repos: [GSD](https://github.com/gsd-build/get-shit-done), [BMAD](https://github.com/bmad-code-org/BMAD-METHOD).
6. ~~**Scale test cost:**~~ **RESOLVED.** **Decision: Opt-in only.** The scale stress test is excluded from `--scenario all` and must be explicitly invoked with `--scenario scale-stress`. A reduced-scale version (factor 1-2) is available as `--scenario scale-stress --scale-factor 2` for quick validation. Full scale runs (factor 3-5) are for dedicated benchmarking sessions only, with cost estimates surfaced in `--dry-run`.

---

## 12. Glossary

| Term | Definition |
|---|---|
| **Condition** | A coordination strategy configuration (e.g., baseline, Twining) defining what tools/files agents have access to |
| **Scenario** | A multi-agent task with defined objectives and scoring criteria |
| **Target** | A codebase (real or synthetic) that scenarios operate on |
| **Run** | A single execution of one scenario under one condition |
| **Suite** | A complete benchmark execution across all scenario/condition combinations |
| **Composite Score (CES)** | A weighted aggregate of individual scoring dimensions, used for condition ranking |
| **Ground Truth** | The known-correct architectural decisions and patterns embedded in a target |
| **LLM-as-Judge** | Using a language model to evaluate qualitative aspects of agent outputs |
| **Context Rotation** | The pattern of using `/clear` to reset the context window, then reloading state from files |
| **Break Point** | The scale factor at which a coordination strategy's coherence drops below acceptable thresholds |
| **Orientation Overhead** | Tokens spent by an agent on reading coordination state and orienting, before doing productive work |
| **Efficacy Score** | The CES advantage of Twining over the best non-Twining condition, averaged across scenarios |

---

*This document is the authoritative specification for the Twining Benchmark Harness. Implementation should follow this spec. Any deviations or ambiguities should be raised as issues before proceeding.*
