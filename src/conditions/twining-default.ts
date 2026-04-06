import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';
import { resolveTwiningPluginPath } from './full-twining.js';

/**
 * FR-CND-009: Twining Default
 *
 * Agents have CLAUDE.md plus the Twining plugin with the default 5-tool surface:
 * twining_assemble, twining_record, twining_post, twining_why, twining_housekeeping.
 *
 * No config override needed — the plugin defaults to this surface when
 * full_surface is not set in .twining/config.yml.
 *
 * Successor to twining-lite. Existing twining-lite data pools with this condition.
 */
export class TwiningDefaultCondition extends BaseCondition {
  readonly name: ConditionName = 'twining-default';
  readonly description =
    'Twining Default — 5-tool surface (assemble, record, post, why, housekeeping).';

  private projectDir = '';

  constructor(private readonly claudeMdContent?: string) {
    super();
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const setupFiles: string[] = [];

    this.projectDir = workingDir;

    // Write CLAUDE.md — plugin injects lifecycle gates via SessionStart hook
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    const content = this.claudeMdContent ?? BaseCondition.BASE_CLAUDE_MD;
    await writeFile(claudeMdPath, content, 'utf-8');
    setupFiles.push('CLAUDE.md');

    return setupFiles;
  }

  protected buildAgentConfig(): AgentConfiguration {
    return {
      systemPrompt: TwiningDefaultCondition.TWINING_SYSTEM_PROMPT,
      mcpServers: {
        twining: {
          command: 'npx',
          args: ['-y', 'twining-mcp', '--project', this.projectDir || '.'],
        },
      },
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
        // Default 5-tool Twining surface
        'mcp__plugin_twining_twining__twining_assemble',
        'mcp__plugin_twining_twining__twining_record',
        'mcp__plugin_twining_twining__twining_post',
        'mcp__plugin_twining_twining__twining_why',
        'mcp__plugin_twining_twining__twining_housekeeping',
      ],
      permissionMode: 'acceptEdits',
    };
  }

  protected override async doTeardown(): Promise<void> {
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

  private static readonly TWINING_SYSTEM_PROMPT = `You have Twining MCP tools for persistent project coordination. Use them:
- BEFORE work: call twining_assemble with your task description and scope
- AFTER decisions/work: call twining_record summarizing your work and any choices you made
- MID-SESSION warnings: call twining_post for findings or warnings
These tools persist across sessions. The next agent benefits from what you record.`;
}
