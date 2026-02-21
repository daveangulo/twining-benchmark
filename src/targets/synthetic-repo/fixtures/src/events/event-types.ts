/**
 * Event type definitions for the event-driven notification system.
 *
 * This application uses an event bus for decoupled communication between
 * modules. Services emit events when significant actions occur, and
 * interested listeners handle them independently.
 */

import type { Order } from '../models/order.js';
import type { User } from '../models/user.js';

export interface OrderCreatedEvent {
  type: 'order:created';
  order: Order;
  user: User;
  timestamp: Date;
}

export interface OrderStatusChangedEvent {
  type: 'order:status-changed';
  order: Order;
  previousStatus: string;
  newStatus: string;
  timestamp: Date;
}

export interface UserCreatedEvent {
  type: 'user:created';
  user: User;
  timestamp: Date;
}

export interface UserUpdatedEvent {
  type: 'user:updated';
  user: User;
  changes: string[];
  timestamp: Date;
}

export type AppEvent =
  | OrderCreatedEvent
  | OrderStatusChangedEvent
  | UserCreatedEvent
  | UserUpdatedEvent;

export type EventType = AppEvent['type'];
