import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  Options as SDKOptions,
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  McpStdioServerConfig,
  Query,
} from '@anthropic-ai/claude-agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentConfiguration,
  AgentTask,
  AgentTranscript,
  ToolCall,
  TokenUsage,
  TurnUsage,
  SessionTiming,
  SessionExitReason,
} from '../types/index.js';

/**
 * Options for creating an agent session.
 */
export interface AgentSessionOptions {
  /** Run ID this session belongs to */
  runId: string;
  /** Scenario name */
  scenario: string;
  /** Condition name */
  condition: string;
  /** Working directory for the agent */
  workingDir: string;
  /** Agent configuration from the condition */
  agentConfig: AgentConfiguration;
  /** Session timeout in milliseconds (default: 15 min) */
  timeoutMs?: number;
}

/**
 * File-changing tool names used to detect time-to-first-action.
 */
const FILE_CHANGING_TOOLS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
]);

/**
 * Extract tool calls from an assistant message's content blocks.
 */
function extractToolCalls(message: SDKAssistantMessage, timestamp: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const content = message.message.content;

  if (!Array.isArray(content)) {
    return toolCalls;
  }

  for (const block of content) {
    if (block.type === 'tool_use') {
      toolCalls.push({
        toolName: block.name,
        parameters: (block.input ?? {}) as Record<string, unknown>,
        timestamp,
        durationMs: 0, // We don't have per-tool-call duration from the SDK
      });
    }
  }

  return toolCalls;
}

/**
 * Determine if a tool call modifies files (used for time-to-first-action).
 */
function isFileChangingToolCall(toolCall: ToolCall): boolean {
  if (FILE_CHANGING_TOOLS.has(toolCall.toolName)) {
    return true;
  }
  // Bash commands that write files count too
  if (toolCall.toolName === 'Bash') {
    const cmd = String(toolCall.parameters['command'] ?? '');
    // Heuristic: commands that redirect output or use git commit
    return /(?:>>?|git\s+commit|git\s+add|mkdir|touch|cp\s|mv\s)/.test(cmd);
  }
  return false;
}

/**
 * Convert our condition's MCP server config to SDK format.
 */
function toSdkMcpServers(
  servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
): Record<string, McpStdioServerConfig> {
  const sdkServers: Record<string, McpStdioServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    sdkServers[name] = {
      type: 'stdio',
      command: config.command,
      args: config.args,
      env: config.env,
    };
  }
  return sdkServers;
}

/**
 * Extract token usage from an SDK result message, preserving full cache breakdown.
 */
function extractTokenUsage(result: SDKResultMessage): TokenUsage {
  const usage = result.usage;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    total: input + output + cacheRead + cacheCreation,
    costUsd: (result as Record<string, unknown>).total_cost_usd as number ?? 0,
  };
}

/**
 * Extract per-turn usage from SDK result iterations.
 */
function extractTurnUsage(result: SDKResultMessage): TurnUsage[] {
  const iterations = (result as Record<string, unknown>).usage as Record<string, unknown> | undefined;
  const iterationList = (iterations as Record<string, unknown>)?.iterations as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(iterationList)) return [];

  return iterationList.map((iter, idx) => ({
    turnIndex: idx,
    type: 'message' as const,
    inputTokens: (iter.input_tokens as number) ?? 0,
    outputTokens: (iter.output_tokens as number) ?? 0,
    cacheReadTokens: (iter.cache_read_input_tokens as number) ?? 0,
    cacheCreationTokens: (iter.cache_creation_input_tokens as number) ?? 0,
  }));
}

/** Default zero-value TokenUsage for error/missing cases. */
const ZERO_TOKEN_USAGE: TokenUsage = {
  input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, costUsd: 0,
};

/**
 * Determine exit reason from SDK result.
 */
function determineExitReason(result: SDKResultMessage, timedOut: boolean): SessionExitReason {
  if (timedOut) return 'timeout';
  if (result.subtype === 'success') return 'completed';
  if (result.subtype === 'error_max_turns') return 'completed';
  return 'error';
}

/**
 * Extract error string from SDK result if present.
 */
function extractError(result: SDKResultMessage): string | undefined {
  if (result.is_error) {
    if ('errors' in result && result.errors.length > 0) {
      return result.errors.join('; ');
    }
    return `Session ended with error: ${result.subtype}`;
  }
  return undefined;
}

/**
 * AgentSessionManager — wraps the Claude Agent SDK to execute agent sessions.
 *
 * Responsibilities (FR-RUN-001):
 * - Invokes agent sessions via the SDK query() function
 * - Configures sessions per condition (MCP servers, system prompt, tools, etc.)
 * - Streams messages and captures full transcript
 * - Extracts token usage from SDK response metadata
 * - Enforces configurable timeout
 * - Tracks time-to-first-action (first file-changing tool call)
 */
export class AgentSessionManager {
  private readonly runId: string;
  private readonly scenario: string;
  private readonly condition: string;
  private readonly workingDir: string;
  private readonly agentConfig: AgentConfiguration;
  private readonly timeoutMs: number;

  constructor(options: AgentSessionOptions) {
    this.runId = options.runId;
    this.scenario = options.scenario;
    this.condition = options.condition;
    this.workingDir = options.workingDir;
    this.agentConfig = options.agentConfig;
    this.timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  }

  /**
   * Execute a single agent task and return the transcript.
   */
  async executeTask(task: AgentTask): Promise<AgentTranscript> {
    const sessionId = uuidv4();
    const startTime = new Date();
    const toolCalls: ToolCall[] = [];
    const rawMessages: SDKMessage[] = [];
    let timeToFirstActionMs = -1;
    let timedOut = false;
    let sdkResult: SDKResultMessage | undefined;
    let compactionCount = 0;

    const abortController = new AbortController();
    const effectiveTimeoutMs = task.timeoutMs || this.timeoutMs;

    // Create rejection promise for hard timeout enforcement.
    // If the SDK ignores AbortController.abort(), Promise.race() still resolves.
    let timeoutReject: ((err: Error) => void) | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutReject = reject;
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      timeoutReject?.(new Error('TIMEOUT'));
    }, effectiveTimeoutMs);

    try {
      const sdkOptions = this.buildSdkOptions(task, abortController);
      const queryStream: Query = sdkQuery({ prompt: task.prompt, options: sdkOptions });

      // Wrap iteration in a function so we can race it against the timeout
      const processStream = async (): Promise<void> => {
        for await (const message of queryStream) {
          rawMessages.push(message);
          const now = new Date();

          if (message.type === 'assistant') {
            const assistantMsg = message as SDKAssistantMessage;
            const calls = extractToolCalls(assistantMsg, now.toISOString());
            toolCalls.push(...calls);

            // Track time-to-first-action
            if (timeToFirstActionMs < 0) {
              for (const call of calls) {
                if (isFileChangingToolCall(call)) {
                  timeToFirstActionMs = now.getTime() - startTime.getTime();
                  break;
                }
              }
            }
          }

          // Track context compaction events
          if (message.type === 'system' && (message as Record<string, unknown>).subtype === 'compact_boundary') {
            compactionCount++;
          }

          if (message.type === 'result') {
            sdkResult = message as SDKResultMessage;
          }
        }
      };

      // Race: iteration vs timeout — ensures hard timeout even if SDK ignores abort
      await Promise.race([processStream(), timeoutPromise]);
    } catch (err: unknown) {
      // Timeout: fall through to normal transcript building with partial data
      if (!timedOut) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return this.buildTranscript({
          sessionId,
          taskIndex: task.sequenceOrder,
          prompt: task.prompt,
          toolCalls,
          startTime,
          endTime: new Date(),
          timeToFirstActionMs,
          exitReason: 'error',
          error: errorMessage,
          tokenUsage: ZERO_TOKEN_USAGE,
          numTurns: 0,
          stopReason: null,
          contextWindowSize: 0,
          compactionCount: 0,
          turnUsage: [],
        });
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    const endTime = new Date();
    const tokenUsage = sdkResult ? extractTokenUsage(sdkResult) : ZERO_TOKEN_USAGE;
    const exitReason = sdkResult ? determineExitReason(sdkResult, timedOut) : (timedOut ? 'timeout' : 'error');
    const error = timedOut
      ? `Session timed out after ${effectiveTimeoutMs}ms`
      : sdkResult
        ? extractError(sdkResult)
        : 'No result received from SDK';

    // Extract per-turn data and context health metrics
    const numTurns = sdkResult ? ((sdkResult as Record<string, unknown>).num_turns as number ?? 0) : 0;
    const stopReason = sdkResult ? (sdkResult.subtype ?? null) : null;
    const modelUsage = sdkResult ? ((sdkResult as Record<string, unknown>).modelUsage as Record<string, unknown> | undefined) : undefined;
    const contextWindowSize = (modelUsage?.contextWindow as number) ?? 0;
    const turnUsage = sdkResult ? extractTurnUsage(sdkResult) : [];

    return this.buildTranscript({
      sessionId,
      taskIndex: task.sequenceOrder,
      prompt: task.prompt,
      toolCalls,
      startTime,
      endTime,
      timeToFirstActionMs,
      exitReason,
      error,
      tokenUsage,
      numTurns,
      stopReason,
      contextWindowSize,
      compactionCount,
      turnUsage,
    });
  }

  /**
   * Build SDK options from condition config and task.
   */
  private buildSdkOptions(task: AgentTask, abortController: AbortController): SDKOptions {
    const options: SDKOptions = {
      cwd: this.workingDir,
      abortController,
      maxTurns: task.maxTurns,
      permissionMode: this.agentConfig.permissionMode === 'full'
        ? 'bypassPermissions'
        : this.agentConfig.permissionMode,
      allowedTools: this.agentConfig.allowedTools,
      persistSession: false,
    };

    // System prompt
    if (this.agentConfig.systemPrompt) {
      options.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: this.agentConfig.systemPrompt,
      };
    }

    // MCP servers
    const mcpServers = toSdkMcpServers(this.agentConfig.mcpServers);
    if (Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }

    // Environment
    if (this.agentConfig.env) {
      options.env = { ...process.env, ...this.agentConfig.env };
    }

    return options;
  }

  /**
   * Build the AgentTranscript from collected data.
   */
  private buildTranscript(params: {
    sessionId: string;
    taskIndex: number;
    prompt: string;
    toolCalls: ToolCall[];
    startTime: Date;
    endTime: Date;
    timeToFirstActionMs: number;
    exitReason: SessionExitReason;
    error?: string;
    tokenUsage: TokenUsage;
    numTurns: number;
    stopReason: string | null;
    contextWindowSize: number;
    compactionCount: number;
    turnUsage: TurnUsage[];
  }): AgentTranscript {
    const timing: SessionTiming = {
      startTime: params.startTime.toISOString(),
      endTime: params.endTime.toISOString(),
      durationMs: params.endTime.getTime() - params.startTime.getTime(),
      timeToFirstActionMs: params.timeToFirstActionMs >= 0 ? params.timeToFirstActionMs : -1,
    };

    return {
      sessionId: params.sessionId,
      runId: this.runId,
      scenario: this.scenario,
      condition: this.condition,
      taskIndex: params.taskIndex,
      prompt: params.prompt,
      toolCalls: params.toolCalls,
      fileChanges: [], // Populated by DataCollector via git diff
      tokenUsage: params.tokenUsage,
      timing,
      exitReason: params.exitReason,
      error: params.error,
      numTurns: params.numTurns,
      stopReason: params.stopReason,
      contextWindowSize: params.contextWindowSize,
      compactionCount: params.compactionCount,
      turnUsage: params.turnUsage,
    };
  }
}
