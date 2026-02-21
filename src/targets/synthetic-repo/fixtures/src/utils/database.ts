/**
 * Simple in-memory database for the application.
 *
 * Provides basic CRUD operations with collection-based storage.
 * This is the utility layer — the deepest dependency in the architecture.
 *
 * Architecture note: All data access goes through Repository classes,
 * which depend on this Database class. Direct database access from
 * services is an anti-pattern in this codebase.
 */

export interface DatabaseRecord {
  id: string;
  [key: string]: unknown;
}

export class Database {
  private collections: Map<string, Map<string, DatabaseRecord>> = new Map();

  /**
   * Get or create a collection.
   */
  private getCollection(name: string): Map<string, DatabaseRecord> {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }
    return collection;
  }

  /**
   * Insert a record into a collection.
   */
  insert(collection: string, record: DatabaseRecord): DatabaseRecord {
    const col = this.getCollection(collection);
    if (col.has(record.id)) {
      throw new Error(`Duplicate key: ${record.id} in collection ${collection}`);
    }
    col.set(record.id, { ...record });
    return { ...record };
  }

  /**
   * Find a record by ID.
   */
  findById(collection: string, id: string): DatabaseRecord | undefined {
    const col = this.getCollection(collection);
    const record = col.get(id);
    return record ? { ...record } : undefined;
  }

  /**
   * Find all records in a collection, optionally filtered by a predicate.
   */
  findAll(
    collection: string,
    predicate?: (record: DatabaseRecord) => boolean,
  ): DatabaseRecord[] {
    const col = this.getCollection(collection);
    const records = Array.from(col.values());
    if (predicate) {
      return records.filter(predicate).map((r) => ({ ...r }));
    }
    return records.map((r) => ({ ...r }));
  }

  /**
   * Update a record by ID. Merges the update into the existing record.
   */
  update(
    collection: string,
    id: string,
    update: Partial<DatabaseRecord>,
  ): DatabaseRecord {
    const col = this.getCollection(collection);
    const existing = col.get(id);
    if (!existing) {
      throw new Error(`Record not found: ${id} in collection ${collection}`);
    }
    const updated = { ...existing, ...update, id };
    col.set(id, updated);
    return { ...updated };
  }

  /**
   * Delete a record by ID.
   */
  delete(collection: string, id: string): boolean {
    const col = this.getCollection(collection);
    return col.delete(id);
  }

  /**
   * Count records in a collection.
   */
  count(collection: string): number {
    const col = this.getCollection(collection);
    return col.size;
  }

  /**
   * Clear all data from all collections.
   */
  clear(): void {
    this.collections.clear();
  }
}

/**
 * Singleton database instance for the application.
 */
let instance: Database | undefined;

export function getDatabase(): Database {
  if (!instance) {
    instance = new Database();
  }
  return instance;
}

export function resetDatabase(): void {
  if (instance) {
    instance.clear();
  }
  instance = undefined;
}
