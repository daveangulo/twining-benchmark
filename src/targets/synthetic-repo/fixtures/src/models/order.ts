/**
 * An item within an order.
 */
export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Order status lifecycle.
 */
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

/**
 * Order model representing a customer order.
 */
export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new order.
 */
export interface CreateOrderInput {
  userId: string;
  items: OrderItem[];
}

/**
 * Calculate the total for an order from its items.
 */
export function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
