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
  BUG_RESOLUTION_TEMPLATE,
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
    'Planted bug: off-by-one in pagination offset calculation causes duplicate items on page 2+. File: src/utils/pagination.ts, function: paginate().',
  decisions: [
    {
      id: 'pagination-bug-location',
      description:
        'The bug is in the pagination utility (src/utils/pagination.ts or src/services/search.service.ts) in the paginate() or getPage() function. The offset calculation is off by one.',
      affectedFiles: ['src/utils/pagination.ts', 'src/services/search.service.ts'],
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
      affectedFiles: ['src/utils/pagination.ts', 'src/services/search.service.ts'],
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
        'tests/utils/pagination.test.ts',
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
This is a TypeScript service (~1,140 lines, ~24 files).

Directory structure:
\`\`\`
src/
  models/        # Data models
  services/      # Business logic (search service)
  utils/         # Shared utilities
  repositories/  # Data access layer
tests/           # Test files
\`\`\`

Your task: Continue a bug investigation that was started by a previous developer.

A previous developer was investigating a bug in the search/listing functionality where users
reported seeing duplicate or missing results. Their session was interrupted before they could
finish.

Specifically:
1. Check for any investigation notes, comments, or findings left by the previous developer.
2. Review the previous developer's changes or coordination artifacts to understand what they discovered.
3. Based on their findings (and your own investigation if needed), locate and fix the bug.
4. Add a regression test that specifically catches this bug.
5. Ensure the regression test fails against the original buggy code and passes with the fix.
6. Make sure all existing tests still pass.

Important:
- Check for prior investigation context before starting from scratch.
- Don't redo work that's already been done — build on existing findings.
- The fix should be minimal and targeted — don't refactor unrelated code.`;

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
      const result = await runSingleEvaluation(evaluatorClient, BUG_RESOLUTION_TEMPLATE, evalCtx);
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

    // Files A investigated (read or modified) — normalize to basenames
    // so paths from different working directories can still match.
    const aFileBasenames = new Set<string>();
    for (const tc of transcriptA.toolCalls) {
      if (tc.toolName === 'Read' || tc.toolName === 'Edit') {
        const filePath = tc.parameters['file_path'] as string | undefined;
        if (filePath) aFileBasenames.add(this.normalizeFilePath(filePath));
      }
    }
    for (const fc of transcriptA.fileChanges) {
      aFileBasenames.add(this.normalizeFilePath(fc.path));
    }

    // Files B checked early (first 25% of tool calls).
    // If B used coordination tools first (assemble/read/query), extend the window
    // to 50% since the coordination calls consume early slots without reading files.
    const usedCoordFirst = transcriptB.toolCalls.length > 0 &&
      /twining_assemble|twining_read|twining_recent|twining_query/.test(transcriptB.toolCalls[0]?.toolName ?? '');
    const earlyRatio = usedCoordFirst ? 0.5 : 0.25;
    const bEarlyCallCount = Math.max(1, Math.floor(transcriptB.toolCalls.length * earlyRatio));
    const bEarlyCalls = transcriptB.toolCalls.slice(0, bEarlyCallCount);

    let recoveredFiles = 0;
    for (const tc of bEarlyCalls) {
      const filePath = tc.parameters['file_path'] as string | undefined;
      if (filePath && aFileBasenames.has(this.normalizeFilePath(filePath))) {
        recoveredFiles++;
      }
    }

    // Check if B uses coordination context — file-based OR tool-based.
    // File-based: reads files with coordination-related names.
    // Tool-based: uses Twining assemble/read/acknowledge to recover prior context.
    const bReadsCoordinationFiles = transcriptB.toolCalls.some((tc) => {
      const fp = tc.parameters['file_path'] as string | undefined;
      return fp && /(?:note|finding|investigation|context|coordination|handoff)/i.test(fp);
    });

    const bUsesCoordinationTools = transcriptB.toolCalls.some((tc) =>
      /twining_assemble|twining_read|twining_acknowledge|twining_recent|twining_query/.test(
        tc.toolName,
      ),
    );

    let score = 0;
    const details: string[] = [];

    if (aFileBasenames.size === 0) {
      score = 50;
      details.push('Agent A did not investigate any files — baseline score.');
    } else {
      const recoveryRatio = recoveredFiles / Math.min(aFileBasenames.size, bEarlyCallCount);
      score = Math.round(recoveryRatio * 80);
      details.push(
        `Agent B accessed ${recoveredFiles} of ${aFileBasenames.size} files A investigated in early calls.`,
      );

      // If B used twining_assemble, it received affected_files and findings from A's decisions
      // without needing to Read each file individually. Grant partial file-recovery credit
      // since assemble output contains the same information as reading coordination files.
      if (bUsesCoordinationTools && score < 40) {
        score = 40;
        details.push('Agent B used coordination tools that contain A\'s file references and findings (floor: 40).');
      }
    }

    // Graduate coordination bonus: both tools and files = +20, one = +10
    if (bUsesCoordinationTools && bReadsCoordinationFiles) {
      score = Math.min(100, score + 20);
      details.push('Agent B used coordination tools and checked investigation files.');
    } else if (bUsesCoordinationTools) {
      score = Math.min(100, score + 15);
      details.push('Agent B used coordination tools to recover prior context.');
    } else if (bReadsCoordinationFiles) {
      score = Math.min(100, score + 10);
      details.push('Agent B checked investigation notes/coordination files.');
    }

    // Warning-heeded penalty: if A posted warnings and B violated them, penalize context recovery.
    // Check if A used twining_post with warning-related content about specific files.
    const aWarningCalls = transcriptA.toolCalls.filter((tc) =>
      /twining.*post/.test(tc.toolName) &&
      (tc.parameters?.entry_type === 'warning' ||
       /warning|do not|don't|avoid|never/i.test(String(tc.parameters?.summary ?? ''))),
    );

    if (aWarningCalls.length > 0) {
      // Extract file paths mentioned in warnings
      const warnedFiles = new Set<string>();
      for (const wc of aWarningCalls) {
        const summary = String(wc.parameters?.summary ?? '');
        const detail = String(wc.parameters?.detail ?? '');
        const text = summary + ' ' + detail;
        // Look for file path patterns in warning text
        const fileMatches = text.match(/[\w/.-]+\.\w{1,4}/g) ?? [];
        for (const fm of fileMatches) warnedFiles.add(fm);
      }

      // Check if B modified any warned-about files
      const bModifiedFiles = new Set(transcriptB.fileChanges.map((c) => c.path));
      const violatedWarnings: string[] = [];
      for (const wf of warnedFiles) {
        for (const bf of bModifiedFiles) {
          if (bf.includes(wf) || wf.includes(bf.split('/').pop() ?? '')) {
            violatedWarnings.push(wf);
            break;
          }
        }
      }

      if (violatedWarnings.length > 0) {
        score = Math.max(0, score - 20);
        details.push(`Agent B ignored warnings and modified: ${violatedWarnings.join(', ')} (-20 pts).`);
      } else if (warnedFiles.size > 0) {
        details.push('Agent B heeded warnings from Agent A.');
      }
    }

    return {
      value: Math.min(100, Math.max(0, score)),
      confidence: aFileBasenames.size > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }

  /**
   * Normalize a file path for cross-session comparison.
   * Strips the working directory prefix (temp dirs differ between agents)
   * leaving a relative path like "src/services/foo.ts".
   */
  private normalizeFilePath(filePath: string): string {
    // Strip common temp-dir prefixes to get relative path
    const match = filePath.match(
      /(?:twining-bench-[A-Za-z0-9]+|benchmark-\w+)[/\\](.*)/,
    );
    if (match?.[1]) return match[1];

    // If already relative, return as-is
    if (!filePath.startsWith('/')) return filePath;

    // Last resort: use basename + parent directory for uniqueness
    const parts = filePath.split('/');
    return parts.slice(-2).join('/');
  }

  /**
   * Robust path comparison: returns true if two paths refer to the same file.
   *
   * Handles absolute vs relative paths, leading './', and falls back to
   * filename-only comparison when includes-based matching fails.
   */
  private pathsMatch(pathA: string, pathB: string): boolean {
    if (!pathA || !pathB) return false;

    // Strip leading './' from both
    const a = pathA.replace(/^\.\//, '');
    const b = pathB.replace(/^\.\//, '');

    // Bidirectional includes (handles absolute vs relative)
    if (a.includes(b) || b.includes(a)) return true;

    // Normalize through the existing helper and compare
    const na = this.normalizeFilePath(a);
    const nb = this.normalizeFilePath(b);
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;

    // Filename-only fallback (basename match)
    const basenameA = a.split('/').pop() ?? '';
    const basenameB = b.split('/').pop() ?? '';
    if (basenameA && basenameB && basenameA === basenameB) return true;

    return false;
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
        if (filePath) aReadFiles.add(this.normalizeFilePath(filePath));
      }
    }

    // Files B read
    const bReadFiles = new Set<string>();
    for (const tc of transcriptB.toolCalls) {
      if (tc.toolName === 'Read') {
        const filePath = tc.parameters['file_path'] as string | undefined;
        if (filePath) bReadFiles.add(this.normalizeFilePath(filePath));
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

    // If B read zero files and made zero changes, that's not efficiency — it's doing nothing
    if (bReadFiles.size === 0 && transcriptB.fileChanges.length === 0) {
      return {
        value: 0,
        confidence: 'medium',
        method: 'automated',
        justification: 'Agent B did not read any files or make any changes — no investigation performed.',
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
   * Partial-credit gradient:
   * -  0: No investigation of bug file, no changes
   * - 15: Investigated the correct file (Read/Grep in toolCalls) but didn't modify it
   * - 30: Modified the correct file but fix doesn't match expected pattern
   * - 50: Fixed the bug (pattern match) but no regression test
   * - 70: Fixed + regression test but anti-pattern remains
   * - 85: Fixed + regression test + no anti-patterns
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

    const details: string[] = [];

    const bDiffs = transcriptB.fileChanges.map((c) => c.diff).filter((d): d is string => d !== undefined).join('\n');
    const hasMissingDiffs = transcriptB.fileChanges.some((c) => c.diff === undefined);
    const bFiles = transcriptB.fileChanges.map((c) => c.path);

    if (hasMissingDiffs && bDiffs.length === 0) {
      return {
        value: 0,
        confidence: 'low',
        method: 'automated',
        justification: 'No diff data available for scoring — git enrichment may have failed.',
        dataQuality: 'missing',
      };
    }

    const bugFix = groundTruth.decisions.find((d) => d.id === 'pagination-bug-fix');
    const regressionDecision = groundTruth.decisions.find((d) => d.id === 'regression-test');

    // --- Step 1: Did B investigate the bug file (Read/Grep tool calls)? ---
    const bugAffectedFiles = bugFix?.affectedFiles ?? [];
    const bInvestigatedBugFile = transcriptB.toolCalls.some((tc) => {
      if (tc.toolName !== 'Read' && tc.toolName !== 'Grep') return false;
      const fp = (tc.parameters['file_path'] ?? tc.parameters['path'] ?? '') as string;
      const pattern = (tc.parameters['pattern'] ?? '') as string;
      // Match against affected file paths using robust path comparison
      return bugAffectedFiles.some(
        (af) => this.pathsMatch(fp, af) || (pattern.length > 0 && pattern.includes(af)),
      );
    });

    // --- Step 2: Did B modify the bug file? ---
    const bModifiedBugFile = bugFix
      ? bugFix.affectedFiles.some((f) =>
          bFiles.some((bf) => this.pathsMatch(bf, f)),
        )
      : false;

    // --- Step 3: Does the fix match the expected patterns? ---
    const hasFixPattern = bugFix
      ? bugFix.expectedPatterns.some((p) => new RegExp(p).test(bDiffs))
      : false;

    // --- Step 4: Does the fix contain anti-patterns? ---
    const hasAntiPattern = bugFix
      ? bugFix.antiPatterns.some((p) => new RegExp(p).test(bDiffs))
      : false;

    // --- Step 5: Was a regression test added? ---
    const hasTestFile = regressionDecision
      ? bFiles.some((f) => /test|spec/i.test(f))
      : false;

    // --- Step 6: Did Agent A already fix the bug? ---
    const transcriptA = rawResults.transcripts[0];
    const aAlreadyFixed = transcriptA
      ? bugAffectedFiles.some((f) =>
          transcriptA.fileChanges.some((fc) => this.pathsMatch(fc.path, f)),
        )
      : false;

    // --- Apply gradient scoring ---
    let score: number;

    if (!bInvestigatedBugFile && !bModifiedBugFile) {
      if (aAlreadyFixed) {
        // Agent A fixed it, Agent B didn't look — missed context but bug is resolved
        score = 0;
        details.push('Agent B did not investigate the bug file. Agent A had already fixed the bug.');
      } else {
        // 0: No investigation, no changes
        score = 0;
        details.push('Agent B did not investigate or modify the bug file.');
      }
    } else if (!bModifiedBugFile && aAlreadyFixed) {
      // Agent A already fixed the bug; Agent B investigated and correctly determined no modification needed.
      // This is good coordination — credit Agent B for verifying the fix rather than redoing work.
      score = 50;
      details.push('Agent A already fixed the bug. Agent B investigated and correctly verified the fix was complete.');
    } else if (bModifiedBugFile && aAlreadyFixed) {
      // Agent A already fixed the bug but Agent B redundantly re-modified it.
      // This is a coordination failure — B didn't check that the work was done.
      score = 20;
      details.push('Agent A already fixed the bug. Agent B redundantly re-modified the bug file — coordination failure.');
    } else if (!bModifiedBugFile) {
      // 15: Investigated but did not modify (and bug is NOT fixed)
      score = 15;
      details.push('Agent B investigated the bug file but did not modify it.');
    } else if (!hasFixPattern) {
      // 30: Modified bug file but fix pattern not matched
      score = 30;
      details.push('Agent B modified the bug file but the fix does not match the expected pattern.');
    } else if (!hasTestFile) {
      // 50: Fixed the bug but no regression test
      score = 50;
      details.push('Agent B fixed the bug but no regression test was added.');
    } else if (hasAntiPattern) {
      // 70: Fixed + test but anti-pattern remains
      score = 70;
      details.push('Agent B fixed the bug and added a regression test, but anti-pattern remains.');
    } else {
      // 85: Fixed + test + no anti-patterns
      score = 85;
      details.push('Agent B fixed the bug, added a regression test, and has no anti-patterns.');
    }

    return {
      value: score,
      confidence: bDiffs.length > 0 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
      dataQuality: hasMissingDiffs ? 'partial' : 'complete',
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
