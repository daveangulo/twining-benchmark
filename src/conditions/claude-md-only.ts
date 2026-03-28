import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

/**
 * FR-CND-002: CLAUDE.md Only
 *
 * Agents have the codebase plus a CLAUDE.md file with project conventions
 * and instructions, but no shared runtime state.
 */
export class ClaudeMdOnlyCondition extends BaseCondition {
  readonly name: ConditionName = 'claude-md-only';
  readonly description =
    'CLAUDE.md with project conventions and instructions. No shared state or MCP servers.';

  /**
   * Generates a scenario-appropriate CLAUDE.md.
   * Can be overridden per scenario by passing content to the constructor.
   */
  constructor(private readonly claudeMdContent?: string) {
    super();
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    const content = this.claudeMdContent ?? BaseCondition.BASE_CLAUDE_MD;
    await writeFile(claudeMdPath, content, 'utf-8');
    return ['CLAUDE.md'];
  }

  protected buildAgentConfig(): AgentConfiguration {
    return {
      systemPrompt: '',
      mcpServers: {},
      allowedTools: [
        'Read',
        'Edit',
        'Write',
        'Bash',
        'Glob',
        'Grep',
      ],
      permissionMode: 'acceptEdits',
    };
  }

  protected override doTeardown(): Promise<void> {
    return Promise.resolve();
  }

  protected override getCoordinationFilePaths(): string[] {
    return ['CLAUDE.md'];
  }

}
