import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TwiningLiteCondition } from '../../../src/conditions/twining-lite.js';

describe('TwiningLiteCondition', () => {
  let condition: TwiningLiteCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new TwiningLiteCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-lite-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name', () => {
    expect(condition.name).toBe('twining-lite');
  });

  it('allows exactly 8 Twining tools', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    const twiningTools = config.allowedTools.filter(t =>
      t.startsWith('mcp__plugin_twining_twining__'),
    );

    expect(twiningTools).toHaveLength(8);
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_post');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_read');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_query');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_recent');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_decide');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_search_decisions');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_handoff');
    expect(twiningTools).toContain('mcp__plugin_twining_twining__twining_acknowledge');
  });

  it('does NOT allow graph, verify, trace, or other advanced tools', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_add_entity');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_add_relation');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_neighbors');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_graph_query');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_verify');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_trace');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_why');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_assemble');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_summarize');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_reconsider');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_override');
  });

  it('includes standard 6 tools', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).toContain('Edit');
    expect(config.allowedTools).toContain('Write');
    expect(config.allowedTools).toContain('Bash');
    expect(config.allowedTools).toContain('Glob');
    expect(config.allowedTools).toContain('Grep');
  });

  it('system prompt references twining_query, twining_decide, twining_handoff', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toContain('twining_query');
    expect(config.systemPrompt).toContain('twining_decide');
    expect(config.systemPrompt).toContain('twining_handoff');
  });

  it('system prompt does NOT reference twining_verify', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).not.toContain('twining_verify');
  });

  it('MCP servers configured with twining server', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.mcpServers).toHaveProperty('twining');
    const twiningServer = config.mcpServers['twining'];
    expect(twiningServer).toBeDefined();
    expect(twiningServer!.command).toBe('twining-mcp');
    expect(twiningServer!.args).toContain('--project');
    expect(twiningServer!.args).toContain(workDir);
    expect(twiningServer!.env?.['TWINING_DASHBOARD']).toBe('0');
  });

  it('creates CLAUDE.md during setup', async () => {
    const ctx = await condition.setup(workDir);
    expect(ctx.setupFiles).toContain('CLAUDE.md');
  });

  it('CLAUDE.md contains Twining Lite tool list', async () => {
    await condition.setup(workDir);

    const content = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Twining Lite');
    expect(content).toContain('twining_post');
    expect(content).toContain('twining_read');
    expect(content).toContain('twining_query');
    expect(content).toContain('twining_recent');
    expect(content).toContain('twining_decide');
    expect(content).toContain('twining_search_decisions');
    expect(content).toContain('twining_handoff');
    expect(content).toContain('twining_acknowledge');
  });

  it('teardown cleans up .twining directory', async () => {
    await condition.setup(workDir);
    const twiningDir = join(workDir, '.twining');

    // Simulate the MCP server creating .twining/
    await mkdir(twiningDir, { recursive: true });

    const dirStat = await stat(twiningDir);
    expect(dirStat.isDirectory()).toBe(true);

    await condition.teardown();

    let existsAfter = true;
    try {
      await stat(twiningDir);
    } catch {
      existsAfter = false;
    }
    expect(existsAfter).toBe(false);
  });
});
