import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileReloadGenericCondition } from '../../../src/conditions/file-reload-generic.js';

describe('FileReloadGenericCondition', () => {
  let condition: FileReloadGenericCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new FileReloadGenericCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(condition.name).toBe('file-reload-generic');
    expect(condition.description).toContain('/clear');
    expect(condition.description).toContain('CONTEXT.md');
  });

  it('creates CLAUDE.md and CONTEXT.md during setup', async () => {
    const ctx = await condition.setup(workDir);

    expect(ctx.setupFiles).toContain('CLAUDE.md');
    expect(ctx.setupFiles).toContain('CONTEXT.md');
  });

  it('CONTEXT.md has structured template sections', async () => {
    await condition.setup(workDir);

    const content = await readFile(join(workDir, 'CONTEXT.md'), 'utf-8');
    expect(content).toContain('Previous Session Summary');
    expect(content).toContain('Key Decisions Made');
    expect(content).toContain('Current Status');
    expect(content).toContain('Warnings for Next Agent');
  });

  it('system prompt instructs read→work→write loop', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toContain('fresh context window');
    expect(config.systemPrompt).toContain('NO conversation history');
    expect(config.systemPrompt).toContain('Read CONTEXT.md');
    expect(config.systemPrompt).toContain('update CONTEXT.md');
  });

  it('has no MCP servers', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.mcpServers).toEqual({});
    expect(config.allowedTools).not.toContain('mcp__twining__twining_post');
  });

  it('CLAUDE.md mentions context management', async () => {
    await condition.setup(workDir);

    const content = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('CONTEXT.md');
    expect(content).toContain('Context Management');
  });

  it('tracks CLAUDE.md and CONTEXT.md as coordination files', async () => {
    await condition.setup(workDir);
    const artifacts = await condition.collectArtifacts();

    expect(artifacts.preSessionState).toHaveProperty('CLAUDE.md');
    expect(artifacts.preSessionState).toHaveProperty('CONTEXT.md');
  });
});
