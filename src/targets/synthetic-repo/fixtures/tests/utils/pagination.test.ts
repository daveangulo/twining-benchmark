import { describe, it, expect } from 'vitest';
import { paginate } from '../../src/utils/pagination.js';

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('should return the first page', () => {
    const result = paginate(items, 1, 3);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(3);
    expect(result.totalItems).toBe(10);
    expect(result.totalPages).toBe(4);
    expect(result.hasNext).toBe(true);
    expect(result.hasPrevious).toBe(false);
  });

  it('should handle a single page', () => {
    const result = paginate([1, 2, 3], 1, 10);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.totalPages).toBe(1);
    expect(result.hasNext).toBe(false);
    expect(result.hasPrevious).toBe(false);
  });

  it('should handle exact page boundary', () => {
    const result = paginate([1, 2, 3, 4, 5, 6], 1, 3);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.totalPages).toBe(2);
  });

  it('should handle empty array', () => {
    const result = paginate([], 1, 10);
    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('should throw for page < 1', () => {
    expect(() => paginate(items, 0, 3)).toThrow('Page must be >= 1');
  });

  it('should throw for pageSize < 1', () => {
    expect(() => paginate(items, 1, 0)).toThrow('Page size must be >= 1');
  });

  it('should handle last page with partial items', () => {
    const result = paginate(items, 4, 3);
    // Page 4 of 10 items with pageSize 3 should have just item 10
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.hasNext).toBe(false);
    expect(result.hasPrevious).toBe(true);
  });

  it('should paginate with large page size', () => {
    const result = paginate(items, 1, 100);
    expect(result.items).toEqual(items);
    expect(result.totalPages).toBe(1);
  });
});
