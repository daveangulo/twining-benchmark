import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FullTwiningCondition } from '../../../src/conditions/full-twining.js';

describe('FullTwiningCondition', () => {
  let condition: FullTwiningCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new FullTwiningCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(condition.name).toBe('full-twining');
    expect(condition.description).toContain('Twining plugin');
    expect(condition.description).toContain('blackboard');
    expect(condition.description).toContain('knowledge graph');
  });

  it('creates CLAUDE.md during setup', async () => {
    const ctx = await condition.setup(workDir);

    expect(ctx.setupFiles).toContain('CLAUDE.md');
  });

  it('CLAUDE.md contains project guidelines (plugin injects gates at runtime)', async () => {
    await condition.setup(workDir);

    const content = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    // Project guidelines are present
    expect(content).toContain('repository pattern');
    expect(content).toContain('TypeScript strict mode');
    expect(content).toContain('vitest');
    // Gates are NOT in the harness-written CLAUDE.md — plugin 1.6.0+
    // injects them via ensure-claude-md-gates.sh SessionStart hook at runtime
    expect(content).not.toContain('twining_assemble');
  });

  it('agent config uses Twining plugin plus explicit MCP server', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    // Explicit MCP server for belt-and-suspenders reliability
    expect(config.mcpServers).toHaveProperty('twining');
    expect(config.mcpServers.twining.command).toBe('npx');
    expect(config.mcpServers.twining.args).toContain('twining-mcp');

    // Plugin should also be configured
    expect(config.plugins).toBeDefined();
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins![0]!.type).toBe('local');
    expect(config.plugins![0]!.path).toContain('twining');
  });

  it('agent config allows all Twining tools', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    // Core tools
    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).toContain('Edit');
    expect(config.allowedTools).toContain('Bash');

    // Twining blackboard tools
    expect(config.allowedTools).toContain('mcp__plugin_twining_twining__twining_post');
    expect(config.allowedTools).toContain('mcp__plugin_twining_twining__twining_read');
    expect(config.allowedTools).toContain('mcp__plugin_twining_twining__twining_query');

    // Twining decision tools
    expect(config.allowedTools).toContain('mcp__plugin_twining_twining__twining_decide');
    expect(config.allowedTools).toContain('mcp__plugin_twining_twining__twining_why');
    expect(config.allowedTools).toContain('mcp__plugin_twining_twining__twining_trace');

    // Twining graph tools
    expect(config.allowedTools).toContain(
      'mcp__plugin_twining_twining__twining_add_entity',
    );
    expect(config.allowedTools).toContain(
      'mcp__plugin_twining_twining__twining_add_relation',
    );
    expect(config.allowedTools).toContain(
      'mcp__plugin_twining_twining__twining_neighbors',
    );

    // Twining context assembly
    expect(config.allowedTools).toContain(
      'mcp__plugin_twining_twining__twining_assemble',
    );
    expect(config.allowedTools).toContain('mcp__plugin_twining_twining__twining_verify');
  });

  it('system prompt includes Twining instructions as fallback', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toContain('twining_assemble');
    expect(config.systemPrompt).toContain('twining_decide');
    expect(config.systemPrompt).toContain('twining_verify');
  });

  it('Twining plugin is configured with a local path', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.plugins).toBeDefined();
    expect(config.plugins![0]!.path).toContain('twining');
  });

  it('teardown cleans up .twining directory', async () => {
    await condition.setup(workDir);
    const twiningDir = join(workDir, '.twining');

    // Simulate the MCP server creating .twining/
    await mkdir(twiningDir, { recursive: true });

    // Verify it exists
    const dirStat = await stat(twiningDir);
    expect(dirStat.isDirectory()).toBe(true);

    await condition.teardown();

    // Verify it's gone
    let existsAfter = true;
    try {
      await stat(twiningDir);
    } catch {
      existsAfter = false;
    }
    expect(existsAfter).toBe(false);
  });

  it('uses custom CLAUDE.md content when provided', async () => {
    const custom = '# Custom Twining\nUse twining tools.';
    const customCondition = new FullTwiningCondition(custom);

    await customCondition.setup(workDir);

    const content = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toBe(custom);

    await customCondition.teardown();
  });

  it('mcpServers includes twining with --project flag', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.mcpServers).toHaveProperty('twining');
    expect(config.mcpServers.twining.args).toContain('--project');
  });
});
