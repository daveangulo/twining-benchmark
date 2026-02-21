import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileReloadStructuredCondition } from '../../../src/conditions/file-reload-structured.js';

describe('FileReloadStructuredCondition', () => {
  let condition: FileReloadStructuredCondition;
  let workDir: string;

  beforeEach(async () => {
    condition = new FileReloadStructuredCondition(3); // 3 agents for faster tests
    workDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));
  });

  afterEach(async () => {
    await condition.teardown();
    await rm(workDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(condition.name).toBe('file-reload-structured');
    expect(condition.description).toContain('GSD/BMAD');
  });

  it('creates coordination directory structure during setup', async () => {
    const ctx = await condition.setup(workDir);

    // Verify directory structure
    const coordDir = join(workDir, 'coordination');
    const coordStat = await stat(coordDir);
    expect(coordStat.isDirectory()).toBe(true);

    const rolesDir = join(coordDir, 'roles');
    const rolesStat = await stat(rolesDir);
    expect(rolesStat.isDirectory()).toBe(true);

    // Verify all expected files
    expect(ctx.setupFiles).toContain('CLAUDE.md');
    expect(ctx.setupFiles).toContain('coordination/STATE.md');
    expect(ctx.setupFiles).toContain('coordination/PLAN.md');
    expect(ctx.setupFiles).toContain('coordination/decisions.md');
    expect(ctx.setupFiles).toContain('coordination/handoff.md');
    expect(ctx.setupFiles).toContain('coordination/roles/agent-1.md');
    expect(ctx.setupFiles).toContain('coordination/roles/agent-2.md');
    expect(ctx.setupFiles).toContain('coordination/roles/agent-3.md');
  });

  it('STATE.md has project state structure', async () => {
    await condition.setup(workDir);

    const content = await readFile(
      join(workDir, 'coordination', 'STATE.md'),
      'utf-8',
    );
    expect(content).toContain('Current Phase');
    expect(content).toContain('Completed Tasks');
    expect(content).toContain('Pending Tasks');
  });

  it('PLAN.md has structured task format with verification steps', async () => {
    await condition.setup(workDir);

    const content = await readFile(
      join(workDir, 'coordination', 'PLAN.md'),
      'utf-8',
    );
    expect(content).toContain('Verification');
    expect(content).toContain('Acceptance Criteria');
    expect(content).toContain('Status');
  });

  it('decisions.md has table format', async () => {
    await condition.setup(workDir);

    const content = await readFile(
      join(workDir, 'coordination', 'decisions.md'),
      'utf-8',
    );
    expect(content).toContain('Decision');
    expect(content).toContain('Rationale');
    expect(content).toContain('Agent');
  });

  it('handoff.md has structured sections', async () => {
    await condition.setup(workDir);

    const content = await readFile(
      join(workDir, 'coordination', 'handoff.md'),
      'utf-8',
    );
    expect(content).toContain('What Was Done');
    expect(content).toContain('Key Findings');
    expect(content).toContain('Next Steps');
    expect(content).toContain('Warnings for Next Agent');
  });

  it('role files have agent-specific personas and startup sequences', async () => {
    await condition.setup(workDir);

    const role1 = await readFile(
      join(workDir, 'coordination', 'roles', 'agent-1.md'),
      'utf-8',
    );
    expect(role1).toContain('Agent 1');
    expect(role1).toContain('Persona');
    expect(role1).toContain('Startup Sequence');
    expect(role1).toContain('STATE.md');
    expect(role1).toContain('PLAN.md');
    expect(role1).toContain('handoff.md');
    expect(role1).toContain('3'); // total agent count

    const role2 = await readFile(
      join(workDir, 'coordination', 'roles', 'agent-2.md'),
      'utf-8',
    );
    expect(role2).toContain('Agent 2');
  });

  it('creates the right number of role files', async () => {
    await condition.setup(workDir);

    const roleFiles = await readdir(
      join(workDir, 'coordination', 'roles'),
    );
    expect(roleFiles).toHaveLength(3);
    expect(roleFiles.sort()).toEqual([
      'agent-1.md',
      'agent-2.md',
      'agent-3.md',
    ]);
  });

  it('system prompt instructs reading role file and structured workflow', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.systemPrompt).toContain('fresh context window');
    expect(config.systemPrompt).toContain('NO conversation history');
    expect(config.systemPrompt).toContain('roles/agent-N.md');
    expect(config.systemPrompt).toContain('STATE.md');
    expect(config.systemPrompt).toContain('PLAN.md');
  });

  it('has no MCP servers', async () => {
    await condition.setup(workDir);
    const config = condition.getAgentConfig();

    expect(config.mcpServers).toEqual({});
  });

  it('tracks all coordination files', async () => {
    await condition.setup(workDir);
    const artifacts = await condition.collectArtifacts();

    expect(artifacts.preSessionState).toHaveProperty(
      'coordination/STATE.md',
    );
    expect(artifacts.preSessionState).toHaveProperty(
      'coordination/PLAN.md',
    );
    expect(artifacts.preSessionState).toHaveProperty(
      'coordination/decisions.md',
    );
    expect(artifacts.preSessionState).toHaveProperty(
      'coordination/handoff.md',
    );
    expect(artifacts.preSessionState).toHaveProperty(
      'coordination/roles/agent-1.md',
    );
  });

  it('defaults to 5 agents when no count specified', async () => {
    const defaultCondition = new FileReloadStructuredCondition();
    const tmpDir = await mkdtemp(join(tmpdir(), 'twining-bench-test-'));

    await defaultCondition.setup(tmpDir);

    const roleFiles = await readdir(join(tmpDir, 'coordination', 'roles'));
    expect(roleFiles).toHaveLength(5);

    await defaultCondition.teardown();
    await rm(tmpDir, { recursive: true, force: true });
  });
});
