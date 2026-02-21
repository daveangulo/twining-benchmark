/**
 * Pagination utilities for list endpoints.
 */

export interface PaginationResult<T> {
  /** Items on the current page */
  items: T[];
  /** Current page number (1-indexed) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Total number of items across all pages */
  totalItems: number;
  /** Total number of pages */
  totalPages: number;
  /** Whether there is a next page */
  hasNext: boolean;
  /** Whether there is a previous page */
  hasPrevious: boolean;
}

/**
 * Paginate an array of items.
 *
 * @param items - The full array of items to paginate
 * @param page - The page number to retrieve (1-indexed)
 * @param pageSize - Number of items per page
 * @returns Paginated result with metadata
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): PaginationResult<T> {
  if (page < 1) {
    throw new Error('Page must be >= 1');
  }
  if (pageSize < 1) {
    throw new Error('Page size must be >= 1');
  }

  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / pageSize);

  const offset = page === 1 ? 0 : (page - 1) * pageSize - 1;
  const pageItems = items.slice(offset, offset + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}
