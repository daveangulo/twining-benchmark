import { describe, it, expect } from 'vitest';
import {
  substitutePromptTemplate,
  type PromptTemplateVars,
} from '../../../src/scenarios/scenario.interface.js';

describe('substitutePromptTemplate', () => {
  const baseVars: PromptTemplateVars = {
    repo_path: '/tmp/test-repo',
    agent_number: '1',
    total_agents: '2',
    scenario_name: 'refactoring-handoff',
  };

  it('replaces all known template variables', () => {
    const template =
      'Working at {{repo_path}} as Agent {{agent_number}} of {{total_agents}} on {{scenario_name}}.';
    const result = substitutePromptTemplate(template, baseVars);
    expect(result).toBe(
      'Working at /tmp/test-repo as Agent 1 of 2 on refactoring-handoff.',
    );
  });

  it('leaves unknown variables unchanged', () => {
    const template = 'Unknown: {{unknown_var}} and known: {{repo_path}}.';
    const result = substitutePromptTemplate(template, baseVars);
    expect(result).toBe('Unknown: {{unknown_var}} and known: /tmp/test-repo.');
  });

  it('handles empty template', () => {
    const result = substitutePromptTemplate('', baseVars);
    expect(result).toBe('');
  });

  it('handles template with no variables', () => {
    const result = substitutePromptTemplate('No variables here.', baseVars);
    expect(result).toBe('No variables here.');
  });

  it('handles multiple occurrences of the same variable', () => {
    const template = '{{repo_path}} and again {{repo_path}}.';
    const result = substitutePromptTemplate(template, baseVars);
    expect(result).toBe('/tmp/test-repo and again /tmp/test-repo.');
  });

  it('handles custom variables via index signature', () => {
    const vars: PromptTemplateVars = {
      ...baseVars,
      custom_key: 'custom_value',
    };
    const template = '{{custom_key}} at {{repo_path}}.';
    const result = substitutePromptTemplate(template, vars);
    expect(result).toBe('custom_value at /tmp/test-repo.');
  });

  it('does not replace partial matches or malformed syntax', () => {
    const template = '{repo_path} and {{ repo_path }} and {{repo_path.';
    const result = substitutePromptTemplate(template, baseVars);
    // None of these should be replaced
    expect(result).toBe('{repo_path} and {{ repo_path }} and {{repo_path.');
  });
});
