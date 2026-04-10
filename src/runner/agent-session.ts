import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  Options as SDKOptions,
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  McpStdioServerConfig,
  Query,
} from '@anthropic-ai/claude-agent-sdk';
import { execa, type ResultPromise } from 'execa';
import { v4 as uuidv4 } from 'uuid';
import { createInterface } from 'node:readline';
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
  /** Claude model to use (e.g. 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'). Defaults to CLI default. */
  model?: string;
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
  private readonly model?: string;
  private conversationHistory: string[] = [];

  constructor(options: AgentSessionOptions) {
    this.runId = options.runId;
    this.scenario = options.scenario;
    this.condition = options.condition;
    this.workingDir = options.workingDir;
    this.agentConfig = options.agentConfig;
    this.timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    this.model = options.model;
  }

  /**
   * Execute a single agent task using the Claude CLI (`claude -p`).
   *
   * This is the primary execution path. It spawns the full Claude Code CLI,
   * which means plugins load completely (hooks fire, BEHAVIORS.md is read,
   * CLAUDE.md gates are injected). This matches what subscription users experience.
   *
   * Timeout enforcement is reliable — the process is killed on timeout.
   */
  async executeTask(task: AgentTask): Promise<AgentTranscript> {
    const sessionId = uuidv4();
    const startTime = new Date();
    const toolCalls: ToolCall[] = [];
    let timeToFirstActionMs = -1;
    let timedOut = false;
    let numTurns = 0;
    let costUsd = 0;
    let exitSubtype = '';
    let compactionCount = 0;
    let turnIndex = 0;
    const turnUsageEntries: TurnUsage[] = [];
    let pendingTurnUsage: TurnUsage | null = null;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let contextWindowSize = 0;
    const toolUseIdToIndex = new Map<string, number>();

    const effectiveTimeoutMs = task.timeoutMs || this.timeoutMs;

    // Build prompt with conversation history for persistent-history conditions
    let effectivePrompt = task.prompt;
    if (this.agentConfig.persistHistory && this.conversationHistory.length > 0) {
      const historyPrefix = this.conversationHistory
        .map((h, i) => `=== Previous Developer ${i + 1} ===\n${h}`)
        .join('\n\n');
      effectivePrompt = `${historyPrefix}\n\n=== Your Task ===\n${task.prompt}`;
    }

    // Build CLI arguments.
    // Use --setting-sources "" to start clean (no user plugins loaded automatically).
    // Then explicitly add plugins via --plugin-dir for conditions that need them.
    // This prevents contamination (e.g., baseline getting Twining tools from user install).
    const cliArgs = [
      '-p', effectivePrompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--setting-sources', '',
      '--permission-mode', 'bypassPermissions',
      '--max-turns', String(task.maxTurns || 50),
    ];

    // Pass allowed tools restriction for conditions that define one (e.g., twining-lite)
    if (this.agentConfig.allowedTools && this.agentConfig.allowedTools.length > 0) {
      cliArgs.push('--allowedTools', ...this.agentConfig.allowedTools);
    }

    if (this.model) {
      cliArgs.push('--model', this.model);
    }

    // Add system prompt if condition provides one
    if (this.agentConfig.systemPrompt) {
      cliArgs.push('--append-system-prompt', this.agentConfig.systemPrompt);
    }

    // Add plugin directories ONLY for conditions that configure them
    if (this.agentConfig.plugins) {
      for (const plugin of this.agentConfig.plugins) {
        cliArgs.push('--plugin-dir', plugin.path);
      }
    }

    // Add MCP servers explicitly via --mcp-config.
    // Plugin .mcp.json may not be read when --setting-sources is empty,
    // so we pass MCP config directly to guarantee server startup.
    if (this.agentConfig.mcpServers && Object.keys(this.agentConfig.mcpServers).length > 0) {
      const mcpConfig = JSON.stringify({ mcpServers: this.agentConfig.mcpServers });
      cliArgs.push('--mcp-config', mcpConfig);
    }

    // Strip env vars that prevent nested Claude Code sessions
    const cleanEnv = { ...process.env };
    delete cleanEnv['CLAUDECODE'];
    delete cleanEnv['CLAUDE_CODE_ENTRYPOINT'];
    if (this.agentConfig.env) {
      Object.assign(cleanEnv, this.agentConfig.env);
    }

    let proc: ResultPromise | undefined;

    try {
      proc = execa('claude', cliArgs, {
        cwd: this.workingDir,
        env: cleanEnv,
        timeout: effectiveTimeoutMs,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        reject: false, // Don't throw on non-zero exit
      });

      // Parse stream-json lines from stdout
      if (proc.stdout) {
        const rl = createInterface({ input: proc.stdout });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);

            if (msg.type === 'assistant') {
              const content = msg.message?.content;
              if (Array.isArray(content)) {
                const now = new Date();
                for (const block of content) {
                  if (block.type === 'tool_use') {
                    const tc: ToolCall = {
                      toolName: block.name,
                      parameters: (block.input ?? {}) as Record<string, unknown>,
                      timestamp: now.toISOString(),
                      durationMs: 0,
                      id: block.id,
                    };
                    if (block.id) toolUseIdToIndex.set(block.id, toolCalls.length);
                    toolCalls.push(tc);

                    if (timeToFirstActionMs < 0 && isFileChangingToolCall(tc)) {
                      timeToFirstActionMs = now.getTime() - startTime.getTime();
                    }
                  }
                }
              }

              // Buffer per-turn usage — overwrite on each assistant event.
              // The CLI emits multiple assistant events per logical turn (streaming partials);
              // we only commit when a turn boundary is reached (user/system/result event).
              const usage = msg.message?.usage;
              if (usage) {
                pendingTurnUsage = {
                  turnIndex,
                  type: 'message',
                  inputTokens: usage.input_tokens ?? 0,
                  outputTokens: usage.output_tokens ?? 0,
                  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
                  cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
                };
              }
            }

            // Flush pending turn usage on turn boundary (user message = tool results returned)
            if ((msg.type === 'user' || msg.type === 'system' || msg.type === 'result') && pendingTurnUsage) {
              turnUsageEntries.push(pendingTurnUsage);
              turnIndex++;
              pendingTurnUsage = null;
            }

            if (msg.type === 'user') {
              const content = msg.message?.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result' && block.tool_use_id) {
                    const tcIndex = toolUseIdToIndex.get(block.tool_use_id);
                    if (tcIndex !== undefined && tcIndex < toolCalls.length) {
                      const tc = toolCalls[tcIndex]!;
                      let resultText = '';
                      if (typeof block.content === 'string') {
                        resultText = block.content;
                      } else if (Array.isArray(block.content)) {
                        resultText = block.content
                          .filter((c: Record<string, unknown>) => c.type === 'text')
                          .map((c: Record<string, unknown>) => c.text as string)
                          .join('\n');
                      }
                      tc.responseBytes = Buffer.byteLength(resultText, 'utf-8');
                      tc.isError = block.is_error === true;
                    }
                  }
                }
              }
            }

            if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
              compactionCount++;
            }

            if (msg.type === 'result') {
              numTurns = msg.num_turns ?? 0;
              costUsd = msg.total_cost_usd ?? 0;
              exitSubtype = msg.subtype ?? '';

              // Extract total token usage from result.usage
              const usage = msg.usage;
              if (usage) {
                totalInput = usage.input_tokens ?? 0;
                totalOutput = usage.output_tokens ?? 0;
                totalCacheRead = usage.cache_read_input_tokens ?? 0;
                totalCacheCreation = usage.cache_creation_input_tokens ?? 0;
              }

              // Extract context window size from result.modelUsage (keyed by model name)
              const modelUsage = msg.modelUsage;
              if (modelUsage && typeof modelUsage === 'object') {
                const firstModel = Object.values(modelUsage)[0] as Record<string, unknown> | undefined;
                if (firstModel?.contextWindow) {
                  contextWindowSize = firstModel.contextWindow as number;
                }
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      await proc;
    } catch (err: unknown) {
      // execa throws on timeout with err.timedOut
      if (err && typeof err === 'object' && 'timedOut' in err && (err as Record<string, unknown>).timedOut) {
        timedOut = true;
      }
    }

    const endTime = new Date();
    const exitReason: SessionExitReason = timedOut
      ? 'timeout'
      : exitSubtype === 'success' || exitSubtype === 'error_max_turns'
        ? 'completed'
        : toolCalls.length > 0 ? 'completed' : 'error';

    const tokenUsage: TokenUsage = {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheCreation: totalCacheCreation,
      total: totalInput + totalOutput + totalCacheRead + totalCacheCreation,
      costUsd,
    };

    // Accumulate conversation history for persistent-history conditions
    if (this.agentConfig.persistHistory && toolCalls.length > 0) {
      this.conversationHistory.push(`[Session completed ${toolCalls.length} tool calls]`);
    }

    return this.buildTranscript({
      sessionId,
      taskIndex: task.sequenceOrder,
      prompt: task.prompt,
      toolCalls,
      startTime,
      endTime,
      timeToFirstActionMs,
      exitReason,
      error: timedOut ? `Session timed out after ${effectiveTimeoutMs}ms` : undefined,
      tokenUsage,
      numTurns,
      stopReason: exitSubtype || null,
      contextWindowSize,
      compactionCount,
      turnUsage: turnUsageEntries,
    });
  }

  /**
   * Execute a single agent task via the SDK query() API.
   * Kept as fallback — does not execute plugin hooks fully.
   */
  async executeTaskViaSdk(task: AgentTask): Promise<AgentTranscript> {
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

    let queryStream: Query | undefined;

    try {
      // Augment prompt with conversation history when persistHistory is enabled
      let effectivePrompt = task.prompt;
      if (this.agentConfig.persistHistory && this.conversationHistory.length > 0) {
        const historyPrefix = this.conversationHistory
          .map((h, i) => `=== Previous Developer ${i + 1} ===\n${h}`)
          .join('\n\n');
        effectivePrompt = `${historyPrefix}\n\n=== Your Task ===\n${task.prompt}`;
      }

      const sdkOptions = this.buildSdkOptions(task, abortController);
      queryStream = sdkQuery({ prompt: effectivePrompt, options: sdkOptions });

      // Wrap iteration in a function so we can race it against the timeout
      const stream = queryStream!;
      const processStream = async (): Promise<void> => {
        for await (const message of stream) {
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

      // Timeout path: force-stop the SDK query stream.
      // The abort signal is soft — the SDK may continue processing.
      // Use interrupt() + a hard grace period to ensure we don't hang.
      if (queryStream) {
        try {
          await Promise.race([
            queryStream.interrupt(),
            new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
          ]);
        } catch {
          // interrupt() may throw if stream is already closed — that's fine
        }
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

    // Accumulate conversation history for persistent-history conditions
    if (this.agentConfig.persistHistory) {
      const summary = this.extractConversationSummary(rawMessages);
      if (summary) {
        this.conversationHistory.push(summary);
      }
    }

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
   * Extract a summary of the conversation from assistant messages.
   * Used for persistent-history accumulation.
   */
  private extractConversationSummary(messages: SDKMessage[]): string | null {
    const assistantTexts: string[] = [];

    for (const message of messages) {
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage;
        const content = assistantMsg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              assistantTexts.push(block.text);
            }
          }
        }
      }
    }

    if (assistantTexts.length === 0) {
      return null;
    }

    // Use the last assistant message as the most relevant summary,
    // but include earlier context if concise enough
    const combined = assistantTexts.join('\n');
    // Cap at ~4000 chars to avoid prompt bloat
    if (combined.length > 4000) {
      return combined.slice(combined.length - 4000);
    }
    return combined;
  }

  /**
   * Build SDK options from condition config and task.
   */
  private buildSdkOptions(task: AgentTask, abortController: AbortController): SDKOptions {
    // Strip env vars that prevent nested Claude Code sessions.
    // The SDK spawns `claude` as a subprocess — if CLAUDECODE is set
    // (e.g., when running the harness from within Claude Code), the
    // subprocess refuses to start with exit code 1.
    const cleanEnv = { ...process.env };
    delete cleanEnv['CLAUDECODE'];
    delete cleanEnv['CLAUDE_CODE_ENTRYPOINT'];

    const options: SDKOptions = {
      cwd: this.workingDir,
      abortController,
      maxTurns: task.maxTurns,
      permissionMode: this.agentConfig.permissionMode === 'full'
        ? 'bypassPermissions'
        : this.agentConfig.permissionMode,
      allowedTools: this.agentConfig.allowedTools,
      persistSession: false,
      env: cleanEnv,
      ...(this.model ? { model: this.model } : {}),
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

    // Plugins
    if (this.agentConfig.plugins && this.agentConfig.plugins.length > 0) {
      options.plugins = this.agentConfig.plugins;
      // Load project settings so CLAUDE.md is picked up
      options.settingSources = ['project'];
    }

    // Merge condition-specific env vars on top of clean env
    if (this.agentConfig.env) {
      Object.assign(options.env!, this.agentConfig.env);
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
