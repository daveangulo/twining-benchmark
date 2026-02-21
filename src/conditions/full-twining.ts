import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration, McpServerConfig } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

const TWINING_SYSTEM_PROMPT = `You have access to Twining, a coordination MCP server for multi-agent workflows.

## Before starting work:
1. Call twining_assemble with your task description and scope to get relevant context
2. Call twining_why on files you're about to change to understand prior decisions
3. Check for warning entries in your scope

## While working:
- Post finding entries for anything surprising
- Post warning entries for gotchas the next agent should know
- Post need entries for follow-up work you identify but won't do now

## After making significant changes:
- Call twining_decide for any architectural or non-trivial choice
- Post a status entry summarizing what you did
- Link tests to decisions via twining_add_relation with type "tested_by"

## Before finishing:
- Call twining_verify on your scope to check coverage and warnings
- Post a final status entry summarizing your session`;

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
        'mcp__twining__twining_export',
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
    return ['CLAUDE.md'];
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

## Twining Coordination
This project uses Twining for multi-agent coordination.

### Before starting work:
1. Call \`twining_assemble\` with your task and scope to get context from previous agents
2. Call \`twining_why\` on files/modules you plan to modify
3. Check for \`warning\` entries in your scope

### While working:
- Post \`finding\` entries for surprising discoveries
- Post \`warning\` entries for gotchas
- Post \`need\` entries for follow-up work

### After making changes:
- Call \`twining_decide\` for significant architectural choices (include rationale + alternatives)
- Post a \`status\` entry summarizing your work
- Link tests to decisions via \`twining_add_relation\` with type \`tested_by\`

### Before finishing:
- Call \`twining_verify\` to check coverage, warnings, and drift

## Testing
- Tests use vitest
- Each module has a corresponding test file in tests/
- Run tests before committing

## Git Practices
- Commit atomically per logical change
- Write descriptive commit messages
`;
  }
}
