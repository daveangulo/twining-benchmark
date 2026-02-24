import { describe, it, expect, vi } from 'vitest';
import {
  buildEvaluatorPrompt,
  getBuiltInTemplates,
  DECISION_CONSISTENCY_TEMPLATE,
  INTEGRATION_QUALITY_TEMPLATE,
  ARCHITECTURAL_COHERENCE_TEMPLATE,
  REDUNDANCY_DETECTION_TEMPLATE,
  type EvaluationContext,
} from '../../../src/analyzer/llm-judge.js';
import type { EvaluatorPromptTemplate } from '../../../src/types/analysis.js';

describe('buildEvaluatorPrompt', () => {
  const context: EvaluationContext = {
    groundTruth: 'Repository pattern for data access',
    codeDiffs: 'diff --git a/service.ts...',
    coordinationArtifacts: 'Decision: use repository pattern',
    additionalContext: 'Agent session 1 completed',
  };

  it('replaces all template placeholders', () => {
    const prompt = buildEvaluatorPrompt(DECISION_CONSISTENCY_TEMPLATE, context);

    expect(prompt).toContain('Repository pattern for data access');
    expect(prompt).toContain('diff --git a/service.ts...');
    expect(prompt).toContain('Decision: use repository pattern');
    expect(prompt).toContain('Agent session 1 completed');
    expect(prompt).not.toContain('{{GROUND_TRUTH}}');
    expect(prompt).not.toContain('{{CODE_DIFFS}}');
    expect(prompt).not.toContain('{{COORDINATION_ARTIFACTS}}');
    expect(prompt).not.toContain('{{ADDITIONAL_CONTEXT}}');
  });

  it('handles missing additional context', () => {
    const ctx: EvaluationContext = {
      groundTruth: 'test',
      codeDiffs: 'test',
      coordinationArtifacts: 'test',
    };

    const prompt = buildEvaluatorPrompt(DECISION_CONSISTENCY_TEMPLATE, ctx);
    expect(prompt).not.toContain('{{ADDITIONAL_CONTEXT}}');
  });

  it('includes rubric in prompt', () => {
    const prompt = buildEvaluatorPrompt(DECISION_CONSISTENCY_TEMPLATE, context);

    expect(prompt).toContain('Scoring Rubric');
    expect(prompt).toContain('Excellent (90-100)');
    expect(prompt).toContain('Good (70-89)');
    expect(prompt).toContain('Acceptable (40-69)');
    expect(prompt).toContain('Poor (0-39)');
  });

  it('includes response format instructions', () => {
    const prompt = buildEvaluatorPrompt(DECISION_CONSISTENCY_TEMPLATE, context);

    expect(prompt).toContain('Response Format');
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"justification"');
  });
});

describe('getBuiltInTemplates', () => {
  it('returns 4 templates', () => {
    const templates = getBuiltInTemplates();
    expect(templates).toHaveLength(4);
  });

  it('all templates have required fields', () => {
    const templates = getBuiltInTemplates();
    for (const t of templates) {
      expect(t.id).toBeTruthy();
      expect(t.version).toBeTruthy();
      expect(t.dimension).toBeTruthy();
      expect(t.template).toBeTruthy();
      expect(t.rubric).toBeDefined();
      expect(t.rubric.excellent).toBeTruthy();
      expect(t.rubric.good).toBeTruthy();
      expect(t.rubric.acceptable).toBeTruthy();
      expect(t.rubric.poor).toBeTruthy();
    }
  });

  it('templates cover expected dimensions', () => {
    const templates = getBuiltInTemplates();
    const dimensions = templates.map(t => t.dimension);

    expect(dimensions).toContain('consistency');
    expect(dimensions).toContain('integration');
    expect(dimensions).toContain('coherence');
    expect(dimensions).toContain('redundancy');
  });

  it('all templates contain required placeholders', () => {
    const templates = getBuiltInTemplates();
    for (const t of templates) {
      expect(t.template).toContain('{{GROUND_TRUTH}}');
      expect(t.template).toContain('{{CODE_DIFFS}}');
      expect(t.template).toContain('{{COORDINATION_ARTIFACTS}}');
    }
  });
});

describe('parseEvaluationResponse (via buildEvaluatorPrompt round-trip)', () => {
  // Since parseEvaluationResponse is not exported, we test it indirectly
  // by verifying the template produces valid prompts that would lead to parseable responses

  it('templates produce non-empty prompts', () => {
    const context: EvaluationContext = {
      groundTruth: 'test truth',
      codeDiffs: 'test diff',
      coordinationArtifacts: 'test artifacts',
    };

    for (const template of getBuiltInTemplates()) {
      const prompt = buildEvaluatorPrompt(template, context);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });
});

describe('template constants', () => {
  it('DECISION_CONSISTENCY_TEMPLATE has correct dimension', () => {
    expect(DECISION_CONSISTENCY_TEMPLATE.dimension).toBe('consistency');
    expect(DECISION_CONSISTENCY_TEMPLATE.id).toBe('decision-consistency-v1');
  });

  it('INTEGRATION_QUALITY_TEMPLATE has correct dimension', () => {
    expect(INTEGRATION_QUALITY_TEMPLATE.dimension).toBe('integration');
    expect(INTEGRATION_QUALITY_TEMPLATE.id).toBe('integration-quality-v1');
  });

  it('ARCHITECTURAL_COHERENCE_TEMPLATE has correct dimension', () => {
    expect(ARCHITECTURAL_COHERENCE_TEMPLATE.dimension).toBe('coherence');
    expect(ARCHITECTURAL_COHERENCE_TEMPLATE.id).toBe('architectural-coherence-v1');
  });

  it('REDUNDANCY_DETECTION_TEMPLATE has correct dimension', () => {
    expect(REDUNDANCY_DETECTION_TEMPLATE.dimension).toBe('redundancy');
    expect(REDUNDANCY_DETECTION_TEMPLATE.id).toBe('redundancy-detection-v1');
  });
});
