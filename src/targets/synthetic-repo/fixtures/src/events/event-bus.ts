/**
 * Event bus for decoupled inter-module communication.
 *
 * Architecture decision: This application uses an event-driven pattern
 * for communication between services. Instead of direct function calls
 * between modules, services emit events that other services can listen to.
 *
 * This promotes loose coupling and makes it easy to add new behaviors
 * (e.g., new notification channels) without modifying existing services.
 */

import type { AppEvent, EventType } from './event-types.js';

export type EventHandler<T extends AppEvent = AppEvent> = (event: T) => void | Promise<void>;

export class EventBus {
  private handlers: Map<EventType, EventHandler[]> = new Map();
  private eventLog: AppEvent[] = [];

  /**
   * Subscribe to events of a given type.
   */
  on<T extends AppEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
  ): () => void {
    const handlers = this.handlers.get(eventType) ?? [];
    handlers.push(handler as EventHandler);
    this.handlers.set(eventType, handlers);

    // Return unsubscribe function
    return () => {
      const current = this.handlers.get(eventType) ?? [];
      const index = current.indexOf(handler as EventHandler);
      if (index >= 0) {
        current.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all registered handlers.
   */
  async emit<T extends AppEvent>(event: T): Promise<void> {
    this.eventLog.push(event);
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      await handler(event);
    }
  }

  /**
   * Get all emitted events. Useful for testing and debugging.
   */
  getEventLog(): AppEvent[] {
    return [...this.eventLog];
  }

  /**
   * Clear all handlers and event log.
   */
  clear(): void {
    this.handlers.clear();
    this.eventLog = [];
  }
}
