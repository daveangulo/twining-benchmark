import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

/**
 * FR-CND-001: Baseline (No Coordination)
 *
 * Agents have the codebase and standard CLAUDE.md project guidance.
 * No shared state, no coordination files, no MCP servers.
 * Agents cannot communicate except through code changes committed to the repo.
 */
export class BaselineCondition extends BaseCondition {
  readonly name: ConditionName = 'baseline';
  readonly description =
    'No coordination tools. Agents have the codebase and CLAUDE.md — no shared state, no MCP servers.';

  protected async doSetup(workingDir: string): Promise<string[]> {
    // Strip any .claude directory (coordination state — may contain subdirectories)
    const claudeDir = join(workingDir, '.claude');
    try {
      await rm(claudeDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist — that's fine
    }

    // Write standard CLAUDE.md (same base content as all other conditions)
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    await writeFile(claudeMdPath, BaseCondition.BASE_CLAUDE_MD, 'utf-8');

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
    // Nothing to tear down
    return Promise.resolve();
  }
}
