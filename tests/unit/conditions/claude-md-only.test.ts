import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeMdOnlyCondition } from '../../../src/conditions/claude-md-only.js';

describe('ClaudeMdOnlyCondition', () => {
  let condition: ClaudeMdOnlyCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new ClaudeMdOnlyCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(condition.name).toBe('claude-md-only');
    expect(condition.description).toContain('CLAUDE.md');
  });

  it('creates CLAUDE.md with default content during setup', async () => {
    const ctx = await condition.setup(workDir);

    expect(ctx.setupFiles).toContain('CLAUDE.md');

    const content = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Project Guidelines');
    expect(content).toContain('repository pattern');
    expect(content).toContain('vitest');
  });

  it('uses custom CLAUDE.md content when provided', async () => {
    const custom = '# Custom Project\nDo things differently.';
    const customCondition = new ClaudeMdOnlyCondition(custom);

    await customCondition.setup(workDir);

    const content = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toBe(custom);

    await customCondition.teardown();
  });

  it('returns agent config with no MCP servers', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toBe('');
    expect(config.mcpServers).toEqual({});
    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_post');
    expect(config.permissionMode).toBe('acceptEdits');
  });

  it('tracks CLAUDE.md in coordination file paths', async () => {
    await condition.setup(workDir);
    const artifacts = await condition.collectArtifacts();

    expect(artifacts.preSessionState).toHaveProperty('CLAUDE.md');
    expect(artifacts.postSessionState).toHaveProperty('CLAUDE.md');
  });

  it('CLAUDE.md content is consistent across setups', async () => {
    await condition.setup(workDir);
    const content1 = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    await condition.teardown();

    const workDir2 = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
    const condition2 = new ClaudeMdOnlyCondition();
    await condition2.setup(workDir2);
    const content2 = await readFile(join(workDir2, 'CLAUDE.md'), 'utf-8');
    await condition2.teardown();
    await rm(workDir2, { recursive: true, force: true });

    expect(content1).toBe(content2);
  });
});
