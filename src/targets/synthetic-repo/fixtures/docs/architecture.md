# TaskFlow Pro — Architecture

## Overview

TaskFlow Pro is a task and order management system built with TypeScript.
The application follows a layered architecture with clear dependency boundaries.

## Layer Architecture

```
┌─────────────────────────────────────────┐
│          Service Layer                   │
│   UserService, OrderService              │
│   (business logic, validation)           │
├─────────────────────────────────────────┤
│          Repository Layer                │
│   BaseRepository, UserRepository,        │
│   OrderRepository                        │
│   (data access abstraction)              │
├─────────────────────────────────────────┤
│          Utility Layer                   │
│   Database, Logger, Pagination           │
│   (infrastructure, shared utilities)     │
└─────────────────────────────────────────┘

         ┌──────────────────┐
         │   Event System    │
         │   EventBus        │
         │   (cross-cutting) │
         └──────────────────┘
```

## Architectural Decisions

### 1. Repository Pattern for Data Access

All data access goes through Repository classes (`BaseRepository`, `UserRepository`,
`OrderRepository`). Services never interact with the `Database` utility directly.

**Rationale:**
- Separates business logic from storage concerns
- Repositories handle domain-to-record mapping
- Easy to swap storage backends without touching services
- Centralized query logic per entity type

**Rules:**
- Services depend on repositories, never on Database directly
- Each entity type has its own repository
- Common CRUD operations are in BaseRepository
- Entity-specific queries go in the concrete repository

### 2. Event-Driven Notification System

Inter-service communication uses an event bus rather than direct function calls.
When significant actions occur (order created, status changed), the originating
service emits an event. Other services (like NotificationService) subscribe to
these events independently.

**Rationale:**
- Services don't need to know about each other
- Adding new behaviors (e.g., analytics, audit logging) only requires adding new listeners
- Each listener can fail independently without affecting the core operation
- Natural extension point for async processing

**Rules:**
- Services emit events for significant state changes
- Services never call other services directly for side effects
- Event handlers are registered in the listener service's constructor
- Events carry all the data the handler needs (no additional lookups required)

## Module Dependencies

```
UserService ──→ UserRepository ──→ Database
     │                                ↑
     ├──→ EventBus                    │
     │                                │
OrderService ──→ OrderRepository ─────┘
     │
     ├──→ UserRepository (validation)
     ├──→ EventBus
     │
NotificationService ──→ EventBus (listener)
```

## Adding New Features

When adding new functionality:

1. **New entity?** Create a model, repository, and service.
2. **New side effect?** Create a new event listener, don't modify existing services.
3. **New query?** Add a method to the appropriate repository.
4. **Cross-cutting concern?** Use the event system.
