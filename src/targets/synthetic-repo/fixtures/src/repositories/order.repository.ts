/**
 * Repository for Order data access.
 *
 * Extends BaseRepository with order-specific query methods.
 * Depends on the Database utility layer for storage.
 */

import type { DatabaseRecord } from '../utils/database.js';
import type { Database } from '../utils/database.js';
import type { Order, OrderItem, OrderStatus } from '../models/order.js';
import { BaseRepository } from './base.repository.js';

export class OrderRepository extends BaseRepository<Order> {
  constructor(db: Database) {
    super(db, 'orders');
  }

  protected toDomain(record: DatabaseRecord): Order {
    return {
      id: record['id'] as string,
      userId: record['userId'] as string,
      items: JSON.parse(record['items'] as string) as OrderItem[],
      total: record['total'] as number,
      status: record['status'] as OrderStatus,
      createdAt: new Date(record['createdAt'] as string),
      updatedAt: new Date(record['updatedAt'] as string),
    };
  }

  protected toRecord(entity: Order): DatabaseRecord {
    return {
      id: entity.id,
      userId: entity.userId,
      items: JSON.stringify(entity.items),
      total: entity.total,
      status: entity.status,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /**
   * Find all orders for a specific user.
   */
  findByUserId(userId: string): Order[] {
    return this.findAll((order) => order.userId === userId);
  }

  /**
   * Find all orders with a specific status.
   */
  findByStatus(status: OrderStatus): Order[] {
    return this.findAll((order) => order.status === status);
  }
}
