#!/usr/bin/env npx tsx
/**
 * Re-score existing benchmark results using the current scorer code.
 *
 * Usage:
 *   npx tsx scripts/rescore.ts <run-id>
 *
 * Reads transcripts from sessions/ and raw/, reconstructs RawResults,
 * runs the scenario scorer, and writes updated score files to scores/.
 * Original scores are backed up to scores/.pre-rescore-backup/
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { SprintSimulationScenario } from '../src/scenarios/sprint-simulation.js';
import type { AgentTranscript } from '../src/types/transcript.js';
import type { RawResults } from '../src/types/scenario.js';

const runId = process.argv[2];
if (!runId) {
  console.error('Usage: npx tsx scripts/rescore.ts <run-id>');
  process.exit(1);
}

const baseDir = join('benchmark-results', runId);
if (!existsSync(baseDir)) {
  console.error(`Run directory not found: ${baseDir}`);
  process.exit(1);
}

const scoresDir = join(baseDir, 'scores');
const sessionsDir = join(baseDir, 'sessions');
const rawDir = join(baseDir, 'raw');

// Backup existing scores
const backupDir = join(scoresDir, '.pre-rescore-backup');
mkdirSync(backupDir, { recursive: true });
for (const f of readdirSync(scoresDir)) {
  if (f.endsWith('.json')) {
    const src = join(scoresDir, f);
    const dst = join(backupDir, f);
    if (!existsSync(dst)) {
      writeFileSync(dst, readFileSync(src));
    }
  }
}
console.log(`Backed up existing scores to ${backupDir}`);

// Build session map: condition -> iteration -> ordered transcripts
interface SessionMeta {
  sessionId: string;
  condition: string;
  taskIndex: number;
  transcript: AgentTranscript;
}

const allSessions: SessionMeta[] = [];

for (const rawFile of readdirSync(rawDir).filter(f => f.endsWith('.json'))) {
  const sid = rawFile.replace('.json', '');
  const rawPath = join(rawDir, rawFile);
  const raw = JSON.parse(readFileSync(rawPath, 'utf-8'));

  // Skip archived sessions
  if (raw.condition === undefined) continue;

  const transcriptPath = join(sessionsDir, sid, 'transcript.json');
  if (!existsSync(transcriptPath)) continue;

  const transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8')) as AgentTranscript;

  allSessions.push({
    sessionId: sid,
    condition: raw.condition,
    taskIndex: raw.taskIndex ?? transcript.taskIndex,
    transcript,
  });
}

console.log(`Loaded ${allSessions.length} sessions`);

// Group by condition
const byCondition = new Map<string, SessionMeta[]>();
for (const s of allSessions) {
  if (!byCondition.has(s.condition)) byCondition.set(s.condition, []);
  byCondition.get(s.condition)!.push(s);
}

// Group into iterations (12 sessions each for sprint-simulation)
const SESSIONS_PER_ITERATION = 12;

for (const [condition, sessions] of byCondition) {
  // Sort by session start time to preserve iteration order
  sessions.sort((a, b) => {
    const ta = a.transcript.timing?.startTime ?? '';
    const tb = b.transcript.timing?.startTime ?? '';
    return ta.localeCompare(tb);
  });

  const numIterations = Math.floor(sessions.length / SESSIONS_PER_ITERATION);
  console.log(`\n${condition}: ${sessions.length} sessions -> ${numIterations} iterations`);

  for (let iter = 0; iter < numIterations; iter++) {
    const iterSessions = sessions.slice(
      iter * SESSIONS_PER_ITERATION,
      (iter + 1) * SESSIONS_PER_ITERATION,
    );

    // Sort within iteration by taskIndex
    iterSessions.sort((a, b) => a.taskIndex - b.taskIndex);

    // Load existing score to get testResults (not stored in transcripts)
    const existingScorePath = join(scoresDir, `sprint-simulation_${condition}_${iter}.json`);
    let testResults: { pass: number; fail: number; compiles: boolean } | undefined;
    if (existsSync(existingScorePath)) {
      const existing = JSON.parse(readFileSync(existingScorePath, 'utf-8'));
      const m = existing.metrics;
      if (m?.testsPass !== undefined) {
        testResults = {
          pass: m.testsPass,
          fail: m.testsFail ?? 0,
          compiles: m.compiles ?? true,
        };
      }
    }

    // Build RawResults
    const rawResults: RawResults = {
      transcripts: iterSessions.map(s => s.transcript),
      finalWorkingDir: '',
      allSessionsCompleted: true,
      errors: [],
      testResults,
    };

    // Score using current scenario code
    const scenario = new SprintSimulationScenario();
    const groundTruth = {
      components: [],
      relationships: [],
      patterns: [],
    };

    try {
      const scored = await scenario.score(rawResults, groundTruth);
      scored.runId = runId;
      scored.condition = condition;
      scored.iteration = iter;

      // Preserve original metrics from the existing score file
      if (existsSync(existingScorePath)) {
        const existing = JSON.parse(readFileSync(existingScorePath, 'utf-8'));
        scored.metrics = existing.metrics;
      }

      writeFileSync(existingScorePath, JSON.stringify(scored, null, 2));
      console.log(`  iter ${iter}: composite=${scored.composite.toFixed(1)} (${Object.entries(scored.scores).map(([k, v]) => `${k}=${v.value}`).join(', ')})`);
    } catch (err) {
      console.error(`  iter ${iter}: SCORING FAILED - ${err}`);
    }
  }
}

console.log('\nDone. Re-run analysis to regenerate reports.');
