/**
 * Concurrent Agents Scenario
 *
 * Three agents work in parallel on the same codebase (caching, audit logging,
 * validation). A fourth merge agent resolves conflicts and ensures integration.
 *
 * Scoring Dimensions:
 * - Merge Conflicts (40%): Did the merge agent resolve conflicts successfully?
 * - Architectural Consistency (30%): Do all 3 new services follow the same patterns?
 * - Completion (30%): Are all 3 features present in the final codebase?
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { WorkingDirectory, ArchitecturalManifest } from '../types/target.js';
import type { ConditionContext } from '../types/condition.js';
import type { ScoredResults, DimensionScore } from '../types/results.js';
import type {
  ScenarioMetadata,
  AgentTask,
  RawResults,
  ScenarioRunner,
} from '../types/scenario.js';
import type { AgentTranscript } from '../types/transcript.js';
import { BaseScenario } from './scenario.interface.js';

const WORKER_TIMEOUT_MS = 10 * 60 * 1000;
const MERGE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth manifest for the concurrent-agents scenario.
 */
export const CONCURRENT_AGENTS_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'concurrent-agents',
  description:
    'Expected outcome: Three parallel features (caching, audit logging, validation) integrated cleanly by a merge agent.',
  decisions: [
    {
      id: 'caching',
      description: 'Cache service implementation',
      affectedFiles: ['src/services/cache.service.ts'],
      expectedPatterns: ['CacheService|cache\\.service'],
      antiPatterns: [],
    },
    {
      id: 'audit',
      description: 'Audit logging implementation',
      affectedFiles: ['src/services/audit.service.ts'],
      expectedPatterns: ['AuditService|audit\\.service'],
      antiPatterns: [],
    },
    {
      id: 'validation',
      description: 'Input validation implementation',
      affectedFiles: ['src/utils/validation.ts', 'src/models/errors.ts'],
      expectedPatterns: ['ValidationError|validation\\.ts'],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {},
  baselineTestCoverage: 60,
};

/**
 * Agent A prompt: Add caching layer.
 */
const AGENT_A_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Your task: Add a caching layer to the service layer.

1. Create a CacheService in src/services/cache.service.ts with get/set/invalidate methods
2. Add caching to UserService — cache user lookups by ID with 5-minute TTL
3. Add caching to OrderService — cache order lookups
4. Use a simple in-memory Map as the cache store
5. Add cache invalidation when entities are updated
6. Add tests for the caching behavior

Follow the existing repository and service patterns in the codebase.`;

/**
 * Agent B prompt: Add audit logging.
 */
const AGENT_B_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Your task: Add audit logging to track all service operations.

1. Create an AuditService in src/services/audit.service.ts
2. Define audit event types (user.created, order.placed, etc.) in src/events/event-types.ts
3. Log audit entries when UserService creates/updates users
4. Log audit entries when OrderService creates/updates orders
5. Store audit entries in an in-memory array (for now)
6. Add a method to query audit entries by type, user, or time range
7. Add tests for audit logging

Follow the existing service and event patterns in the codebase.`;

/**
 * Agent C prompt: Add input validation.
 */
const AGENT_C_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Your task: Add input validation to all service methods.

1. Create validation utilities in src/utils/validation.ts
2. Add input validation to UserService methods (validate email format, required fields, etc.)
3. Add input validation to OrderService methods (validate quantities, prices, required fields)
4. Throw typed ValidationError for invalid inputs
5. Add a ValidationError class in src/models/errors.ts
6. Add tests for validation logic

Follow the existing patterns in the codebase.`;

/**
 * Agent D prompt: Merge agent.
 */
const AGENT_D_PROMPT = `You are working on the TaskFlow Pro project at {{repo_path}}.

Multiple developers have been working on this codebase in parallel. They may have created conflicting changes.

Your task:
1. Review all recent changes for conflicts or inconsistencies
2. Resolve any merge conflicts or overlapping implementations
3. Ensure all services (caching, audit, validation) work together
4. Make sure the type system is consistent across all new code
5. Run all tests and fix any failures
6. Ensure the codebase compiles cleanly

Focus on integration — make the separate pieces work as a unified whole.`;

export class ConcurrentAgentsScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'concurrent-agents',
      description:
        'Three agents work in parallel (caching, audit logging, validation). A fourth merge agent resolves conflicts and ensures integration.',
      estimatedDurationMinutes: 40,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 4,
      scoringDimensions: ['merge-conflicts', 'architectural-consistency', 'completion'],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: AGENT_A_PROMPT,
        timeoutMs: WORKER_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'caching',
      },
      {
        prompt: AGENT_B_PROMPT,
        timeoutMs: WORKER_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'audit-logging',
      },
      {
        prompt: AGENT_C_PROMPT,
        timeoutMs: WORKER_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 2,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'validation',
      },
      {
        prompt: AGENT_D_PROMPT,
        timeoutMs: MERGE_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 3,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'merge-agent',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return CONCURRENT_AGENTS_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'concurrent-agents',
      parallelAgents: 3,
      mergeAgent: 1,
    };
  }

  /**
   * Custom execute: run first 3 tasks in parallel, then 4th sequentially.
   */
  async execute(runner: ScenarioRunner): Promise<RawResults> {
    if (!this.context || !this.tasks) {
      throw new Error('Scenario not set up. Call setup() first.');
    }

    const tasks = this.getAgentTasks();
    const parallelTasks = tasks.slice(0, 3);
    const mergeTask = tasks[3]!;

    // Run first 3 in parallel
    const parallelResults = await Promise.allSettled(
      parallelTasks.map(t => runner.runAgentTask(t)),
    );

    const transcripts: AgentTranscript[] = [];
    const errors: string[] = [];
    let allCompleted = true;

    for (let i = 0; i < parallelResults.length; i++) {
      const result = parallelResults[i]!;
      if (result.status === 'fulfilled') {
        transcripts.push(result.value);
        if (result.value.exitReason === 'error') {
          allCompleted = false;
          errors.push(`Task ${i}: ${result.value.error}`);
        }
      } else {
        allCompleted = false;
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`Task ${i} failed: ${message}`);
        // Push error placeholder transcript
        transcripts.push({
          sessionId: `error-${i}`,
          runId: '',
          scenario: 'concurrent-agents',
          condition: '',
          taskIndex: i,
          prompt: parallelTasks[i]!.prompt,
          toolCalls: [],
          fileChanges: [],
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, costUsd: 0 },
          timing: { startTime: new Date().toISOString(), endTime: new Date().toISOString(), durationMs: 0, timeToFirstActionMs: 0 },
          exitReason: 'error',
          error: message,
          numTurns: 0,
          stopReason: null,
          contextWindowSize: 0,
          compactionCount: 0,
          turnUsage: [],
        });
      }
    }

    // Run merge agent sequentially
    try {
      const mergeTranscript = await runner.runAgentTask(mergeTask);
      transcripts.push(mergeTranscript);
      if (mergeTranscript.exitReason === 'error') {
        allCompleted = false;
        errors.push(`Merge task: ${mergeTranscript.error}`);
      }
    } catch (err) {
      allCompleted = false;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Merge task failed: ${message}`);
      transcripts.push({
        sessionId: 'error-merge',
        runId: '',
        scenario: 'concurrent-agents',
        condition: '',
        taskIndex: 3,
        prompt: mergeTask.prompt,
        toolCalls: [],
        fileChanges: [],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, costUsd: 0 },
        timing: { startTime: new Date().toISOString(), endTime: new Date().toISOString(), durationMs: 0, timeToFirstActionMs: 0 },
        exitReason: 'error',
        error: message,
        numTurns: 0,
        stopReason: null,
        contextWindowSize: 0,
        compactionCount: 0,
        turnUsage: [],
      });
    }

    return {
      transcripts,
      finalWorkingDir: this.context.workingDir.path,
      allSessionsCompleted: allCompleted,
      errors,
    };
  }

  protected async doScore(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
    _evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const mergeConflicts = this.scoreMergeConflicts(rawResults);
    const architecturalConsistency = this.scoreArchitecturalConsistency(rawResults);
    const completion = this.scoreCompletion(rawResults);

    const scores: Record<string, DimensionScore> = {
      'merge-conflicts': mergeConflicts,
      'architectural-consistency': architecturalConsistency,
      completion,
    };

    const composite =
      mergeConflicts.value * 0.4 +
      architecturalConsistency.value * 0.3 +
      completion.value * 0.3;

    return {
      runId: '',
      scenario: 'concurrent-agents',
      condition: '',
      iteration: 0,
      scores,
      metrics: this.extractMetrics(rawResults),
      composite,
    };
  }

  protected async doTeardown(): Promise<void> {
    // No scenario-specific cleanup needed
  }

  /**
   * Score merge conflicts (40%):
   * Check merge agent transcript for conflict resolution. If merge agent
   * mentions "conflict" or "merge" issues and the final codebase compiles,
   * score high. If codebase doesn't compile, score low.
   */
  private scoreMergeConflicts(rawResults: RawResults): DimensionScore {
    const mergeTranscript = rawResults.transcripts[3];

    if (!mergeTranscript) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Merge agent did not produce a transcript.',
      };
    }

    let score = 0;
    const details: string[] = [];

    // 1. Did merge agent complete? (20 pts)
    if (mergeTranscript.exitReason === 'completed') {
      score += 20;
      details.push('Merge agent completed.');
    } else {
      details.push(`Merge agent ended with: ${mergeTranscript.exitReason}.`);
    }

    // 2. Did merge agent make integration changes? Graduated by scope. (30 pts)
    const mergeFileCount = mergeTranscript.fileChanges.length;
    if (mergeFileCount >= 3) {
      score += 30;
      details.push(`Modified ${mergeFileCount} files — broad integration.`);
    } else if (mergeFileCount >= 1) {
      score += 15;
      details.push(`Modified ${mergeFileCount} file(s) — limited integration.`);
    } else {
      details.push('No file changes — no integration work.');
    }

    // 3. Did merge agent modify cross-cutting files (index, config, shared modules)? (20 pts)
    const crossCutting = mergeTranscript.fileChanges.filter(fc =>
      /index\.ts|config|app|main|shared|common|integration/i.test(fc.path),
    );
    if (crossCutting.length > 0) {
      score += 20;
      details.push(`Touched ${crossCutting.length} cross-cutting file(s).`);
    } else {
      details.push('No cross-cutting files modified.');
    }

    // 4. Did merge agent run tests successfully? (30 pts) — outcome measure
    const ranTests = mergeTranscript.toolCalls.some(
      (tc) =>
        tc.toolName === 'Bash' &&
        /(?:test|vitest|jest|npm\s+test)/i.test(JSON.stringify(tc.parameters)),
    );
    if (rawResults.allSessionsCompleted && ranTests) {
      score += 30;
      details.push('All sessions completed and merge agent ran tests.');
    } else if (rawResults.allSessionsCompleted) {
      score += 15;
      details.push('All sessions completed but merge agent did not run tests.');
    } else {
      details.push('Not all sessions completed.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score architectural consistency (30%):
   * Check if all 3 new services follow the same patterns (dependency injection,
   * similar structure). Pattern match for consistent constructor patterns.
   */
  private scoreArchitecturalConsistency(rawResults: RawResults): DimensionScore {
    const workerTranscripts = rawResults.transcripts.slice(0, 3);

    if (workerTranscripts.length < 3) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Not all 3 worker agents produced transcripts.',
      };
    }

    const structuralPatterns = [
      /class\s+\w+Service/,
      /constructor\s*\(/,
      /export\s+class/,
      /async\s+\w+/,
      /interface\s+\w+/,
      /import\s+/,
    ];

    const patternSets: Set<string>[] = workerTranscripts.map(transcript => {
      const allDiffs = transcript.fileChanges.map(fc => fc.diff ?? '').join('\n');
      const found = new Set<string>();
      for (const pattern of structuralPatterns) {
        if (pattern.test(allDiffs)) {
          found.add(pattern.source);
        }
      }
      return found;
    });

    // Calculate pairwise similarity
    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < patternSets.length; i++) {
      for (let j = i + 1; j < patternSets.length; j++) {
        const a = patternSets[i]!;
        const b = patternSets[j]!;
        const intersection = [...a].filter(p => b.has(p));
        const union = new Set([...a, ...b]);
        const similarity = union.size > 0 ? intersection.length / union.size : 1;
        totalSimilarity += similarity;
        pairCount++;
      }
    }

    const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0;
    const score = Math.round(avgSimilarity * 100);

    return {
      value: score,
      confidence: patternSets.every(s => s.size > 0) ? 'medium' : 'low',
      method: 'automated',
      justification: `Average pairwise pattern similarity across 3 worker agents: ${(avgSimilarity * 100).toFixed(1)}%.`,
    };
  }

  /**
   * Score completion (30%):
   * Check if all 3 features are present in the final codebase
   * (CacheService, AuditService, ValidationError/validation.ts).
   */
  private scoreCompletion(rawResults: RawResults): DimensionScore {
    const allFiles = rawResults.transcripts
      .flatMap(t => t.fileChanges.map(fc => fc.path));
    const allDiffs = rawResults.transcripts
      .flatMap(t => t.fileChanges.map(fc => fc.diff ?? ''))
      .join('\n');
    const allFilePaths = allFiles.join('\n');

    let score = 0;
    const details: string[] = [];

    // Check for CacheService
    if (/CacheService/i.test(allDiffs) || /cache\.service/i.test(allFilePaths)) {
      score += 33;
      details.push('CacheService found.');
    } else {
      details.push('CacheService NOT found.');
    }

    // Check for AuditService
    if (/AuditService/i.test(allDiffs) || /audit\.service/i.test(allFilePaths)) {
      score += 33;
      details.push('AuditService found.');
    } else {
      details.push('AuditService NOT found.');
    }

    // Check for ValidationError / validation.ts
    if (/ValidationError/i.test(allDiffs) || /validation\.ts/i.test(allFilePaths)) {
      score += 34;
      details.push('Validation implementation found.');
    } else {
      details.push('Validation implementation NOT found.');
    }

    return {
      value: Math.min(100, score),
      confidence: 'medium',
      method: 'automated',
      justification: details.join(' '),
    };
  }
}

export function createConcurrentAgentsScenario(): ConcurrentAgentsScenario {
  return new ConcurrentAgentsScenario();
}
