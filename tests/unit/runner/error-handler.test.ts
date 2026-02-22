import { describe, it, expect, vi } from 'vitest';
import {
  classifyFailure,
  isSessionFailed,
  withRetry,
  type ClassifiedFailure,
} from '../../../src/runner/error-handler.js';
import type { AgentTranscript } from '../../../src/types/index.js';

function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    sessionId: 'sess-1',
    runId: 'run-1',
    scenario: 'test',
    condition: 'baseline',
    taskIndex: 0,
    prompt: 'Do something',
    toolCalls: [],
    fileChanges: [],
    tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150, costUsd: 0 },
    timing: {
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:01:00.000Z',
      durationMs: 60000,
      timeToFirstActionMs: -1,
    },
    exitReason: 'completed',
    numTurns: 1,
    stopReason: 'success',
    contextWindowSize: 200000,
    compactionCount: 0,
    turnUsage: [],
    ...overrides,
  };
}

describe('classifyFailure', () => {
  it('classifies timeout as retryable', () => {
    const transcript = makeTranscript({
      exitReason: 'timeout',
      error: 'Session timed out after 900000ms',
    });

    const result = classifyFailure(transcript);

    expect(result.failureClass).toBe('timeout');
    expect(result.retryable).toBe(true);
  });

  it('classifies rate limit error as retryable API error', () => {
    const transcript = makeTranscript({
      exitReason: 'error',
      error: 'rate_limit: Too many requests',
    });

    const result = classifyFailure(transcript);

    expect(result.failureClass).toBe('api-error');
    expect(result.retryable).toBe(true);
  });

  it('classifies authentication error as non-retryable', () => {
    const transcript = makeTranscript({
      exitReason: 'error',
      error: 'authentication_failed: Invalid API key',
    });

    const result = classifyFailure(transcript);

    expect(result.failureClass).toBe('api-error');
    expect(result.retryable).toBe(false);
  });

  it('classifies generic error as retryable crash', () => {
    const transcript = makeTranscript({
      exitReason: 'error',
      error: 'Unexpected EOF',
    });

    const result = classifyFailure(transcript);

    expect(result.failureClass).toBe('crash');
    expect(result.retryable).toBe(true);
  });

  it('classifies no file changes with tool calls as no-changes failure', () => {
    const transcript = makeTranscript({
      exitReason: 'completed',
      toolCalls: [
        {
          toolName: 'Read',
          parameters: { file_path: '/test' },
          timestamp: '2026-01-01T00:00:30.000Z',
          durationMs: 100,
        },
      ],
      fileChanges: [],
    });

    const result = classifyFailure(transcript);

    expect(result.failureClass).toBe('no-changes');
    expect(result.retryable).toBe(true);
  });
});

describe('isSessionFailed', () => {
  it('returns true for timeout', () => {
    expect(isSessionFailed(makeTranscript({ exitReason: 'timeout' }))).toBe(true);
  });

  it('returns true for error', () => {
    expect(isSessionFailed(makeTranscript({ exitReason: 'error' }))).toBe(true);
  });

  it('returns true for completed with no tools and no changes', () => {
    expect(isSessionFailed(makeTranscript({
      exitReason: 'completed',
      toolCalls: [],
      fileChanges: [],
    }))).toBe(true);
  });

  it('returns false for completed with file changes', () => {
    expect(isSessionFailed(makeTranscript({
      exitReason: 'completed',
      fileChanges: [
        { path: 'test.ts', changeType: 'modified', linesAdded: 5, linesRemoved: 2 },
      ],
    }))).toBe(false);
  });

  it('returns false for completed with tool calls', () => {
    expect(isSessionFailed(makeTranscript({
      exitReason: 'completed',
      toolCalls: [
        { toolName: 'Read', parameters: {}, timestamp: '2026-01-01T00:00:30.000Z', durationMs: 100 },
      ],
    }))).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns immediately on success with no retries', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        return 'success';
      },
      () => null,
      { maxRetries: 3 },
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe('success');
    expect(result.attempts).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(callCount).toBe(1);
  });

  it('retries on retryable failure', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        return callCount >= 3 ? 'success' : 'fail';
      },
      (res) => {
        if (res === 'fail') {
          return {
            failureClass: 'crash',
            retryable: true,
            description: 'Failed',
          } satisfies ClassifiedFailure;
        }
        return null;
      },
      { maxRetries: 3, baseDelayMs: 10, exponentialBackoff: false },
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe('success');
    expect(result.attempts).toBe(3);
    expect(result.failures).toHaveLength(2);
    expect(callCount).toBe(3);
  });

  it('stops retrying on non-retryable failure', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        return 'fail';
      },
      () => ({
        failureClass: 'api-error' as const,
        retryable: false,
        description: 'Auth failed',
      }),
      { maxRetries: 3, baseDelayMs: 10 },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });

  it('stops after max retries', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        return 'fail';
      },
      () => ({
        failureClass: 'timeout' as const,
        retryable: true,
        description: 'Timed out',
      }),
      { maxRetries: 2, baseDelayMs: 10, exponentialBackoff: false },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3); // initial + 2 retries
    expect(callCount).toBe(3);
    expect(result.failures).toHaveLength(3);
  });

  it('handles thrown exceptions', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) throw new Error('Connection reset');
        return 'success';
      },
      () => null,
      { maxRetries: 3, baseDelayMs: 10, exponentialBackoff: false },
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe('success');
    expect(result.attempts).toBe(3);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]!.failureClass).toBe('crash');
  });

  it('works with zero retries (maxRetries: 0)', async () => {
    const result = await withRetry(
      async () => 'fail',
      () => ({
        failureClass: 'crash' as const,
        retryable: true,
        description: 'Crashed',
      }),
      { maxRetries: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });
});
