/**
 * TaskFlow Pro — A task and order management system.
 *
 * Architecture:
 * - Service Layer: UserService, OrderService (business logic)
 * - Repository Layer: UserRepository, OrderRepository (data access via Repository pattern)
 * - Utility Layer: Database, Logger, Pagination (infrastructure)
 * - Event System: EventBus with typed events (decoupled communication)
 *
 * Key architectural decisions:
 * 1. Repository pattern for all data access (no direct DB calls from services)
 * 2. Event-driven notifications (services emit events, listeners handle side effects)
 */

// Models
export type { User, CreateUserInput, UpdateUserInput } from './models/user.js';
export type {
  Order,
  OrderItem,
  OrderStatus,
  CreateOrderInput,
} from './models/order.js';
export { calculateOrderTotal } from './models/order.js';

// Utilities
export { Database, getDatabase, resetDatabase } from './utils/database.js';
export { Logger } from './utils/logger.js';
export { paginate } from './utils/pagination.js';
export type { PaginationResult } from './utils/pagination.js';

// Repositories
export { BaseRepository } from './repositories/base.repository.js';
export { UserRepository } from './repositories/user.repository.js';
export { OrderRepository } from './repositories/order.repository.js';

// Events
export { EventBus } from './events/event-bus.js';
export type {
  AppEvent,
  EventType,
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  UserCreatedEvent,
  UserUpdatedEvent,
} from './events/event-types.js';

// Services
export { UserService } from './services/user.service.js';
export { OrderService } from './services/order.service.js';
export { NotificationService } from './services/notification.service.js';

// Config
export { createConfig, defaultConfig } from './config/app.config.js';
export type { AppConfig } from './config/app.config.js';
