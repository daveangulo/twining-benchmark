/**
 * Simple logger utility for the application.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private logs: Array<{ level: LogLevel; message: string; timestamp: Date }> = [];

  constructor(prefix: string, level: LogLevel = 'info') {
    this.prefix = prefix;
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private log(level: LogLevel, message: string): void {
    if (this.shouldLog(level)) {
      const entry = { level, message, timestamp: new Date() };
      this.logs.push(entry);
    }
  }

  debug(message: string): void {
    this.log('debug', message);
  }

  info(message: string): void {
    this.log('info', message);
  }

  warn(message: string): void {
    this.log('warn', message);
  }

  error(message: string): void {
    this.log('error', message);
  }

  /**
   * Get all log entries. Useful for testing.
   */
  getEntries(): Array<{ level: LogLevel; message: string; timestamp: Date }> {
    return [...this.logs];
  }

  /**
   * Clear all log entries.
   */
  clearEntries(): void {
    this.logs = [];
  }

  getPrefix(): string {
    return this.prefix;
  }
}
