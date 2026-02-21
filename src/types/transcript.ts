/**
 * Exit reasons for an agent session.
 */
export type SessionExitReason = 'completed' | 'timeout' | 'error' | 'manual';

/**
 * A single tool call made by an agent.
 */
export interface ToolCall {
  /** Tool name (e.g., "Read", "Edit", "Bash", "mcp__twining__twining_decide") */
  toolName: string;
  /** Parameters passed to the tool */
  parameters: Record<string, unknown>;
  /** Tool call result (may be truncated for storage) */
  result?: string;
  /** ISO 8601 timestamp of the tool call */
  timestamp: string;
  /** Duration of the tool call in milliseconds */
  durationMs: number;
  /** Token usage for this specific tool call */
  tokenUsage?: {
    input: number;
    output: number;
  };
}

/**
 * A file change made by an agent during a session.
 */
export interface FileChange {
  /** Relative path to the file */
  path: string;
  /** Type of change */
  changeType: 'added' | 'modified' | 'deleted';
  /** Lines added (for added/modified files) */
  linesAdded: number;
  /** Lines removed (for modified/deleted files) */
  linesRemoved: number;
  /** Git diff patch for this file (may be large) */
  diff?: string;
}

/**
 * Token usage breakdown for a session.
 */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Timing data for a session.
 */
export interface SessionTiming {
  /** ISO 8601 start time */
  startTime: string;
  /** ISO 8601 end time */
  endTime: string;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Time from session start to first meaningful file change */
  timeToFirstActionMs: number;
}

/**
 * Full transcript of a single agent session.
 * PRD Section 7.3.
 */
export interface AgentTranscript {
  /** Unique session identifier */
  sessionId: string;
  /** Parent run identifier */
  runId: string;
  /** Scenario name */
  scenario: string;
  /** Condition name */
  condition: string;
  /** Sequential task index within the scenario (0-based) */
  taskIndex: number;
  /** Exact prompt sent to the agent */
  prompt: string;
  /** All tool invocations made during the session */
  toolCalls: ToolCall[];
  /** All file modifications made during the session */
  fileChanges: FileChange[];
  /** Token usage breakdown */
  tokenUsage: TokenUsage;
  /** Timing data */
  timing: SessionTiming;
  /** How the session ended */
  exitReason: SessionExitReason;
  /** Error message if session failed */
  error?: string;
}

/**
 * Coordination artifacts captured at session boundaries.
 * Used for conditions with shared state (FR-RUN-003).
 */
export interface CoordinationArtifacts {
  /** State of coordination files at session start */
  preSessionState: Record<string, string>;
  /** State of coordination files at session end */
  postSessionState: Record<string, string>;
  /** Files that were added/modified between pre and post */
  changes: string[];
}
