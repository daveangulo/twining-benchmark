import type { ScenarioName, ScenarioRegistryEntry } from '../types/index.js';
import { createRefactoringHandoffScenario } from './refactoring-handoff.js';
import { createArchitectureCascadeScenario } from './architecture-cascade.js';
import { createBugInvestigationScenario } from './bug-investigation.js';
import { createMultiSessionBuildScenario } from './multi-session-build.js';
import { createScaleStressTestScenario } from './scale-stress-test.js';

/**
 * Registry of all available benchmark scenarios.
 */
export const SCENARIO_REGISTRY: Record<ScenarioName, ScenarioRegistryEntry> = {
  'refactoring-handoff': {
    metadata: {
      name: 'refactoring-handoff',
      description: 'Agent A extracts an IUserRepository interface. Agent B adds a caching layer. Measures consistency, rework, and completion.',
      estimatedDurationMinutes: 30,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 2,
      scoringDimensions: ['consistency', 'rework', 'completion'],
      excludeFromAll: false,
    },
    create: () => createRefactoringHandoffScenario(),
  },
  'architecture-cascade': {
    metadata: {
      name: 'architecture-cascade',
      description: 'Agent A decouples notification from orders. Agents B and C independently integrate. Measures decision propagation and pattern consistency.',
      estimatedDurationMinutes: 45,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 3,
      scoringDimensions: ['decision-propagation', 'pattern-consistency', 'decision-quality'],
      excludeFromAll: false,
    },
    create: () => createArchitectureCascadeScenario(),
  },
  'bug-investigation': {
    metadata: {
      name: 'bug-investigation',
      description: 'Agent A investigates a planted bug partway. Agent B continues. Measures context recovery and redundant investigation.',
      estimatedDurationMinutes: 20,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 2,
      scoringDimensions: ['context-recovery', 'redundant-investigation', 'resolution'],
      excludeFromAll: false,
    },
    create: () => createBugInvestigationScenario(),
  },
  'multi-session-build': {
    metadata: {
      name: 'multi-session-build',
      description: 'Feature built across 5 sequential sessions. Measures architectural drift, cumulative rework, and final quality.',
      estimatedDurationMinutes: 75,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 5,
      scoringDimensions: ['architectural-drift', 'cumulative-rework', 'final-quality'],
      excludeFromAll: false,
    },
    create: () => createMultiSessionBuildScenario(),
  },
  'scale-stress-test': {
    metadata: {
      name: 'scale-stress-test',
      description: 'Parameterised stress test. Measures coherence degradation, orientation overhead, and integration success at increasing scale.',
      estimatedDurationMinutes: 120,
      requiredTargetType: 'generated',
      agentSessionCount: 4, // base count, multiplied by scale factor
      scoringDimensions: ['coherence-degradation', 'orientation-overhead', 'integration-success'],
      excludeFromAll: true,
    },
    create: () => createScaleStressTestScenario(),
  },
};

/**
 * Get all scenario names.
 */
export function getAllScenarioNames(): ScenarioName[] {
  return Object.keys(SCENARIO_REGISTRY) as ScenarioName[];
}

/**
 * Get a scenario by name.
 */
export function getScenario(name: ScenarioName): ScenarioRegistryEntry {
  const entry = SCENARIO_REGISTRY[name];
  if (!entry) {
    throw new Error(`Unknown scenario: ${name}`);
  }
  return entry;
}

/**
 * Resolve scenario names from CLI input.
 * 'all' returns all scenarios EXCEPT those with excludeFromAll=true.
 */
export function resolveScenarioNames(input: string): ScenarioName[] {
  if (input === 'all') {
    return getAllScenarioNames().filter(
      name => !SCENARIO_REGISTRY[name]?.metadata.excludeFromAll,
    );
  }
  const names = input.split(',').map(s => s.trim()) as ScenarioName[];
  for (const name of names) {
    if (!SCENARIO_REGISTRY[name]) {
      throw new Error(`Unknown scenario: ${name}. Available: ${getAllScenarioNames().join(', ')}`);
    }
  }
  return names;
}
