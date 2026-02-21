import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../../src/utils/database.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { EventBus } from '../../src/events/event-bus.js';
import { UserService, resetUserIdCounter } from '../../src/services/user.service.js';

describe('UserService', () => {
  let db: Database;
  let userRepo: UserRepository;
  let eventBus: EventBus;
  let service: UserService;

  beforeEach(() => {
    db = new Database();
    userRepo = new UserRepository(db);
    eventBus = new EventBus();
    service = new UserService(userRepo, eventBus);
    resetUserIdCounter();
  });

  describe('createUser', () => {
    it('should create a user and emit event', async () => {
      const user = await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });

      expect(user.id).toBe('user-0001');
      expect(user.name).toBe('Alice');
      expect(user.email).toBe('alice@example.com');
      expect(user.role).toBe('member');

      const events = eventBus.getEventLog();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('user:created');
    });

    it('should reject duplicate email', async () => {
      await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });

      await expect(
        service.createUser({
          name: 'Alice 2',
          email: 'alice@example.com',
          role: 'member',
        }),
      ).rejects.toThrow('already exists');
    });

    it('should auto-increment IDs', async () => {
      const u1 = await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });
      const u2 = await service.createUser({
        name: 'Bob',
        email: 'bob@example.com',
        role: 'member',
      });

      expect(u1.id).toBe('user-0001');
      expect(u2.id).toBe('user-0002');
    });
  });

  describe('getUser', () => {
    it('should get an existing user', async () => {
      const created = await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });

      const found = service.getUser(created.id);
      expect(found?.name).toBe('Alice');
    });

    it('should return undefined for non-existent user', () => {
      expect(service.getUser('nonexistent')).toBeUndefined();
    });
  });

  describe('updateUser', () => {
    it('should update user fields and emit event', async () => {
      const user = await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });

      const updated = await service.updateUser(user.id, {
        name: 'Alice Smith',
      });

      expect(updated.name).toBe('Alice Smith');
      expect(updated.email).toBe('alice@example.com');

      const events = eventBus.getEventLog();
      expect(events).toHaveLength(2); // created + updated
      expect(events[1]?.type).toBe('user:updated');
    });

    it('should reject duplicate email on update', async () => {
      await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });
      const bob = await service.createUser({
        name: 'Bob',
        email: 'bob@example.com',
        role: 'member',
      });

      await expect(
        service.updateUser(bob.id, { email: 'alice@example.com' }),
      ).rejects.toThrow('already in use');
    });

    it('should not emit event when nothing changed', async () => {
      const user = await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });

      await service.updateUser(user.id, {});

      const events = eventBus.getEventLog();
      expect(events).toHaveLength(1); // only the created event
    });

    it('should throw for non-existent user', async () => {
      await expect(
        service.updateUser('nonexistent', { name: 'Ghost' }),
      ).rejects.toThrow('User not found');
    });
  });

  describe('listUsers', () => {
    it('should list all users', async () => {
      await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'admin',
      });
      await service.createUser({
        name: 'Bob',
        email: 'bob@example.com',
        role: 'member',
      });

      const all = service.listUsers();
      expect(all).toHaveLength(2);
    });

    it('should filter by role', async () => {
      await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'admin',
      });
      await service.createUser({
        name: 'Bob',
        email: 'bob@example.com',
        role: 'member',
      });

      const admins = service.listUsers('admin');
      expect(admins).toHaveLength(1);
      expect(admins[0]?.name).toBe('Alice');
    });
  });

  describe('deleteUser', () => {
    it('should delete a user', async () => {
      const user = await service.createUser({
        name: 'Alice',
        email: 'alice@example.com',
        role: 'member',
      });

      expect(service.deleteUser(user.id)).toBe(true);
      expect(service.getUser(user.id)).toBeUndefined();
    });
  });
});
