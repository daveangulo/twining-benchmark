import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSessionManager } from '../../../src/runner/agent-session.js';
import type { AgentConfiguration, AgentTask } from '../../../src/types/index.js';

// Mock the Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Import the mocked module
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
const mockQuery = vi.mocked(sdkQuery);

function makeAgentConfig(overrides: Partial<AgentConfiguration> = {}): AgentConfiguration {
  return {
    systemPrompt: 'Test system prompt',
    mcpServers: {},
    allowedTools: ['Read', 'Edit', 'Bash'],
    permissionMode: 'acceptEdits',
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    prompt: 'Implement a hello world function',
    timeoutMs: 30_000,
    requiredCapabilities: [],
    sequenceOrder: 0,
    maxTurns: 10,
    ...overrides,
  };
}

/**
 * Create a mock async generator that yields SDK messages and then a result.
 */
function createMockQueryStream(messages: Array<Record<string, unknown>>) {
  async function* generator() {
    for (const msg of messages) {
      yield msg;
    }
  }

  const gen = generator();
  // Add stub methods that the Query interface requires
  const stream = Object.assign(gen, {
    interrupt: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
    initializationResult: vi.fn().mockResolvedValue({}),
    supportedCommands: vi.fn().mockResolvedValue([]),
    supportedModels: vi.fn().mockResolvedValue([]),
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    accountInfo: vi.fn().mockResolvedValue({}),
    rewindFiles: vi.fn().mockResolvedValue({ canRewind: false }),
    reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
    toggleMcpServer: vi.fn().mockResolvedValue(undefined),
    setMcpServers: vi.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
    streamInput: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  });

  return stream;
}

describe('AgentSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes a task and returns a transcript', async () => {
    const stream = createMockQueryStream([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I will create a hello world function.' },
          ],
        },
        parent_tool_use_id: null,
        uuid: 'msg-1',
        session_id: 'sess-1',
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: '/test/hello.ts', old_string: '', new_string: 'export function hello() { return "world"; }' },
            },
          ],
        },
        parent_tool_use_id: null,
        uuid: 'msg-2',
        session_id: 'sess-1',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 2,
        result: 'Done',
        duration_ms: 5000,
        duration_api_ms: 4000,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-1',
        session_id: 'sess-1',
      },
    ]);

    mockQuery.mockReturnValue(stream as ReturnType<typeof sdkQuery>);

    const manager = new AgentSessionManager({
      runId: 'run-123',
      scenario: 'test-scenario',
      condition: 'baseline',
      workingDir: '/tmp/test',
      agentConfig: makeAgentConfig(),
    });

    const transcript = await manager.executeTask(makeTask());

    expect(transcript.runId).toBe('run-123');
    expect(transcript.scenario).toBe('test-scenario');
    expect(transcript.condition).toBe('baseline');
    expect(transcript.exitReason).toBe('completed');
    expect(transcript.error).toBeUndefined();
    expect(transcript.tokenUsage.input).toBe(1200); // 1000 + 200 cache read
    expect(transcript.tokenUsage.output).toBe(500);
    expect(transcript.tokenUsage.total).toBe(1700);
    expect(transcript.toolCalls).toHaveLength(1);
    expect(transcript.toolCalls[0]!.toolName).toBe('Edit');
  });

  it('tracks time-to-first-action for file-changing tools', async () => {
    const stream = createMockQueryStream([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Reading files...' }],
        },
        parent_tool_use_id: null,
        uuid: 'msg-1',
        session_id: 'sess-1',
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/test/file.ts' } },
          ],
        },
        parent_tool_use_id: null,
        uuid: 'msg-2',
        session_id: 'sess-1',
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: '/test/new.ts', content: 'test' } },
          ],
        },
        parent_tool_use_id: null,
        uuid: 'msg-3',
        session_id: 'sess-1',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 3,
        result: 'Done',
        duration_ms: 3000,
        duration_api_ms: 2000,
        total_cost_usd: 0.005,
        usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-1',
        session_id: 'sess-1',
      },
    ]);

    mockQuery.mockReturnValue(stream as ReturnType<typeof sdkQuery>);

    const manager = new AgentSessionManager({
      runId: 'run-123',
      scenario: 'test',
      condition: 'baseline',
      workingDir: '/tmp/test',
      agentConfig: makeAgentConfig(),
    });

    const transcript = await manager.executeTask(makeTask());

    expect(transcript.timing.timeToFirstActionMs).toBeGreaterThanOrEqual(0);
    expect(transcript.toolCalls).toHaveLength(2); // Read + Write
    expect(transcript.toolCalls[0]!.toolName).toBe('Read');
    expect(transcript.toolCalls[1]!.toolName).toBe('Write');
  });

  it('handles session errors', async () => {
    const stream = createMockQueryStream([
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        num_turns: 0,
        duration_ms: 1000,
        duration_api_ms: 500,
        total_cost_usd: 0.001,
        usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        errors: ['API rate limit exceeded'],
        uuid: 'result-1',
        session_id: 'sess-1',
      },
    ]);

    mockQuery.mockReturnValue(stream as ReturnType<typeof sdkQuery>);

    const manager = new AgentSessionManager({
      runId: 'run-123',
      scenario: 'test',
      condition: 'baseline',
      workingDir: '/tmp/test',
      agentConfig: makeAgentConfig(),
    });

    const transcript = await manager.executeTask(makeTask());

    expect(transcript.exitReason).toBe('error');
    expect(transcript.error).toContain('API rate limit exceeded');
  });

  it('handles thrown exceptions from the SDK', async () => {
    mockQuery.mockImplementation(() => {
      throw new Error('Connection refused');
    });

    const manager = new AgentSessionManager({
      runId: 'run-123',
      scenario: 'test',
      condition: 'baseline',
      workingDir: '/tmp/test',
      agentConfig: makeAgentConfig(),
    });

    const transcript = await manager.executeTask(makeTask());

    expect(transcript.exitReason).toBe('error');
    expect(transcript.error).toContain('Connection refused');
  });

  it('passes MCP server configuration to the SDK', async () => {
    const stream = createMockQueryStream([
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        result: 'Done',
        duration_ms: 1000,
        duration_api_ms: 800,
        total_cost_usd: 0.002,
        usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-1',
        session_id: 'sess-1',
      },
    ]);

    mockQuery.mockReturnValue(stream as ReturnType<typeof sdkQuery>);

    const manager = new AgentSessionManager({
      runId: 'run-123',
      scenario: 'test',
      condition: 'full-twining',
      workingDir: '/tmp/test',
      agentConfig: makeAgentConfig({
        mcpServers: {
          twining: {
            command: 'npx',
            args: ['twining-mcp'],
            env: { TWINING_DIR: '/tmp/.twining' },
          },
        },
        allowedTools: ['Read', 'Edit', 'Bash', 'mcp__twining__twining_post'],
      }),
    });

    await manager.executeTask(makeTask());

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Implement a hello world function',
        options: expect.objectContaining({
          mcpServers: {
            twining: {
              type: 'stdio',
              command: 'npx',
              args: ['twining-mcp'],
              env: { TWINING_DIR: '/tmp/.twining' },
            },
          },
          allowedTools: ['Read', 'Edit', 'Bash', 'mcp__twining__twining_post'],
          permissionMode: 'acceptEdits',
        }),
      }),
    );
  });

  it('returns -1 for timeToFirstAction when no file changes occur', async () => {
    const stream = createMockQueryStream([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'I analyzed the code.' }],
        },
        parent_tool_use_id: null,
        uuid: 'msg-1',
        session_id: 'sess-1',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        result: 'Done',
        duration_ms: 2000,
        duration_api_ms: 1500,
        total_cost_usd: 0.003,
        usage: { input_tokens: 300, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-1',
        session_id: 'sess-1',
      },
    ]);

    mockQuery.mockReturnValue(stream as ReturnType<typeof sdkQuery>);

    const manager = new AgentSessionManager({
      runId: 'run-123',
      scenario: 'test',
      condition: 'baseline',
      workingDir: '/tmp/test',
      agentConfig: makeAgentConfig(),
    });

    const transcript = await manager.executeTask(makeTask());

    expect(transcript.timing.timeToFirstActionMs).toBe(-1);
    expect(transcript.toolCalls).toHaveLength(0);
  });
});
