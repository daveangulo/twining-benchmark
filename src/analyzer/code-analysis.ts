import { simpleGit, type SimpleGit, type DiffResult } from 'simple-git';
import { Project, SyntaxKind } from 'ts-morph';
import { execa } from 'execa';
import type {
  ChurnAnalysis,
  SessionChurn,
  DetectedPattern,
  TestSuiteResults,
} from '../types/analysis.js';

/**
 * Analyze git churn across agent sessions (FR-ANL-001).
 *
 * Each session is identified by consecutive commits between session boundary tags.
 * Falls back to commit-by-commit analysis when tags aren't present.
 */
export async function analyzeGitChurn(
  repoPath: string,
  sessionCommitRanges: Array<{ from: string; to: string }>,
): Promise<ChurnAnalysis> {
  const git: SimpleGit = simpleGit(repoPath);
  const perSession: SessionChurn[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalReverts = 0;
  let totalFilesChanged = new Set<string>();

  for (let i = 0; i < sessionCommitRanges.length; i++) {
    const range = sessionCommitRanges[i]!;
    const diff: DiffResult = await git.diffSummary([
      `${range.from}..${range.to}`,
    ]);

    // Count lines added/removed across all files in this session
    let sessionAdded = 0;
    let sessionRemoved = 0;
    const sessionFiles = new Set<string>();

    for (const file of diff.files) {
      if ('insertions' in file) {
        sessionAdded += file.insertions;
        sessionRemoved += file.deletions;
      }
      sessionFiles.add(file.file);
      totalFilesChanged.add(file.file);
    }

    // Detect reverts by looking at commit messages and reverse diffs
    const revertedLines = await detectReverts(git, range.from, range.to);

    // Count commits in this range
    const log = await git.log({ from: range.from, to: range.to });
    const commitCount = log.total;

    const sessionChurn: SessionChurn = {
      sessionIndex: i,
      linesAdded: sessionAdded,
      linesRemoved: sessionRemoved,
      filesChanged: sessionFiles.size,
      revertedLines,
      commitCount,
    };

    perSession.push(sessionChurn);
    totalAdded += sessionAdded;
    totalRemoved += sessionRemoved;
    totalReverts += revertedLines;
  }

  const totalChanges = totalAdded + totalRemoved;
  const netEffective = totalAdded - totalRemoved;

  return {
    perSession,
    cumulative: {
      linesAdded: totalAdded,
      linesRemoved: totalRemoved,
      netEffectiveChanges: netEffective,
      reverts: totalReverts,
      filesChanged: totalFilesChanged.size,
    },
    effectiveChangeRatio:
      totalChanges > 0 ? Math.abs(netEffective) / totalChanges : 0,
  };
}

/**
 * Detect reverted lines between two commits by searching for revert commits
 * and counting lines that were added then removed (or vice versa).
 */
async function detectReverts(
  git: SimpleGit,
  fromRef: string,
  toRef: string,
): Promise<number> {
  const log = await git.log({ from: fromRef, to: toRef });
  let revertedLines = 0;

  for (const commit of log.all) {
    // Check for revert commits by message pattern
    if (/^revert/i.test(commit.message)) {
      const diff = await git.diffSummary([
        `${commit.hash}~1..${commit.hash}`,
      ]);
      for (const file of diff.files) {
        if ('insertions' in file) {
          revertedLines += file.insertions + file.deletions;
        }
      }
    }
  }

  return revertedLines;
}

/**
 * Detect code patterns in a TypeScript project using ts-morph AST analysis (FR-ANL-001).
 */
export function detectPatterns(projectPath: string): DetectedPattern[] {
  const project = new Project({
    tsConfigFilePath: `${projectPath}/tsconfig.json`,
    skipAddingFilesFromTsConfig: false,
  });

  const patterns: DetectedPattern[] = [];

  patterns.push(...detectEventEmitterPattern(project));
  patterns.push(...detectRepositoryPattern(project));
  patterns.push(...detectInterfaceImplementationPattern(project));
  patterns.push(...detectDependencyInjectionPattern(project));

  return patterns;
}

/**
 * Detect EventEmitter / event-driven patterns.
 */
function detectEventEmitterPattern(project: Project): DetectedPattern[] {
  const files: string[] = [];
  const evidence: string[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const classes = sourceFile.getClasses();

    for (const cls of classes) {
      // Check for EventEmitter extension
      const baseTypes = cls.getExtends();
      if (baseTypes) {
        const baseText = baseTypes.getText();
        if (/EventEmitter|EventBus|EventTarget/i.test(baseText)) {
          files.push(filePath);
          evidence.push(
            `${cls.getName() ?? 'anonymous'} extends ${baseText}`,
          );
        }
      }

      // Check for .on(), .emit(), .addEventListener() method calls
      const methods = cls.getMethods();
      for (const method of methods) {
        const body = method.getBody();
        if (!body) continue;
        const calls = body.getDescendantsOfKind(
          SyntaxKind.CallExpression,
        );
        for (const call of calls) {
          const expr = call.getExpression().getText();
          if (/\.(on|emit|addEventListener|removeEventListener)\b/.test(expr)) {
            if (!files.includes(filePath)) files.push(filePath);
            evidence.push(`${cls.getName() ?? 'anonymous'}.${method.getName()} calls ${expr}`);
          }
        }
      }
    }
  }

  if (files.length === 0) return [];

  return [
    {
      patternName: 'event-emitter',
      files,
      confidence: Math.min(1, files.length * 0.3 + evidence.length * 0.1),
      evidence,
    },
  ];
}

/**
 * Detect Repository pattern (data access abstraction).
 */
function detectRepositoryPattern(project: Project): DetectedPattern[] {
  const files: string[] = [];
  const evidence: string[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const classes = sourceFile.getClasses();
    const interfaces = sourceFile.getInterfaces();

    // Check class names and inheritance
    for (const cls of classes) {
      const name = cls.getName() ?? '';
      if (/Repository/i.test(name)) {
        files.push(filePath);
        evidence.push(`Class ${name} follows Repository naming`);

        const baseTypes = cls.getExtends();
        if (baseTypes) {
          evidence.push(`${name} extends ${baseTypes.getText()}`);
        }

        // Check for CRUD-like methods
        const methodNames = cls.getMethods().map((m) => m.getName());
        const crudMethods = methodNames.filter((m) =>
          /^(find|get|create|save|update|delete|remove)/i.test(m),
        );
        if (crudMethods.length >= 2) {
          evidence.push(
            `${name} has CRUD methods: ${crudMethods.join(', ')}`,
          );
        }
      }
    }

    // Check interface names
    for (const iface of interfaces) {
      const name = iface.getName();
      if (/Repository/i.test(name)) {
        if (!files.includes(filePath)) files.push(filePath);
        evidence.push(`Interface ${name} follows Repository naming`);
      }
    }
  }

  if (files.length === 0) return [];

  return [
    {
      patternName: 'repository-pattern',
      files,
      confidence: Math.min(1, files.length * 0.25 + evidence.length * 0.1),
      evidence,
    },
  ];
}

/**
 * Detect interface implementation patterns.
 */
function detectInterfaceImplementationPattern(
  project: Project,
): DetectedPattern[] {
  const files: string[] = [];
  const evidence: string[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    for (const cls of sourceFile.getClasses()) {
      const impls = cls.getImplements();
      if (impls.length > 0) {
        files.push(filePath);
        for (const impl of impls) {
          evidence.push(
            `${cls.getName() ?? 'anonymous'} implements ${impl.getText()}`,
          );
        }
      }
    }
  }

  if (files.length === 0) return [];

  return [
    {
      patternName: 'interface-implementation',
      files,
      confidence: Math.min(1, files.length * 0.2 + evidence.length * 0.05),
      evidence,
    },
  ];
}

/**
 * Detect dependency injection patterns.
 */
function detectDependencyInjectionPattern(
  project: Project,
): DetectedPattern[] {
  const files: string[] = [];
  const evidence: string[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    for (const cls of sourceFile.getClasses()) {
      const constructors = cls.getConstructors();
      for (const ctor of constructors) {
        const params = ctor.getParameters();
        // DI pattern: constructor with interface-typed or abstract-typed params
        const injectedParams = params.filter((p) => {
          const typeNode = p.getTypeNode();
          if (!typeNode) return false;
          // Check if parameter type is an interface or abstract reference
          const typeText = typeNode.getText();
          return (
            /^I[A-Z]/.test(typeText) ||
            p.hasModifier(SyntaxKind.PrivateKeyword) ||
            p.hasModifier(SyntaxKind.ReadonlyKeyword)
          );
        });

        if (injectedParams.length >= 2) {
          files.push(filePath);
          evidence.push(
            `${cls.getName() ?? 'anonymous'} constructor injects ${injectedParams.length} dependencies`,
          );
        }
      }
    }
  }

  if (files.length === 0) return [];

  return [
    {
      patternName: 'dependency-injection',
      files,
      confidence: Math.min(1, files.length * 0.3 + evidence.length * 0.15),
      evidence,
    },
  ];
}

/**
 * Run the target's test suite and capture results (FR-ANL-001).
 */
export async function runTestSuite(
  projectPath: string,
  testCommand = 'npm test',
): Promise<TestSuiteResults> {
  // First check compilation
  const { compiles, compilationErrors } = await checkCompilation(projectPath);

  // Run tests even if compilation fails (some tests may still work)
  const [cmd, ...args] = testCommand.split(' ');
  if (!cmd) {
    throw new Error('Empty test command');
  }

  try {
    const result = await execa(cmd, args, {
      cwd: projectPath,
      reject: false,
      timeout: 120_000,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    });

    const output = result.stdout + '\n' + result.stderr;
    const counts = parseTestOutput(output);

    return {
      ...counts,
      compiles,
      compilationErrors,
    };
  } catch {
    return {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      compiles,
      compilationErrors,
    };
  }
}

/**
 * Check if the TypeScript project compiles (FR-ANL-001).
 */
export async function checkCompilation(
  projectPath: string,
): Promise<{ compiles: boolean; compilationErrors: string[] }> {
  try {
    const result = await execa('npx', ['tsc', '--noEmit'], {
      cwd: projectPath,
      reject: false,
      timeout: 60_000,
    });

    if (result.exitCode === 0) {
      return { compiles: true, compilationErrors: [] };
    }

    const errors = (result.stdout + '\n' + result.stderr)
      .split('\n')
      .filter((line) => /error TS\d+/.test(line));

    return { compiles: false, compilationErrors: errors };
  } catch {
    return {
      compiles: false,
      compilationErrors: ['Compilation check failed to execute'],
    };
  }
}

/**
 * Parse test runner output to extract pass/fail/skip counts.
 * Supports vitest, jest, and mocha output formats.
 */
function parseTestOutput(output: string): {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  coveragePct?: number;
} {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let coveragePct: number | undefined;

  // Vitest format: "Tests  5 passed | 2 failed | 1 skipped (8)"
  const vitestMatch = output.match(
    /Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?(?:\s*\|\s*(\d+)\s+skipped)?/i,
  );
  if (vitestMatch) {
    passed = parseInt(vitestMatch[1]!, 10);
    failed = vitestMatch[2] ? parseInt(vitestMatch[2], 10) : 0;
    skipped = vitestMatch[3] ? parseInt(vitestMatch[3], 10) : 0;
  }

  // Jest format: "Tests:       5 passed, 2 failed, 7 total"
  if (passed === 0 && failed === 0) {
    const jestMatch = output.match(
      /Tests:\s+(?:(\d+)\s+passed)?(?:,\s*)?(?:(\d+)\s+failed)?(?:,\s*)?(?:(\d+)\s+skipped)?(?:,\s*)?(\d+)\s+total/i,
    );
    if (jestMatch) {
      passed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0;
      failed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0;
      skipped = jestMatch[3] ? parseInt(jestMatch[3], 10) : 0;
    }
  }

  // Mocha format: "5 passing" "2 failing" "1 pending"
  if (passed === 0 && failed === 0) {
    const passingMatch = output.match(/(\d+)\s+passing/i);
    const failingMatch = output.match(/(\d+)\s+failing/i);
    const pendingMatch = output.match(/(\d+)\s+pending/i);
    if (passingMatch) passed = parseInt(passingMatch[1]!, 10);
    if (failingMatch) failed = parseInt(failingMatch[1]!, 10);
    if (pendingMatch) skipped = parseInt(pendingMatch[1]!, 10);
  }

  // Coverage: "All files  |   85.2 |"  or "Statements : 85.2%"
  const coverageMatch = output.match(
    /(?:All files|Statements)\s*[|:]\s*([\d.]+)\s*%?/i,
  );
  if (coverageMatch) {
    coveragePct = parseFloat(coverageMatch[1]!);
  }

  const total = passed + failed + skipped;
  return { passed, failed, skipped, total, coveragePct };
}
