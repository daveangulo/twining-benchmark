/**
 * Progress display with ETA estimation.
 *
 * Reports progress to stderr so stdout remains clean for
 * structured output (tables, JSON).
 */

export interface ProgressState {
  /** Total number of items to process */
  total: number;
  /** Number of items completed */
  completed: number;
  /** Currently processing description */
  current: string;
  /** Start time of the overall operation */
  startTime: number;
}

/**
 * Format milliseconds into a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format a dollar amount.
 */
export function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Progress display for benchmark execution.
 *
 * Renders a single-line progress bar with ETA to stderr.
 * Updates in place using carriage return.
 */
export class ProgressDisplay {
  private state: ProgressState;
  private readonly isInteractive: boolean;

  constructor(total: number) {
    this.state = {
      total,
      completed: 0,
      current: '',
      startTime: Date.now(),
    };
    this.isInteractive = process.stderr.isTTY === true;
  }

  /**
   * Update progress with a new status.
   */
  update(completed: number, current: string): void {
    this.state.completed = completed;
    this.state.current = current;
    this.render();
  }

  /**
   * Increment completed count by 1.
   */
  tick(current: string): void {
    this.state.completed++;
    this.state.current = current;
    this.render();
  }

  /**
   * Finish progress display — prints newline.
   */
  finish(message?: string): void {
    if (this.isInteractive) {
      // Clear the progress line
      process.stderr.write('\r\x1b[K');
    }
    if (message) {
      const elapsed = formatDuration(Date.now() - this.state.startTime);
      process.stderr.write(`${message} (${elapsed})\n`);
    }
  }

  private render(): void {
    const { completed, total, current, startTime } = this.state;
    const elapsed = Date.now() - startTime;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const eta = this.estimateEta(completed, total, elapsed);

    const barWidth = 20;
    const filled = Math.round((completed / Math.max(total, 1)) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);

    const etaStr = eta !== null ? ` ETA: ${formatDuration(eta)}` : '';
    const line = `  [${bar}] ${completed}/${total} (${pct}%) ${current}${etaStr}`;

    if (this.isInteractive) {
      process.stderr.write(`\r\x1b[K${line}`);
    } else {
      // Non-interactive: print each update on its own line
      process.stderr.write(`${line}\n`);
    }
  }

  private estimateEta(completed: number, total: number, elapsedMs: number): number | null {
    if (completed === 0 || completed >= total) return null;
    const msPerItem = elapsedMs / completed;
    const remaining = total - completed;
    return Math.round(msPerItem * remaining);
  }
}
