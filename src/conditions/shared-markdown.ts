import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

const COORDINATION_TEMPLATE = `# Coordination Log

Use this file to share decisions, status updates, and context with other agents.
Write your updates below. There is no enforced format — use whatever structure helps.

---

`;

/**
 * FR-CND-003: Manual Shared Markdown
 *
 * Agents have CLAUDE.md plus a shared COORDINATION.md file they can read and
 * write to. Simulates ad-hoc coordination without tooling.
 * No structured format is enforced — agents write freeform markdown.
 */
export class SharedMarkdownCondition extends BaseCondition {
  readonly name: ConditionName = 'shared-markdown';
  readonly description =
    'CLAUDE.md plus shared COORDINATION.md for freeform agent notes. No search, indexing, or graph capabilities.';

  constructor(private readonly claudeMdContent?: string) {
    super();
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const setupFiles: string[] = [];

    // Write CLAUDE.md with coordination instructions
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    const claudeContent =
      this.claudeMdContent ?? this.generateClaudeMdWithCoordination();
    await writeFile(claudeMdPath, claudeContent, 'utf-8');
    setupFiles.push('CLAUDE.md');

    // Write COORDINATION.md with template header
    const coordPath = join(workingDir, 'COORDINATION.md');
    await writeFile(coordPath, COORDINATION_TEMPLATE, 'utf-8');
    setupFiles.push('COORDINATION.md');

    return setupFiles;
  }

  protected buildAgentConfig(): AgentConfiguration {
    return {
      systemPrompt:
        'Before starting work, read COORDINATION.md to see context from previous agents. ' +
        'After completing your work, update COORDINATION.md with: what you did, key decisions ' +
        'you made, and any context the next agent should know.',
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
    return ['CLAUDE.md', 'COORDINATION.md'];
  }

  private generateClaudeMdWithCoordination(): string {
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

## Coordination
- Read COORDINATION.md before starting any work
- Update COORDINATION.md after completing your work with:
  - What you did
  - Key decisions and their rationale
  - Warnings or context for the next agent
  - Status of your assigned tasks

## Testing
- Tests use vitest
- Each module has a corresponding test file in tests/
- Run tests before committing

## Git Practices
- Commit atomically per logical change
- Write descriptive commit messages
`;
  }
}
