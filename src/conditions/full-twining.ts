import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

/**
 * Resolve the Twining plugin path.
 * Checks common install locations; falls back to a known cache path.
 */
function resolveTwiningPluginPath(): string {
  const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';

  // Check installed_plugins.json for the actual path
  try {
    const fs = require('node:fs');
    const pluginsFile = join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
    const data = JSON.parse(fs.readFileSync(pluginsFile, 'utf-8'));
    const twiningEntries = data.plugins?.['twining@twining-marketplace'];
    if (twiningEntries && twiningEntries.length > 0) {
      // Prefer user-scoped, fall back to any
      const userEntry = twiningEntries.find((e: any) => e.scope === 'user');
      const entry = userEntry ?? twiningEntries[0];
      if (entry?.installPath) return entry.installPath;
    }
  } catch {
    // Fall through to default
  }

  // Default fallback
  return join(homeDir, '.claude', 'plugins', 'cache', 'twining-marketplace', 'twining', '1.1.4');
}

/**
 * FR-CND-006: Full Twining Plugin
 *
 * Agents have CLAUDE.md plus the Twining plugin loaded via SDK plugin system.
 * The plugin provides: MCP server, skills, hooks, agents, and BEHAVIORS.md —
 * the full infrastructure that guides agents through lifecycle gates.
 *
 * The plugin's MCP server uses --project <cwd> for isolation (set via SDK cwd).
 */
export class FullTwiningCondition extends BaseCondition {
  readonly name: ConditionName = 'full-twining';
  readonly description =
    'Full Twining plugin with skills, hooks, and MCP server — blackboard, decision tracking, knowledge graph, and semantic search.';

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
    return {
      systemPrompt: '', // Plugin provides all instructions via hooks, skills, and BEHAVIORS.md
      mcpServers: {}, // Plugin handles MCP server
      plugins: [
        { type: 'local', path: resolveTwiningPluginPath() },
      ],
      allowedTools: [
        'Read',
        'Edit',
        'Write',
        'Bash',
        'Glob',
        'Grep',
        // All Twining tools (plugin prefix: mcp__plugin_twining_twining__)
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
        'mcp__plugin_twining_twining__twining_agents',
        'mcp__plugin_twining_twining__twining_discover',
        'mcp__plugin_twining_twining__twining_delegate',
        'mcp__plugin_twining_twining__twining_handoff',
        'mcp__plugin_twining_twining__twining_acknowledge',
        'mcp__plugin_twining_twining__twining_dismiss',
        'mcp__plugin_twining_twining__twining_prune_graph',
        'mcp__plugin_twining_twining__twining_register',
        'mcp__plugin_twining_twining__twining_promote',
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
`;
  }
}
