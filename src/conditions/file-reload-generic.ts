import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

const CONTEXT_TEMPLATE = `# Context File

This file is your only link to previous agent sessions.
Read it carefully at the start of your session.
Update it thoroughly before your session ends.

## Previous Session Summary
(No previous session yet)

## Key Decisions Made
(None yet)

## Current Status
(Starting fresh)

## Warnings for Next Agent
(None yet)
`;

const SYSTEM_PROMPT = `IMPORTANT: You are starting with a completely fresh context window. You have NO conversation history from previous sessions.

Your workflow MUST follow this exact pattern:
1. FIRST: Read CONTEXT.md to understand what previous agents did, what decisions were made, and what work remains
2. THEN: Do your assigned work, building on the context you read
3. FINALLY: Before ending, update CONTEXT.md with:
   - Summary of what you accomplished
   - Key decisions you made and why
   - Current project status
   - Any warnings or important context for the next agent
   - What work remains to be done

The CONTEXT.md file is your ONLY way to communicate with future agents. Be thorough.`;

/**
 * FR-CND-004: Generic File-Based Context Reload (/clear Pattern)
 *
 * Simulates the /clear workflow where agents reload state from a single
 * CONTEXT.md file. Each agent session starts with zero conversation history.
 * The agent reads CONTEXT.md first, works, then writes back to CONTEXT.md.
 */
export class FileReloadGenericCondition extends BaseCondition {
  readonly name: ConditionName = 'file-reload-generic';
  readonly description =
    'Simulates /clear + CONTEXT.md reload. Zero conversation history, single unstructured context file.';

  constructor(private readonly claudeMdContent?: string) {
    super();
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const setupFiles: string[] = [];

    // Write CLAUDE.md
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    const claudeContent =
      this.claudeMdContent ?? this.generateClaudeMd();
    await writeFile(claudeMdPath, claudeContent, 'utf-8');
    setupFiles.push('CLAUDE.md');

    // Write initial CONTEXT.md
    const contextPath = join(workingDir, 'CONTEXT.md');
    await writeFile(contextPath, CONTEXT_TEMPLATE, 'utf-8');
    setupFiles.push('CONTEXT.md');

    return setupFiles;
  }

  protected buildAgentConfig(): AgentConfiguration {
    return {
      systemPrompt: SYSTEM_PROMPT,
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
    return ['CLAUDE.md', 'CONTEXT.md'];
  }

  private generateClaudeMd(): string {
    return `# Project Guidelines

## Architecture
- This project follows the repository pattern for data access
- Services depend on repositories, never on each other directly
- Events are preferred over direct cross-service calls for decoupling

## Coding Conventions
- Use TypeScript strict mode — no \`any\` types
- All public methods must have JSDoc comments
- Use dependency injection via constructor parameters

## Context Management
- ALWAYS read CONTEXT.md at the start of your session
- ALWAYS update CONTEXT.md before ending your session
- This is your only coordination mechanism with other agents

## Testing
- Tests use vitest
- Run tests before committing
`;
  }
}
