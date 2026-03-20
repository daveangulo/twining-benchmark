/**
 * FR-SCN-001: Refactoring Handoff Scenario
 *
 * Agent A refactors the UserService to extract an IUserRepository interface
 * and implement the repository pattern. Agent B then extends the architecture
 * by adding a caching layer to user data access.
 *
 * Scoring dimensions:
 * - Consistency (0-100): Does Agent B's code align with Agent A's architectural choices?
 * - Rework (0-100): Inverse of code churn — 100 = no reverts/rewrites of A's code.
 * - Completion (0-100): Did both agents complete their assigned tasks?
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type { ScenarioMetadata, AgentTask, RawResults } from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';
import {
  buildEvaluationContextFromResults,
  runSingleEvaluation,
  DECISION_CONSISTENCY_TEMPLATE,
} from '../analyzer/llm-judge.js';

/** Default timeout per agent session: 15 minutes */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** Default max turns per agent session */
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest specific to the refactoring-handoff scenario.
 *
 * Defines what the agents should produce: an IUserRepository interface,
 * the existing repository pattern preserved, and a caching layer that
 * conforms to the interface.
 */
export const REFACTORING_HANDOFF_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'refactoring-handoff',
  description:
    'Expected outcome: IUserRepository interface extracted, repository pattern preserved, caching layer added conforming to the interface.',
  decisions: [
    {
      id: 'extract-iuser-repository',
      description:
        'Agent A should extract an IUserRepository interface from the existing UserRepository class, defining the contract for user data access.',
      affectedFiles: [
        'src/repositories/user.repository.ts',
        'src/services/user.service.ts',
      ],
      expectedPatterns: [
        'interface IUserRepository',
        'implements IUserRepository',
        'IUserRepository',
      ],
      antiPatterns: [
        // Agent should NOT bypass the interface and use concrete class directly in service
        'new UserRepository',
      ],
    },
    {
      id: 'preserve-repository-pattern',
      description:
        'The existing repository pattern (BaseRepository → UserRepository) should be preserved. Agent A should not dismantle the base repository abstraction.',
      affectedFiles: [
        'src/repositories/base.repository.ts',
        'src/repositories/user.repository.ts',
      ],
      expectedPatterns: [
        'extends BaseRepository',
        'BaseRepository',
      ],
      antiPatterns: [
        // Should not remove the base repository
        'db\\.insert\\(',
        'db\\.findAll\\(',
      ],
    },
    {
      id: 'caching-via-interface',
      description:
        'Agent B should add a caching layer that implements IUserRepository (or wraps it), following the same interface contract Agent A established.',
      affectedFiles: [
        'src/repositories/user.repository.ts',
        'src/services/user.service.ts',
      ],
      expectedPatterns: [
        'cache',
        'Cache',
        'IUserRepository',
      ],
      antiPatterns: [
        // Should not bypass the repository interface for caching
        'db\\.findById.*cache',
      ],
    },
  ],
  moduleDependencies: {
    'services/user.service': [
      'repositories/user.repository',
      'events/event-bus',
    ],
    'repositories/user.repository': [
      'repositories/base.repository',
      'utils/database',
    ],
  },
  baselineTestCoverage: 80,
};

/**
 * Agent A prompt: Extract IUserRepository interface and implement repository pattern.
 *
 * Template variables: {{repo_path}}, {{agent_number}}, {{total_agents}}, {{scenario_name}}
 */
const AGENT_A_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). Key files for your task:
- \`src/repositories/user.repository.ts\` — UserRepository class (your main refactoring target)
- \`src/repositories/base.repository.ts\` — BaseRepository abstract class (preserve this pattern)
- \`src/services/user.service.ts\` — UserService that depends on UserRepository
- \`src/models/user.ts\` — User model/type definitions
- \`tests/\` — existing test files

Directory structure:
\`\`\`
src/
  models/        # Data models
  repositories/  # Data access layer (base + user)
  services/      # Business logic
  utils/         # Shared utilities
tests/           # Test files
\`\`\`

Your task: Refactor the UserService to extract an IUserRepository interface and implement the repository pattern. Document your decisions.

Specifically:
1. Look at \`src/repositories/user.repository.ts\` and \`src/services/user.service.ts\` to understand the current dependency.
2. Extract an IUserRepository interface that captures the public API of UserRepository.
3. Update \`src/services/user.service.ts\` to depend on IUserRepository (the interface) rather than the concrete UserRepository class.
4. Ensure the existing UserRepository in \`src/repositories/user.repository.ts\` implements the new interface.
5. Make sure all existing tests still pass after your refactoring.
6. Document what you did and why — leave clear notes for the next developer.

Important:
- Do NOT change the existing functionality — this is a pure refactoring.
- Preserve the existing BaseRepository pattern in \`src/repositories/base.repository.ts\`.
- Make sure the codebase compiles and tests pass when you're done.`;

/**
 * Agent B prompt: Add caching layer to user data access.
 *
 * Template variables: {{repo_path}}, {{agent_number}}, {{total_agents}}, {{scenario_name}}
 */
const AGENT_B_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). Key files for your task:
- \`src/repositories/user.repository.ts\` — UserRepository class (may now implement IUserRepository)
- \`src/repositories/base.repository.ts\` — BaseRepository abstract class
- \`src/services/user.service.ts\` — UserService (depends on the repository interface)
- \`src/models/user.ts\` — User model/type definitions
- \`tests/\` — existing test files

Directory structure:
\`\`\`
src/
  models/        # Data models
  repositories/  # Data access layer (base + user)
  services/      # Business logic
  utils/         # Shared utilities
tests/           # Test files
\`\`\`

Your task: Add a caching layer to the user data access. Build on the existing architecture.

Specifically:
1. Review \`src/repositories/user.repository.ts\` and \`src/services/user.service.ts\` to understand the current architecture and any interfaces (e.g., IUserRepository).
2. Add an in-memory caching layer for user lookups (findById, findByEmail).
3. The cache should integrate with the existing patterns and interfaces in \`src/repositories/\`.
4. Cache invalidation: updates and deletes should invalidate the relevant cache entries.
5. Add tests for the caching behavior.
6. Make sure the codebase compiles and all existing tests still pass.

Important:
- Build on what's already there — respect the existing architecture and patterns.
- Don't restructure or rewrite existing code unnecessarily.
- Make sure the codebase compiles and tests pass when you're done.`;

export class RefactoringHandoffScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'refactoring-handoff',
      description:
        'Agent A extracts an IUserRepository interface. Agent B adds a caching layer. Measures consistency, rework, and completion.',
      estimatedDurationMinutes: 30,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 2,
      scoringDimensions: ['consistency', 'rework', 'completion'],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: AGENT_A_PROMPT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'refactorer',
      },
      {
        prompt: AGENT_B_PROMPT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'extender',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return REFACTORING_HANDOFF_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'refactoring-handoff',
      agentARole: 'refactorer',
      agentBRole: 'extender',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    let consistency: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, DECISION_CONSISTENCY_TEMPLATE, evalCtx);
      consistency = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      consistency = this.scoreConsistency(rawResults, groundTruth);
    }
    const rework = this.scoreRework(rawResults);
    const completion = this.scoreCompletion(rawResults);

    const scores: Record<string, DimensionScore> = {
      consistency,
      rework,
      completion,
    };

    // Composite: weighted average per PRD Section 9.2
    const composite =
      consistency.value * 0.4 +
      rework.value * 0.3 +
      completion.value * 0.3;

    return {
      runId: '', // Set by the runner
      scenario: 'refactoring-handoff',
      condition: '', // Set by the runner
      iteration: 0, // Set by the runner
      scores,
      metrics: this.extractMetrics(rawResults),
      composite,
    };
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Score consistency: Does Agent B's code align with Agent A's architectural choices?
   *
   * Uses additive scoring across independent signals to produce a gradient:
   *
   * Signal 1 (25 pts): Agent B imports from A's new/modified modules
   * Signal 2 (25 pts): Agent B references the IUserRepository interface
   * Signal 3 (25 pts): Agent B implements or wraps IUserRepository (structural conformance)
   * Signal 4 (25 pts): Agent B avoids anti-patterns from ground truth
   *
   * This replaces the old subtract-from-100 approach which always yielded ~80.
   */
  private scoreConsistency(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];
    if (!transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent B did not produce a transcript.',
      };
    }

    // Collect Agent B's diffs
    const bChanges = transcriptB.fileChanges;
    const bDiffs = bChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const hasMissingDiffs = bChanges.some((c) => c.diff === undefined);

    if (hasMissingDiffs && bDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
      };
    }

    // Collect Agent A's diffs for cross-referencing
    const aDiffs = transcriptA
      ? transcriptA.fileChanges
          .map((c) => c.diff)
          .filter((d): d is string => d !== undefined)
          .join('\n')
      : '';
    const aFiles = new Set(
      transcriptA ? transcriptA.fileChanges.map((c) => c.path) : [],
    );
    const bFiles = new Set(bChanges.map((c) => c.path));

    let score = 0;
    const signals: string[] = [];

    // --- Signal 1 (25 pts): Agent B imports from or touches A's modules ---
    // Check if B's diffs import from files that A modified, or if B modifies
    // files that A also touched (showing awareness of A's work).
    const bImportsFromAModules = aFiles.size > 0 && Array.from(aFiles).some((aFile) => {
      // Extract module name from file path (e.g., "src/repositories/user.repository.ts" -> "user.repository")
      const moduleName = aFile.replace(/^src\//, '').replace(/\.ts$/, '');
      const baseName = moduleName.split('/').pop() ?? '';
      // Check if B's diffs contain an import referencing this module
      return (
        new RegExp(`from\\s+['"]\\..*${baseName.replace('.', '\\.')}`, 'i').test(bDiffs) ||
        new RegExp(`require\\(.*${baseName.replace('.', '\\.')}`, 'i').test(bDiffs)
      );
    });
    const bTouchesAFiles = aFiles.size > 0 && Array.from(aFiles).some((f) => bFiles.has(f));

    if (bImportsFromAModules) {
      score += 25;
      signals.push('B imports from A\'s modified modules (+25)');
    } else if (bTouchesAFiles) {
      score += 15;
      signals.push('B modifies files A touched but does not import from A\'s modules (+15)');
    } else {
      signals.push('B does not reference A\'s modules (+0)');
    }

    // --- Signal 2 (25 pts): Agent B references IUserRepository interface ---
    // This checks whether B is aware of the interface A created.
    const interfaceRefPattern = /IUserRepository/;
    const bReferencesInterface = interfaceRefPattern.test(bDiffs);
    // Also check if A actually created the interface
    const aCreatedInterface = interfaceRefPattern.test(aDiffs);

    if (bReferencesInterface) {
      score += 25;
      signals.push('B references IUserRepository interface (+25)');
    } else if (!aCreatedInterface) {
      // A didn't create the interface, so B can't be faulted for not using it
      score += 15;
      signals.push('A did not create IUserRepository; B not penalized (+15)');
    } else {
      signals.push('B does not reference IUserRepository despite A creating it (+0)');
    }

    // --- Signal 3 (25 pts): Agent B structurally conforms to the interface ---
    // Checks for implements/extends IUserRepository, or wraps it (decorator/proxy pattern).
    const implementsInterface = /implements\s+IUserRepository/.test(bDiffs);
    const extendsInterface = /extends\s+\S*UserRepository/.test(bDiffs);
    const wrapsRepository =
      /(?:private|readonly|protected)\s+\w*(?:repository|repo|delegate|inner)\w*\s*[;:]/i.test(bDiffs) &&
      bReferencesInterface;
    const usesCachePattern =
      /[Cc]ache/.test(bDiffs) && bReferencesInterface;

    if (implementsInterface) {
      score += 25;
      signals.push('B implements IUserRepository (+25)');
    } else if (wrapsRepository || extendsInterface) {
      score += 20;
      signals.push('B wraps or extends the repository pattern (+20)');
    } else if (usesCachePattern) {
      score += 10;
      signals.push('B uses cache with interface reference but no structural conformance (+10)');
    } else {
      signals.push('B does not structurally conform to A\'s interface (+0)');
    }

    // --- Signal 4 (25 pts): Absence of anti-patterns ---
    // Start with full points and deduct for each anti-pattern violation.
    let antiPatternScore = 25;
    const antiPatternIssues: string[] = [];

    for (const decision of groundTruth.decisions) {
      for (const pattern of decision.antiPatterns) {
        if (new RegExp(pattern).test(bDiffs)) {
          antiPatternScore -= 8;
          antiPatternIssues.push(
            `anti-pattern '${pattern}' found for ${decision.id}`,
          );
        }
      }
    }
    antiPatternScore = Math.max(0, antiPatternScore);
    score += antiPatternScore;

    if (antiPatternIssues.length === 0) {
      signals.push('No anti-patterns detected (+25)');
    } else {
      signals.push(
        `Anti-pattern deductions: ${antiPatternIssues.join('; ')} (+${antiPatternScore})`,
      );
    }

    return {
      value: Math.max(0, Math.min(100, score)),
      confidence: bDiffs.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: `Consistency signals: ${signals.join('. ')}.`,
      dataQuality: hasMissingDiffs ? 'partial' : 'complete',
    };
  }

  /**
   * Score rework: Inverse of code churn on Agent A's files.
   *
   * 100 = Agent B made zero reverts/rewrites of A's code.
   * 0 = Agent A's work was effectively discarded.
   */
  private scoreRework(rawResults: RawResults): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];

    if (!transcriptA || !transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Missing transcripts — cannot measure rework.',
      };
    }

    // Files modified by Agent A
    const aFiles = new Set(
      transcriptA.fileChanges.map((c) => c.path),
    );

    // Part 1: Line-level rework (B deleting A's additions)
    let totalALines = 0;
    let reworkedLines = 0;

    for (const aChange of transcriptA.fileChanges) {
      totalALines += aChange.linesAdded;
    }

    for (const bChange of transcriptB.fileChanges) {
      if (aFiles.has(bChange.path)) {
        reworkedLines += bChange.linesRemoved;
      }
    }

    // Part 2: Investigation overlap (B re-reading files A already investigated)
    const aReadFiles = new Set<string>();
    for (const tc of transcriptA.toolCalls) {
      if (tc.toolName === 'Read' || tc.toolName === 'Edit') {
        const fp = tc.parameters['file_path'] as string | undefined;
        if (fp) {
          const basename = fp.split('/').pop() ?? fp;
          aReadFiles.add(basename);
        }
      }
    }

    let bOverlapReads = 0;
    let bTotalReads = 0;
    for (const tc of transcriptB.toolCalls) {
      if (tc.toolName === 'Read') {
        bTotalReads++;
        const fp = tc.parameters['file_path'] as string | undefined;
        if (fp) {
          const basename = fp.split('/').pop() ?? fp;
          if (aReadFiles.has(basename)) bOverlapReads++;
        }
      }
    }

    // Avoid division by zero
    if (totalALines === 0 && aReadFiles.size === 0) {
      return {
        value: 100,
        confidence: 'low',
        method: 'automated',
        justification: 'Agent A made no changes and investigated no files, so no rework is possible.',
      };
    }

    // Combine: line rework (60%) + investigation overlap (40%)
    const lineReworkRatio = totalALines > 0 ? Math.min(1, reworkedLines / totalALines) : 0;
    const investigationReworkRatio = bTotalReads > 0 && aReadFiles.size > 0
      ? bOverlapReads / bTotalReads
      : 0;
    const combinedRework = lineReworkRatio * 0.6 + investigationReworkRatio * 0.4;
    const score = Math.round((1 - combinedRework) * 100);

    const details: string[] = [];
    if (reworkedLines > 0) {
      details.push(`Agent B removed ${reworkedLines} lines from files Agent A modified (${totalALines} lines added by A).`);
    }
    if (bOverlapReads > 0) {
      details.push(`Agent B re-read ${bOverlapReads} of ${bTotalReads} files A had already investigated.`);
    }
    if (details.length === 0) {
      details.push('Agent B preserved all of Agent A\'s work and avoided redundant investigation.');
    }

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score completion: Did both agents complete their assigned tasks?
   *
   * 100 = both agents completed fully.
   * 50 = one agent completed.
   * 0 = neither completed.
   */
  private scoreCompletion(rawResults: RawResults): DimensionScore {
    let score = 0;
    const details: string[] = [];

    for (let i = 0; i < rawResults.transcripts.length; i++) {
      const transcript = rawResults.transcripts[i];
      if (!transcript) continue;

      const agentLabel = i === 0 ? 'Agent A' : 'Agent B';

      if (transcript.exitReason === 'completed') {
        // Check that the agent actually made file changes
        if (transcript.fileChanges.length > 0) {
          score += 50;
          details.push(`${agentLabel}: completed with ${transcript.fileChanges.length} file changes.`);
        } else {
          score += 15;
          details.push(`${agentLabel}: session completed but no file changes detected.`);
        }
      } else if (transcript.exitReason === 'timeout') {
        // Partial credit if some work was done
        if (transcript.fileChanges.length > 0) {
          score += 25;
          details.push(`${agentLabel}: timed out but made ${transcript.fileChanges.length} file changes.`);
        } else {
          details.push(`${agentLabel}: timed out with no file changes.`);
        }
      } else {
        details.push(`${agentLabel}: session ended with ${transcript.exitReason}.`);
      }
    }

    return {
      value: Math.min(100, score),
      confidence: 'high',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Extract quantitative metrics from raw results.
   */
  // extractMetrics is inherited from BaseScenario
}

/**
 * Factory function for the scenario registry.
 */
export function createRefactoringHandoffScenario(): RefactoringHandoffScenario {
  return new RefactoringHandoffScenario();
}
