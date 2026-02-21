/**
 * Database configuration.
 *
 * Currently uses an in-memory store. This config exists to support
 * future migration to a persistent database.
 */

export interface DatabaseConfig {
  /** Storage type */
  type: 'memory' | 'file' | 'postgresql';
  /** File path for file-based storage */
  filePath?: string;
  /** Connection string for database storage */
  connectionString?: string;
  /** Maximum number of records per collection (for memory safety) */
  maxRecordsPerCollection: number;
}

export const defaultDatabaseConfig: DatabaseConfig = {
  type: 'memory',
  maxRecordsPerCollection: 10000,
};
