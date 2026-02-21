import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfiguration } from '../types/index.js';
import { BaseCondition } from './condition.interface.js';
import type { ConditionName } from '../types/index.js';

// --- Template Content ---

const STATE_TEMPLATE = `# Project State

## Current Phase
Phase 1: Initial Implementation

## Completed Tasks
(None yet)

## In Progress
(None yet)

## Pending Tasks
(See PLAN.md for full task breakdown)

## Blockers
(None)
`;

const PLAN_TEMPLATE = `# Execution Plan

## Overview
Tasks are organized by phase. Each task has verification steps.

## Tasks

### Task 1: [Assigned by scenario]
- **Status:** [ ] Not started
- **Assigned to:** Agent 1
- **Description:** (Set by scenario)
- **Verification:**
  - [ ] Code compiles
  - [ ] Tests pass
  - [ ] Changes committed
- **Acceptance Criteria:** (Set by scenario)

### Task 2: [Assigned by scenario]
- **Status:** [ ] Not started
- **Assigned to:** Agent 2
- **Description:** (Set by scenario)
- **Verification:**
  - [ ] Code compiles
  - [ ] Tests pass
  - [ ] Changes committed
  - [ ] Integrates with Task 1 output
- **Acceptance Criteria:** (Set by scenario)
`;

const DECISIONS_TEMPLATE = `# Decision Log

Record all significant decisions here with rationale.

| # | Decision | Rationale | Agent | Date |
|---|----------|-----------|-------|------|
`;

const HANDOFF_TEMPLATE = `# Handoff Document

## Last Agent Summary
(No previous agent yet)

## What Was Done
(Nothing yet)

## Key Findings
(None)

## Blockers / Issues
(None)

## Next Steps
(See PLAN.md)

## Warnings for Next Agent
(None)
`;

function generateRoleFile(agentNumber: number, totalAgents: number): string {
  const roleNames = [
    'Architect & Scaffolder',
    'Core Implementer',
    'Integration Developer',
    'Test Engineer & Reviewer',
    'Final Integration & Polish',
  ];
  const roleName = roleNames[agentNumber - 1] ?? `Agent ${agentNumber}`;

  return `# Agent ${agentNumber} Role: ${roleName}

## Persona
You are Agent ${agentNumber} of ${totalAgents} in a sequential development workflow.
Your role is: ${roleName}.

## Responsibilities
- Execute your assigned tasks from PLAN.md
- Maintain consistency with previous agents' decisions
- Update STATE.md with your progress
- Write clear handoff notes in handoff.md

## Startup Sequence (FOLLOW THIS EXACTLY)
1. Read this role file to understand your responsibilities
2. Read STATE.md to see current project status and what's been done
3. Read PLAN.md to find your assigned tasks and their verification steps
4. Read handoff.md to get context from the previous agent
5. Read decisions.md to understand architectural decisions made so far
6. Execute your tasks per the plan
7. After each task: update STATE.md, mark task status in PLAN.md
8. Before ending: update handoff.md with your findings and context
9. Commit each completed task atomically

## Rules
- Do NOT change architecture decisions without recording in decisions.md
- Do NOT skip verification steps in your tasks
- Do NOT leave STATE.md out of date
- ALWAYS update handoff.md for the next agent
`;
}

const SYSTEM_PROMPT = `IMPORTANT: You are starting with a completely fresh context window. You have NO conversation history.

You are part of a structured multi-agent workflow. Follow the startup sequence in your role file EXACTLY:
1. Read coordination/roles/agent-N.md (your role file, where N is your agent number)
2. Read coordination/STATE.md for current project status
3. Read coordination/PLAN.md for your assigned tasks
4. Read coordination/handoff.md for context from the previous agent
5. Read coordination/decisions.md for architectural decisions

Execute your tasks, then update STATE.md, PLAN.md, handoff.md, and decisions.md before ending.
Commit each completed task atomically.`;

/**
 * FR-CND-005: Structured Framework Context Reload (GSD/BMAD Pattern)
 *
 * Simulates structured multi-agent frameworks with:
 * - Fresh context per agent (simulating /clear or subagent spawn)
 * - Role-specific system prompts from roles/agent-N.md
 * - Structured PLAN.md as executable instructions
 * - STATE.md for progress tracking
 * - decisions.md for decision logging
 * - handoff.md for structured handoff between agents
 */
export class FileReloadStructuredCondition extends BaseCondition {
  readonly name: ConditionName = 'file-reload-structured';
  readonly description =
    'GSD/BMAD-style structured framework. Fresh context per agent, role files, STATE.md, PLAN.md, decisions.md, handoff.md.';

  private agentCount: number;

  constructor(agentCount = 5) {
    super();
    this.agentCount = agentCount;
  }

  protected async doSetup(workingDir: string): Promise<string[]> {
    const setupFiles: string[] = [];
    const coordDir = join(workingDir, 'coordination');
    const rolesDir = join(coordDir, 'roles');

    // Create coordination directory structure
    await mkdir(coordDir, { recursive: true });
    await mkdir(rolesDir, { recursive: true });

    // Write CLAUDE.md
    const claudeMdPath = join(workingDir, 'CLAUDE.md');
    await writeFile(claudeMdPath, this.generateClaudeMd(), 'utf-8');
    setupFiles.push('CLAUDE.md');

    // Write STATE.md
    const statePath = join(coordDir, 'STATE.md');
    await writeFile(statePath, STATE_TEMPLATE, 'utf-8');
    setupFiles.push('coordination/STATE.md');

    // Write PLAN.md
    const planPath = join(coordDir, 'PLAN.md');
    await writeFile(planPath, PLAN_TEMPLATE, 'utf-8');
    setupFiles.push('coordination/PLAN.md');

    // Write decisions.md
    const decisionsPath = join(coordDir, 'decisions.md');
    await writeFile(decisionsPath, DECISIONS_TEMPLATE, 'utf-8');
    setupFiles.push('coordination/decisions.md');

    // Write handoff.md
    const handoffPath = join(coordDir, 'handoff.md');
    await writeFile(handoffPath, HANDOFF_TEMPLATE, 'utf-8');
    setupFiles.push('coordination/handoff.md');

    // Write role files for each agent
    for (let i = 1; i <= this.agentCount; i++) {
      const roleContent = generateRoleFile(i, this.agentCount);
      const rolePath = join(rolesDir, `agent-${i}.md`);
      await writeFile(rolePath, roleContent, 'utf-8');
      setupFiles.push(`coordination/roles/agent-${i}.md`);
    }

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
    const paths = [
      'CLAUDE.md',
      'coordination/STATE.md',
      'coordination/PLAN.md',
      'coordination/decisions.md',
      'coordination/handoff.md',
    ];
    for (let i = 1; i <= this.agentCount; i++) {
      paths.push(`coordination/roles/agent-${i}.md`);
    }
    return paths;
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

## Structured Coordination
This project uses a structured multi-agent coordination framework.
All coordination happens through files in the coordination/ directory:

- coordination/STATE.md — Project state and progress tracking
- coordination/PLAN.md — Task plan with verification steps
- coordination/decisions.md — Decision log with rationale
- coordination/handoff.md — Handoff notes between agents
- coordination/roles/agent-N.md — Role definitions per agent

ALWAYS follow the startup sequence in your role file.

## Testing
- Tests use vitest
- Run tests before committing
- Commit each task atomically
`;
  }
}
