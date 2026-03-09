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
