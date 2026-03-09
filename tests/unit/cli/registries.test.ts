import { describe, it, expect } from 'vitest';
import {
  CONDITION_REGISTRY,
  getAllConditionNames,
  getCondition,
  resolveConditionNames,
} from '../../../src/conditions/registry.js';
import {
  SCENARIO_REGISTRY,
  getAllScenarioNames,
  getScenario,
  resolveScenarioNames,
} from '../../../src/scenarios/registry.js';

describe('Condition Registry', () => {
  it('has all 7 conditions', () => {
    expect(getAllConditionNames()).toHaveLength(7);
  });

  it('has expected condition names', () => {
    const names = getAllConditionNames();
    expect(names).toContain('baseline');
    expect(names).toContain('claude-md-only');
    expect(names).toContain('shared-markdown');
    expect(names).toContain('file-reload-generic');
    expect(names).toContain('file-reload-structured');
    expect(names).toContain('full-twining');
    expect(names).toContain('persistent-history');
  });

  it('getCondition returns valid entries', () => {
    const entry = getCondition('baseline');
    expect(entry.name).toBe('baseline');
    expect(entry.description).toBeTruthy();
    expect(typeof entry.create).toBe('function');
  });

  it('getCondition throws for unknown names', () => {
    expect(() => getCondition('nonexistent' as never)).toThrow('Unknown condition');
  });

  it('resolveConditionNames resolves "all"', () => {
    const names = resolveConditionNames('all');
    expect(names).toHaveLength(7);
  });

  it('resolveConditionNames resolves single names', () => {
    const names = resolveConditionNames('baseline');
    expect(names).toEqual(['baseline']);
  });

  it('resolveConditionNames resolves comma-separated names', () => {
    const names = resolveConditionNames('baseline,full-twining');
    expect(names).toEqual(['baseline', 'full-twining']);
  });

  it('resolveConditionNames throws for unknown names', () => {
    expect(() => resolveConditionNames('invalid')).toThrow('Unknown condition: invalid');
  });

  it('each registry entry can create a condition instance', () => {
    for (const name of getAllConditionNames()) {
      const entry = CONDITION_REGISTRY[name];
      expect(entry).toBeDefined();
      const condition = entry!.create();
      expect(condition.name).toBe(name);
    }
  });
});

describe('Scenario Registry', () => {
  it('has all 5 scenarios', () => {
    expect(getAllScenarioNames()).toHaveLength(5);
  });

  it('has expected scenario names', () => {
    const names = getAllScenarioNames();
    expect(names).toContain('refactoring-handoff');
    expect(names).toContain('architecture-cascade');
    expect(names).toContain('bug-investigation');
    expect(names).toContain('multi-session-build');
    expect(names).toContain('scale-stress-test');
  });

  it('getScenario returns valid entries', () => {
    const entry = getScenario('refactoring-handoff');
    expect(entry.metadata.name).toBe('refactoring-handoff');
    expect(typeof entry.create).toBe('function');
  });

  it('getScenario throws for unknown names', () => {
    expect(() => getScenario('nonexistent' as never)).toThrow('Unknown scenario');
  });

  it('resolveScenarioNames resolves "all" excluding scale-stress-test', () => {
    const names = resolveScenarioNames('all');
    expect(names).toHaveLength(4);
    expect(names).not.toContain('scale-stress-test');
  });

  it('resolveScenarioNames resolves explicit scale-stress-test', () => {
    const names = resolveScenarioNames('scale-stress-test');
    expect(names).toEqual(['scale-stress-test']);
  });

  it('resolveScenarioNames throws for unknown names', () => {
    expect(() => resolveScenarioNames('invalid')).toThrow('Unknown scenario: invalid');
  });

  it('each registry entry can create a scenario instance', () => {
    for (const name of getAllScenarioNames()) {
      const entry = SCENARIO_REGISTRY[name];
      expect(entry).toBeDefined();
      const scenario = entry!.create();
      expect(scenario.getMetadata().name).toBe(name);
    }
  });
});
