import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../src/events/event-bus.js';
import {
  NotificationService,
  resetNotificationIdCounter,
} from '../../src/services/notification.service.js';
import type { OrderCreatedEvent, OrderStatusChangedEvent } from '../../src/events/event-types.js';

describe('NotificationService', () => {
  let eventBus: EventBus;
  let service: NotificationService;

  beforeEach(() => {
    eventBus = new EventBus();
    service = new NotificationService(eventBus);
    resetNotificationIdCounter();
  });

  describe('order:created handler', () => {
    it('should send notification on order created', async () => {
      const event: OrderCreatedEvent = {
        type: 'order:created',
        order: {
          id: 'order-1',
          userId: 'user-1',
          items: [
            { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
          ],
          total: 20,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        user: {
          id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'member',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await eventBus.emit(event);

      const notifications = service.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.recipient).toBe('alice@example.com');
      expect(notifications[0]?.subject).toContain('Order Confirmation');
      expect(notifications[0]?.body).toContain('Widget x2');
      expect(notifications[0]?.body).toContain('$20.00');
    });

    it('should include all items in notification body', async () => {
      const event: OrderCreatedEvent = {
        type: 'order:created',
        order: {
          id: 'order-1',
          userId: 'user-1',
          items: [
            { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
            { productId: 'p2', name: 'Gadget', quantity: 1, unitPrice: 25 },
          ],
          total: 45,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        user: {
          id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'member',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await eventBus.emit(event);

      const notifications = service.getNotifications();
      expect(notifications[0]?.body).toContain('Widget x2');
      expect(notifications[0]?.body).toContain('Gadget x1');
    });
  });

  describe('order:status-changed handler', () => {
    it('should send notification on status change', async () => {
      const event: OrderStatusChangedEvent = {
        type: 'order:status-changed',
        order: {
          id: 'order-1',
          userId: 'user-1',
          items: [],
          total: 20,
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        previousStatus: 'pending',
        newStatus: 'confirmed',
        timestamp: new Date(),
      };

      await eventBus.emit(event);

      const notifications = service.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.subject).toContain('Order Update');
      expect(notifications[0]?.body).toContain('pending');
      expect(notifications[0]?.body).toContain('confirmed');
    });
  });

  describe('notification management', () => {
    it('should count notifications', async () => {
      expect(service.getNotificationCount()).toBe(0);

      await eventBus.emit({
        type: 'order:status-changed',
        order: {
          id: 'order-1',
          userId: 'user-1',
          items: [],
          total: 20,
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        previousStatus: 'pending',
        newStatus: 'confirmed',
        timestamp: new Date(),
      });

      expect(service.getNotificationCount()).toBe(1);
    });

    it('should filter by recipient', async () => {
      const event: OrderCreatedEvent = {
        type: 'order:created',
        order: {
          id: 'order-1',
          userId: 'user-1',
          items: [
            { productId: 'p1', name: 'Widget', quantity: 1, unitPrice: 10 },
          ],
          total: 10,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        user: {
          id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'member',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await eventBus.emit(event);

      expect(service.getNotificationsForRecipient('alice@example.com')).toHaveLength(1);
      expect(service.getNotificationsForRecipient('bob@example.com')).toHaveLength(0);
    });

    it('should clear notifications', async () => {
      await eventBus.emit({
        type: 'order:status-changed',
        order: {
          id: 'order-1',
          userId: 'user-1',
          items: [],
          total: 20,
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        previousStatus: 'pending',
        newStatus: 'confirmed',
        timestamp: new Date(),
      });

      service.clearNotifications();
      expect(service.getNotificationCount()).toBe(0);
    });

    it('should generate sequential notification IDs', async () => {
      await eventBus.emit({
        type: 'order:status-changed',
        order: {
          id: 'order-1',
          userId: 'user-1',
          items: [],
          total: 20,
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        previousStatus: 'pending',
        newStatus: 'confirmed',
        timestamp: new Date(),
      });
      await eventBus.emit({
        type: 'order:status-changed',
        order: {
          id: 'order-2',
          userId: 'user-1',
          items: [],
          total: 30,
          status: 'shipped',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        previousStatus: 'confirmed',
        newStatus: 'shipped',
        timestamp: new Date(),
      });

      const notifications = service.getNotifications();
      expect(notifications[0]?.id).toBe('notif-0001');
      expect(notifications[1]?.id).toBe('notif-0002');
    });
  });
});
