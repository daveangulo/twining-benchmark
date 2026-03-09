import { describe, it, expect } from 'vitest';
import { seededShuffle } from '../../../src/runner/shuffle.js';

describe('seededShuffle', () => {
  it('produces deterministic output for same seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = seededShuffle(items, 'test-seed-42');
    const b = seededShuffle(items, 'test-seed-42');
    expect(a).toEqual(b);
  });

  it('produces different output for different seeds', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = seededShuffle(items, 'seed-A');
    const b = seededShuffle(items, 'seed-B');
    expect(a).not.toEqual(b);
  });

  it('does not mutate the input array', () => {
    const items = [1, 2, 3];
    const original = [...items];
    seededShuffle(items, 'seed');
    expect(items).toEqual(original);
  });

  it('preserves all elements', () => {
    const items = [1, 2, 3, 4, 5];
    const shuffled = seededShuffle(items, 'seed');
    expect(shuffled.sort()).toEqual(items.sort());
  });
});
