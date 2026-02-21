import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../../src/utils/database.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import type { User } from '../../src/models/user.js';

describe('UserRepository', () => {
  let db: Database;
  let repo: UserRepository;

  const makeUser = (overrides?: Partial<User>): User => ({
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    role: 'member',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    db = new Database();
    repo = new UserRepository(db);
  });

  it('should save and retrieve a user', () => {
    const user = makeUser();
    repo.save(user);
    const found = repo.findById('user-1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Alice');
    expect(found?.email).toBe('alice@example.com');
  });

  it('should find user by email', () => {
    repo.save(makeUser());
    const found = repo.findByEmail('alice@example.com');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Alice');
  });

  it('should return undefined for non-existent email', () => {
    expect(repo.findByEmail('nobody@example.com')).toBeUndefined();
  });

  it('should find users by role', () => {
    repo.save(makeUser({ id: 'u1', role: 'admin' }));
    repo.save(makeUser({ id: 'u2', role: 'member', email: 'bob@example.com' }));
    repo.save(makeUser({ id: 'u3', role: 'admin', email: 'carol@example.com' }));

    const admins = repo.findByRole('admin');
    expect(admins).toHaveLength(2);
  });

  it('should update a user', () => {
    repo.save(makeUser());
    const updated = repo.update('user-1', { name: 'Alice Smith' });
    expect(updated.name).toBe('Alice Smith');
    expect(updated.email).toBe('alice@example.com');
  });

  it('should delete a user', () => {
    repo.save(makeUser());
    expect(repo.delete('user-1')).toBe(true);
    expect(repo.findById('user-1')).toBeUndefined();
  });

  it('should count users', () => {
    repo.save(makeUser({ id: 'u1' }));
    repo.save(makeUser({ id: 'u2', email: 'bob@example.com' }));
    expect(repo.count()).toBe(2);
  });

  it('should convert dates correctly through round-trip', () => {
    const user = makeUser({ createdAt: new Date('2024-06-15T10:30:00Z') });
    repo.save(user);
    const found = repo.findById('user-1');
    expect(found?.createdAt).toEqual(new Date('2024-06-15T10:30:00Z'));
  });
});
