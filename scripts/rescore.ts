#!/usr/bin/env npx tsx
/**
 * Re-score existing benchmark results using the current scorer code.
 *
 * Usage:
 *   npx tsx scripts/rescore.ts <run-id> [--scenario <name>] [--condition <name>]
 *
 * Reads transcripts from sessions/ and raw/, reconstructs RawResults,
 * runs the scenario scorer, and writes updated score files to scores/.
 * Original scores are backed up to scores/.pre-rescore-backup/
 *
 * Supports all scenarios registered in the scenario registry.
 * Auto-detects scenarios from the run metadata or score file names.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getScenario, type ScenarioName } from '../src/scenarios/registry.js';
import { SyntheticRepoTarget } from '../src/targets/synthetic-repo/index.js';
import type { AgentTranscript } from '../src/types/transcript.js';
import type { RawResults } from '../src/types/scenario.js';

// Parse args
const args = process.argv.slice(2);
const runId = args.find(a => !a.startsWith('--'));
const scenarioFilter = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : undefined;
const conditionFilter = args.includes('--condition') ? args[args.indexOf('--condition') + 1] : undefined;

if (!runId) {
  console.error('Usage: npx tsx scripts/rescore.ts <run-id> [--scenario <name>] [--condition <name>]');
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

// Load metadata to get scenario list
const metadataPath = join(baseDir, 'metadata.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
const runScenarios: string[] = metadata.scenarios ?? [];

// Load all sessions with their scenario info
interface SessionMeta {
  sessionId: string;
  scenario: string;
  condition: string;
  taskIndex: number;
  transcript: AgentTranscript;
}

const allSessions: SessionMeta[] = [];

for (const rawFile of readdirSync(rawDir).filter(f => f.endsWith('.json'))) {
  const sid = rawFile.replace('.json', '');
  const rawPath = join(rawDir, rawFile);
  const raw = JSON.parse(readFileSync(rawPath, 'utf-8'));

  if (raw.condition === undefined) continue;

  const scenario = raw.scenario ?? '';
  if (scenarioFilter && scenario !== scenarioFilter) continue;
  if (conditionFilter && raw.condition !== conditionFilter) continue;

  const transcriptPath = join(sessionsDir, sid, 'transcript.json');
  if (!existsSync(transcriptPath)) continue;

  const transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8')) as AgentTranscript;

  allSessions.push({
    sessionId: sid,
    scenario,
    condition: raw.condition,
    taskIndex: raw.taskIndex ?? transcript.taskIndex,
    transcript,
  });
}

console.log(`Loaded ${allSessions.length} sessions`);

// Group by scenario -> condition
const byScenarioCondition = new Map<string, Map<string, SessionMeta[]>>();
for (const s of allSessions) {
  const key = s.scenario;
  if (!byScenarioCondition.has(key)) byScenarioCondition.set(key, new Map());
  const condMap = byScenarioCondition.get(key)!;
  if (!condMap.has(s.condition)) condMap.set(s.condition, []);
  condMap.get(s.condition)!.push(s);
}

// Process each scenario
for (const [scenarioName, condMap] of byScenarioCondition) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scenario: ${scenarioName}`);
  console.log(`${'='.repeat(60)}`);

  // Get scenario instance and session count
  let scenarioEntry;
  try {
    scenarioEntry = getScenario(scenarioName as ScenarioName);
  } catch {
    console.error(`  Unknown scenario: ${scenarioName} — skipping`);
    continue;
  }

  const sessionsPerIteration = scenarioEntry.metadata.agentSessionCount;
  const scenario = scenarioEntry.create();

  for (const [condition, sessions] of condMap) {
    // Sort by start time
    sessions.sort((a, b) => {
      const ta = a.transcript.timing?.startTime ?? '';
      const tb = b.transcript.timing?.startTime ?? '';
      return ta.localeCompare(tb);
    });

    const numIterations = Math.floor(sessions.length / sessionsPerIteration);
    console.log(`\n  ${condition}: ${sessions.length} sessions -> ${numIterations} iterations (${sessionsPerIteration} sess/iter)`);

    for (let iter = 0; iter < numIterations; iter++) {
      const iterSessions = sessions.slice(
        iter * sessionsPerIteration,
        (iter + 1) * sessionsPerIteration,
      );

      // Sort within iteration by taskIndex
      iterSessions.sort((a, b) => a.taskIndex - b.taskIndex);

      // Load existing score to get testResults
      const scoreFileName = `${scenarioName}_${condition}_${iter}.json`;
      const existingScorePath = join(scoresDir, scoreFileName);
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

      // Use scenario-specific ground truth when available (e.g. context-recovery
      // has its own 3-decision manifest distinct from the target's 2-decision one).
      // Fall back to synthetic repo target for scenarios that don't override.
      // Access protected getGroundTruth via bracket notation since we can't call setup() without a real working dir.
      const target = new SyntheticRepoTarget();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groundTruth = await (scenario as any)['getGroundTruth']()
        ?? target.getGroundTruth();

      try {
        const scored = await scenario.score(rawResults, groundTruth);
        scored.runId = runId;
        scored.condition = condition;
        scored.iteration = iter;

        // Preserve original metrics from existing score file
        if (existsSync(existingScorePath)) {
          const existing = JSON.parse(readFileSync(existingScorePath, 'utf-8'));
          scored.metrics = existing.metrics;
        }

        writeFileSync(existingScorePath, JSON.stringify(scored, null, 2));
        const dimSummary = Object.entries(scored.scores)
          .map(([k, v]) => `${k}=${v.value}`)
          .join(', ');
        console.log(`    iter ${iter}: composite=${scored.composite.toFixed(1)} (${dimSummary})`);
      } catch (err) {
        console.error(`    iter ${iter}: SCORING FAILED - ${err}`);
      }
    }
  }
}

console.log('\nDone. Re-run analysis to regenerate reports.');
