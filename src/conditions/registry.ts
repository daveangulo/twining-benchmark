import type { ConditionName, ConditionRegistryEntry } from '../types/index.js';
import { BaselineCondition } from './baseline.js';
import { ClaudeMdOnlyCondition } from './claude-md-only.js';
import { SharedMarkdownCondition } from './shared-markdown.js';
import { FileReloadGenericCondition } from './file-reload-generic.js';
import { FileReloadStructuredCondition } from './file-reload-structured.js';
import { FullTwiningCondition } from './full-twining.js';
import { TwiningLiteCondition } from './twining-lite.js';

/**
 * Registry of all available coordination conditions.
 */
export const CONDITION_REGISTRY: Record<ConditionName, ConditionRegistryEntry> = {
  baseline: {
    name: 'baseline',
    description: 'No coordination. Agents have only the codebase — no CLAUDE.md, no shared files, no MCP servers.',
    coordinationTools: [],
    create: () => new BaselineCondition(),
  },
  'claude-md-only': {
    name: 'claude-md-only',
    description: 'CLAUDE.md with project conventions and instructions. No shared state or MCP servers.',
    coordinationTools: ['CLAUDE.md'],
    create: () => new ClaudeMdOnlyCondition(),
  },
  'shared-markdown': {
    name: 'shared-markdown',
    description: 'CLAUDE.md plus shared COORDINATION.md for freeform agent notes. No search, indexing, or graph capabilities.',
    coordinationTools: ['CLAUDE.md', 'COORDINATION.md'],
    create: () => new SharedMarkdownCondition(),
  },
  'file-reload-generic': {
    name: 'file-reload-generic',
    description: 'Simulates /clear + CONTEXT.md reload. Zero conversation history, single unstructured context file.',
    coordinationTools: ['CONTEXT.md'],
    create: () => new FileReloadGenericCondition(),
  },
  'file-reload-structured': {
    name: 'file-reload-structured',
    description: 'GSD/BMAD-style structured framework. Fresh context per agent, role files, STATE.md, PLAN.md, decisions.md, handoff.md.',
    coordinationTools: ['coordination/STATE.md', 'coordination/PLAN.md', 'coordination/decisions.md', 'coordination/handoff.md', 'coordination/roles/'],
    create: () => new FileReloadStructuredCondition(),
  },
  'full-twining': {
    name: 'full-twining',
    description: 'Full Twining MCP server with blackboard, decision tracking, knowledge graph, and semantic search.',
    coordinationTools: ['Twining MCP (all tools)'],
    create: () => new FullTwiningCondition(),
  },
  'twining-lite': {
    name: 'twining-lite',
    description: 'Twining Lite — core blackboard and decision tools only (8 of 26 tools).',
    coordinationTools: ['Twining MCP (core: blackboard, decisions, handoff)'],
    create: () => new TwiningLiteCondition(),
  },
};

/**
 * Get all condition names.
 */
export function getAllConditionNames(): ConditionName[] {
  return Object.keys(CONDITION_REGISTRY) as ConditionName[];
}

/**
 * Get a condition by name.
 */
export function getCondition(name: ConditionName): ConditionRegistryEntry {
  const entry = CONDITION_REGISTRY[name];
  if (!entry) {
    throw new Error(`Unknown condition: ${name}`);
  }
  return entry;
}

/**
 * Resolve condition names from CLI input.
 * Supports 'all' to return all conditions.
 */
export function resolveConditionNames(input: string): ConditionName[] {
  if (input === 'all') {
    return getAllConditionNames();
  }
  const names = input.split(',').map(s => s.trim()) as ConditionName[];
  for (const name of names) {
    if (!CONDITION_REGISTRY[name]) {
      throw new Error(`Unknown condition: ${name}. Available: ${getAllConditionNames().join(', ')}`);
    }
  }
  return names;
}
