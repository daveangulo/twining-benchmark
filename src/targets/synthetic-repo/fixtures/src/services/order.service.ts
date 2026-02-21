/**
 * Order service — business logic for order management.
 *
 * Depends on:
 * - OrderRepository (data layer) for persistence
 * - UserRepository (data layer) for user validation
 * - EventBus (event system) for publishing order lifecycle events
 *
 * Architecture note: Order events are used to trigger side effects
 * (notifications, analytics, etc.) without direct coupling.
 * The OrderService emits events; it does not directly call
 * the NotificationService.
 */

import type { Order, CreateOrderInput, OrderStatus } from '../models/order.js';
import { calculateOrderTotal } from '../models/order.js';
import type { OrderRepository } from '../repositories/order.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { EventBus } from '../events/event-bus.js';
import { Logger } from '../utils/logger.js';

let nextId = 1;

function generateId(): string {
  return `order-${String(nextId++).padStart(4, '0')}`;
}

export function resetOrderIdCounter(): void {
  nextId = 1;
}

export class OrderService {
  private logger = new Logger('OrderService');

  constructor(
    private orderRepository: OrderRepository,
    private userRepository: UserRepository,
    private eventBus: EventBus,
  ) {}

  /**
   * Create a new order for a user.
   */
  async createOrder(input: CreateOrderInput): Promise<Order> {
    this.logger.info(`Creating order for user: ${input.userId}`);

    // Validate user exists
    const user = this.userRepository.findById(input.userId);
    if (!user) {
      throw new Error(`User not found: ${input.userId}`);
    }

    // Validate order has items
    if (input.items.length === 0) {
      throw new Error('Order must have at least one item');
    }

    const now = new Date();
    const order: Order = {
      id: generateId(),
      userId: input.userId,
      items: input.items,
      total: calculateOrderTotal(input.items),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.orderRepository.save(order);

    // Emit event for decoupled notification handling
    await this.eventBus.emit({
      type: 'order:created',
      order,
      user,
      timestamp: now,
    });

    return order;
  }

  /**
   * Get an order by ID.
   */
  getOrder(id: string): Order | undefined {
    return this.orderRepository.findById(id);
  }

  /**
   * Update order status.
   */
  async updateOrderStatus(id: string, newStatus: OrderStatus): Promise<Order> {
    this.logger.info(`Updating order ${id} status to: ${newStatus}`);

    const order = this.orderRepository.findById(id);
    if (!order) {
      throw new Error(`Order not found: ${id}`);
    }

    const previousStatus = order.status;

    // Validate status transition
    if (!this.isValidStatusTransition(previousStatus, newStatus)) {
      throw new Error(
        `Invalid status transition: ${previousStatus} -> ${newStatus}`,
      );
    }

    const updated = this.orderRepository.update(id, {
      status: newStatus,
      updatedAt: new Date(),
    });

    await this.eventBus.emit({
      type: 'order:status-changed',
      order: updated,
      previousStatus,
      newStatus,
      timestamp: new Date(),
    });

    return updated;
  }

  /**
   * List orders for a user.
   */
  listUserOrders(userId: string): Order[] {
    return this.orderRepository.findByUserId(userId);
  }

  /**
   * List orders by status.
   */
  listOrdersByStatus(status: OrderStatus): Order[] {
    return this.orderRepository.findByStatus(status);
  }

  /**
   * Validate that a status transition is allowed.
   */
  private isValidStatusTransition(
    from: OrderStatus,
    to: OrderStatus,
  ): boolean {
    const transitions: Record<OrderStatus, OrderStatus[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['shipped', 'cancelled'],
      shipped: ['delivered'],
      delivered: [],
      cancelled: [],
    };
    return transitions[from].includes(to);
  }
}
