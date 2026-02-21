import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, configureLogger, getLogger } from '../../../src/cli/utils/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('logs info messages to stderr', () => {
    const logger = new Logger({ level: 'info' });
    logger.info('test message');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('test message');
    expect(output).toContain('[INF]');
  });

  it('logs warn messages to stderr', () => {
    const logger = new Logger({ level: 'info' });
    logger.warn('warning message');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('warning message');
    expect(output).toContain('[WRN]');
  });

  it('logs error messages to stderr', () => {
    const logger = new Logger({ level: 'info' });
    logger.error('error message');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('error message');
    expect(output).toContain('[ERR]');
  });

  it('suppresses debug messages at info level', () => {
    const logger = new Logger({ level: 'info' });
    logger.debug('debug message');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows debug messages at debug level', () => {
    const logger = new Logger({ level: 'debug', verbose: true });
    logger.debug('debug message');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('debug message');
  });

  it('suppresses all output in silent mode', () => {
    const logger = new Logger({ level: 'debug', silent: true });
    logger.info('silent message');
    logger.error('silent error');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('includes context in output', () => {
    const logger = new Logger({ level: 'info' });
    logger.info('test', { key: 'value' });
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('key=');
    expect(output).toContain('"value"');
  });

  it('configureLogger replaces global logger', () => {
    const oldLogger = getLogger();
    const newLogger = configureLogger({ level: 'error' });
    expect(getLogger()).toBe(newLogger);
    expect(getLogger()).not.toBe(oldLogger);
    // Reset
    configureLogger({});
  });
});
