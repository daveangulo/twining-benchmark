import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SharedMarkdownCondition } from '../../../src/conditions/shared-markdown.js';

describe('SharedMarkdownCondition', () => {
  let condition: SharedMarkdownCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new SharedMarkdownCondition();
    workDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(condition.name).toBe('shared-markdown');
    expect(condition.description).toContain('COORDINATION.md');
  });

  it('creates both CLAUDE.md and COORDINATION.md during setup', async () => {
    const ctx = await condition.setup(workDir);

    expect(ctx.setupFiles).toContain('CLAUDE.md');
    expect(ctx.setupFiles).toContain('COORDINATION.md');

    const claudeContent = await readFile(join(workDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeContent).toContain('COORDINATION.md');

    const coordContent = await readFile(
      join(workDir, 'COORDINATION.md'),
      'utf-8',
    );
    expect(coordContent).toContain('Coordination Log');
  });

  it('COORDINATION.md starts with template header', async () => {
    await condition.setup(workDir);

    const content = await readFile(
      join(workDir, 'COORDINATION.md'),
      'utf-8',
    );
    expect(content).toContain('Coordination Log');
    expect(content).toContain('share decisions');
  });

  it('returns agent config with coordination system prompt', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toContain('COORDINATION.md');
    expect(config.systemPrompt).toContain('read');
    expect(config.systemPrompt).toContain('update');
    expect(config.mcpServers).toEqual({});
    expect(config.permissionMode).toBe('acceptEdits');
  });

  it('tracks both CLAUDE.md and COORDINATION.md', async () => {
    await condition.setup(workDir);
    const artifacts = await condition.collectArtifacts();

    expect(artifacts.preSessionState).toHaveProperty('CLAUDE.md');
    expect(artifacts.preSessionState).toHaveProperty('COORDINATION.md');
  });

  it('detects changes to COORDINATION.md between artifact collections', async () => {
    await condition.setup(workDir);

    // Simulate an agent modifying COORDINATION.md
    const { writeFile: write } = await import('node:fs/promises');
    await write(
      join(workDir, 'COORDINATION.md'),
      '# Updated by agent\n## Decision: use event bus',
      'utf-8',
    );

    const artifacts = await condition.collectArtifacts();
    expect(artifacts.changes).toContain('COORDINATION.md');
  });
});
