import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
    expect(condition.description).toContain('Twining MCP');
    expect(condition.description).toContain('blackboard');
    expect(condition.description).toContain('knowledge graph');
  });

  it('creates .twining directory and CLAUDE.md during setup', async () => {
    const ctx = await condition.setup(workDir);

    expect(ctx.setupFiles).toContain('CLAUDE.md');

    // .twining directory should exist
    const twiningDir = join(workDir, '.twining');
    const dirStat = await stat(twiningDir);
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('CLAUDE.md contains Twining usage instructions', async () => {
    await condition.setup(workDir);

    const content = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('twining_assemble');
    expect(content).toContain('twining_decide');
    expect(content).toContain('twining_verify');
    expect(content).toContain('twining_why');
  });

  it('agent config includes Twining MCP server', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.mcpServers).toHaveProperty('twining');
    const twiningServer = config.mcpServers['twining'];
    expect(twiningServer).toBeDefined();
    expect(twiningServer!.command).toBe('npx');
    expect(twiningServer!.args).toContain('twining-mcp');
    expect(twiningServer!.env).toHaveProperty('TWINING_DATA_DIR');
    expect(twiningServer!.env?.['TWINING_DASHBOARD']).toBe('0');
  });

  it('agent config allows all Twining tools', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    // Core tools
    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).toContain('Edit');
    expect(config.allowedTools).toContain('Bash');

    // Twining blackboard tools
    expect(config.allowedTools).toContain('mcp__twining__twining_post');
    expect(config.allowedTools).toContain('mcp__twining__twining_read');
    expect(config.allowedTools).toContain('mcp__twining__twining_query');

    // Twining decision tools
    expect(config.allowedTools).toContain('mcp__twining__twining_decide');
    expect(config.allowedTools).toContain('mcp__twining__twining_why');
    expect(config.allowedTools).toContain('mcp__twining__twining_trace');

    // Twining graph tools
    expect(config.allowedTools).toContain(
      'mcp__twining__twining_add_entity',
    );
    expect(config.allowedTools).toContain(
      'mcp__twining__twining_add_relation',
    );
    expect(config.allowedTools).toContain(
      'mcp__twining__twining_neighbors',
    );

    // Twining context assembly
    expect(config.allowedTools).toContain(
      'mcp__twining__twining_assemble',
    );
    expect(config.allowedTools).toContain('mcp__twining__twining_verify');
  });

  it('system prompt references Twining and CLAUDE.md', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toContain('Twining');
    expect(config.systemPrompt).toContain('CLAUDE.md');
  });

  it('Twining data directory is isolated in the working directory', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();
    const twiningServer = config.mcpServers['twining'];

    expect(twiningServer!.env?.['TWINING_DATA_DIR']).toContain(workDir);
    expect(twiningServer!.env?.['TWINING_DATA_DIR']).toContain('.twining');
  });

  it('teardown cleans up .twining directory', async () => {
    await condition.setup(workDir);
    const twiningDir = join(workDir, '.twining');

    // Verify it exists
    let exists = true;
    try {
      await stat(twiningDir);
    } catch {
      exists = false;
    }
    expect(exists).toBe(true);

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

  it('dashboard is disabled in the MCP server config', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();
    const twiningServer = config.mcpServers['twining'];

    expect(twiningServer!.env?.['TWINING_DASHBOARD']).toBe('0');
  });
});
