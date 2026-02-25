import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration, McpServerConfig } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

const TWINING_SYSTEM_PROMPT = `You have access to Twining, a coordination MCP server for multi-agent workflows.
Follow the Twining workflow documented in CLAUDE.md for this project.`;

/**
 * FR-CND-006: Full Twining MCP
 *
 * Agents have CLAUDE.md plus a fully configured Twining MCP server with all
 * capabilities: blackboard, decision tracking, knowledge graph, and semantic search.
 *
 * The Twining data directory is isolated per run.
 */
export class FullTwiningCondition extends BaseCondition {
  readonly name: ConditionName = 'full-twining';
  readonly description =
    'Full Twining MCP server with blackboard, decision tracking, knowledge graph, and semantic search.';

  private twiningDataDir = '';

  constructor(private readonly claudeMdContent?: string) {
    super();
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const setupFiles: string[] = [];

    // Create isolated Twining data directory for this run
    this.twiningDataDir = join(workingDir, '.twining');
    await mkdir(this.twiningDataDir, { recursive: true });

    // Write CLAUDE.md with Twining instructions
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    const content =
      this.claudeMdContent ?? this.generateClaudeMdWithTwining();
    await writeFile(claudeMdPath, content, 'utf-8');
    setupFiles.push('CLAUDE.md');

    return setupFiles;
  }

  protected buildAgentConfig(): AgentConfiguration {
    const twiningServer: McpServerConfig = {
      command: 'npx',
      args: ['-y', 'twining-mcp'],
      env: {
        TWINING_DATA_DIR: this.twiningDataDir,
        TWINING_DASHBOARD: '0', // Disable dashboard during benchmarks
      },
    };

    return {
      systemPrompt: TWINING_SYSTEM_PROMPT,
      mcpServers: {
        twining: twiningServer,
      },
      allowedTools: [
        'Read',
        'Edit',
        'Write',
        'Bash',
        'Glob',
        'Grep',
        // All Twining tools
        'mcp__twining__twining_post',
        'mcp__twining__twining_read',
        'mcp__twining__twining_query',
        'mcp__twining__twining_recent',
        'mcp__twining__twining_decide',
        'mcp__twining__twining_why',
        'mcp__twining__twining_trace',
        'mcp__twining__twining_reconsider',
        'mcp__twining__twining_override',
        'mcp__twining__twining_search_decisions',
        'mcp__twining__twining_link_commit',
        'mcp__twining__twining_commits',
        'mcp__twining__twining_assemble',
        'mcp__twining__twining_summarize',
        'mcp__twining__twining_what_changed',
        'mcp__twining__twining_add_entity',
        'mcp__twining__twining_add_relation',
        'mcp__twining__twining_neighbors',
        'mcp__twining__twining_graph_query',
        'mcp__twining__twining_verify',
        'mcp__twining__twining_status',
        'mcp__twining__twining_archive',
        'mcp__twining__twining_export',
        // Agent coordination tools
        'mcp__twining__twining_agents',
        'mcp__twining__twining_discover',
        'mcp__twining__twining_delegate',
        'mcp__twining__twining_handoff',
        'mcp__twining__twining_acknowledge',
      ],
      permissionMode: 'acceptEdits',
    };
  }

  protected override async doTeardown(): Promise<void> {
    // Clean up the Twining data directory
    if (this.twiningDataDir) {
      try {
        await rm(this.twiningDataDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    this.twiningDataDir = '';
  }

  protected override getCoordinationFilePaths(): string[] {
    return [
      'CLAUDE.md',
      '.twining/blackboard.jsonl',
      '.twining/decisions.jsonl',
      '.twining/graph.json',
    ];
  }

  private generateClaudeMdWithTwining(): string {
    return `# Project Guidelines

## Architecture
- This project follows the repository pattern for data access
- Services depend on repositories, never on each other directly
- Events are preferred over direct cross-service calls for decoupling
- All business logic lives in the service layer

## Coding Conventions
- Use TypeScript strict mode — no \`any\` types
- All public methods must have JSDoc comments
- Use dependency injection via constructor parameters
- Error handling: throw typed errors, never return null for errors
- Prefer async/await over raw Promises

## Testing
- Tests use vitest
- Each module has a corresponding test file in tests/
- Mock external dependencies, test business logic directly
- Minimum: test the happy path and one error path per public method

## File Organization
- src/models/ — Data models and interfaces
- src/repositories/ — Data access layer (implements repository interfaces)
- src/services/ — Business logic layer
- src/events/ — Event definitions and event bus
- src/utils/ — Shared utilities (database, logger, pagination)
- src/config/ — Configuration files
- tests/ — Test files mirroring src/ structure

## Git Practices
- Commit atomically per logical change
- Write descriptive commit messages explaining the "why"
- Run tests before committing

---

## Twining Integration

This project uses [Twining](https://github.com/twining-mcp/twining-mcp) for shared agent coordination. All agents must follow these practices.

### Setup

Twining is configured as an MCP server. On first use it creates \`.twining/\` with default config. State is plain-text, git-diffable, and \`jq\`-queryable.

### Core Workflow: Think Before Acting, Decide After Acting

#### Before modifying code:
1. Call \`twining_assemble\` with your task description and scope to get relevant decisions, warnings, needs, and graph entities within a token budget
2. Call \`twining_why\` on the file/module you're about to change to understand prior decision rationale
3. Check for \`warning\` entries in your scope — these are gotchas left by previous agents

#### While working:
- Post \`finding\` entries for anything surprising or noteworthy
- Post \`warning\` entries for gotchas the next agent should know about
- Post \`need\` entries for follow-up work you identify but won't do now
- Post \`status\` entries for progress updates on long-running work

#### After making significant changes:
- Call \`twining_decide\` for any architectural or non-trivial choice — always include rationale and at least one rejected alternative
- Post a \`status\` entry summarizing what you did
- Use \`twining_link_commit\` to associate decisions with git commits

#### Before handing off or completing work:
- Call \`twining_verify\` to check test coverage, unresolved warnings, drift, and assembly hygiene
- For decisions affecting testable code, link tests via \`twining_add_relation\` with \`type: "tested_by"\`
- Address or explicitly acknowledge any warnings surfaced during assembly

### Blackboard Entry Types

Use the right type for each post:

| Type | When to use |
|------|-------------|
| \`finding\` | Something discovered that others should know |
| \`warning\` | A gotcha, risk, or "don't do X because Y" |
| \`need\` | Work that should be done by someone |
| \`question\` | Something you need answered (another agent may respond) |
| \`answer\` | Response to a question (use \`relates_to\` to link to the question ID) |
| \`status\` | Progress update on work in progress |
| \`offer\` | Capability or resource you can provide |
| \`artifact\` | Reference to a produced artifact (schema, export, doc) |
| \`constraint\` | A hard requirement or limitation that must be respected |

**Important:** Do NOT use \`twining_post\` with \`entry_type: "decision"\`. Use \`twining_decide\` instead, which captures rationale, detects conflicts, populates the knowledge graph, and enables full traceability.

### Decision Conventions

**Confidence levels:**
- \`high\` — Well-researched, strong rationale, tested or proven
- \`medium\` — Reasonable choice, some uncertainty remains
- \`low\` — Best guess, needs validation, may be revised

**Domains** (use consistently): \`architecture\`, \`implementation\`, \`testing\`, \`deployment\`, \`security\`, \`performance\`, \`api-design\`, \`data-model\`

**Provisional decisions** are flagged for review. Always check decision status before relying on a provisional decision. Use \`twining_reconsider\` to flag a decision for re-evaluation with new context.

### Verification and Rigor

The verification step ensures decisions are backed by evidence and code hasn't drifted from documented intent.

#### Decision-to-Test Traceability

Link tests to decisions to create an evidence trail:

\`\`\`
# After recording the decision
twining_decide(
  domain="implementation",
  scope="src/auth/",
  summary="Use JWT for stateless auth",
  affected_files=["src/auth/middleware.ts"],
  ...
)

# After writing the test
twining_add_relation(
  source="src/auth/middleware.ts",
  target="test/auth.test.ts",
  type="tested_by",
  properties={ covers: "JWT middleware validation" }
)
\`\`\`

The \`twining_verify\` tool checks for decisions without \`tested_by\` relations and flags them for review.

#### Decision Conflict Detection

When \`twining_decide\` detects a conflict (same domain + overlapping scope + active status):

1. **The new decision is recorded normally** — decisions are never blocked by conflicts
2. **A warning is auto-posted to the blackboard** linking both decision IDs via \`relates_to\`
3. **Conflict metadata is recorded** on the new decision: \`conflicts_with: [existing_id]\`
4. **Both decisions remain active** until explicitly resolved

Resolution requires explicit action:
- Use \`twining_override\` to replace one decision (sets it to \`overridden\`, optionally creates replacement)
- Use \`twining_reconsider\` to flag one for review (sets to \`provisional\`)

Conflicts surface in the next \`twining_assemble\` call as high-priority warnings. This design ensures conflicts are **loud** (visible in assembled context) without blocking agent progress.

#### Drift Detection

Decisions capture intent at a point in time. Code evolves. When a file listed in \`affected_files\` is modified after the decision timestamp without a superseding decision, that's **drift** — the documented rationale no longer matches reality.

\`twining_verify\` compares decision timestamps against git history for affected files and flags stale decisions. Drift doesn't block work — it surfaces as a warning in the next agent's assembled context.

#### Checkable Constraints

Some constraints can be mechanically verified. Use the structured format:

\`\`\`
twining_post(
  entry_type="constraint",
  summary="No direct fs calls outside storage/",
  detail='{"check_command": "grep -r \\\\"import.*node:fs\\\\" src/ --include=\\\\"*.ts\\\\" | grep -v storage/ | wc -l", "expected": "0"}',
  scope="src/"
)
\`\`\`

The \`twining_verify\` tool executes \`check_command\` (sandboxed to project directory) and compares output against \`expected\`.

#### Assembly-Before-Decision Tracking

If an agent calls \`twining_decide\` without having called \`twining_assemble\` in the same session, the decision was made without shared context. It might still be correct — but it was made blind.

\`twining_verify\` checks for "blind decisions" (decisions made without prior context assembly) and flags them.

### Scope Conventions

Scopes use path-prefix semantics:
- \`"project"\` — matches everything (broadest, use sparingly)
- \`"src/auth/"\` — matches anything under the auth module
- \`"src/auth/jwt.ts"\` — matches a specific file

Use the narrowest scope that fits. \`"project"\` scope entries are always included in assembly results, so don't overuse it.

### Tool Quick Reference

#### Blackboard (shared communication)
| Tool | Purpose |
|------|---------|
| \`twining_post\` | Share findings, warnings, needs, questions, answers, status, offers, artifacts, constraints |
| \`twining_read\` | Read entries with filters (type, scope, tags, since, limit) |
| \`twining_query\` | Semantic search across entries (embeddings with keyword fallback) |
| \`twining_recent\` | Latest N entries, most recent first |

#### Decisions (structured rationale)
| Tool | Purpose |
|------|---------|
| \`twining_decide\` | Record a choice with rationale, alternatives, affected files/symbols, confidence |
| \`twining_why\` | Show decision chain for a file/module/scope |
| \`twining_trace\` | Trace decision dependencies upstream and downstream |
| \`twining_reconsider\` | Flag a decision for review with new context |
| \`twining_override\` | Replace a decision, recording who and why |
| \`twining_search_decisions\` | Search decisions by keyword, domain, status, confidence |
| \`twining_link_commit\` | Link a git commit to a decision |
| \`twining_commits\` | Find decisions associated with a commit |

#### Context Assembly
| Tool | Purpose |
|------|---------|
| \`twining_assemble\` | Build tailored context for a task within a token budget |
| \`twining_summarize\` | Quick project overview with counts and activity narrative |
| \`twining_what_changed\` | Changes since a timestamp (decisions, entries, overrides) |

#### Knowledge Graph
| Tool | Purpose |
|------|---------|
| \`twining_add_entity\` | Record a code entity (module, function, class, file, concept, pattern, dependency, api_endpoint) |
| \`twining_add_relation\` | Record a relationship (depends_on, implements, decided_by, affects, tested_by, calls, imports, related_to) |
| \`twining_neighbors\` | Explore entity connections up to depth 3 |
| \`twining_graph_query\` | Search entities by name or property |

Note: \`twining_decide\` auto-creates \`file\`/\`function\` entities with \`decided_by\` relations for \`affected_files\` and \`affected_symbols\`. Manual graph calls are for richer structure (imports, calls, implements).

#### Agent Coordination
| Tool | Purpose |
|------|---------|
| \`twining_agents\` | List registered agents with capabilities and liveness |
| \`twining_discover\` | Find agents matching capabilities, ranked by overlap and liveness |
| \`twining_delegate\` | Post a delegation request with capability requirements |
| \`twining_handoff\` | Hand off work with results and auto-assembled context snapshot |
| \`twining_acknowledge\` | Accept a handoff |

#### Verification
| Tool | Purpose |
|------|---------|
| \`twining_verify\` | Check test coverage, unresolved warnings, drift, assembly hygiene, and checkable constraints for a scope |

#### Lifecycle
| Tool | Purpose |
|------|---------|
| \`twining_status\` | Health check — entry counts, decision counts, graph stats, warnings |
| \`twining_archive\` | Archive old entries to reduce working set (preserves decisions) |
| \`twining_export\` | Export full state as markdown for context window handoff or docs |

### Multi-Agent Patterns

#### Delegation
\`\`\`
# Identify what capabilities are needed
twining_discover(required_capabilities=["database", "postgresql"])

# Post a delegation request — returns suggested agents
twining_delegate(
  summary="Optimize slow user query",
  required_capabilities=["database"],
  urgency="high"
)
\`\`\`

#### Handoff (passing work between agents)
\`\`\`
# Agent A verifies work before handing off
twining_verify(scope="src/auth/", checks=["test_coverage", "warnings"])

# Agent A completes partial work
twining_handoff(
  source_agent="agent-a",
  target_agent="agent-b",
  summary="Auth refactoring — middleware done, routes remaining",
  results=[
    {description: "Extracted JWT middleware", status: "completed"},
    {description: "Route handler migration", status: "partial"}
  ]
)
# Context snapshot is auto-assembled from relevant decisions and warnings

# Agent B picks it up
twining_acknowledge(handoff_id="...", agent_id="agent-b")
\`\`\`

#### Context Window Handoff
When approaching context limits, use \`twining_export\` to produce a self-contained markdown document with all decisions, entries, and graph state for a scope. Start a new conversation and provide the export as context.

### Anti-patterns

- **Don't skip \`twining_assemble\` before starting work.** You'll miss decisions, warnings, and context that prevent wasted effort. Making decisions without context creates "blind decisions" that may conflict with existing work.
- **Don't skip \`twining_verify\` before handoff.** Call it to catch uncovered decisions, unresolved warnings, drift, and blind decisions before passing work to the next agent.
- **Don't use \`"project"\` scope for everything.** Narrow scopes make assembly relevant and reduce noise.
- **Don't record trivial decisions.** Variable renames don't need decision records. Reserve for choices with alternatives and tradeoffs.
- **Don't make decisions without test coverage** (when applicable). Link tests via \`tested_by\` relations to create an evidence trail.
- **Don't ignore conflict warnings.** When \`twining_decide\` detects a conflict, investigate and resolve explicitly via \`twining_override\` or \`twining_reconsider\`.
- **Don't forget \`relates_to\`.** Link answers to questions, warnings to decisions, conflict resolutions to conflicting decisions.
- **Don't use \`twining_post\` for decisions.** Always use \`twining_decide\`.

### Dashboard

The web dashboard runs on port 24282 by default with read-only views of blackboard, decisions, knowledge graph, and agents. Configure with environment variables:
- \`TWINING_DASHBOARD=0\` — disable entirely
- \`TWINING_DASHBOARD_NO_OPEN=1\` — prevent auto-opening browser
- \`TWINING_DASHBOARD_PORT=<port>\` — change the port
`;
  }
}
