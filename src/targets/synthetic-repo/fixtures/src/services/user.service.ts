/**
 * User service — business logic for user management.
 *
 * Depends on:
 * - UserRepository (data layer) for persistence
 * - EventBus (event system) for publishing user lifecycle events
 *
 * This is the service layer, which sits above the repository layer.
 * Services contain business logic and coordinate between repositories and events.
 */

import type { User, CreateUserInput, UpdateUserInput } from '../models/user.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { EventBus } from '../events/event-bus.js';
import { Logger } from '../utils/logger.js';

let nextId = 1;

function generateId(): string {
  return `user-${String(nextId++).padStart(4, '0')}`;
}

export function resetUserIdCounter(): void {
  nextId = 1;
}

export class UserService {
  private logger = new Logger('UserService');

  constructor(
    private userRepository: UserRepository,
    private eventBus: EventBus,
  ) {}

  /**
   * Create a new user.
   */
  async createUser(input: CreateUserInput): Promise<User> {
    this.logger.info(`Creating user: ${input.name}`);

    // Validate email uniqueness
    const existing = this.userRepository.findByEmail(input.email);
    if (existing) {
      throw new Error(`User with email ${input.email} already exists`);
    }

    const now = new Date();
    const user: User = {
      id: generateId(),
      name: input.name,
      email: input.email,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    };

    this.userRepository.save(user);

    await this.eventBus.emit({
      type: 'user:created',
      user,
      timestamp: now,
    });

    return user;
  }

  /**
   * Get a user by ID.
   */
  getUser(id: string): User | undefined {
    return this.userRepository.findById(id);
  }

  /**
   * Update a user.
   */
  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    this.logger.info(`Updating user: ${id}`);

    const existing = this.userRepository.findById(id);
    if (!existing) {
      throw new Error(`User not found: ${id}`);
    }

    // If changing email, check uniqueness
    if (input.email && input.email !== existing.email) {
      const emailTaken = this.userRepository.findByEmail(input.email);
      if (emailTaken) {
        throw new Error(`Email ${input.email} is already in use`);
      }
    }

    const changes: string[] = [];
    if (input.name && input.name !== existing.name) changes.push('name');
    if (input.email && input.email !== existing.email) changes.push('email');
    if (input.role && input.role !== existing.role) changes.push('role');

    const updated = this.userRepository.update(id, {
      ...input,
      updatedAt: new Date(),
    });

    if (changes.length > 0) {
      await this.eventBus.emit({
        type: 'user:updated',
        user: updated,
        changes,
        timestamp: new Date(),
      });
    }

    return updated;
  }

  /**
   * List all users, optionally filtered by role.
   */
  listUsers(role?: User['role']): User[] {
    if (role) {
      return this.userRepository.findByRole(role);
    }
    return this.userRepository.findAll();
  }

  /**
   * Delete a user.
   */
  deleteUser(id: string): boolean {
    this.logger.info(`Deleting user: ${id}`);
    return this.userRepository.delete(id);
  }
}
