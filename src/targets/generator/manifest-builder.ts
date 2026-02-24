/**
 * Builds an ArchitecturalManifest from generation decisions.
 */

import type { ArchitecturalManifest, ArchitecturalDecision } from '../../types/target.js';
import type { ModuleDefinition } from './templates.js';

/**
 * Build a ground truth manifest from the modules and generation parameters.
 */
export function buildManifest(
  modules: ModuleDefinition[],
  testCoverage: number,
  hasRepositoryPattern: boolean,
  hasDependencyInjection: boolean,
): ArchitecturalManifest {
  const decisions: ArchitecturalDecision[] = [];

  if (hasRepositoryPattern) {
    const repoFiles = modules
      .filter(m => m.level > 0)
      .map(m => `src/repositories/${m.name}.ts`);

    decisions.push({
      id: 'repository-pattern',
      description: 'Data access uses the Repository pattern. Services depend on repositories for CRUD operations.',
      affectedFiles: repoFiles,
      expectedPatterns: ['Repository', 'findAll', 'findById', 'create', 'delete'],
      antiPatterns: [],
    });
  }

  if (hasDependencyInjection) {
    const serviceFiles = modules
      .filter(m => m.dependencies.length > 0)
      .map(m => `src/services/${m.name}.ts`);

    decisions.push({
      id: 'dependency-injection',
      description: 'Services receive dependencies through constructor injection rather than direct instantiation.',
      affectedFiles: serviceFiles,
      expectedPatterns: ['constructor(', 'private readonly'],
      antiPatterns: ['new .*Repository()'],
    });
  }

  // Build module dependency graph
  const moduleDependencies: Record<string, string[]> = {};
  for (const mod of modules) {
    if (mod.dependencies.length > 0) {
      moduleDependencies[mod.name] = [...mod.dependencies];
    }
  }

  return {
    name: 'generated-project',
    description: `Generated TypeScript project with ${modules.length} modules across ${Math.max(...modules.map(m => m.level)) + 1} layers`,
    decisions,
    moduleDependencies,
    baselineTestCoverage: testCoverage,
  };
}
