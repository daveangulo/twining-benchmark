/**
 * FR-SCN-005: Scale Stress Test Scenario
 *
 * Tests how coordination strategies degrade as the number of agents, sessions,
 * and codebase size increase. Parameterized by --scale-factor (1-5).
 *
 * At scale factor S:
 * - A generated repo of size S x baseline complexity is used.
 * - A feature is built across S x 4 sequential sessions.
 * - Each session adds a component, later sessions must integrate.
 * - Integration tests validate the full feature at the end.
 *
 * Scoring Dimensions:
 * - Coherence Degradation Rate: Coherence score vs. scale factor slope.
 * - Orientation Overhead Ratio: Tokens on orientation vs. total tokens.
 * - Integration Success Rate: Percentage of integration tests passing.
 * - Break Point: Scale factor where coherence < 60% or overhead > 40%.
 *
 * Excluded from --scenario all; must be explicitly invoked.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type {
  ScenarioMetadata,
  AgentTask,
  RawResults,
  ScaleTestConfig,
} from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';
import {
  buildEvaluationContextFromResults,
  runSingleEvaluation,
  ARCHITECTURAL_COHERENCE_TEMPLATE,
} from '../analyzer/llm-judge.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;

/** Base session count before scale factor multiplier */
const BASE_SESSION_COUNT = 4;

/** Base repo line count before scale factor multiplier */
const BASE_REPO_SIZE = 2000;

/**
 * Default scale test configuration.
 */
export const DEFAULT_SCALE_CONFIG: ScaleTestConfig = {
  scaleFactor: 1,
  baseSessionCount: BASE_SESSION_COUNT,
  baseRepoSize: BASE_REPO_SIZE,
};

/**
 * Ground truth manifest for the scale stress test.
 *
 * At each scale factor, agents build components that must integrate.
 * The ground truth defines expected integration patterns.
 */
export const SCALE_STRESS_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'scale-stress-test',
  description:
    'Expected outcome: All components integrate correctly at the given scale factor. Each component follows the established patterns and connects to previous components.',
  decisions: [
    {
      id: 'component-integration',
      description:
        'Each component should integrate with the shared service layer and follow the established module pattern.',
      affectedFiles: ['src/services/', 'src/components/'],
      expectedPatterns: [
        'import',
        'export',
        'service',
        'Service',
        'interface',
      ],
      antiPatterns: [
        'any',
      ],
    },
    {
      id: 'consistent-patterns',
      description:
        'All components should use consistent naming, error handling, and dependency injection patterns.',
      affectedFiles: ['src/'],
      expectedPatterns: [
        'interface',
        'class',
        'export',
        'async',
      ],
      antiPatterns: [],
    },
    {
      id: 'integration-tests',
      description:
        'Integration tests should verify cross-component functionality.',
      affectedFiles: ['tests/integration/'],
      expectedPatterns: [
        'describe',
        'it\\(',
        'test\\(',
        'expect',
        'integration',
      ],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {},
  baselineTestCoverage: 50,
};

/**
 * Generate the prompt for a component-building session.
 *
 * Each session builds a new component at scale:
 * - Sessions 1-4 (at scale 1): core components
 * - Sessions 5-8 (at scale 2): additional components + integration
 * - etc.
 */
/**
 * Codebase orientation block shared across all scale-stress-test prompts.
 */
const SCALE_ORIENTATION = `## Codebase Orientation
This is a TypeScript service. Key structural directories:
- \`src/services/\` — service classes (shared interface + component implementations)
- \`src/components/\` — component modules (if created by previous sessions)
- \`src/models/\` or \`src/types/\` — shared type definitions and interfaces
- \`tests/\` — unit and integration test files

Directory structure:
\`\`\`
src/
  models/        # Data models and shared interfaces
  services/      # Service layer (shared interface, component services)
  components/    # Component modules (created by agents)
  utils/         # Shared utilities
tests/           # Test files (unit + integration)
\`\`\`
`;

function buildComponentPrompt(sessionIndex: number, totalSessions: number): string {
  const componentNumber = sessionIndex + 1;
  const isIntegrationSession = sessionIndex === totalSessions - 1;
  const isEarlySession = sessionIndex < 4;

  if (isIntegrationSession) {
    return `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${SCALE_ORIENTATION}
Your task: Write integration tests for all ${totalSessions - 1} components that have been built and ensure everything works end-to-end.

Specifically:
1. Review all components in \`src/services/\` and \`src/components/\` that have been added by previous sessions.
2. Write integration tests that verify cross-component functionality.
3. Test that all components integrate correctly with the shared service layer.
4. Test error propagation across component boundaries.
5. Fix any integration issues you discover.
6. Make sure ALL tests pass.

Important:
- This is the final session — focus on integration, not new features.
- Fix issues but don't restructure existing code.
- Make sure the codebase compiles and all tests pass when you're done.`;
  }

  if (isEarlySession) {
    return `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${SCALE_ORIENTATION}
Your task: Build component #${componentNumber} for the modular feature system.

Specifically:
1. ${sessionIndex === 0 ? 'Design the component architecture and shared service interface. Create the base patterns in `src/services/` that subsequent components will follow.' : 'Review the existing components and architecture in `src/services/` established by previous sessions.'}
2. Create component-${componentNumber} with:
   - A service class that implements the shared interface
   - At least 2 public methods with clear TypeScript interfaces
   - Proper error handling
   - Unit tests for the component
3. ${sessionIndex === 0 ? 'Create a shared service interface and registry in `src/services/` that future components will use.' : 'Register your component with the existing service registry in `src/services/`.'}
4. Make sure the codebase compiles and tests pass.

Important:
- ${sessionIndex === 0 ? 'Establish clear patterns — all subsequent components will follow your architecture.' : 'Follow the patterns established by earlier sessions — do NOT redesign the architecture.'}
- Make sure the codebase compiles and tests pass when you're done.`;
  }

  // Later sessions at higher scale factors
  return `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

${SCALE_ORIENTATION}
Your task: Build component #${componentNumber} and integrate it with the existing ${componentNumber - 1} components.

Specifically:
1. Review the existing component architecture in \`src/services/\` and \`src/components/\` and their integration patterns.
2. Create component-${componentNumber} following the established patterns:
   - A service class implementing the shared interface
   - At least 2 public methods with TypeScript interfaces
   - Proper error handling
   - Integration with at least 2 existing components
3. Add unit tests for the new component.
4. Add an integration test verifying component-${componentNumber} works with existing components.
5. Make sure the codebase compiles and ALL tests pass.

Important:
- Follow established patterns — consistency is critical.
- Integrate with existing components, don't create isolated modules.
- Make sure the codebase compiles and tests pass when you're done.`;
}

export class ScaleStressTestScenario extends BaseScenario {
  private scaleConfig: ScaleTestConfig;

  constructor(scaleConfig?: Partial<ScaleTestConfig>) {
    super();
    this.scaleConfig = {
      ...DEFAULT_SCALE_CONFIG,
      ...scaleConfig,
    };
  }

  /** Get the current scale configuration. */
  getScaleConfig(): ScaleTestConfig {
    return { ...this.scaleConfig };
  }

  /** Update the scale factor. Must be called before setup(). */
  setScaleFactor(factor: number): void {
    if (factor < 1 || factor > 5) {
      throw new Error(`Scale factor must be 1-5, got ${factor}`);
    }
    this.scaleConfig.scaleFactor = factor;
  }

  protected buildMetadata(): ScenarioMetadata {
    const sessionCount = this.scaleConfig.scaleFactor * this.scaleConfig.baseSessionCount;
    return {
      name: 'scale-stress-test',
      description:
        `Scale stress test at factor ${this.scaleConfig.scaleFactor}: ${sessionCount} sessions building ${sessionCount - 1} components. Measures coherence degradation and orientation overhead.`,
      estimatedDurationMinutes: sessionCount * 15,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: sessionCount,
      scoringDimensions: [
        'coherenceDegradation',
        'orientationOverhead',
        'integrationSuccess',
      ],
      excludeFromAll: true, // Excluded from --scenario all
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    const totalSessions =
      this.scaleConfig.scaleFactor * this.scaleConfig.baseSessionCount;

    const tasks: AgentTask[] = [];

    for (let i = 0; i < totalSessions; i++) {
      tasks.push({
        prompt: buildComponentPrompt(i, totalSessions),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: i,
        maxTurns: DEFAULT_MAX_TURNS,
        role: i === totalSessions - 1 ? 'integration-tester' : `component-builder-${i + 1}`,
      });
    }

    return tasks;
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return SCALE_STRESS_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'scale-stress-test',
      scaleFactor: this.scaleConfig.scaleFactor,
      sessionCount: this.scaleConfig.scaleFactor * this.scaleConfig.baseSessionCount,
      baseRepoSize: this.scaleConfig.baseRepoSize,
      targetRepoSize: this.scaleConfig.scaleFactor * this.scaleConfig.baseRepoSize,
    };
  }

  protected async doScore(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    let coherenceDegradation: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, _groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, ARCHITECTURAL_COHERENCE_TEMPLATE, evalCtx);
      coherenceDegradation = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      coherenceDegradation = this.scoreCoherenceDegradation(rawResults);
    }
    const orientationOverhead = this.scoreOrientationOverhead(rawResults);
    const integrationSuccess = this.scoreIntegrationSuccess(rawResults);

    const scores: Record<string, DimensionScore> = {
      coherenceDegradation,
      orientationOverhead,
      integrationSuccess,
    };

    const metrics = this.extractMetrics(rawResults);

    // Composite: weighted average
    const composite =
      coherenceDegradation.value * 0.35 +
      orientationOverhead.value * 0.30 +
      integrationSuccess.value * 0.35;

    return {
      runId: '',
      scenario: 'scale-stress-test',
      condition: '',
      iteration: 0,
      scores,
      metrics,
      composite,
    };
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Score coherence degradation: How consistent are later sessions
   * compared to early sessions?
   *
   * Measures pattern consistency across all sessions. Early sessions
   * establish patterns; later sessions should follow them.
   * A high score means patterns stayed consistent (low degradation).
   */
  private scoreCoherenceDegradation(rawResults: RawResults): DimensionScore {
    const transcripts = rawResults.transcripts;

    if (transcripts.length < 2) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'Not enough sessions to measure coherence degradation.',
      };
    }

    // Check for missing diff data across all transcripts
    const allChanges = transcripts.flatMap((t) => t.fileChanges);
    const allDiffs = allChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const hasMissingDiffs = allChanges.some((c) => c.diff === undefined);

    if (hasMissingDiffs && allDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
      };
    }

    // Divide sessions into early half and late half
    const midpoint = Math.floor(transcripts.length / 2);
    const earlyTranscripts = transcripts.slice(0, midpoint);
    const lateTranscripts = transcripts.slice(midpoint);

    // Measure pattern usage in each half
    const codePatterns = [
      /interface\s+\w+/,
      /class\s+\w+/,
      /async\s+\w+/,
      /export\s+(?:class|interface|function|const)/,
      /import\s+/,
      /extends\s+/,
      /implements\s+/,
    ];

    const earlyPatternCounts = this.countPatterns(earlyTranscripts, codePatterns);
    const latePatternCounts = this.countPatterns(lateTranscripts, codePatterns);

    // Calculate pattern consistency (Jaccard-like similarity)
    const earlyActive = new Set(
      Object.entries(earlyPatternCounts)
        .filter(([, count]) => count > 0)
        .map(([key]) => key),
    );
    const lateActive = new Set(
      Object.entries(latePatternCounts)
        .filter(([, count]) => count > 0)
        .map(([key]) => key),
    );

    const intersection = [...earlyActive].filter((p) => lateActive.has(p));
    const union = new Set([...earlyActive, ...lateActive]);

    const coherence = union.size > 0 ? intersection.length / union.size : 1;

    // Also check for cross-session rework in late sessions
    const lateReworkRatio = this.calculateLateReworkRatio(
      earlyTranscripts,
      lateTranscripts,
    );

    // Combined score: pattern coherence weighted with rework penalty
    const reworkPenalty = Math.round(lateReworkRatio * 30);
    const score = Math.max(0, Math.round(coherence * 100) - reworkPenalty);

    return {
      value: score,
      confidence: transcripts.length >= 4 ? 'medium' : 'low',
      method: 'automated',
      justification:
        `Pattern coherence: ${(coherence * 100).toFixed(1)}% (${intersection.length}/${union.size} patterns shared between early/late sessions). Late-session rework penalty: -${reworkPenalty}. Scale factor: ${this.scaleConfig.scaleFactor}.`,
      dataQuality: hasMissingDiffs ? 'partial' : 'complete',
    };
  }

  /**
   * Score orientation overhead: What fraction of tool calls is spent on
   * reading/orientation vs. productive work?
   *
   * Orientation = tool calls to Read, Grep, Glob, search tools, twining reads.
   * Production = tool calls to Edit, Write, Bash (build/test).
   *
   * Some orientation is expected and healthy (the "sweet spot" is 20-40%).
   * Too little means the agent is editing blind; too much means excessive overhead.
   *
   * Scoring curve (bell-shaped around the sweet spot):
   *   20-40% overhead  = 100 (sweet spot)
   *   10-20% overhead  = 50-100 (too little orientation)
   *   40-60% overhead  = 60-100 (slightly high but acceptable)
   *   60-80% overhead  = 20-60 (too much reading)
   *   < 10% overhead   = 30 (editing blind)
   *   > 80% overhead   = 0 (almost no productive work)
   */
  private scoreOrientationOverhead(rawResults: RawResults): DimensionScore {
    let orientationCalls = 0;
    let productionCalls = 0;
    let totalCalls = 0;

    const orientationTools = new Set([
      'Read', 'Grep', 'Glob', 'Search',
      'mcp__plugin_serena_serena__find_symbol',
      'mcp__plugin_serena_serena__get_symbols_overview',
      'mcp__plugin_serena_serena__search_for_pattern',
      'mcp__plugin_serena_serena__read_file',
      'mcp__plugin_twining_twining__twining_assemble',
      'mcp__plugin_twining_twining__twining_read',
      'mcp__plugin_twining_twining__twining_query',
      'mcp__plugin_twining_twining__twining_why',
      'mcp__plugin_twining_twining__twining_recent',
    ]);

    const productionTools = new Set([
      'Edit', 'Write', 'Bash',
      'mcp__plugin_serena_serena__replace_symbol_body',
      'mcp__plugin_serena_serena__replace_content',
      'mcp__plugin_serena_serena__create_text_file',
      'mcp__plugin_serena_serena__insert_after_symbol',
      'mcp__plugin_serena_serena__insert_before_symbol',
    ]);

    for (const transcript of rawResults.transcripts) {
      for (const tc of transcript.toolCalls) {
        totalCalls++;
        if (orientationTools.has(tc.toolName)) {
          orientationCalls++;
        } else if (productionTools.has(tc.toolName)) {
          productionCalls++;
        }
      }
    }

    if (totalCalls === 0) {
      return {
        value: 50,
        confidence: 'low',
        method: 'automated',
        justification: 'No tool calls recorded — cannot measure orientation overhead.',
      };
    }

    const overheadRatio = orientationCalls / totalCalls;

    // Bell-curve scoring around the sweet spot of 20-40% orientation overhead.
    // Real agents typically spend 40-70% of calls on orientation, so the old
    // curve (which scored 0 at >40%) was degenerate.
    let score: number;
    if (overheadRatio < 0.10) {
      // Too little orientation — editing blind
      score = 30;
    } else if (overheadRatio < 0.20) {
      // Ramping up toward sweet spot
      score = Math.round(30 + ((overheadRatio - 0.10) / 0.10) * 70);
    } else if (overheadRatio <= 0.40) {
      // Sweet spot: good balance of reading and writing
      score = 100;
    } else if (overheadRatio <= 0.60) {
      // Slightly high but acceptable
      score = Math.round(100 - ((overheadRatio - 0.40) / 0.20) * 40);
    } else if (overheadRatio <= 0.80) {
      // Too much reading, not enough productive work
      score = Math.round(60 - ((overheadRatio - 0.60) / 0.20) * 40);
    } else {
      // Almost no productive work
      score = Math.round(20 - ((overheadRatio - 0.80) / 0.20) * 20);
    }

    score = Math.max(0, Math.min(100, score));

    return {
      value: score,
      confidence: totalCalls >= 10 ? 'medium' : 'low',
      method: 'automated',
      justification:
        `Orientation: ${orientationCalls}/${totalCalls} tool calls (${(overheadRatio * 100).toFixed(1)}%). Production: ${productionCalls} calls. Sweet spot: 20-40%. Scale factor: ${this.scaleConfig.scaleFactor}.`,
    };
  }

  /**
   * Score integration success: Did agents successfully integrate their work at scale?
   *
   * Measures integration quality through multiple gradient signals:
   * - Cross-component file references (do later sessions reference earlier files?)
   * - Integration test coverage depth (not just existence, but breadth)
   * - Test execution and pass signals from Bash output
   * - Session completion rate (graduated, not binary threshold)
   * - Component connectivity (do components import/reference each other?)
   */
  private scoreIntegrationSuccess(rawResults: RawResults): DimensionScore {
    const transcripts = rawResults.transcripts;

    if (transcripts.length === 0) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'No transcripts available.',
      };
    }

    const lastTranscript = transcripts[transcripts.length - 1];
    const details: string[] = [];
    let score = 0;

    // --- Dimension 1: Session completion rate (0-15 points, graduated) ---
    const completedSessions = transcripts.filter(
      (t) => t.exitReason === 'completed',
    ).length;
    const completionRate = completedSessions / transcripts.length;
    const completionPoints = Math.round(completionRate * 15);
    score += completionPoints;
    details.push(`Completion: ${completedSessions}/${transcripts.length} sessions (${completionPoints}/15 pts).`);

    // --- Dimension 2: Final session quality (0-20 points) ---
    let finalSessionPoints = 0;
    if (lastTranscript.exitReason === 'completed') {
      finalSessionPoints += 5;
    }
    const testFiles = lastTranscript.fileChanges.filter(
      (fc) => /test|spec|integration/i.test(fc.path),
    );
    // Graduated: 1 test file = 3pts, 2 = 5pts, 3+ = 8pts
    if (testFiles.length >= 3) {
      finalSessionPoints += 8;
    } else if (testFiles.length === 2) {
      finalSessionPoints += 5;
    } else if (testFiles.length === 1) {
      finalSessionPoints += 3;
    }
    // Test execution with pass/fail signal
    const testBashCalls = lastTranscript.toolCalls.filter(
      (tc) =>
        tc.toolName === 'Bash' &&
        /(?:test|jest|vitest|mocha|npm\s+test|npx\s+.*test)/i.test(
          JSON.stringify(tc.parameters),
        ),
    );
    if (testBashCalls.length > 0) {
      finalSessionPoints += 4;
      // Bonus: multiple test runs suggest iteration on failures
      if (testBashCalls.length >= 3) {
        finalSessionPoints += 3;
      }
    }
    score += finalSessionPoints;
    details.push(`Final session: ${testFiles.length} test file(s), ${testBashCalls.length} test run(s) (${finalSessionPoints}/20 pts).`);

    // --- Dimension 3: Cross-session file integration (0-30 points) ---
    // Do later sessions touch files created by earlier sessions?
    const filesBySession: Map<number, Set<string>> = new Map();
    for (let i = 0; i < transcripts.length; i++) {
      filesBySession.set(i, new Set(transcripts[i].fileChanges.map((fc) => fc.path)));
    }
    let crossSessionTouches = 0;
    let totalLateFiles = 0;
    const midpoint = Math.floor(transcripts.length / 2);
    const earlyFiles = new Set<string>();
    for (let i = 0; i < midpoint; i++) {
      for (const fc of transcripts[i].fileChanges) {
        earlyFiles.add(fc.path);
      }
    }
    for (let i = midpoint; i < transcripts.length; i++) {
      for (const fc of transcripts[i].fileChanges) {
        totalLateFiles++;
        if (earlyFiles.has(fc.path)) {
          crossSessionTouches++;
        }
      }
    }
    // Also check: do late sessions read early files? (via Read tool calls)
    let crossSessionReads = 0;
    for (let i = midpoint; i < transcripts.length; i++) {
      for (const tc of transcripts[i].toolCalls) {
        if (tc.toolName === 'Read' && tc.parameters) {
          const filePath = String(tc.parameters.file_path || tc.parameters.path || '');
          if (earlyFiles.has(filePath)) {
            crossSessionReads++;
          }
        }
      }
    }
    const crossSessionRatio = totalLateFiles > 0
      ? Math.min(1, (crossSessionTouches + crossSessionReads * 0.5) / Math.max(totalLateFiles, 1))
      : 0;
    const crossSessionPoints = Math.round(crossSessionRatio * 30);
    score += crossSessionPoints;
    details.push(`Cross-session integration: ${crossSessionTouches} file overlaps, ${crossSessionReads} cross-reads (${crossSessionPoints}/30 pts).`);

    // --- Dimension 4: Component connectivity via imports (0-20 points) ---
    // Check diffs for import statements referencing other components
    const allDiffs = transcripts
      .flatMap((t) => t.fileChanges.map((fc) => fc.diff))
      .filter((d): d is string => d !== undefined)
      .join('\n');
    const importMatches = allDiffs.match(/import\s+.*from\s+['"]\..*['"]/g) || [];
    const crossComponentImports = importMatches.filter(
      (imp) => /component|service|shared|common|registry/i.test(imp),
    );
    // Graduated: 0 cross-imports = 0, 1-2 = 8, 3-5 = 14, 6+ = 20
    let connectivityPoints: number;
    if (crossComponentImports.length >= 6) {
      connectivityPoints = 20;
    } else if (crossComponentImports.length >= 3) {
      connectivityPoints = 14;
    } else if (crossComponentImports.length >= 1) {
      connectivityPoints = 8;
    } else if (importMatches.length >= 3) {
      // Some imports exist but not cross-component
      connectivityPoints = 4;
    } else {
      connectivityPoints = 0;
    }
    score += connectivityPoints;
    details.push(`Component connectivity: ${crossComponentImports.length} cross-component imports, ${importMatches.length} total (${connectivityPoints}/20 pts).`);

    // --- Dimension 5: Integration test depth (0-15 points) ---
    // Check if integration tests reference multiple components
    const integrationTestDiffs = transcripts
      .flatMap((t) => t.fileChanges
        .filter((fc) => /integration|e2e/i.test(fc.path))
        .map((fc) => fc.diff),
      )
      .filter((d): d is string => d !== undefined)
      .join('\n');
    const componentRefs = new Set<string>();
    const componentRefMatches = integrationTestDiffs.match(/[Cc]omponent[-_]?\d+|[Ss]ervice[-_]?\d+/g) || [];
    for (const ref of componentRefMatches) {
      componentRefs.add(ref.toLowerCase().replace(/[-_]/g, ''));
    }
    // Also count describe/it/test blocks as a depth signal
    const testBlockCount = (integrationTestDiffs.match(/(?:describe|it|test)\s*\(/g) || []).length;
    let depthPoints: number;
    if (componentRefs.size >= 3 && testBlockCount >= 5) {
      depthPoints = 15;
    } else if (componentRefs.size >= 2 && testBlockCount >= 3) {
      depthPoints = 10;
    } else if (componentRefs.size >= 1 || testBlockCount >= 2) {
      depthPoints = 5;
    } else if (testBlockCount >= 1) {
      depthPoints = 2;
    } else {
      depthPoints = 0;
    }
    score += depthPoints;
    details.push(`Integration depth: ${componentRefs.size} component refs, ${testBlockCount} test blocks (${depthPoints}/15 pts).`);

    return {
      value: Math.min(100, score),
      confidence: transcripts.length >= 4 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Count pattern occurrences across transcripts' diffs.
   */
  private countPatterns(
    transcripts: RawResults['transcripts'],
    patterns: RegExp[],
  ): Record<string, number> {
    const counts: Record<string, number> = {};

    const allDiffs = transcripts
      .flatMap((t) => t.fileChanges.map((fc) => fc.diff))
      .filter((d): d is string => d !== undefined)
      .join('\n');

    for (const pattern of patterns) {
      const key = pattern.source;
      const matches = allDiffs.match(new RegExp(pattern, 'g'));
      counts[key] = matches ? matches.length : 0;
    }

    return counts;
  }

  /**
   * Calculate the rework ratio in late sessions on early sessions' files.
   */
  private calculateLateReworkRatio(
    earlyTranscripts: RawResults['transcripts'],
    lateTranscripts: RawResults['transcripts'],
  ): number {
    const earlyFiles = new Set<string>();
    let earlyTotalAdded = 0;

    for (const t of earlyTranscripts) {
      for (const fc of t.fileChanges) {
        earlyFiles.add(fc.path);
        earlyTotalAdded += fc.linesAdded;
      }
    }

    if (earlyTotalAdded === 0) return 0;

    let lateRework = 0;
    for (const t of lateTranscripts) {
      for (const fc of t.fileChanges) {
        if (earlyFiles.has(fc.path)) {
          lateRework += fc.linesRemoved;
        }
      }
    }

    return Math.min(1, lateRework / earlyTotalAdded);
  }

  // extractMetrics is inherited from BaseScenario
}

export function createScaleStressTestScenario(
  scaleConfig?: Partial<ScaleTestConfig>,
): ScaleStressTestScenario {
  return new ScaleStressTestScenario(scaleConfig);
}
