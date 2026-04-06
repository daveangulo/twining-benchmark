import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';
import { resolveTwiningPluginPath } from './full-twining.js';

/**
 * FR-CND-010: Twining Full
 *
 * Agents have CLAUDE.md plus the Twining plugin with the full tool surface enabled
 * via full_surface: true in .twining/config.yml. Exposes all Twining tools including
 * graph operations, verification, advanced search, and multi-agent coordination.
 *
 * Successor to full-twining. Existing full-twining data pools with this condition.
 */
export class TwiningFullCondition extends BaseCondition {
  readonly name: ConditionName = 'twining-full';
  readonly description =
    'Twining Full — all tools enabled via full_surface config (graph, verify, search, coordination).';

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

    // Write .twining/config.yml with full_surface: true
    const twiningDir = join(workingDir, '.twining');
    await mkdir(twiningDir, { recursive: true });
    const configPath = join(twiningDir, 'config.yml');
    const configContent = 'full_surface: true\n';
    await writeFile(configPath, configContent, 'utf-8');
    setupFiles.push('.twining/config.yml');

    return setupFiles;
  }

  protected buildAgentConfig(): AgentConfiguration {
    return {
      systemPrompt: TwiningFullCondition.TWINING_SYSTEM_PROMPT,
      mcpServers: {
        twining: {
          command: 'npx',
          args: ['-y', 'twining-mcp', '--project', this.projectDir || '.'],
        },
      },
      plugins: [
        { type: 'local', path: resolveTwiningPluginPath() },
      ],
      // No allowedTools restriction — full_surface config exposes all tools
      // and we don't want to hardcode the tool list since it may grow
      allowedTools: [],
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
      '.twining/config.yml',
      '.twining/blackboard.jsonl',
      '.twining/decisions/index.json',
      '.twining/graph/entities.json',
      '.twining/graph/relations.json',
    ];
  }

  private static readonly TWINING_SYSTEM_PROMPT = `You have Twining MCP tools for persistent project coordination. Use them:
- BEFORE work: call twining_assemble with your task description and scope
- AFTER decisions/work: call twining_record summarizing your work and any choices you made
- BEFORE completing: call twining_verify on your scope
- MID-SESSION warnings: call twining_post for findings or warnings
These tools persist across sessions. The next agent benefits from what you record.`;
}
