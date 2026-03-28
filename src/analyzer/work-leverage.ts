/**
 * Work Leverage Metrics
 *
 * Measures how effectively later agents build on earlier agents' work.
 * All metrics are computed from git diffs — no reference to coordination tools used.
 *
 * Key principle: rework that improves quality (tech debt paydown) is scored
 * differently from uninformed rework (agent didn't know what predecessor did).
 */

import type { AgentTranscript, FileChange } from '../types/transcript.js';

/**
 * Result of work leverage analysis across ordered sessions.
 */
export interface WorkLeverageResult {
  /** Per-session rework ratios: fraction of session N's additions deleted by N+1 */
  reworkRatios: number[];
  /** Average rework ratio across all session pairs */
  avgReworkRatio: number;
  /** Per-session line survival rates: fraction of session N's additions surviving to final state */
  lineSurvivalRates: number[];
  /** Average line survival rate */
  avgLineSurvivalRate: number;
  /** Per-session continuation indices: fraction of B's additions that reference A's new symbols */
  continuationIndices: number[];
  /** Average continuation index */
  avgContinuationIndex: number;
}

/**
 * Parse a unified diff to extract added and removed line content (without +/- prefix).
 * Filters to meaningful code lines, ignoring blank lines and diff headers.
 */
function parseAddedLines(diff: string): string[] {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1).trim())
    .filter((line) => line.length > 0);
}

function parseRemovedLines(diff: string): string[] {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1).trim())
    .filter((line) => line.length > 0);
}

/**
 * Filter to source code files only (excludes docs, coordination artifacts).
 */
function filterSourceFiles(fileChanges: FileChange[]): FileChange[] {
  return fileChanges.filter(
    (c) => (c.path.startsWith('src/') || c.path.startsWith('tests/')) && c.path.endsWith('.ts'),
  );
}

/**
 * Compute rework ratio between two consecutive sessions.
 *
 * reworkRatio = (lines A added that B removed) / (lines A added)
 *
 * A low ratio means B built on A's work. A high ratio means B rewrote A's work.
 */
export function computeReworkRatio(
  sessionA: AgentTranscript,
  sessionB: AgentTranscript,
): number {
  const aSourceFiles = filterSourceFiles(sessionA.fileChanges);
  const bSourceFiles = filterSourceFiles(sessionB.fileChanges);

  const aDiffs = aSourceFiles
    .map((c) => c.diff)
    .filter((d): d is string => d !== undefined)
    .join('\n');
  const bDiffs = bSourceFiles
    .map((c) => c.diff)
    .filter((d): d is string => d !== undefined)
    .join('\n');

  const aAdded = new Set(parseAddedLines(aDiffs));
  const bRemoved = new Set(parseRemovedLines(bDiffs));

  if (aAdded.size === 0) return 0;

  // Count how many of A's added lines were removed by B
  let overlapCount = 0;
  for (const line of aAdded) {
    if (bRemoved.has(line)) {
      overlapCount++;
    }
  }

  return overlapCount / aAdded.size;
}

/**
 * Compute line survival rate for a session: what fraction of its additions
 * survive through all subsequent sessions to the final state.
 *
 * lineSurvival = (session N lines NOT removed by any later session) / (session N total additions)
 */
export function computeLineSurvivalRate(
  session: AgentTranscript,
  laterSessions: AgentTranscript[],
): number {
  const sourceFiles = filterSourceFiles(session.fileChanges);
  const diffs = sourceFiles
    .map((c) => c.diff)
    .filter((d): d is string => d !== undefined)
    .join('\n');

  const added = new Set(parseAddedLines(diffs));
  if (added.size === 0) return 1; // No additions = nothing to survive

  // Collect all lines removed by any later session
  const allLaterRemoved = new Set<string>();
  for (const later of laterSessions) {
    const laterSourceFiles = filterSourceFiles(later.fileChanges);
    const laterDiffs = laterSourceFiles
      .map((c) => c.diff)
      .filter((d): d is string => d !== undefined)
      .join('\n');
    for (const line of parseRemovedLines(laterDiffs)) {
      allLaterRemoved.add(line);
    }
  }

  let survivingCount = 0;
  for (const line of added) {
    if (!allLaterRemoved.has(line)) {
      survivingCount++;
    }
  }

  return survivingCount / added.size;
}

/**
 * Compute continuation index: did session B extend A's code structure
 * (importing A's new symbols, calling A's functions) or create parallel implementations?
 *
 * continuationIndex = (B's additions referencing A's new symbols) / (B's total additions)
 *
 * A's "new symbols" are identifiers extracted from A's added export/class/function/interface declarations.
 */
export function computeContinuationIndex(
  sessionA: AgentTranscript,
  sessionB: AgentTranscript,
): number {
  const aSourceFiles = filterSourceFiles(sessionA.fileChanges);
  const bSourceFiles = filterSourceFiles(sessionB.fileChanges);

  const aDiffs = aSourceFiles
    .map((c) => c.diff)
    .filter((d): d is string => d !== undefined)
    .join('\n');
  const bDiffs = bSourceFiles
    .map((c) => c.diff)
    .filter((d): d is string => d !== undefined)
    .join('\n');

  // Extract symbol names from A's added lines (exports, classes, functions, interfaces, types)
  const aAddedLines = parseAddedLines(aDiffs);
  const symbolPattern = /(?:export\s+)?(?:class|function|interface|type|const|enum)\s+(\w+)/;
  const aSymbols = new Set<string>();
  for (const line of aAddedLines) {
    const match = symbolPattern.exec(line);
    if (match?.[1] && match[1].length > 2) { // Skip very short identifiers
      aSymbols.add(match[1]);
    }
  }

  if (aSymbols.size === 0) return 0; // A didn't introduce new symbols

  // Check how many of B's added lines reference A's symbols
  const bAddedLines = parseAddedLines(bDiffs);
  if (bAddedLines.length === 0) return 0;

  let referencingCount = 0;
  for (const line of bAddedLines) {
    for (const sym of aSymbols) {
      if (line.includes(sym)) {
        referencingCount++;
        break; // Count each B line only once
      }
    }
  }

  return referencingCount / bAddedLines.length;
}

/**
 * Compute full work leverage analysis across an ordered list of session transcripts.
 */
export function analyzeWorkLeverage(transcripts: AgentTranscript[]): WorkLeverageResult {
  const reworkRatios: number[] = [];
  const lineSurvivalRates: number[] = [];
  const continuationIndices: number[] = [];

  for (let i = 0; i < transcripts.length; i++) {
    // Rework ratio: only for pairs (session i → session i+1)
    if (i < transcripts.length - 1) {
      reworkRatios.push(computeReworkRatio(transcripts[i]!, transcripts[i + 1]!));
    }

    // Line survival: for each session vs all later sessions
    const laterSessions = transcripts.slice(i + 1);
    lineSurvivalRates.push(computeLineSurvivalRate(transcripts[i]!, laterSessions));

    // Continuation index: for each session after the first
    if (i > 0) {
      continuationIndices.push(computeContinuationIndex(transcripts[i - 1]!, transcripts[i]!));
    }
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    reworkRatios,
    avgReworkRatio: avg(reworkRatios),
    lineSurvivalRates,
    avgLineSurvivalRate: avg(lineSurvivalRates),
    continuationIndices,
    avgContinuationIndex: avg(continuationIndices),
  };
}

/**
 * Convert work leverage result to a 0-100 score.
 *
 * Composite:
 * - Low rework ratio → good (inverted: 1 - ratio)
 * - High line survival → good
 * - High continuation index → good
 *
 * Weights: rework 40%, survival 30%, continuation 30%
 */
export function workLeverageScore(result: WorkLeverageResult): number {
  const reworkScore = (1 - result.avgReworkRatio) * 100;
  const survivalScore = result.avgLineSurvivalRate * 100;
  const continuationScore = result.avgContinuationIndex * 100;

  return Math.round(
    reworkScore * 0.4 +
    survivalScore * 0.3 +
    continuationScore * 0.3,
  );
}
