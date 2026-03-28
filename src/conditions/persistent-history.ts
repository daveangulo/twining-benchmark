import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

/**
 * Persistent History Condition
 *
 * Agents share conversation context rather than starting fresh.
 * Each subsequent agent receives the accumulated conversation history
 * from all previous agents as a prompt prefix.
 *
 * No coordination files or MCP servers — context is passed entirely
 * through conversation history accumulation.
 */
export class PersistentHistoryCondition extends BaseCondition {
  readonly name: ConditionName = 'persistent-history';
  readonly description =
    'Agents share conversation context via accumulated history. No coordination files or MCP servers.';

  protected async doSetup(workingDir: string): Promise<string[]> {
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    await writeFile(claudeMdPath, this.generateDefaultClaudeMd(), 'utf-8');
    return ['CLAUDE.md'];
  }

  protected buildAgentConfig(): AgentConfiguration {
    return {
      systemPrompt:
        'This is a continuous session. You can see the full conversation history from previous developers who worked on this codebase. Review what they did before starting your work.',
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
      persistHistory: true,
    };
  }

  protected override doTeardown(): Promise<void> {
    return Promise.resolve();
  }

  protected override getCoordinationFilePaths(): string[] {
    return [];
  }

  private generateDefaultClaudeMd(): string {
    return BaseCondition.BASE_CLAUDE_MD;
  }
}
