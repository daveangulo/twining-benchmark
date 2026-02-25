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
    };
  }

  /**
   * Score orientation overhead: What fraction of tokens is spent on
   * reading/orientation vs. productive work?
   *
   * Orientation = tool calls to Read, Grep, Glob, search tools.
   * Production = tool calls to Edit, Write, Bash (build/test).
   *
   * 100 = low overhead (< 10%), 0 = high overhead (> 40%).
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
      'mcp__twining__twining_assemble',
      'mcp__twining__twining_read',
      'mcp__twining__twining_query',
      'mcp__twining__twining_why',
      'mcp__twining__twining_recent',
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

    // Score mapping: <10% overhead = 100, 10-20% = 80-60, 20-40% = 60-20, >40% = 0
    let score: number;
    if (overheadRatio <= 0.10) {
      score = 100;
    } else if (overheadRatio <= 0.20) {
      score = Math.round(100 - ((overheadRatio - 0.10) / 0.10) * 40);
    } else if (overheadRatio <= 0.40) {
      score = Math.round(60 - ((overheadRatio - 0.20) / 0.20) * 60);
    } else {
      score = 0;
    }

    return {
      value: score,
      confidence: totalCalls >= 10 ? 'medium' : 'low',
      method: 'automated',
      justification:
        `Orientation: ${orientationCalls}/${totalCalls} tool calls (${(overheadRatio * 100).toFixed(1)}%). Production: ${productionCalls} calls. Scale factor: ${this.scaleConfig.scaleFactor}.`,
    };
  }

  /**
   * Score integration success: Did the final session's integration tests pass?
   *
   * Since we can't run tests directly, we proxy by checking:
   * - Final session completed
   * - Final session added test files
   * - No errors reported
   */
  private scoreIntegrationSuccess(rawResults: RawResults): DimensionScore {
    const lastTranscript = rawResults.transcripts[rawResults.transcripts.length - 1];

    if (!lastTranscript) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Final session did not produce a transcript.',
      };
    }

    let score = 0;
    const details: string[] = [];

    // Check: Did the final session complete?
    if (lastTranscript.exitReason === 'completed') {
      score += 30;
      details.push('Final session completed.');
    } else {
      details.push(`Final session ended with: ${lastTranscript.exitReason}.`);
    }

    // Check: Did the final session produce test files?
    const testFiles = lastTranscript.fileChanges.filter(
      (fc) => /test|spec|integration/i.test(fc.path),
    );
    if (testFiles.length > 0) {
      score += 30;
      details.push(`${testFiles.length} test file(s) produced by final session.`);
    } else {
      details.push('No test files from final session.');
    }

    // Check: Was there a Bash call to run tests?
    const ranTests = lastTranscript.toolCalls.some(
      (tc) =>
        tc.toolName === 'Bash' &&
        /(?:test|jest|vitest|mocha|npm\s+test|npx\s+.*test)/i.test(
          JSON.stringify(tc.parameters),
        ),
    );
    if (ranTests) {
      score += 20;
      details.push('Tests were executed in the final session.');
    }

    // Check: Overall completion rate
    const completedSessions = rawResults.transcripts.filter(
      (t) => t.exitReason === 'completed',
    ).length;
    const completionRate = completedSessions / rawResults.transcripts.length;
    if (completionRate >= 0.8) {
      score += 20;
      details.push(`${completedSessions}/${rawResults.transcripts.length} sessions completed (${(completionRate * 100).toFixed(0)}%).`);
    } else {
      details.push(`Only ${completedSessions}/${rawResults.transcripts.length} sessions completed.`);
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
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
      .flatMap((t) => t.fileChanges.map((fc) => fc.diff ?? ''))
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
