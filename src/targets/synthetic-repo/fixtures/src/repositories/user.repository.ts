/**
 * Repository for User data access.
 *
 * Extends BaseRepository with user-specific query methods.
 * Depends on the Database utility layer for storage.
 */

import type { DatabaseRecord } from '../utils/database.js';
import type { Database } from '../utils/database.js';
import type { User } from '../models/user.js';
import { BaseRepository } from './base.repository.js';

export class UserRepository extends BaseRepository<User> {
  constructor(db: Database) {
    super(db, 'users');
  }

  protected toDomain(record: DatabaseRecord): User {
    return {
      id: record['id'] as string,
      name: record['name'] as string,
      email: record['email'] as string,
      role: record['role'] as User['role'],
      createdAt: new Date(record['createdAt'] as string),
      updatedAt: new Date(record['updatedAt'] as string),
    };
  }

  protected toRecord(entity: User): DatabaseRecord {
    return {
      id: entity.id,
      name: entity.name,
      email: entity.email,
      role: entity.role,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /**
   * Find a user by email address.
   */
  findByEmail(email: string): User | undefined {
    const results = this.findAll((user) => user.email === email);
    return results[0];
  }

  /**
   * Find all users with a specific role.
   */
  findByRole(role: User['role']): User[] {
    return this.findAll((user) => user.role === role);
  }
}
