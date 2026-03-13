/**
 * Callback registry for direct service-to-service notification.
 *
 * Alternative approach to EventBus: register callbacks directly on services
 * for lightweight, synchronous notification without an intermediary.
 *
 * Trade-offs vs EventBus:
 * - Simpler (no event types, no serialization)
 * - Synchronous by default (predictable ordering)
 * - Tighter coupling (caller knows about callbacks)
 * - No event log / replay capability
 */

export class CallbackRegistry<T = unknown> {
  private callbacks: ((data: T) => void)[] = [];

  /**
   * Register a callback to be notified when events occur.
   */
  register(cb: (data: T) => void): () => void {
    this.callbacks.push(cb);
    // Return unregister function
    return () => {
      const index = this.callbacks.indexOf(cb);
      if (index >= 0) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all registered callbacks with the given data.
   */
  notify(data: T): void {
    for (const cb of this.callbacks) {
      cb(data);
    }
  }

  /**
   * Get the number of registered callbacks.
   */
  get size(): number {
    return this.callbacks.length;
  }

  /**
   * Clear all registered callbacks.
   */
  clear(): void {
    this.callbacks = [];
  }
}

// --- Pre-configured registries ---
// These are shared instances used across services.

import type { OrderStatusChangedEvent } from '../events/event-types.js';

/**
 * Registry for order status change callbacks.
 * Services register here to be notified of status changes
 * via the direct callback pattern (as opposed to EventBus).
 */
export const statusChangeCallbacks = new CallbackRegistry<OrderStatusChangedEvent>();
