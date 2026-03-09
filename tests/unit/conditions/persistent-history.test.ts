import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersistentHistoryCondition } from '../../../src/conditions/persistent-history.js';

describe('PersistentHistoryCondition', () => {
  let condition: PersistentHistoryCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new PersistentHistoryCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name', () => {
    expect(condition.name).toBe('persistent-history');
  });

  it('has persistHistory set to true in agent config', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.persistHistory).toBe(true);
  });

  it('has no MCP servers', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.mcpServers).toEqual({});
  });

  it('has no coordination files', async () => {
    await condition.setup(workDir);
    const artifacts = await condition.collectArtifacts();

    expect(Object.keys(artifacts.preSessionState)).toHaveLength(0);
    expect(Object.keys(artifacts.postSessionState)).toHaveLength(0);
  });

  it('includes baseline tools', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).toContain('Edit');
    expect(config.allowedTools).toContain('Write');
    expect(config.allowedTools).toContain('Bash');
    expect(config.allowedTools).toContain('Glob');
    expect(config.allowedTools).toContain('Grep');
  });

  it('has a system prompt about continuous session', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toContain('continuous session');
    expect(config.systemPrompt).toContain('conversation history');
  });

  it('has acceptEdits permission mode', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.permissionMode).toBe('acceptEdits');
  });
});
