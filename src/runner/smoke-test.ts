import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SyntheticRepoTarget } from '../targets/synthetic-repo/index.js';
import { BaselineCondition } from '../conditions/baseline.js';
import { FullTwiningCondition } from '../conditions/full-twining.js';
import { createRefactoringHandoffScenario } from '../scenarios/refactoring-handoff.js';
import { AgentSessionManager } from './agent-session.js';
import type { AgentTranscript } from '../types/transcript.js';
import type { ScoredResults } from '../types/results.js';

export interface SmokeTestCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SmokeTestResult {
  passed: boolean;
  checks: SmokeTestCheck[];
  duration: number;
}

export interface SmokeTestOptions {
  timeoutMinutes?: number;
  budgetDollars?: number;
}

interface ConditionRunResult {
  transcripts: AgentTranscript[];
  workingDir: string;
  scores?: ScoredResults;
}

export async function runSmokeTest(options: SmokeTestOptions = {}): Promise<SmokeTestResult> {
  const timeoutMs = (options.timeoutMinutes ?? 5) * 60 * 1000;
  const checks: SmokeTestCheck[] = [];
  const startTime = Date.now();

  const target = new SyntheticRepoTarget();

  // Run baseline condition
  let baselineResult: ConditionRunResult | undefined;
  try {
    baselineResult = await runCondition('baseline', new BaselineCondition(), target, timeoutMs);
    checks.push({ name: 'baseline-execution', passed: true, detail: `Completed with ${baselineResult.transcripts.length} transcripts` });
  } catch (err) {
    checks.push({ name: 'baseline-execution', passed: false, detail: `Failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  // Run full-twining condition
  let twiningResult: ConditionRunResult | undefined;
  try {
    twiningResult = await runCondition('full-twining', new FullTwiningCondition(), target, timeoutMs);
    checks.push({ name: 'twining-execution', passed: true, detail: `Completed with ${twiningResult.transcripts.length} transcripts` });
  } catch (err) {
    checks.push({ name: 'twining-execution', passed: false, detail: `Failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  // Validate baseline transcripts
  if (baselineResult) {
    checks.push(checkTranscriptStructure('baseline', baselineResult.transcripts));
    checks.push(checkNoTwiningTools(baselineResult.transcripts));
    checks.push(checkNoTwiningDir(baselineResult.workingDir));
  }

  // Validate twining transcripts
  if (twiningResult) {
    checks.push(checkTranscriptStructure('full-twining', twiningResult.transcripts));
    checks.push(checkHasTwiningTools(twiningResult.transcripts));
  }

  return {
    passed: checks.every(c => c.passed),
    checks,
    duration: Date.now() - startTime,
  };
}

async function runCondition(
  name: string,
  condition: { setup(dir: string): Promise<any>; getAgentConfig(): any; teardown(): Promise<void> },
  target: SyntheticRepoTarget,
  timeoutMs: number,
): Promise<ConditionRunResult> {
  const workingDir = await target.setup();
  const conditionCtx = await condition.setup(workingDir.path);
  const scenario = createRefactoringHandoffScenario();
  await scenario.setup(workingDir, conditionCtx);

  const tasks = scenario.getAgentTasks();
  const transcripts: AgentTranscript[] = [];

  const manager = new AgentSessionManager({
    runId: `smoke-test-${name}`,
    scenario: 'refactoring-handoff',
    condition: name,
    workingDir: workingDir.path,
    agentConfig: conditionCtx.agentConfig,
    timeoutMs,
  });

  for (const task of tasks) {
    const transcript = await manager.executeTask(task);
    transcripts.push(transcript);
  }

  await condition.teardown();

  return { transcripts, workingDir: workingDir.path };
}

export function checkTranscriptStructure(condition: string, transcripts: AgentTranscript[]): SmokeTestCheck {
  const hasMessages = transcripts.length > 0;
  const hasToolCalls = transcripts.some(t => t.toolCalls.length > 0);
  const hasTokenUsage = transcripts.every(t => t.tokenUsage.total > 0);
  const passed = hasMessages && hasToolCalls && hasTokenUsage;
  return {
    name: `${condition}-transcript-structure`,
    passed,
    detail: passed
      ? `${transcripts.length} transcripts with tool calls and token usage`
      : `Missing: ${!hasMessages ? 'transcripts' : ''} ${!hasToolCalls ? 'tool calls' : ''} ${!hasTokenUsage ? 'token usage' : ''}`.trim(),
  };
}

export function checkNoTwiningTools(transcripts: AgentTranscript[]): SmokeTestCheck {
  const twiningCalls = transcripts.flatMap(t => t.toolCalls).filter(tc => tc.toolName?.startsWith('twining_') || tc.toolName?.includes('twining'));
  return {
    name: 'baseline-no-twining-tools',
    passed: twiningCalls.length === 0,
    detail: twiningCalls.length === 0
      ? 'No Twining tool calls found (expected)'
      : `Found ${twiningCalls.length} unexpected Twining tool calls`,
  };
}

export function checkHasTwiningTools(transcripts: AgentTranscript[]): SmokeTestCheck {
  const allCalls = transcripts.flatMap(t => t.toolCalls);
  const hasAssemble = allCalls.some(tc => tc.toolName?.includes('twining_assemble'));
  const hasDecide = allCalls.some(tc => tc.toolName?.includes('twining_decide'));
  const passed = hasAssemble && hasDecide;
  return {
    name: 'twining-has-lifecycle-tools',
    passed,
    detail: passed
      ? 'Found twining_assemble and twining_decide calls'
      : `Missing: ${!hasAssemble ? 'twining_assemble' : ''} ${!hasDecide ? 'twining_decide' : ''}`.trim(),
  };
}

export function checkNoTwiningDir(workingDir: string): SmokeTestCheck {
  const twiningDir = join(workingDir, '.twining');
  const exists = existsSync(twiningDir);
  return {
    name: 'baseline-no-twining-dir',
    passed: !exists,
    detail: exists ? '.twining/ directory found in baseline working dir (unexpected)' : 'No .twining/ directory (expected)',
  };
}
