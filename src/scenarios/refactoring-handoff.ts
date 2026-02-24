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

import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type { ScenarioMetadata, AgentTask, RawResults } from '../types/scenario.js';
import { BaseScenario } from './scenario.interface.js';

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
  ): Promise<ScoredResults> {
    const consistency = this.scoreConsistency(rawResults, groundTruth);
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
   * Checks:
   * - Agent B uses the IUserRepository interface (if A created it)
   * - Agent B doesn't introduce contradictory patterns
   * - Agent B's caching layer conforms to the interface
   */
  private scoreConsistency(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const transcriptB = rawResults.transcripts[1];
    if (!transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent B did not produce a transcript.',
      };
    }

    let score = 100;
    const issues: string[] = [];

    // Check if Agent B's file changes reference the expected patterns
    const bChanges = transcriptB.fileChanges;
    const bDiffs = bChanges
      .map((c) => c.diff ?? '')
      .join('\n');

    for (const decision of groundTruth.decisions) {
      // Check expected patterns in Agent B's changes
      const hasExpected = decision.expectedPatterns.some(
        (pattern) => new RegExp(pattern).test(bDiffs),
      );

      // Check for anti-patterns
      const hasAntiPattern = decision.antiPatterns.some(
        (pattern) => new RegExp(pattern).test(bDiffs),
      );

      if (!hasExpected && decision.id === 'caching-via-interface') {
        score -= 30;
        issues.push(
          `Agent B did not use the expected interface pattern for ${decision.id}`,
        );
      }

      if (hasAntiPattern) {
        score -= 20;
        issues.push(
          `Agent B introduced anti-pattern for ${decision.id}`,
        );
      }
    }

    return {
      value: Math.max(0, score),
      confidence: bDiffs.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification:
        issues.length > 0
          ? `Consistency issues found: ${issues.join('; ')}`
          : 'Agent B aligned with Agent A\'s architectural choices.',
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

    // Count how many of A's files were modified by B and how much
    let totalALines = 0;
    let reworkedLines = 0;

    for (const aChange of transcriptA.fileChanges) {
      totalALines += aChange.linesAdded;
    }

    for (const bChange of transcriptB.fileChanges) {
      if (aFiles.has(bChange.path)) {
        // B modified a file that A changed — count removed lines as rework
        reworkedLines += bChange.linesRemoved;
      }
    }

    // Avoid division by zero
    if (totalALines === 0) {
      return {
        value: 100,
        confidence: 'low',
        method: 'automated',
        justification: 'Agent A made no changes, so no rework is possible.',
      };
    }

    const reworkRatio = Math.min(1, reworkedLines / totalALines);
    const score = Math.round((1 - reworkRatio) * 100);

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification:
        reworkedLines === 0
          ? 'Agent B preserved all of Agent A\'s work.'
          : `Agent B removed ${reworkedLines} lines from files Agent A modified (${totalALines} lines added by A). Rework ratio: ${(reworkRatio * 100).toFixed(1)}%.`,
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
  private extractMetrics(rawResults: RawResults) {
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let costUsd = 0;
    let wallTimeMs = 0;
    let numTurns = 0;
    let compactionCount = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    let maxContextUtilization = 0;

    const changedFiles = new Set<string>();

    for (const transcript of rawResults.transcripts) {
      totalTokens += transcript.tokenUsage.total;
      inputTokens += transcript.tokenUsage.input;
      outputTokens += transcript.tokenUsage.output;
      cacheReadTokens += transcript.tokenUsage.cacheRead;
      cacheCreationTokens += transcript.tokenUsage.cacheCreation;
      costUsd += transcript.tokenUsage.costUsd;
      wallTimeMs += transcript.timing.durationMs;
      numTurns += transcript.numTurns;
      compactionCount += transcript.compactionCount;

      // Context utilization: peak cumulative input / context window
      if (transcript.contextWindowSize > 0) {
        const utilization = transcript.tokenUsage.total / transcript.contextWindowSize;
        maxContextUtilization = Math.max(maxContextUtilization, utilization);
      }

      for (const change of transcript.fileChanges) {
        linesAdded += change.linesAdded;
        linesRemoved += change.linesRemoved;
        changedFiles.add(change.path);
      }
    }

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
      wallTimeMs,
      agentSessions: rawResults.transcripts.length,
      numTurns,
      compactionCount,
      contextUtilization: maxContextUtilization,
      gitChurn: {
        linesAdded,
        linesRemoved,
        filesChanged: changedFiles.size,
        reverts: 0, // Calculated by deeper analysis later
      },
      testsPass: 0, // Filled by test runner
      testsFail: 0, // Filled by test runner
      compiles: rawResults.allSessionsCompleted,
    };
  }
}

/**
 * Factory function for the scenario registry.
 */
export function createRefactoringHandoffScenario(): RefactoringHandoffScenario {
  return new RefactoringHandoffScenario();
}
