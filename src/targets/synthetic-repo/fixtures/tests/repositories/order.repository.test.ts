import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../../src/utils/database.js';
import { OrderRepository } from '../../src/repositories/order.repository.js';
import type { Order } from '../../src/models/order.js';

describe('OrderRepository', () => {
  let db: Database;
  let repo: OrderRepository;

  const makeOrder = (overrides?: Partial<Order>): Order => ({
    id: 'order-1',
    userId: 'user-1',
    items: [
      { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
    ],
    total: 20,
    status: 'pending',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    db = new Database();
    repo = new OrderRepository(db);
  });

  it('should save and retrieve an order', () => {
    const order = makeOrder();
    repo.save(order);
    const found = repo.findById('order-1');
    expect(found).toBeDefined();
    expect(found?.userId).toBe('user-1');
    expect(found?.items).toHaveLength(1);
    expect(found?.total).toBe(20);
  });

  it('should find orders by user ID', () => {
    repo.save(makeOrder({ id: 'o1', userId: 'user-1' }));
    repo.save(makeOrder({ id: 'o2', userId: 'user-2' }));
    repo.save(makeOrder({ id: 'o3', userId: 'user-1' }));

    const orders = repo.findByUserId('user-1');
    expect(orders).toHaveLength(2);
  });

  it('should find orders by status', () => {
    repo.save(makeOrder({ id: 'o1', status: 'pending' }));
    repo.save(makeOrder({ id: 'o2', status: 'confirmed' }));
    repo.save(makeOrder({ id: 'o3', status: 'pending' }));

    const pending = repo.findByStatus('pending');
    expect(pending).toHaveLength(2);
  });

  it('should serialize and deserialize items through round-trip', () => {
    const items = [
      { productId: 'p1', name: 'Widget', quantity: 2, unitPrice: 10 },
      { productId: 'p2', name: 'Gadget', quantity: 1, unitPrice: 25.50 },
    ];
    repo.save(makeOrder({ items, total: 45.50 }));
    const found = repo.findById('order-1');
    expect(found?.items).toEqual(items);
    expect(found?.total).toBe(45.50);
  });

  it('should update order status', () => {
    repo.save(makeOrder());
    const updated = repo.update('order-1', {
      status: 'confirmed',
      updatedAt: new Date(),
    });
    expect(updated.status).toBe('confirmed');
  });

  it('should delete an order', () => {
    repo.save(makeOrder());
    expect(repo.delete('order-1')).toBe(true);
    expect(repo.findById('order-1')).toBeUndefined();
  });
});
