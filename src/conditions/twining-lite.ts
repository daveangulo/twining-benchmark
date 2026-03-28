import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';
import { resolveTwiningPluginPath } from './full-twining.js';

// No custom system prompt — plugin provides all instructions via hooks, skills, and BEHAVIORS.md.
// The allowedTools restriction limits agents to 8 core tools.

/**
 * FR-CND-007: Twining Lite
 *
 * Agents have CLAUDE.md plus the Twining plugin (MCP server) with only 9 core tools:
 * context (assemble), blackboard (post, read, query, recent),
 * decisions (decide, search_decisions), and handoff (handoff, acknowledge).
 *
 * The Twining project directory is isolated per run via --project flag.
 */
export class TwiningLiteCondition extends BaseCondition {
  readonly name: ConditionName = 'twining-lite';
  readonly description =
    'Twining Lite — assemble + core blackboard and decision tools only (9 of 26 tools).';

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
    return {
      systemPrompt: '', // Plugin provides instructions; allowedTools restricts to 8 core tools
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
        // Core Twining tools only (9 of 32) — plugin prefix
        'mcp__plugin_twining_twining__twining_assemble',
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
      '.twining/decisions/index.json',
    ];
  }

  private generateClaudeMdWithTwiningLite(): string {
    return BaseCondition.BASE_CLAUDE_MD;
  }
}
