/**
 * User model representing a system user.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new user.
 */
export interface CreateUserInput {
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
}

/**
 * Input for updating an existing user.
 */
export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: 'admin' | 'member' | 'viewer';
}
