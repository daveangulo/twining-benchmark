/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic: same seed always produces the same sequence.
 * No external dependencies.
 */

/**
 * Convert a string seed into a numeric seed via simple hash.
 */
export function seedFromString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash >>> 0; // ensure unsigned 32-bit
}

/**
 * Create a seeded PRNG (mulberry32 algorithm).
 * Returns a function that produces numbers in [0, 1).
 */
export function createRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded RNG helper class providing common random operations.
 */
export class SeededRng {
  private next: () => number;

  constructor(seed: string) {
    this.next = createRng(seedFromString(seed));
  }

  /** Random float in [0, 1) */
  random(): number {
    return this.next();
  }

  /** Random integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Random element from array */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  /** Shuffle array in place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  /** Random boolean with given probability of true */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Random alphanumeric string */
  alphanumeric(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(this.next() * chars.length)];
    }
    return result;
  }
}
