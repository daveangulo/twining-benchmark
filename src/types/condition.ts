import type { CoordinationArtifacts } from './transcript.js';

/**
 * Known condition names (the 6 conditions from PRD Section 4.3).
 */
export type ConditionName =
  | 'baseline'
  | 'claude-md-only'
  | 'shared-markdown'
  | 'file-reload-generic'
  | 'file-reload-structured'
  | 'full-twining'
  | 'twining-lite'
  | 'persistent-history';

/**
 * MCP server configuration for agent sessions.
 */
export interface McpServerConfig {
  /** Server command to start */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Configuration passed to agent sessions by a condition.
 */
export interface AgentConfiguration {
  /** System prompt additions for this condition */
  systemPrompt: string;
  /** MCP servers to inject into agent sessions */
  mcpServers: Record<string, McpServerConfig>;
  /** Tools the agent is allowed to use */
  allowedTools: string[];
  /** Permission mode for the agent session */
  permissionMode: 'acceptEdits' | 'plan' | 'full';
  /** Additional environment variables for the agent process */
  env?: Record<string, string>;
  /** Plugins to load for this condition (SDK plugin system) */
  plugins?: Array<{ type: 'local'; path: string }>;
  /** If true, pass previous agents' conversation as history prefix to subsequent agents */
  persistHistory?: boolean;
}

/**
 * Context returned by condition setup.
 */
export interface ConditionContext {
  /** The agent configuration for this condition */
  agentConfig: AgentConfiguration;
  /** Files created/modified during condition setup */
  setupFiles: string[];
  /** Metadata about the condition setup */
  metadata: Record<string, unknown>;
}

/**
 * Condition interface contract.
 * All coordination conditions must implement this.
 * PRD Section FR-CND-007.
 */
export interface Condition {
  /** Unique condition name */
  readonly name: ConditionName;
  /** Human-readable description */
  readonly description: string;
  /** Set up the condition environment in the working directory */
  setup(workingDir: string): Promise<ConditionContext>;
  /** Get the agent configuration for this condition */
  getAgentConfig(): AgentConfiguration;
  /** Collect coordination artifacts after a session */
  collectArtifacts(): Promise<CoordinationArtifacts>;
  /** Clean up condition resources */
  teardown(): Promise<void>;
}

/**
 * Registry entry for a condition.
 */
export interface ConditionRegistryEntry {
  name: ConditionName;
  description: string;
  /** What coordination tools/files are available */
  coordinationTools: string[];
  /** Factory function to create the condition */
  create: () => Condition;
}
