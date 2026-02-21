/**
 * Abstract base repository implementing the Repository pattern.
 *
 * Architecture decision: All data access in this application goes through
 * Repository classes. Repositories provide a domain-oriented abstraction
 * over the underlying data store (Database utility layer).
 *
 * This pattern:
 * - Decouples business logic from data access details
 * - Makes it easy to swap the data store (e.g., from in-memory to PostgreSQL)
 * - Provides a consistent API for CRUD operations across all entities
 * - Centralizes data access concerns (validation, transformation, caching)
 */

import type { DatabaseRecord } from '../utils/database.js';
import { Database } from '../utils/database.js';
import { Logger } from '../utils/logger.js';

export abstract class BaseRepository<T extends { id: string }> {
  protected logger: Logger;

  constructor(
    protected db: Database,
    protected collectionName: string,
  ) {
    this.logger = new Logger(`Repository:${collectionName}`);
  }

  /**
   * Convert a database record to a domain entity.
   */
  protected abstract toDomain(record: DatabaseRecord): T;

  /**
   * Convert a domain entity to a database record.
   */
  protected abstract toRecord(entity: T): DatabaseRecord;

  /**
   * Find an entity by ID.
   */
  findById(id: string): T | undefined {
    this.logger.debug(`Finding ${this.collectionName} by id: ${id}`);
    const record = this.db.findById(this.collectionName, id);
    return record ? this.toDomain(record) : undefined;
  }

  /**
   * Find all entities, optionally filtered.
   */
  findAll(predicate?: (entity: T) => boolean): T[] {
    this.logger.debug(`Finding all ${this.collectionName}`);
    const records = this.db.findAll(this.collectionName);
    const entities = records.map((r) => this.toDomain(r));
    return predicate ? entities.filter(predicate) : entities;
  }

  /**
   * Save a new entity.
   */
  save(entity: T): T {
    this.logger.info(`Saving ${this.collectionName}: ${entity.id}`);
    const record = this.toRecord(entity);
    this.db.insert(this.collectionName, record);
    return entity;
  }

  /**
   * Update an existing entity.
   */
  update(id: string, updates: Partial<T>): T {
    this.logger.info(`Updating ${this.collectionName}: ${id}`);
    const existing = this.findById(id);
    if (!existing) {
      throw new Error(`${this.collectionName} not found: ${id}`);
    }
    const updated = { ...existing, ...updates, id } as T;
    this.db.update(this.collectionName, id, this.toRecord(updated));
    return updated;
  }

  /**
   * Delete an entity by ID.
   */
  delete(id: string): boolean {
    this.logger.info(`Deleting ${this.collectionName}: ${id}`);
    return this.db.delete(this.collectionName, id);
  }

  /**
   * Count all entities in the collection.
   */
  count(): number {
    return this.db.count(this.collectionName);
  }
}
