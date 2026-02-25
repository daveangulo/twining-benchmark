import { describe, it, expect, vi } from 'vitest';
import {
  buildEvaluatorPrompt,
  parseEvaluationResponse,
  runSingleEvaluation,
  getBuiltInTemplates,
  DECISION_CONSISTENCY_TEMPLATE,
  INTEGRATION_QUALITY_TEMPLATE,
  ARCHITECTURAL_COHERENCE_TEMPLATE,
  REDUNDANCY_DETECTION_TEMPLATE,
  type EvaluationContext,
} from '../../../src/analyzer/llm-judge.js';
import type { EvaluatorPromptTemplate } from '../../../src/types/analysis.js';

// --- parseEvaluationResponse tests ---

describe('parseEvaluationResponse', () => {
  it('parses a clean JSON response', () => {
    const response = JSON.stringify({
      score: 85,
      confidence: 'high',
      justification: 'Good alignment with ground truth',
    });

    const result = parseEvaluationResponse(response);
    expect(result.score).toBe(85);
    expect(result.confidence).toBe('high');
    expect(result.justification).toBe('Good alignment with ground truth');
  });

  it('parses JSON inside markdown code fence', () => {
    const response = `Here is my evaluation:

\`\`\`json
{
  "score": 72,
  "confidence": "medium",
  "justification": "Partial consistency observed"
}
\`\`\`

That concludes my assessment.`;

    const result = parseEvaluationResponse(response);
    expect(result.score).toBe(72);
    expect(result.confidence).toBe('medium');
    expect(result.justification).toBe('Partial consistency observed');
  });

  it('parses JSON embedded in prose without code fence', () => {
    const response = `Based on my analysis, I would rate this as follows:
{"score": 45, "confidence": "low", "justification": "Significant issues found"}
Overall, the code needs improvement.`;

    const result = parseEvaluationResponse(response);
    expect(result.score).toBe(45);
    expect(result.confidence).toBe('low');
    expect(result.justification).toBe('Significant issues found');
  });

  it('clamps score to 0-100 range', () => {
    const tooHigh = parseEvaluationResponse(
      JSON.stringify({ score: 150, confidence: 'high', justification: 'test' }),
    );
    expect(tooHigh.score).toBe(100);

    const tooLow = parseEvaluationResponse(
      JSON.stringify({ score: -20, confidence: 'high', justification: 'test' }),
    );
    expect(tooLow.score).toBe(0);
  });

  it('defaults unknown confidence to low', () => {
    const result = parseEvaluationResponse(
      JSON.stringify({ score: 50, confidence: 'very-high', justification: 'test' }),
    );
    expect(result.confidence).toBe('low');
  });

  it('handles missing fields gracefully', () => {
    const result = parseEvaluationResponse(JSON.stringify({ score: 60 }));
    expect(result.score).toBe(60);
    expect(result.confidence).toBe('low');
    expect(result.justification).toBe('');
  });

  it('returns score 0 and low confidence for unparseable response', () => {
    const result = parseEvaluationResponse('This is just plain text with no JSON at all.');
    expect(result.score).toBe(0);
    expect(result.confidence).toBe('low');
    expect(result.justification).toContain('Failed to parse');
  });

  it('handles non-numeric score by defaulting to 0', () => {
    const result = parseEvaluationResponse(
      JSON.stringify({ score: 'excellent', confidence: 'high', justification: 'test' }),
    );
    expect(result.score).toBe(0);
  });
});

// --- buildEvaluatorPrompt tests ---

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

// --- runSingleEvaluation tests (mocked Anthropic client) ---

describe('runSingleEvaluation', () => {
  function makeMockClient(responseText: string) {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: responseText }],
          usage: { input_tokens: 500, output_tokens: 200 },
        }),
      },
    } as never; // Cast to Anthropic type
  }

  it('calls the Anthropic API with the correct prompt and returns parsed result', async () => {
    const responseJson = JSON.stringify({
      score: 88,
      confidence: 'high',
      justification: 'Strong consistency observed',
    });
    const client = makeMockClient(responseJson);

    const result = await runSingleEvaluation(
      client,
      DECISION_CONSISTENCY_TEMPLATE,
      {
        groundTruth: 'Use repository pattern',
        codeDiffs: 'diff --git a/repo.ts...',
        coordinationArtifacts: 'Decision logged',
      },
    );

    expect(result.score).toBe(88);
    expect(result.confidence).toBe('high');
    expect(result.justification).toBe('Strong consistency observed');
    expect(result.tokenUsage.input).toBe(500);
    expect(result.tokenUsage.output).toBe(200);

    // Verify the API was called with correct model
    const createCall = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(createCall.model).toBe('claude-sonnet-4-5-20250929');
    expect(createCall.messages[0]!.role).toBe('user');
    expect(createCall.messages[0]!.content).toContain('Use repository pattern');
  });

  it('handles LLM returning unparseable response', async () => {
    const client = makeMockClient('I cannot evaluate this properly.');

    const result = await runSingleEvaluation(
      client,
      DECISION_CONSISTENCY_TEMPLATE,
      {
        groundTruth: 'test',
        codeDiffs: 'test',
        coordinationArtifacts: 'test',
      },
    );

    expect(result.score).toBe(0);
    expect(result.confidence).toBe('low');
    expect(result.justification).toContain('Failed to parse');
  });

  it('handles code-fenced JSON in LLM response', async () => {
    const responseText = 'Here is my evaluation:\n```json\n{"score": 75, "confidence": "medium", "justification": "Reasonable"}\n```';
    const client = makeMockClient(responseText);

    const result = await runSingleEvaluation(
      client,
      INTEGRATION_QUALITY_TEMPLATE,
      {
        groundTruth: 'test',
        codeDiffs: 'test',
        coordinationArtifacts: 'test',
      },
    );

    expect(result.score).toBe(75);
    expect(result.confidence).toBe('medium');
  });
});

// --- Template constants ---

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
