import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Log levels for structured logging.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured log entry format.
 * All log entries are JSON-serializable for machine consumption.
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Logger options.
 */
export interface LoggerOptions {
  /** Minimum log level to display (default: 'info') */
  level?: LogLevel;
  /** Write JSON logs to this file path */
  logFile?: string;
  /** Enable verbose console output (default: false) */
  verbose?: boolean;
  /** Suppress all console output (default: false) */
  silent?: boolean;
}

/**
 * Structured JSON logger.
 *
 * Writes structured JSON to a log file (if configured) and formatted
 * output to stderr (to keep stdout clean for CLI table output).
 */
export class Logger {
  private readonly minLevel: number;
  private readonly logFile?: string;
  private readonly verbose: boolean;
  private readonly silent: boolean;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = LOG_LEVEL_PRIORITY[options.level ?? 'info'];
    this.logFile = options.logFile;
    this.verbose = options.verbose ?? false;
    this.silent = options.silent ?? false;

    if (this.logFile) {
      mkdirSync(dirname(this.logFile), { recursive: true });
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ? { context } : {}),
    };

    // Write to log file as JSON
    if (this.logFile) {
      appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf-8');
    }

    // Write to stderr (formatted for human consumption)
    if (!this.silent) {
      const shouldPrint = this.verbose || level !== 'debug';
      if (shouldPrint) {
        const prefix = this.formatPrefix(level);
        const contextStr = context ? ` ${formatContext(context)}` : '';
        process.stderr.write(`${prefix} ${message}${contextStr}\n`);
      }
    }
  }

  private formatPrefix(level: LogLevel): string {
    switch (level) {
      case 'debug': return '\x1b[90m[DBG]\x1b[0m';
      case 'info':  return '\x1b[36m[INF]\x1b[0m';
      case 'warn':  return '\x1b[33m[WRN]\x1b[0m';
      case 'error': return '\x1b[31m[ERR]\x1b[0m';
    }
  }
}

function formatContext(ctx: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(ctx)) {
    parts.push(`${key}=${JSON.stringify(value)}`);
  }
  return `\x1b[90m(${parts.join(', ')})\x1b[0m`;
}

/**
 * Global logger instance.
 * Reconfigured by CLI commands at startup.
 */
let globalLogger = new Logger();

export function getLogger(): Logger {
  return globalLogger;
}

export function configureLogger(options: LoggerOptions): Logger {
  globalLogger = new Logger(options);
  return globalLogger;
}
