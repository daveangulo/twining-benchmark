import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../../src/utils/database.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { OrderRepository } from '../../src/repositories/order.repository.js';
import { EventBus } from '../../src/events/event-bus.js';
import { OrderService, resetOrderIdCounter } from '../../src/services/order.service.js';
import type { User } from '../../src/models/user.js';

describe('OrderService', () => {
  let db: Database;
  let userRepo: UserRepository;
  let orderRepo: OrderRepository;
  let eventBus: EventBus;
  let service: OrderService;
  let testUser: User;

  beforeEach(() => {
    db = new Database();
    userRepo = new UserRepository(db);
    orderRepo = new OrderRepository(db);
    eventBus = new EventBus();
    service = new OrderService(orderRepo, userRepo, eventBus);
    resetOrderIdCounter();

    // Create a test user
    testUser = {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@example.com',
      role: 'member',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    userRepo.save(testUser);
  });

  describe('createOrder', () => {
    it('should create an order and emit event', async () => {
      const order = await service.createOrder({
        userId: 'user-1',
        items: [
          { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
        ],
      });

      expect(order.id).toBe('order-0001');
      expect(order.userId).toBe('user-1');
      expect(order.total).toBe(20);
      expect(order.status).toBe('pending');

      const events = eventBus.getEventLog();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('order:created');
    });

    it('should throw for non-existent user', async () => {
      await expect(
        service.createOrder({
          userId: 'nonexistent',
          items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
        }),
      ).rejects.toThrow('User not found');
    });

    it('should throw for empty items', async () => {
      await expect(
        service.createOrder({ userId: 'user-1', items: [] }),
      ).rejects.toThrow('at least one item');
    });

    it('should calculate total from items', async () => {
      const order = await service.createOrder({
        userId: 'user-1',
        items: [
          { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
          { productId: 'p2', name: 'Gadget', quantity: 1, unitPrice: 25 },
        ],
      });

      expect(order.total).toBe(45);
    });
  });

  describe('getOrder', () => {
    it('should get an existing order', async () => {
      const created = await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      });

      const found = service.getOrder(created.id);
      expect(found).toBeDefined();
      expect(found?.total).toBe(10);
    });
  });

  describe('updateOrderStatus', () => {
    it('should update status and emit event', async () => {
      const order = await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      });

      const updated = await service.updateOrderStatus(order.id, 'confirmed');
      expect(updated.status).toBe('confirmed');

      const events = eventBus.getEventLog();
      expect(events).toHaveLength(2); // created + status-changed
      expect(events[1]?.type).toBe('order:status-changed');
    });

    it('should reject invalid status transition', async () => {
      const order = await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      });

      await expect(
        service.updateOrderStatus(order.id, 'delivered'),
      ).rejects.toThrow('Invalid status transition');
    });

    it('should follow valid status flow', async () => {
      const order = await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      });

      await service.updateOrderStatus(order.id, 'confirmed');
      await service.updateOrderStatus(order.id, 'shipped');
      const delivered = await service.updateOrderStatus(order.id, 'delivered');

      expect(delivered.status).toBe('delivered');
    });

    it('should reject transitions from terminal states', async () => {
      const order = await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      });

      await service.updateOrderStatus(order.id, 'cancelled');

      await expect(
        service.updateOrderStatus(order.id, 'confirmed'),
      ).rejects.toThrow('Invalid status transition');
    });

    it('should throw for non-existent order', async () => {
      await expect(
        service.updateOrderStatus('nonexistent', 'confirmed'),
      ).rejects.toThrow('Order not found');
    });
  });

  describe('listUserOrders', () => {
    it('should list orders for a user', async () => {
      await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      });
      await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p2', name: 'Gadget', quantity: 1, unitPrice: 20 }],
      });

      const orders = service.listUserOrders('user-1');
      expect(orders).toHaveLength(2);
    });
  });

  describe('listOrdersByStatus', () => {
    it('should list orders by status', async () => {
      const o1 = await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      });
      await service.createOrder({
        userId: 'user-1',
        items: [{ productId: 'p2', name: 'Gadget', quantity: 1, unitPrice: 20 }],
      });

      await service.updateOrderStatus(o1.id, 'confirmed');

      const pending = service.listOrdersByStatus('pending');
      expect(pending).toHaveLength(1);

      const confirmed = service.listOrdersByStatus('confirmed');
      expect(confirmed).toHaveLength(1);
    });
  });
});
