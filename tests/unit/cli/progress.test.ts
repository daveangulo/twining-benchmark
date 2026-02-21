import { describe, it, expect } from 'vitest';
import { formatDuration, formatDollars } from '../../../src/cli/utils/progress.js';

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(45000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(300000)).toBe('5m 0s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(5400000)).toBe('1h 30m');
  });
});

describe('formatDollars', () => {
  it('formats dollar amounts', () => {
    expect(formatDollars(5.4)).toBe('$5.40');
    expect(formatDollars(100)).toBe('$100.00');
    expect(formatDollars(0.5)).toBe('$0.50');
  });
});
