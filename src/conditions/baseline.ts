import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

/**
 * FR-CND-001: Baseline (No Coordination)
 *
 * Agents have access only to the codebase itself.
 * No shared state, no CLAUDE.md, no coordination files.
 * Agents cannot communicate except through code changes committed to the repo.
 */
export class BaselineCondition extends BaseCondition {
  readonly name: ConditionName = 'baseline';
  readonly description =
    'No coordination. Agents have only the codebase — no CLAUDE.md, no shared files, no MCP servers.';

  protected async doSetup(workingDir: string): Promise<string[]> {
    // Strip any CLAUDE.md that might exist in the repo
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    try {
      await unlink(claudeMdPath);
    } catch {
      // File doesn't exist — that's fine
    }

    // Also strip any .claude directory
    const claudeDir = join(workingDir, '.claude');
    try {
      const entries = await readdir(claudeDir);
      for (const entry of entries) {
        await unlink(join(claudeDir, entry));
      }
    } catch {
      // Directory doesn't exist — that's fine
    }

    return [];
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
    // Nothing to tear down
    return Promise.resolve();
  }
}
