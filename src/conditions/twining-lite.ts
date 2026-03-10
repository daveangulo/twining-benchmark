import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

const TWINING_LITE_SYSTEM_PROMPT = `You have access to Twining Lite, a coordination plugin with core blackboard and decision tools.

Follow these coordination steps:

**Before starting work:**
1. Call twining_query to check for context from prior agents

**While working:**
2. Call twining_decide for any architectural or implementation choice where alternatives exist
3. Call twining_post with entry_type "finding" for discoveries, "warning" for gotchas

**Before finishing:**
4. Call twining_post with entry_type "status" summarizing what you accomplished
5. Call twining_handoff with your results for the next agent`;

/**
 * FR-CND-007: Twining Lite
 *
 * Agents have CLAUDE.md plus the Twining plugin (MCP server) with only 8 core tools:
 * blackboard (post, read, query, recent), decisions (decide, search_decisions),
 * and handoff (handoff, acknowledge).
 *
 * The Twining project directory is isolated per run via --project flag.
 */
export class TwiningLiteCondition extends BaseCondition {
  readonly name: ConditionName = 'twining-lite';
  readonly description =
    'Twining Lite — core blackboard and decision tools only (8 of 26 tools).';

  private projectDir = '';

  constructor(private readonly claudeMdContent?: string) {
    super();
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const setupFiles: string[] = [];

    // Use the working directory as the Twining project directory for isolation
    this.projectDir = workingDir;

    // Write CLAUDE.md with Twining Lite instructions
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    const content =
      this.claudeMdContent ?? this.generateClaudeMdWithTwiningLite();
    await writeFile(claudeMdPath, content, 'utf-8');
    setupFiles.push('CLAUDE.md');

    return setupFiles;
  }

  protected buildAgentConfig(): AgentConfiguration {
    // Reuse same plugin path resolution as full-twining
    const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
    let pluginPath: string;
    try {
      const fs = require('node:fs');
      const pluginsFile = join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
      const data = JSON.parse(fs.readFileSync(pluginsFile, 'utf-8'));
      const entries = data.plugins?.['twining@twining-marketplace'];
      const userEntry = entries?.find((e: any) => e.scope === 'user');
      const entry = userEntry ?? entries?.[0];
      pluginPath = entry?.installPath ?? join(homeDir, '.claude', 'plugins', 'cache', 'twining-marketplace', 'twining', '1.1.4');
    } catch {
      pluginPath = join(homeDir, '.claude', 'plugins', 'cache', 'twining-marketplace', 'twining', '1.1.4');
    }

    return {
      systemPrompt: TWINING_LITE_SYSTEM_PROMPT,
      mcpServers: {}, // Plugin handles MCP server
      plugins: [
        { type: 'local', path: pluginPath },
      ],
      allowedTools: [
        'Read',
        'Edit',
        'Write',
        'Bash',
        'Glob',
        'Grep',
        // Core Twining tools only (8 of 32) — plugin prefix
        'mcp__plugin_twining_twining__twining_post',
        'mcp__plugin_twining_twining__twining_read',
        'mcp__plugin_twining_twining__twining_query',
        'mcp__plugin_twining_twining__twining_recent',
        'mcp__plugin_twining_twining__twining_decide',
        'mcp__plugin_twining_twining__twining_search_decisions',
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
    ];
  }

  private generateClaudeMdWithTwiningLite(): string {
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

## Twining Lite Integration

This project uses Twining Lite for lightweight agent coordination.
You have access to the following 8 Twining tools:

### Blackboard Tools
- \`twining_post\` — Post entries (findings, warnings, status updates)
- \`twining_read\` — Read specific blackboard entries
- \`twining_query\` — Query the blackboard for context
- \`twining_recent\` — Get recent blackboard entries

### Decision Tools
- \`twining_decide\` — Record architectural/implementation decisions
- \`twining_search_decisions\` — Search past decisions

### Handoff Tools
- \`twining_handoff\` — Hand off work to the next agent
- \`twining_acknowledge\` — Acknowledge a handoff from a prior agent

### Workflow
1. **Before work:** Call \`twining_query\` to check for prior context
2. **During work:** Use \`twining_decide\` for choices, \`twining_post\` for findings/warnings
3. **After work:** Post a status summary and call \`twining_handoff\`
`;
  }
}
