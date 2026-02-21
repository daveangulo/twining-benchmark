/**
 * Application configuration.
 */

export interface AppConfig {
  /** Application name */
  appName: string;
  /** Default page size for paginated endpoints */
  defaultPageSize: number;
  /** Maximum allowed page size */
  maxPageSize: number;
  /** Whether to enable debug logging */
  debug: boolean;
}

export const defaultConfig: AppConfig = {
  appName: 'TaskFlow Pro',
  defaultPageSize: 10,
  maxPageSize: 100,
  debug: false,
};

export function createConfig(overrides?: Partial<AppConfig>): AppConfig {
  return { ...defaultConfig, ...overrides };
}
