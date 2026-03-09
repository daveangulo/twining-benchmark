import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkTranscriptStructure,
  checkNoTwiningTools,
  checkHasTwiningTools,
  checkNoTwiningDir,
} from '../../../src/runner/smoke-test.js';
import type { AgentTranscript } from '../../../src/types/transcript.js';

/**
 * Build a minimal mock AgentTranscript for testing check functions.
 */
function mockTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'test-session',
    runId: 'test-run',
    scenario: 'refactoring-handoff',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Test prompt',
    toolCalls: [
      {
        toolName: 'Read',
        parameters: { file_path: '/tmp/test.ts' },
        timestamp: new Date().toISOString(),
        durationMs: 100,
      },
    ],
    fileChanges: [],
    tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150, costUsd: 0.01 },
    timing: {
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 5000,
      timeToFirstActionMs: 1000,
    },
    exitReason: 'completed',
    numTurns: 3,
    stopReason: 'success',
    contextWindowSize: 200000,
    compactionCount: 0,
    turnUsage: [],
    ...overrides,
  };
}

describe('checkTranscriptStructure', () => {
  it('passes when transcripts have messages, tool calls, and token usage', () => {
    const transcripts = [mockTranscript()];
    const result = checkTranscriptStructure('baseline', transcripts);
    expect(result.passed).toBe(true);
    expect(result.name).toBe('baseline-transcript-structure');
    expect(result.detail).toContain('1 transcripts');
  });

  it('fails when transcripts array is empty', () => {
    const result = checkTranscriptStructure('baseline', []);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('transcripts');
  });

  it('fails when no transcript has tool calls', () => {
    const transcripts = [mockTranscript({ toolCalls: [] })];
    const result = checkTranscriptStructure('baseline', transcripts);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('tool calls');
  });

  it('fails when a transcript has zero token usage', () => {
    const transcripts = [
      mockTranscript({
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, costUsd: 0 },
      }),
    ];
    const result = checkTranscriptStructure('baseline', transcripts);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('token usage');
  });

  it('uses the condition name as prefix in the check name', () => {
    const result = checkTranscriptStructure('full-twining', [mockTranscript()]);
    expect(result.name).toBe('full-twining-transcript-structure');
  });
});

describe('checkNoTwiningTools', () => {
  it('passes when no tool calls contain twining', () => {
    const transcripts = [mockTranscript()];
    const result = checkNoTwiningTools(transcripts);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('No Twining tool calls found');
  });

  it('fails when tool calls include twining tools', () => {
    const transcripts = [
      mockTranscript({
        toolCalls: [
          {
            toolName: 'mcp__plugin_twining_twining__twining_assemble',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 200,
          },
        ],
      }),
    ];
    const result = checkNoTwiningTools(transcripts);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('1 unexpected Twining tool calls');
  });

  it('fails when tool calls start with twining_', () => {
    const transcripts = [
      mockTranscript({
        toolCalls: [
          {
            toolName: 'twining_decide',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 100,
          },
        ],
      }),
    ];
    const result = checkNoTwiningTools(transcripts);
    expect(result.passed).toBe(false);
  });
});

describe('checkHasTwiningTools', () => {
  it('passes when both twining_assemble and twining_decide are present', () => {
    const transcripts = [
      mockTranscript({
        toolCalls: [
          {
            toolName: 'mcp__plugin_twining_twining__twining_assemble',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 200,
          },
          {
            toolName: 'mcp__plugin_twining_twining__twining_decide',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 150,
          },
        ],
      }),
    ];
    const result = checkHasTwiningTools(transcripts);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('twining_assemble');
    expect(result.detail).toContain('twining_decide');
  });

  it('fails when twining_assemble is missing', () => {
    const transcripts = [
      mockTranscript({
        toolCalls: [
          {
            toolName: 'mcp__plugin_twining_twining__twining_decide',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 150,
          },
        ],
      }),
    ];
    const result = checkHasTwiningTools(transcripts);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('twining_assemble');
  });

  it('fails when twining_decide is missing', () => {
    const transcripts = [
      mockTranscript({
        toolCalls: [
          {
            toolName: 'mcp__plugin_twining_twining__twining_assemble',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 200,
          },
        ],
      }),
    ];
    const result = checkHasTwiningTools(transcripts);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('twining_decide');
  });

  it('fails when no twining tools are present', () => {
    const transcripts = [mockTranscript()];
    const result = checkHasTwiningTools(transcripts);
    expect(result.passed).toBe(false);
  });

  it('finds tools across multiple transcripts', () => {
    const transcripts = [
      mockTranscript({
        toolCalls: [
          {
            toolName: 'mcp__plugin_twining_twining__twining_assemble',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 200,
          },
        ],
      }),
      mockTranscript({
        toolCalls: [
          {
            toolName: 'mcp__plugin_twining_twining__twining_decide',
            parameters: {},
            timestamp: new Date().toISOString(),
            durationMs: 150,
          },
        ],
      }),
    ];
    const result = checkHasTwiningTools(transcripts);
    expect(result.passed).toBe(true);
  });
});

describe('checkNoTwiningDir', () => {
  let tmpDir: string;

  it('passes when .twining directory does not exist', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'smoke-test-'));
    const result = checkNoTwiningDir(tmpDir);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('No .twining/ directory');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('fails when .twining directory exists', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'smoke-test-'));
    await mkdir(join(tmpDir, '.twining'), { recursive: true });
    const result = checkNoTwiningDir(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('.twining/ directory found');
    await rm(tmpDir, { recursive: true, force: true });
  });
});
