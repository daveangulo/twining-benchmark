import type { AgentTranscript } from '../types/index.js';

/**
 * Classification of a run failure (FR-RUN-004).
 */
export type FailureClass =
  | 'timeout'
  | 'api-error'
  | 'crash'
  | 'no-changes'
  | 'non-compiling'
  | 'unknown';

/**
 * Classified failure result.
 */
export interface ClassifiedFailure {
  /** Failure classification */
  failureClass: FailureClass;
  /** Whether this failure is retryable */
  retryable: boolean;
  /** Human-readable description */
  description: string;
  /** Original error if available */
  originalError?: string;
}

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 0) */
  maxRetries: number;
  /** Base delay between retries in ms (default: 5000) */
  baseDelayMs?: number;
  /** Whether to use exponential backoff (default: true) */
  exponentialBackoff?: boolean;
}

/**
 * Result of a retry-wrapped execution.
 */
export interface RetryResult<T> {
  /** The successful result, if any */
  result?: T;
  /** Whether execution succeeded */
  success: boolean;
  /** Number of attempts made */
  attempts: number;
  /** Failures from each failed attempt */
  failures: ClassifiedFailure[];
}

/**
 * Classify a session failure based on its transcript data.
 * Per FR-RUN-004: a run is considered failed if:
 * - Agent exceeds timeout
 * - Agent produces no file changes
 * - Target repo left in non-compiling state with no commits
 */
export function classifyFailure(transcript: AgentTranscript): ClassifiedFailure {
  if (transcript.exitReason === 'timeout') {
    return {
      failureClass: 'timeout',
      retryable: true,
      description: `Session timed out after ${transcript.timing.durationMs}ms`,
      originalError: transcript.error,
    };
  }

  if (transcript.exitReason === 'error') {
    const errorStr = transcript.error ?? '';

    // API-level errors are retryable
    if (
      errorStr.includes('rate_limit') ||
      errorStr.includes('server_error') ||
      errorStr.includes('billing_error') ||
      errorStr.includes('overloaded')
    ) {
      return {
        failureClass: 'api-error',
        retryable: true,
        description: `API error: ${errorStr}`,
        originalError: errorStr,
      };
    }

    // Authentication errors are not retryable
    if (errorStr.includes('authentication_failed')) {
      return {
        failureClass: 'api-error',
        retryable: false,
        description: `Authentication failed: ${errorStr}`,
        originalError: errorStr,
      };
    }

    return {
      failureClass: 'crash',
      retryable: true,
      description: `Agent session crashed: ${errorStr}`,
      originalError: errorStr,
    };
  }

  // Session "completed" but made zero tool calls — likely API rate limit.
  // The CLI gets a 429, exits cleanly, but produces nothing useful.
  if (
    transcript.exitReason === 'completed' &&
    transcript.toolCalls.length === 0
  ) {
    return {
      failureClass: 'api-error',
      retryable: true,
      description: `Session completed with 0 tool calls in ${(transcript.timing.durationMs / 1000).toFixed(0)}s — likely rate-limited`,
    };
  }

  // Session completed but no file changes — considered a failure
  if (transcript.fileChanges.length === 0 && transcript.toolCalls.length > 0) {
    return {
      failureClass: 'no-changes',
      retryable: true,
      description: 'Agent completed but produced no file changes',
    };
  }

  // Should not reach here for actual failures
  return {
    failureClass: 'unknown',
    retryable: false,
    description: `Unknown failure state: exitReason=${transcript.exitReason}`,
    originalError: transcript.error,
  };
}

/**
 * Determine if a transcript represents a failed session.
 */
export function isSessionFailed(transcript: AgentTranscript): boolean {
  if (transcript.exitReason === 'timeout') return true;
  if (transcript.exitReason === 'error') return true;
  // Completed but no tool calls AND no file changes = likely rate-limited or crashed.
  // The CLI gets a 429, exits cleanly with "completed", but produces nothing.
  if (
    transcript.exitReason === 'completed' &&
    transcript.toolCalls.length === 0 &&
    transcript.fileChanges.length === 0
  ) {
    return true;
  }
  return false;
}

/**
 * Calculate retry delay with optional exponential backoff.
 */
function calculateDelay(attempt: number, baseDelayMs: number, exponential: boolean): number {
  if (!exponential) return baseDelayMs;
  // Exponential backoff with jitter
  const delay = baseDelayMs * Math.pow(2, attempt);
  const jitter = delay * 0.1 * Math.random();
  return delay + jitter;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic (FR-RUN-004).
 *
 * Retries on retryable failures up to maxRetries times.
 * Uses exponential backoff by default.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (result: T) => ClassifiedFailure | null,
  options: RetryOptions,
): Promise<RetryResult<T>> {
  const maxRetries = options.maxRetries;
  const baseDelayMs = options.baseDelayMs ?? 5000;
  const exponential = options.exponentialBackoff ?? true;
  const failures: ClassifiedFailure[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      const failure = shouldRetry(result);

      if (failure === null) {
        // Success
        return { result, success: true, attempts: attempt + 1, failures };
      }

      failures.push(failure);

      if (!failure.retryable || attempt >= maxRetries) {
        return { result, success: false, attempts: attempt + 1, failures };
      }

      // Wait before retrying
      const delay = calculateDelay(attempt, baseDelayMs, exponential);
      await sleep(delay);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failures.push({
        failureClass: 'crash',
        retryable: attempt < maxRetries,
        description: `Unexpected error on attempt ${attempt + 1}: ${errorMessage}`,
        originalError: errorMessage,
      });

      if (attempt >= maxRetries) {
        return { success: false, attempts: attempt + 1, failures };
      }

      const delay = calculateDelay(attempt, baseDelayMs, exponential);
      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  return { success: false, attempts: maxRetries + 1, failures };
}
