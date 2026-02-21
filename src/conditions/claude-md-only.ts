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
    const content = this.claudeMdContent ?? this.generateDefaultClaudeMd();
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
