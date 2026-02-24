/**
 * Programmatic repository generator (FR-TGT-002).
 *
 * Generates deterministic TypeScript projects from a seed and configuration.
 * Same seed + config = byte-identical output.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

import type { ITestTarget } from '../target.interface.js';
import type {
  WorkingDirectory,
  ValidationResult,
  ArchitecturalManifest,
  GeneratorConfig,
} from '../../types/target.js';
import { SeededRng } from './rng.js';
import type { ModuleDefinition } from './templates.js';
import {
  generateModel,
  generateRepository,
  generateService,
  generateConfig,
  generateTest,
  generateReadme,
} from './templates.js';
import { buildManifest } from './manifest-builder.js';

/**
 * Default generator configuration.
 */
const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  fileCount: 20,
  moduleCount: 4,
  dependencyDepth: 2,
  testCoverage: 50,
  documentationLevel: 'minimal',
  seed: 'default-seed',
};

/**
 * Validate generator configuration bounds.
 */
export function validateGeneratorConfig(config: GeneratorConfig): string[] {
  const errors: string[] = [];
  if (config.fileCount < 10 || config.fileCount > 100) {
    errors.push('fileCount must be between 10 and 100');
  }
  if (config.moduleCount < 2 || config.moduleCount > 10) {
    errors.push('moduleCount must be between 2 and 10');
  }
  if (config.dependencyDepth < 1 || config.dependencyDepth > 5) {
    errors.push('dependencyDepth must be between 1 and 5');
  }
  if (config.testCoverage < 0 || config.testCoverage > 100) {
    errors.push('testCoverage must be between 0 and 100');
  }
  if (!['none', 'minimal', 'thorough'].includes(config.documentationLevel)) {
    errors.push('documentationLevel must be none, minimal, or thorough');
  }
  if (!config.seed || config.seed.length === 0) {
    errors.push('seed must be a non-empty string');
  }
  return errors;
}

/**
 * Build a module dependency DAG based on config.
 */
function buildModuleGraph(
  moduleCount: number,
  depthLevels: number,
  rng: SeededRng,
): ModuleDefinition[] {
  const moduleNames = [
    'user', 'order', 'product', 'payment', 'notification',
    'inventory', 'shipping', 'analytics', 'auth', 'search',
  ];

  const modules: ModuleDefinition[] = [];
  const modulesPerLevel = Math.max(1, Math.floor(moduleCount / depthLevels));

  let moduleIdx = 0;
  for (let level = 0; level < depthLevels && moduleIdx < moduleCount; level++) {
    const count = level === depthLevels - 1
      ? moduleCount - moduleIdx
      : Math.min(modulesPerLevel, moduleCount - moduleIdx);

    for (let i = 0; i < count; i++) {
      const name = moduleNames[moduleIdx % moduleNames.length]!;
      const deps: string[] = [];

      // Modules at higher levels depend on lower-level modules
      if (level > 0) {
        const lowerModules = modules.filter(m => m.level < level);
        if (lowerModules.length > 0) {
          const depCount = rng.int(1, Math.min(3, lowerModules.length));
          const shuffled = rng.shuffle([...lowerModules]);
          for (let d = 0; d < depCount; d++) {
            deps.push(shuffled[d]!.name);
          }
        }
      }

      modules.push({ name, level, dependencies: deps });
      moduleIdx++;
    }
  }

  return modules;
}

export class GeneratedRepoTarget implements ITestTarget {
  readonly name = 'generated-repo';

  private config: GeneratorConfig;
  private workingDir: string | undefined;
  private cleanupFn: (() => Promise<void>) | undefined;
  private manifest: ArchitecturalManifest | undefined;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_GENERATOR_CONFIG, ...config };
  }

  async setup(): Promise<WorkingDirectory> {
    const errors = validateGeneratorConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Invalid generator config: ${errors.join(', ')}`);
    }

    const rng = new SeededRng(this.config.seed);
    const tmpDir = await mkdtemp(join(tmpdir(), 'twining-gen-'));
    this.workingDir = tmpDir;

    // Create directory structure
    await mkdir(join(tmpDir, 'src', 'models'), { recursive: true });
    await mkdir(join(tmpDir, 'src', 'repositories'), { recursive: true });
    await mkdir(join(tmpDir, 'src', 'services'), { recursive: true });
    await mkdir(join(tmpDir, 'src', 'config'), { recursive: true });
    await mkdir(join(tmpDir, 'tests'), { recursive: true });

    // Build module graph
    const modules = buildModuleGraph(
      this.config.moduleCount,
      this.config.dependencyDepth,
      rng,
    );

    // Generate files
    const generatedFiles: string[] = [];

    for (const mod of modules) {
      // Model
      const modelContent = generateModel(mod.name, rng, this.config.documentationLevel);
      await writeFile(join(tmpDir, 'src', 'models', `${mod.name}.ts`), modelContent);
      generatedFiles.push(`src/models/${mod.name}.ts`);

      // Repository
      const repoContent = generateRepository(mod.name, rng, this.config.documentationLevel);
      await writeFile(join(tmpDir, 'src', 'repositories', `${mod.name}.ts`), repoContent);
      generatedFiles.push(`src/repositories/${mod.name}.ts`);

      // Service (with dependency injection)
      const serviceContent = generateService(mod.name, mod.dependencies, rng, this.config.documentationLevel);
      await writeFile(join(tmpDir, 'src', 'services', `${mod.name}.ts`), serviceContent);
      generatedFiles.push(`src/services/${mod.name}.ts`);

      // Config
      const configContent = generateConfig(mod.name, rng, this.config.documentationLevel);
      await writeFile(join(tmpDir, 'src', 'config', `${mod.name}.ts`), configContent);
      generatedFiles.push(`src/config/${mod.name}.ts`);
    }

    // Generate tests based on testCoverage
    const modulesToCover = modules.filter(() =>
      rng.chance(this.config.testCoverage / 100),
    );

    for (const mod of modulesToCover) {
      const repoTestContent = generateTest(mod.name, 'repository', mod.dependencies, rng);
      await writeFile(join(tmpDir, 'tests', `${mod.name}.repository.test.ts`), repoTestContent);
      generatedFiles.push(`tests/${mod.name}.repository.test.ts`);

      const serviceTestContent = generateTest(mod.name, 'service', mod.dependencies, rng);
      await writeFile(join(tmpDir, 'tests', `${mod.name}.service.test.ts`), serviceTestContent);
      generatedFiles.push(`tests/${mod.name}.service.test.ts`);
    }

    // Generate README
    const readme = generateReadme(modules, this.config.documentationLevel);
    if (readme) {
      await writeFile(join(tmpDir, 'README.md'), readme);
      generatedFiles.push('README.md');
    }

    // Generate package.json
    const packageJson = {
      name: 'generated-project',
      version: '1.0.0',
      type: 'module',
      scripts: {
        build: 'tsc',
        test: 'vitest run',
      },
      devDependencies: {
        typescript: '^5.3.0',
        vitest: '^1.0.0',
      },
    };
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );

    // Generate tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        esModuleInterop: true,
        outDir: './dist',
        rootDir: '.',
        skipLibCheck: true,
        declaration: true,
      },
      include: ['src/**/*.ts', 'tests/**/*.ts'],
    };
    await writeFile(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2),
    );

    // Build manifest from generation decisions
    this.manifest = buildManifest(
      modules,
      this.config.testCoverage,
      true, // always uses repository pattern
      modules.some(m => m.dependencies.length > 0),
    );

    // Initialize git
    const git = simpleGit(tmpDir);
    await git.init();
    await git.addConfig('user.email', 'generator@twining-bench.local');
    await git.addConfig('user.name', 'Twining Generator');
    await git.addConfig('commit.gpgsign', 'false');
    await git.add('.');
    await git.commit('Initial commit: generated project');

    this.cleanupFn = async () => {
      await rm(tmpDir, { recursive: true, force: true });
    };

    return {
      path: tmpDir,
      gitDir: join(tmpDir, '.git'),
      cleanup: this.cleanupFn,
    };
  }

  async validate(): Promise<ValidationResult> {
    if (!this.workingDir) {
      return {
        valid: false,
        errors: ['Target not set up. Call setup() first.'],
        warnings: [],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // Check git status
    const git = simpleGit(this.workingDir);
    const status = await git.status();
    if (status.modified.length > 0) {
      warnings.push('Working directory has uncommitted changes');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  getGroundTruth(): ArchitecturalManifest {
    if (!this.manifest) {
      throw new Error('Target not set up. Call setup() first.');
    }
    return this.manifest;
  }

  async reset(): Promise<void> {
    if (!this.workingDir) {
      throw new Error('Target not set up. Call setup() first.');
    }

    const git = simpleGit(this.workingDir);
    await git.checkout('.');
    await git.clean('f', ['-d']);
  }

  async teardown(): Promise<void> {
    if (this.cleanupFn) {
      await this.cleanupFn();
      this.cleanupFn = undefined;
      this.workingDir = undefined;
      this.manifest = undefined;
    }
  }

  /** Expose config for testing */
  getConfig(): GeneratorConfig {
    return { ...this.config };
  }
}
