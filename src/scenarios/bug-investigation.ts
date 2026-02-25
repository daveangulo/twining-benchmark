/**
 * FR-SCN-003: Bug Investigation Handoff Scenario
 *
 * Agent A investigates a planted bug (off-by-one pagination error) for 5 minutes,
 * then session is terminated. Agent B picks up the investigation, fixes the bug,
 * and adds a regression test.
 *
 * Task Flow:
 * 1. A known bug is planted (off-by-one in pagination causing duplicate results).
 * 2. Agent A investigates for 5 minutes (hard timeout).
 * 3. Agent B continues investigation, fixes the bug, adds regression test.
 *
 * Scoring Dimensions:
 * - Context Recovery (0-100): How much of A's investigation did B leverage?
 * - Redundant Investigation (0-100): Inverse of duplicated investigation steps.
 * - Resolution (0-100): Did B fix the bug and add a passing test?
 * - Time-to-Resolution (seconds): Wall clock time from B's start to fix commit.
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
  INTEGRATION_QUALITY_TEMPLATE,
} from '../analyzer/llm-judge.js';

/** Agent A timeout: 5 minutes (hard cutoff mid-investigation) */
const AGENT_A_TIMEOUT_MS = 5 * 60 * 1000;

/** Agent B timeout: 15 minutes */
const AGENT_B_TIMEOUT_MS = 15 * 60 * 1000;

const DEFAULT_MAX_TURNS = 50;

/**
 * Ground truth for the planted bug.
 *
 * The bug: an off-by-one error in the pagination logic of the search/list
 * endpoint. When calculating the offset for page N, the code uses
 * `(page - 1) * pageSize` but incorrectly subtracts 1 from the result,
 * causing page 2+ to show the last item from the previous page as a duplicate.
 */
export const BUG_INVESTIGATION_GROUND_TRUTH: ArchitecturalManifest = {
  name: 'bug-investigation',
  description:
    'Planted bug: off-by-one in pagination offset calculation causes duplicate items on page 2+. File: src/services/search.service.ts, function: paginate().',
  decisions: [
    {
      id: 'pagination-bug-location',
      description:
        'The bug is in src/services/search.service.ts in the paginate() or getPage() function. The offset calculation is off by one.',
      affectedFiles: ['src/services/search.service.ts'],
      expectedPatterns: [
        'offset',
        'page',
        'pageSize',
        'paginate',
        'getPage',
      ],
      antiPatterns: [],
    },
    {
      id: 'pagination-bug-fix',
      description:
        'The fix should correct the offset calculation to `(page - 1) * pageSize` without the extra subtraction.',
      affectedFiles: ['src/services/search.service.ts'],
      expectedPatterns: [
        '\\(page\\s*-\\s*1\\)\\s*\\*\\s*pageSize',
        'offset',
        'slice',
      ],
      antiPatterns: [
        'offset\\s*-\\s*1',
      ],
    },
    {
      id: 'regression-test',
      description:
        'A regression test should be added that specifically tests pagination with multiple pages and verifies no duplicates.',
      affectedFiles: [
        'tests/search.service.test.ts',
        'tests/pagination.test.ts',
        'src/services/__tests__/search.test.ts',
      ],
      expectedPatterns: [
        'duplicate',
        'page\\s*2',
        'pagination',
        'offset',
      ],
      antiPatterns: [],
    },
  ],
  moduleDependencies: {
    'services/search.service': ['utils/database', 'models/search-result'],
  },
  baselineTestCoverage: 75,
};

/**
 * Agent A prompt: Investigate the pagination bug (will be cut short at 5 min).
 */
const AGENT_A_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). Key files for your investigation:
- \`src/utils/pagination.ts\` — Pagination utility (likely location of the bug)
- \`src/services/search.service.ts\` — Search service that uses pagination
- \`tests/\` — existing test files

Directory structure:
\`\`\`
src/
  models/        # Data models
  services/      # Business logic (search service)
  utils/         # Shared utilities (pagination)
  repositories/  # Data access layer
tests/           # Test files
\`\`\`

Your task: Users report that page 2 of search results sometimes shows duplicates from page 1. Investigate and document your findings.

Specifically:
1. Start with \`src/utils/pagination.ts\` — check the offset calculation for an off-by-one error.
2. Also examine \`src/services/search.service.ts\` to trace the data flow from search request through to result pagination.
3. Identify the root cause of the duplicate results on page 2.
4. Document your findings clearly: what you investigated, what you found, and where you think the bug is.
5. If you find the fix, implement it. If not, document your progress so far.

Important:
- You have limited time. Focus on efficient investigation.
- Document your investigation trail clearly — another developer will continue from where you left off.
- Leave notes about what files you checked, what you found, and what you suspect.`;

/**
 * Agent B prompt: Continue investigation, fix the bug, add regression test.
 */
const AGENT_B_PROMPT = `You are Agent {{agent_number}} of {{total_agents}} working on a codebase at {{repo_path}}.

## Codebase Orientation
This is a TypeScript service (~1,140 lines, ~24 files). Key files for your task:
- \`src/utils/pagination.ts\` — Pagination utility (check here for the off-by-one offset calculation)
- \`src/services/search.service.ts\` — Search service that uses pagination
- \`tests/\` — existing test files (add your regression test here)

Directory structure:
\`\`\`
src/
  models/        # Data models
  services/      # Business logic (search service)
  utils/         # Shared utilities (pagination)
  repositories/  # Data access layer
tests/           # Test files
\`\`\`

Your task: Continue the investigation into the search results pagination bug. Fix it and add a regression test.

Context: A previous developer was investigating a bug where page 2 of search results sometimes shows duplicate items from page 1. They may have left notes or partial findings. Check \`src/utils/pagination.ts\` for the off-by-one offset calculation.

Specifically:
1. Check for any investigation notes, comments, or partial fixes left by the previous developer.
2. Look at \`src/utils/pagination.ts\` — the offset calculation likely has an off-by-one error.
3. Fix the pagination bug so that page 2+ results never contain duplicates from previous pages.
4. Add a regression test that specifically catches this pagination offset bug.
5. Ensure the regression test fails against the original buggy code and passes with the fix.
6. Make sure all existing tests still pass.

Important:
- Check if there are any notes or findings from the previous investigation before starting fresh.
- Don't redo work that's already been done — build on existing findings.
- The fix should be minimal and targeted — don't refactor unrelated code.
- Make sure the codebase compiles and tests pass when you're done.`;

export class BugInvestigationScenario extends BaseScenario {
  protected buildMetadata(): ScenarioMetadata {
    return {
      name: 'bug-investigation',
      description:
        'Agent A investigates a planted pagination bug (5-min cutoff). Agent B continues, fixes it, and adds a regression test. Measures context recovery and redundant investigation.',
      estimatedDurationMinutes: 20,
      requiredTargetType: 'service-with-dependency',
      agentSessionCount: 2,
      scoringDimensions: [
        'contextRecovery',
        'redundantInvestigation',
        'resolution',
        'timeToResolution',
      ],
      excludeFromAll: false,
    };
  }

  protected buildAgentTasks(): AgentTask[] {
    return [
      {
        prompt: AGENT_A_PROMPT,
        timeoutMs: AGENT_A_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 0,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'investigator',
      },
      {
        prompt: AGENT_B_PROMPT,
        timeoutMs: AGENT_B_TIMEOUT_MS,
        requiredCapabilities: ['Read', 'Edit', 'Write', 'Bash'],
        sequenceOrder: 1,
        maxTurns: DEFAULT_MAX_TURNS,
        role: 'fixer',
      },
    ];
  }

  protected async getGroundTruth(): Promise<ArchitecturalManifest> {
    return BUG_INVESTIGATION_GROUND_TRUTH;
  }

  protected async doSetup(
    _target: WorkingDirectory,
    _condition: ConditionContext,
  ): Promise<Record<string, unknown>> {
    return {
      scenario: 'bug-investigation',
      agentARole: 'investigator',
      agentBRole: 'fixer',
      agentATimeoutMs: AGENT_A_TIMEOUT_MS,
      bugLocation: 'src/services/search.service.ts',
      bugType: 'off-by-one pagination offset',
    };
  }

  protected async doScore(
    rawResults: RawResults,
    groundTruth: ArchitecturalManifest,
    evaluatorClient?: Anthropic,
  ): Promise<ScoredResults> {
    const contextRecovery = this.scoreContextRecovery(rawResults);
    const redundantInvestigation = this.scoreRedundantInvestigation(rawResults);
    let resolution: DimensionScore;
    if (evaluatorClient) {
      const evalCtx = buildEvaluationContextFromResults(rawResults, groundTruth);
      const result = await runSingleEvaluation(evaluatorClient, INTEGRATION_QUALITY_TEMPLATE, evalCtx);
      resolution = {
        value: result.score,
        confidence: result.confidence,
        method: 'llm-judge',
        justification: result.justification,
      };
    } else {
      resolution = this.scoreResolution(rawResults, groundTruth);
    }
    const timeToResolution = this.scoreTimeToResolution(rawResults);

    const scores: Record<string, DimensionScore> = {
      contextRecovery,
      redundantInvestigation,
      resolution,
      timeToResolution,
    };

    // Composite: weighted average
    const composite =
      contextRecovery.value * 0.25 +
      redundantInvestigation.value * 0.25 +
      resolution.value * 0.35 +
      timeToResolution.value * 0.15;

    return {
      runId: '',
      scenario: 'bug-investigation',
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
   * Score context recovery: How much of A's investigation did B leverage?
   *
   * Heuristic: If B reads files that A investigated (and left notes in),
   * B is recovering context. If B's early tool calls reference A's findings,
   * that's strong context recovery.
   */
  private scoreContextRecovery(rawResults: RawResults): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];

    if (!transcriptA || !transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Missing transcripts — cannot assess context recovery.',
      };
    }

    // Files A investigated (read or modified)
    const aFiles = new Set<string>();
    for (const tc of transcriptA.toolCalls) {
      if (tc.toolName === 'Read' || tc.toolName === 'Edit') {
        const filePath = tc.parameters['file_path'] as string | undefined;
        if (filePath) aFiles.add(filePath);
      }
    }
    for (const fc of transcriptA.fileChanges) {
      aFiles.add(fc.path);
    }

    // Files B checked early (first 25% of tool calls)
    const bEarlyCallCount = Math.max(1, Math.floor(transcriptB.toolCalls.length * 0.25));
    const bEarlyCalls = transcriptB.toolCalls.slice(0, bEarlyCallCount);

    let recoveredFiles = 0;
    for (const tc of bEarlyCalls) {
      const filePath = tc.parameters['file_path'] as string | undefined;
      if (filePath && aFiles.has(filePath)) {
        recoveredFiles++;
      }
    }

    // Also check if B reads coordination/notes files
    const bReadsNotes = transcriptB.toolCalls.some((tc) => {
      const fp = tc.parameters['file_path'] as string | undefined;
      return fp && /(?:note|finding|investigation|context|coordination|handoff)/i.test(fp);
    });

    let score = 0;
    const details: string[] = [];

    if (aFiles.size === 0) {
      score = 50;
      details.push('Agent A did not investigate any files — baseline score.');
    } else {
      const recoveryRatio = recoveredFiles / Math.min(aFiles.size, bEarlyCallCount);
      score = Math.round(recoveryRatio * 80);
      details.push(
        `Agent B accessed ${recoveredFiles} of ${aFiles.size} files A investigated in early calls.`,
      );
    }

    if (bReadsNotes) {
      score = Math.min(100, score + 20);
      details.push('Agent B checked investigation notes/coordination files.');
    }

    return {
      value: Math.min(100, score),
      confidence: aFiles.size > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score redundant investigation: Inverse of duplicated investigation steps.
   *
   * Measures overlap between A's and B's file access patterns.
   * 100 = no overlap (B started from where A left off).
   * 0 = complete restart (B re-read every file A read).
   */
  private scoreRedundantInvestigation(rawResults: RawResults): DimensionScore {
    const transcriptA = rawResults.transcripts[0];
    const transcriptB = rawResults.transcripts[1];

    if (!transcriptA || !transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Missing transcripts — cannot assess redundancy.',
      };
    }

    // Files A read (tool calls with Read)
    const aReadFiles = new Set<string>();
    for (const tc of transcriptA.toolCalls) {
      if (tc.toolName === 'Read') {
        const filePath = tc.parameters['file_path'] as string | undefined;
        if (filePath) aReadFiles.add(filePath);
      }
    }

    // Files B read
    const bReadFiles = new Set<string>();
    for (const tc of transcriptB.toolCalls) {
      if (tc.toolName === 'Read') {
        const filePath = tc.parameters['file_path'] as string | undefined;
        if (filePath) bReadFiles.add(filePath);
      }
    }

    if (aReadFiles.size === 0) {
      return {
        value: 100,
        confidence: 'low',
        method: 'automated',
        justification: 'Agent A did not read any files — no investigation to duplicate.',
      };
    }

    // Calculate overlap
    let overlap = 0;
    for (const file of bReadFiles) {
      if (aReadFiles.has(file)) overlap++;
    }

    const overlapRatio = overlap / aReadFiles.size;
    const score = Math.round((1 - overlapRatio) * 100);

    return {
      value: score,
      confidence: 'medium',
      method: 'automated',
      justification:
        `Agent B re-investigated ${overlap} of ${aReadFiles.size} files Agent A had already examined. Overlap ratio: ${(overlapRatio * 100).toFixed(1)}%.`,
    };
  }

  /**
   * Score resolution: Did Agent B fix the bug and add a regression test?
   *
   * Checks:
   * - Bug file was modified
   * - Fix matches expected patterns
   * - Test file was added/modified
   */
  private scoreResolution(
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

    let score = 0;
    const details: string[] = [];

    const bDiffs = transcriptB.fileChanges.map((c) => c.diff ?? '').join('\n');
    const bFiles = transcriptB.fileChanges.map((c) => c.path);

    // Check: Was the bug file modified?
    const bugFix = groundTruth.decisions.find((d) => d.id === 'pagination-bug-fix');
    if (bugFix) {
      const fixedBugFile = bugFix.affectedFiles.some((f) =>
        bFiles.some((bf) => bf.includes(f) || f.includes(bf)),
      );
      if (fixedBugFile) {
        score += 30;
        details.push('Agent B modified the bug file.');
      } else {
        details.push('Agent B did NOT modify the expected bug file.');
      }

      // Check: Does the fix match expected patterns?
      const hasFixPattern = bugFix.expectedPatterns.some((p) => new RegExp(p).test(bDiffs));
      if (hasFixPattern) {
        score += 30;
        details.push('Fix matches expected pattern.');
      }

      // Check: No anti-patterns in fix
      const hasAntiPattern = bugFix.antiPatterns.some((p) => new RegExp(p).test(bDiffs));
      if (hasAntiPattern) {
        score -= 20;
        details.push('Fix still contains the anti-pattern (likely incomplete fix).');
      }
    }

    // Check: Was a regression test added?
    const regressionDecision = groundTruth.decisions.find((d) => d.id === 'regression-test');
    if (regressionDecision) {
      const hasTestFile = bFiles.some(
        (f) => /test|spec/i.test(f),
      );
      if (hasTestFile) {
        score += 40;
        details.push('Regression test file added/modified.');
      } else {
        details.push('No regression test file detected.');
      }
    }

    return {
      value: Math.max(0, Math.min(100, score)),
      confidence: bDiffs.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Score time-to-resolution: Normalized wall clock time.
   *
   * Maps B's session duration to a 0-100 score.
   * < 3 min = 100 (very fast), 3-10 min = linear 100-50, > 10 min = 50-0.
   */
  private scoreTimeToResolution(rawResults: RawResults): DimensionScore {
    const transcriptB = rawResults.transcripts[1];

    if (!transcriptB) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Agent B did not produce a transcript.',
      };
    }

    const durationMs = transcriptB.timing.durationMs;
    const durationMinutes = durationMs / 60_000;

    let score: number;
    if (durationMinutes <= 3) {
      score = 100;
    } else if (durationMinutes <= 10) {
      // Linear interpolation: 3min=100, 10min=50
      score = Math.round(100 - ((durationMinutes - 3) / 7) * 50);
    } else {
      // Linear interpolation: 10min=50, 15min=0
      score = Math.round(Math.max(0, 50 - ((durationMinutes - 10) / 5) * 50));
    }

    return {
      value: score,
      confidence: 'high',
      method: 'automated',
      justification:
        `Agent B session duration: ${durationMinutes.toFixed(1)} minutes. Score based on resolution speed.`,
    };
  }

  // extractMetrics is inherited from BaseScenario
}

export function createBugInvestigationScenario(): BugInvestigationScenario {
  return new BugInvestigationScenario();
}
