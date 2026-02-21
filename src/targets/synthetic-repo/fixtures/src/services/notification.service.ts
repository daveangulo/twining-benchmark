/**
 * Notification service — handles sending notifications in response to events.
 *
 * Architecture decision: This service listens to events from the EventBus
 * rather than being called directly by other services. This keeps the
 * notification logic decoupled from order/user management.
 *
 * Depends on:
 * - EventBus (event system) for receiving events
 */

import type { EventBus } from '../events/event-bus.js';
import type { OrderCreatedEvent, OrderStatusChangedEvent } from '../events/event-types.js';
import { Logger } from '../utils/logger.js';

export interface Notification {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  sentAt: Date;
}

let nextId = 1;

function generateNotificationId(): string {
  return `notif-${String(nextId++).padStart(4, '0')}`;
}

export function resetNotificationIdCounter(): void {
  nextId = 1;
}

export class NotificationService {
  private logger = new Logger('NotificationService');
  private notifications: Notification[] = [];

  constructor(private eventBus: EventBus) {
    this.registerHandlers();
  }

  /**
   * Register event handlers for notification triggers.
   */
  private registerHandlers(): void {
    this.eventBus.on<OrderCreatedEvent>('order:created', (event) => {
      this.handleOrderCreated(event);
    });

    this.eventBus.on<OrderStatusChangedEvent>('order:status-changed', (event) => {
      this.handleOrderStatusChanged(event);
    });
  }

  /**
   * Handle order created event — send confirmation to user.
   */
  private handleOrderCreated(event: OrderCreatedEvent): void {
    this.logger.info(`Sending order confirmation for order ${event.order.id}`);

    const itemSummary = event.order.items
      .map((item) => `${item.name} x${item.quantity}`)
      .join(', ');

    this.sendNotification({
      recipient: event.user.email,
      subject: `Order Confirmation: ${event.order.id}`,
      body: `Your order has been placed. Items: ${itemSummary}. Total: $${event.order.total.toFixed(2)}`,
    });
  }

  /**
   * Handle order status change — notify user of update.
   */
  private handleOrderStatusChanged(event: OrderStatusChangedEvent): void {
    this.logger.info(
      `Sending status update for order ${event.order.id}: ${event.previousStatus} -> ${event.newStatus}`,
    );

    this.sendNotification({
      recipient: event.order.userId,
      subject: `Order Update: ${event.order.id}`,
      body: `Your order status has changed from ${event.previousStatus} to ${event.newStatus}.`,
    });
  }

  /**
   * Send a notification (in-memory for this demo).
   */
  private sendNotification(params: {
    recipient: string;
    subject: string;
    body: string;
  }): void {
    const notification: Notification = {
      id: generateNotificationId(),
      recipient: params.recipient,
      subject: params.subject,
      body: params.body,
      sentAt: new Date(),
    };
    this.notifications.push(notification);
    this.logger.info(`Notification sent: ${notification.id} to ${params.recipient}`);
  }

  /**
   * Get all sent notifications.
   */
  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  /**
   * Get notifications for a specific recipient.
   */
  getNotificationsForRecipient(recipient: string): Notification[] {
    return this.notifications.filter((n) => n.recipient === recipient);
  }

  /**
   * Get the count of sent notifications.
   */
  getNotificationCount(): number {
    return this.notifications.length;
  }

  /**
   * Clear all notifications (useful for testing).
   */
  clearNotifications(): void {
    this.notifications = [];
  }
}
