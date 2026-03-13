import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaselineCondition } from '../../../src/conditions/baseline.js';

describe('BaselineCondition', () => {
  let condition: BaselineCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new BaselineCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(condition.name).toBe('baseline');
    expect(condition.description).toContain('No coordination');
  });

  it('preserves CLAUDE.md during setup', async () => {
    // Plant a CLAUDE.md that should be kept
    await writeFile(join(workDir, 'CLAUDE.md'), '# Test', 'utf-8');

    const ctx = await condition.setup(workDir);

    // CLAUDE.md should still exist
    const files = await readdir(workDir);
    expect(files).toContain('CLAUDE.md');
    expect(ctx.setupFiles).toEqual([]);
  });

  it('succeeds even if no CLAUDE.md exists', async () => {
    const ctx = await condition.setup(workDir);
    expect(ctx.setupFiles).toEqual([]);
  });

  it('removes .claude directory entirely', async () => {
    const claudeDir = join(workDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, 'settings.json'), '{}', 'utf-8');

    await condition.setup(workDir);

    const { existsSync } = await import('node:fs');
    expect(existsSync(claudeDir)).toBe(false);
  });

  it('returns agent config with no MCP servers and no system prompt', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toBe('');
    expect(config.mcpServers).toEqual({});
    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).toContain('Edit');
    expect(config.allowedTools).toContain('Bash');
    expect(config.allowedTools).not.toContain('mcp__plugin_twining_twining__twining_post');
    expect(config.permissionMode).toBe('acceptEdits');
  });

  it('throws if getAgentConfig is called before setup', () => {
    expect(() => condition.getAgentConfig()).toThrow('has not been set up');
  });

  it('collectArtifacts returns empty state (no coordination files)', async () => {
    await condition.setup(workDir);
    const artifacts = await condition.collectArtifacts();

    expect(artifacts.preSessionState).toEqual({});
    expect(artifacts.postSessionState).toEqual({});
    expect(artifacts.changes).toEqual([]);
  });

  it('teardown is idempotent', async () => {
    await condition.setup(workDir);
    await condition.teardown();
    await condition.teardown(); // Should not throw
  });
});
