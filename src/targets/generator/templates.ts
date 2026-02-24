/**
 * Code generation templates for the programmatic repo generator (FR-TGT-002).
 *
 * Generates TypeScript source files: models, repositories, services, config, tests.
 */

import type { SeededRng } from './rng.js';

export interface ModuleDefinition {
  name: string;
  level: number;
  dependencies: string[];
}

/**
 * Generate a model interface file.
 */
export function generateModel(
  moduleName: string,
  rng: SeededRng,
  docLevel: 'none' | 'minimal' | 'thorough',
): string {
  const className = toPascalCase(moduleName);
  const fieldCount = rng.int(3, 6);
  const fields: string[] = [];
  const fieldTypes = ['string', 'number', 'boolean', 'Date'];
  const fieldNames = ['id', 'name', 'status', 'createdAt', 'updatedAt', 'value', 'description', 'count', 'enabled', 'priority'];

  for (let i = 0; i < fieldCount; i++) {
    const fname = fieldNames[i % fieldNames.length]!;
    const ftype = fieldTypes[i % fieldTypes.length]!;
    if (docLevel === 'thorough') {
      fields.push(`  /** The ${fname} of the ${className} */\n  ${fname}: ${ftype};`);
    } else {
      fields.push(`  ${fname}: ${ftype};`);
    }
  }

  const doc = docLevel !== 'none'
    ? `/**\n * Data model for ${className}.\n */\n`
    : '';

  return `${doc}export interface ${className} {\n${fields.join('\n')}\n}\n\nexport interface Create${className}Input {\n  name: string;\n  value?: number;\n}\n`;
}

/**
 * Generate a repository class file.
 */
export function generateRepository(
  moduleName: string,
  _rng: SeededRng,
  docLevel: 'none' | 'minimal' | 'thorough',
): string {
  const className = toPascalCase(moduleName);
  const repoName = `${className}Repository`;

  const doc = docLevel !== 'none'
    ? `/**\n * Repository for ${className} data access.\n * Follows the repository pattern for data abstraction.\n */\n`
    : '';

  return `import type { ${className}, Create${className}Input } from '../models/${moduleName}.js';\n\n${doc}export class ${repoName} {\n  private items: Map<string, ${className}> = new Map();\n  private nextId = 1;\n\n  async findAll(): Promise<${className}[]> {\n    return [...this.items.values()];\n  }\n\n  async findById(id: string): Promise<${className} | undefined> {\n    return this.items.get(id);\n  }\n\n  async create(input: Create${className}Input): Promise<${className}> {\n    const item: ${className} = {\n      id: String(this.nextId++),\n      name: input.name,\n      status: 'active',\n      createdAt: new Date(),\n      updatedAt: new Date(),\n      value: input.value ?? 0,\n      description: '',\n      count: 0,\n      enabled: true,\n      priority: 0,\n    } as ${className};\n    this.items.set(item.id, item);\n    return item;\n  }\n\n  async delete(id: string): Promise<boolean> {\n    return this.items.delete(id);\n  }\n}\n`;
}

/**
 * Generate a service class file.
 */
export function generateService(
  moduleName: string,
  deps: string[],
  _rng: SeededRng,
  docLevel: 'none' | 'minimal' | 'thorough',
): string {
  const className = toPascalCase(moduleName);
  const serviceName = `${className}Service`;

  const imports: string[] = [];
  const ctorParams: string[] = [];
  const privateFields: string[] = [];

  for (const dep of deps) {
    const depClass = toPascalCase(dep);
    const repoName = `${depClass}Repository`;
    const fieldName = `${toCamelCase(dep)}Repository`;
    imports.push(`import { ${repoName} } from '../repositories/${dep}.js';`);
    ctorParams.push(`private readonly ${fieldName}: ${repoName}`);
    privateFields.push(fieldName);
  }

  const doc = docLevel !== 'none'
    ? `/**\n * Service layer for ${className} business logic.\n * Dependencies are injected via constructor.\n */\n`
    : '';

  const importBlock = imports.length > 0 ? imports.join('\n') + '\n\n' : '';
  const ctorParamsStr = ctorParams.join(',\n    ');

  return `${importBlock}${doc}export class ${serviceName} {\n  constructor(\n    ${ctorParamsStr}\n  ) {}\n\n  async getAll(): Promise<unknown[]> {\n    ${privateFields.length > 0 ? `return this.${privateFields[0]}.findAll();` : 'return [];'}\n  }\n\n  async getById(id: string): Promise<unknown | undefined> {\n    ${privateFields.length > 0 ? `return this.${privateFields[0]}.findById(id);` : 'return undefined;'}\n  }\n}\n`;
}

/**
 * Generate a config constants file.
 */
export function generateConfig(
  moduleName: string,
  rng: SeededRng,
  docLevel: 'none' | 'minimal' | 'thorough',
): string {
  const prefix = moduleName.toUpperCase().replace(/-/g, '_');
  const timeout = rng.int(1000, 30000);
  const maxRetries = rng.int(1, 5);

  const doc = docLevel !== 'none'
    ? `/**\n * Configuration constants for ${moduleName} module.\n */\n`
    : '';

  return `${doc}export const ${prefix}_CONFIG = {\n  timeout: ${timeout},\n  maxRetries: ${maxRetries},\n  enabled: true,\n} as const;\n\nexport type ${toPascalCase(moduleName)}Config = typeof ${prefix}_CONFIG;\n`;
}

/**
 * Generate a test file for a module.
 */
export function generateTest(
  moduleName: string,
  type: 'service' | 'repository',
  deps: string[],
  _rng: SeededRng,
): string {
  const className = toPascalCase(moduleName);

  if (type === 'repository') {
    const repoName = `${className}Repository`;
    return `import { describe, it, expect } from 'vitest';\nimport { ${repoName} } from '../src/repositories/${moduleName}.js';\n\ndescribe('${repoName}', () => {\n  it('creates and retrieves items', async () => {\n    const repo = new ${repoName}();\n    const item = await repo.create({ name: 'test' });\n    expect(item.name).toBe('test');\n    const found = await repo.findById(item.id);\n    expect(found).toBeDefined();\n  });\n\n  it('lists all items', async () => {\n    const repo = new ${repoName}();\n    await repo.create({ name: 'a' });\n    await repo.create({ name: 'b' });\n    const all = await repo.findAll();\n    expect(all).toHaveLength(2);\n  });\n\n  it('deletes items', async () => {\n    const repo = new ${repoName}();\n    const item = await repo.create({ name: 'test' });\n    const deleted = await repo.delete(item.id);\n    expect(deleted).toBe(true);\n  });\n});\n`;
  }

  // Service test
  const serviceName = `${className}Service`;
  const depImports = deps.map(d => {
    const depClass = toPascalCase(d);
    return `import { ${depClass}Repository } from '../src/repositories/${d}.js';`;
  }).join('\n');
  const depInits = deps.map(d => {
    const fieldName = `${toCamelCase(d)}Repository`;
    const depClass = toPascalCase(d);
    return `    const ${fieldName} = new ${depClass}Repository();`;
  }).join('\n');
  const ctorArgs = deps.map(d => `${toCamelCase(d)}Repository`).join(', ');

  return `import { describe, it, expect } from 'vitest';\nimport { ${serviceName} } from '../src/services/${moduleName}.js';\n${depImports}\n\ndescribe('${serviceName}', () => {\n  it('returns all items', async () => {\n${depInits}\n    const service = new ${serviceName}(${ctorArgs});\n    const items = await service.getAll();\n    expect(Array.isArray(items)).toBe(true);\n  });\n\n  it('returns undefined for non-existent id', async () => {\n${depInits}\n    const service = new ${serviceName}(${ctorArgs});\n    const item = await service.getById('nonexistent');\n    expect(item).toBeUndefined();\n  });\n});\n`;
}

/**
 * Generate a README.md for the generated project.
 */
export function generateReadme(
  modules: ModuleDefinition[],
  docLevel: 'none' | 'minimal' | 'thorough',
): string {
  if (docLevel === 'none') return '';

  const lines = ['# Generated Project\n'];

  if (docLevel === 'thorough') {
    lines.push('A TypeScript project with layered architecture.\n');
    lines.push('## Modules\n');
    for (const mod of modules) {
      const deps = mod.dependencies.length > 0
        ? ` (depends on: ${mod.dependencies.join(', ')})`
        : '';
      lines.push(`- **${mod.name}** (level ${mod.level})${deps}`);
    }
    lines.push('\n## Architecture\n');
    lines.push('The project follows a layered architecture with dependency injection.');
    lines.push('Services depend on repositories, which abstract data access.\n');
  } else {
    lines.push('A generated TypeScript project for benchmarking.\n');
  }

  return lines.join('\n');
}

// --- Helpers ---

function toPascalCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

function toCamelCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toLowerCase());
}
