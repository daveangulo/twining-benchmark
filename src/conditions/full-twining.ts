import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration, McpServerConfig } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

const TWINING_SYSTEM_PROMPT = `You have access to Twining, a coordination plugin for multi-agent workflows.

Follow the Twining lifecycle gates for every task:

**Before starting work:**
1. Call twining_assemble with your task description to get context from prior agents
2. Call twining_why on any files you plan to modify to understand prior decisions

**While working:**
3. Call twining_decide for any architectural or implementation choice where alternatives exist — include rationale and at least one rejected alternative
4. Call twining_post with entry_type "finding" for discoveries, "warning" for gotchas you encounter

**Before finishing:**
5. Call twining_verify on your scope to check for unresolved issues
6. Call twining_post with entry_type "status" summarizing what you accomplished
7. Call twining_handoff with your results so the next agent can pick up where you left off`;

/**
 * FR-CND-006: Full Twining Plugin
 *
 * Agents have CLAUDE.md plus the Twining plugin (MCP server, skills, hooks)
 * with all capabilities: blackboard, decision tracking, knowledge graph, and semantic search.
 *
 * The Twining project directory is isolated per run via --project flag.
 */
export class FullTwiningCondition extends BaseCondition {
  readonly name: ConditionName = 'full-twining';
  readonly description =
    'Full Twining MCP server with blackboard, decision tracking, knowledge graph, and semantic search.';

  private projectDir = '';

  constructor(private readonly claudeMdContent?: string) {
    super();
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const setupFiles: string[] = [];

    // Use the working directory as the Twining project directory for isolation
    this.projectDir = workingDir;

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
      args: ['-y', 'twining-mcp', '--project', this.projectDir],
      env: {
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
        'mcp__plugin_twining_twining__twining_post',
        'mcp__plugin_twining_twining__twining_read',
        'mcp__plugin_twining_twining__twining_query',
        'mcp__plugin_twining_twining__twining_recent',
        'mcp__plugin_twining_twining__twining_decide',
        'mcp__plugin_twining_twining__twining_why',
        'mcp__plugin_twining_twining__twining_trace',
        'mcp__plugin_twining_twining__twining_reconsider',
        'mcp__plugin_twining_twining__twining_override',
        'mcp__plugin_twining_twining__twining_search_decisions',
        'mcp__plugin_twining_twining__twining_link_commit',
        'mcp__plugin_twining_twining__twining_commits',
        'mcp__plugin_twining_twining__twining_assemble',
        'mcp__plugin_twining_twining__twining_summarize',
        'mcp__plugin_twining_twining__twining_what_changed',
        'mcp__plugin_twining_twining__twining_add_entity',
        'mcp__plugin_twining_twining__twining_add_relation',
        'mcp__plugin_twining_twining__twining_neighbors',
        'mcp__plugin_twining_twining__twining_graph_query',
        'mcp__plugin_twining_twining__twining_verify',
        'mcp__plugin_twining_twining__twining_status',
        'mcp__plugin_twining_twining__twining_archive',
        'mcp__plugin_twining_twining__twining_export',
        // Agent coordination tools
        'mcp__plugin_twining_twining__twining_agents',
        'mcp__plugin_twining_twining__twining_discover',
        'mcp__plugin_twining_twining__twining_delegate',
        'mcp__plugin_twining_twining__twining_handoff',
        'mcp__plugin_twining_twining__twining_acknowledge',
      ],
      permissionMode: 'acceptEdits',
    };
  }

  protected override async doTeardown(): Promise<void> {
    // Clean up the .twining directory created by the MCP server
    if (this.projectDir) {
      try {
        await rm(join(this.projectDir, '.twining'), { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    this.projectDir = '';
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

This project uses the Twining plugin for structured agent coordination.

### Mandatory Lifecycle Gates

**Before work:** Call \`twining_assemble\` with your task and scope to get decisions, warnings, and context from prior agents. Call \`twining_why\` on files you plan to modify.

**During work:** Call \`twining_decide\` for any choice where alternatives exist. Call \`twining_post\` with entry_type "finding" or "warning" as you discover things.

**Before finishing:** Call \`twining_verify\` on your scope. Call \`twining_post\` with entry_type "status" summarizing your work. Call \`twining_handoff\` with results for the next agent.

### Available Tools
- **Context:** twining_assemble, twining_why, twining_what_changed
- **Decisions:** twining_decide, twining_search_decisions, twining_trace
- **Blackboard:** twining_post, twining_read, twining_query, twining_recent
- **Coordination:** twining_handoff, twining_acknowledge, twining_agents
- **Verification:** twining_verify, twining_status
- **Knowledge Graph:** twining_add_entity, twining_add_relation, twining_neighbors
`;
  }
}
