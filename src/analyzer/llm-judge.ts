import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmJudgeEvaluation,
  AggregatedJudgeResult,
  EvaluatorPromptTemplate,
  EvaluatorRubric,
} from '../types/analysis.js';
import type { ScoreConfidence } from '../types/results.js';
import type { RawResults } from '../types/scenario.js';
import type { ArchitecturalManifest } from '../types/target.js';

/**
 * Context provided to the evaluator for each scoring judgment.
 */
export interface EvaluationContext {
  /** Ground truth manifest describing expected architecture */
  groundTruth: string;
  /** Relevant code diffs from agent sessions */
  codeDiffs: string;
  /** Coordination artifacts (shared files, decisions, etc.) */
  coordinationArtifacts: string;
  /** Additional scenario-specific context */
  additionalContext?: string;
}

/**
 * Configuration for the LLM judge.
 */
export interface LlmJudgeConfig {
  /** Model to use for evaluation (default: claude-sonnet-4-5-20250929) */
  model: string;
  /** Number of evaluations to run per dimension (default: 3) */
  evaluationCount: number;
  /** Maximum tokens for evaluation response */
  maxTokens: number;
}

const DEFAULT_JUDGE_CONFIG: LlmJudgeConfig = {
  model: 'claude-sonnet-4-5-20250929',
  evaluationCount: 3,
  maxTokens: 2048,
};

/**
 * Run a single LLM-as-judge evaluation (FR-ANL-002).
 */
export async function runSingleEvaluation(
  client: Anthropic,
  template: EvaluatorPromptTemplate,
  context: EvaluationContext,
  config: LlmJudgeConfig = DEFAULT_JUDGE_CONFIG,
): Promise<LlmJudgeEvaluation> {
  const prompt = buildEvaluatorPrompt(template, context);

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  const responseText = textContent ? textContent.text : '';

  const parsed = parseEvaluationResponse(responseText);

  return {
    score: parsed.score,
    confidence: parsed.confidence,
    justification: parsed.justification,
    model: config.model,
    tokenUsage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}

/**
 * Run triple evaluation and return aggregated result with median score (FR-ANL-002).
 * Each evaluation is run independently and the median score is used.
 */
export async function runAggregatedEvaluation(
  client: Anthropic,
  template: EvaluatorPromptTemplate,
  context: EvaluationContext,
  config: LlmJudgeConfig = DEFAULT_JUDGE_CONFIG,
): Promise<AggregatedJudgeResult> {
  const evaluations: LlmJudgeEvaluation[] = [];

  for (let i = 0; i < config.evaluationCount; i++) {
    const evaluation = await runSingleEvaluation(
      client,
      template,
      context,
      config,
    );
    evaluations.push(evaluation);
  }

  // Sort by score to find median
  const sortedScores = evaluations
    .map((e) => e.score)
    .sort((a, b) => a - b);

  const medianScore =
    sortedScores.length % 2 === 0
      ? (sortedScores[sortedScores.length / 2 - 1]! +
          sortedScores[sortedScores.length / 2]!) /
        2
      : sortedScores[Math.floor(sortedScores.length / 2)]!;

  // Calculate variance across evaluations
  const mean =
    sortedScores.reduce((a, b) => a + b, 0) / sortedScores.length;
  const evaluationVariance =
    sortedScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) /
    sortedScores.length;

  return {
    medianScore,
    evaluations,
    evaluationVariance,
  };
}

/**
 * Build the full evaluator prompt from a template and context.
 */
export function buildEvaluatorPrompt(
  template: EvaluatorPromptTemplate,
  context: EvaluationContext,
): string {
  let prompt = template.template;

  // Replace template placeholders
  prompt = prompt.replace('{{GROUND_TRUTH}}', context.groundTruth);
  prompt = prompt.replace('{{CODE_DIFFS}}', context.codeDiffs);
  prompt = prompt.replace(
    '{{COORDINATION_ARTIFACTS}}',
    context.coordinationArtifacts,
  );
  prompt = prompt.replace(
    '{{ADDITIONAL_CONTEXT}}',
    context.additionalContext ?? '',
  );

  // Append the structured rubric
  prompt += '\n\n' + formatRubric(template.rubric);
  prompt += '\n\n' + RESPONSE_FORMAT_INSTRUCTIONS;

  return prompt;
}

/**
 * Format a rubric into a structured text block for the evaluator.
 */
function formatRubric(rubric: EvaluatorRubric): string {
  return `## Scoring Rubric

**Excellent (90-100):** ${rubric.excellent}
**Good (70-89):** ${rubric.good}
**Acceptable (40-69):** ${rubric.acceptable}
**Poor (0-39):** ${rubric.poor}`;
}

const RESPONSE_FORMAT_INSTRUCTIONS = `## Response Format

You MUST respond in exactly this JSON format:

\`\`\`json
{
  "score": <number 0-100>,
  "confidence": "<low|medium|high>",
  "justification": "<paragraph explaining your reasoning>"
}
\`\`\`

- Score must be an integer from 0 to 100.
- Confidence reflects how certain you are in your assessment:
  - "high": Clear evidence supports the score
  - "medium": Some ambiguity but reasonable confidence
  - "low": Limited evidence or significant uncertainty
- Justification must be a single paragraph explaining the key factors behind your score.`;

/**
 * Parse a structured evaluation response from the LLM.
 */
export function parseEvaluationResponse(response: string): {
  score: number;
  confidence: ScoreConfidence;
  justification: string;
} {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) ??
    response.match(/\{[\s\S]*"score"[\s\S]*\}/);

  if (!jsonMatch) {
    // Fallback: try to parse the entire response as JSON
    try {
      return parseJsonResponse(response);
    } catch {
      return {
        score: 0,
        confidence: 'low',
        justification: `Failed to parse evaluation response: ${response.slice(0, 200)}`,
      };
    }
  }

  const jsonStr = jsonMatch[1] ?? jsonMatch[0];
  try {
    return parseJsonResponse(jsonStr!);
  } catch {
    return {
      score: 0,
      confidence: 'low',
      justification: `Failed to parse evaluation JSON: ${jsonStr!.slice(0, 200)}`,
    };
  }
}

function parseJsonResponse(jsonStr: string): {
  score: number;
  confidence: ScoreConfidence;
  justification: string;
} {
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  const score = Math.max(0, Math.min(100, Number(parsed['score']) || 0));

  const rawConfidence = String(parsed['confidence'] ?? 'low');
  const confidence: ScoreConfidence =
    rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
      ? rawConfidence
      : 'low';

  const justification = String(parsed['justification'] ?? '');

  return { score, confidence, justification };
}

// --- Built-in evaluator prompt templates ---

/**
 * Template: Decision consistency — evaluates whether later agents respected
 * earlier architectural decisions.
 */
export const DECISION_CONSISTENCY_TEMPLATE: EvaluatorPromptTemplate = {
  id: 'decision-consistency-v1',
  version: '1.0.0',
  dimension: 'consistency',
  template: `You are evaluating multi-agent coordination quality. Specifically, you are assessing whether later agents' implementations are consistent with earlier agents' architectural decisions.

## Ground Truth (Expected Architecture)
{{GROUND_TRUTH}}

## Code Changes (Diffs from all agent sessions)
{{CODE_DIFFS}}

## Coordination Artifacts
{{COORDINATION_ARTIFACTS}}

{{ADDITIONAL_CONTEXT}}

## Your Task
Evaluate the degree to which later agents' code changes are consistent with the architectural decisions made by earlier agents. Look for:
1. Direct contradictions (e.g., Agent B uses a different pattern than Agent A established)
2. Partial alignment (e.g., Agent B mostly follows but deviates in some areas)
3. Full alignment (e.g., Agent B discovers and respects all of Agent A's decisions)`,
  rubric: {
    excellent:
      'All agents\' code is fully consistent. Later agents discovered and respected all architectural decisions. No contradictions found.',
    good: 'Minor inconsistencies exist but do not affect functionality. Agents mostly aligned with prior decisions.',
    acceptable:
      'Some notable inconsistencies, but core architecture is preserved. Agents partially aligned.',
    poor: 'Major contradictions between agents. Later agents ignored or contradicted earlier decisions, leading to incoherent architecture.',
  },
};

/**
 * Template: Integration quality — evaluates whether agent outputs integrate
 * cleanly into a working system.
 */
export const INTEGRATION_QUALITY_TEMPLATE: EvaluatorPromptTemplate = {
  id: 'integration-quality-v1',
  version: '1.0.0',
  dimension: 'integration',
  template: `You are evaluating multi-agent coordination quality. Specifically, you are assessing whether the combined outputs from multiple agents integrate into a coherent, working system.

## Ground Truth (Expected Architecture)
{{GROUND_TRUTH}}

## Code Changes (Diffs from all agent sessions)
{{CODE_DIFFS}}

## Coordination Artifacts
{{COORDINATION_ARTIFACTS}}

{{ADDITIONAL_CONTEXT}}

## Your Task
Evaluate how well the agents' combined work integrates. Consider:
1. Do modules connect properly (imports, exports, types match)?
2. Are there interface mismatches or broken contracts?
3. Does the combined code compile and pass tests?
4. Is the overall architecture coherent?`,
  rubric: {
    excellent:
      'All agent outputs integrate seamlessly. No compilation errors, all tests pass, and the architecture is clean and coherent.',
    good: 'Minor integration issues that are easily fixable. The system mostly works, with small gaps at module boundaries.',
    acceptable:
      'Notable integration problems requiring manual intervention. Some modules don\'t connect properly, but the overall structure is sound.',
    poor: 'Agents\' outputs are incompatible. Major integration failures — broken imports, type mismatches, or contradictory implementations that prevent the system from working.',
  },
};

/**
 * Template: Architectural coherence — evaluates whether the codebase follows
 * a coherent architectural vision.
 */
export const ARCHITECTURAL_COHERENCE_TEMPLATE: EvaluatorPromptTemplate = {
  id: 'architectural-coherence-v1',
  version: '1.0.0',
  dimension: 'coherence',
  template: `You are evaluating multi-agent coordination quality. Specifically, you are assessing the overall architectural coherence of a codebase built by multiple agents.

## Ground Truth (Expected Architecture)
{{GROUND_TRUTH}}

## Code Changes (Diffs from all agent sessions)
{{CODE_DIFFS}}

## Coordination Artifacts
{{COORDINATION_ARTIFACTS}}

{{ADDITIONAL_CONTEXT}}

## Your Task
Rate the architectural coherence on a 0-5 scale (which will be normalized to 0-100):
- 5: Unified vision — feels like one developer wrote it
- 4: Mostly coherent with minor style/approach variations
- 3: Generally coherent but noticeable inconsistencies in patterns or conventions
- 2: Multiple competing approaches visible, unclear single architecture
- 1: Fragmented — agents clearly worked in isolation
- 0: Chaotic — no discernible architecture

Provide your score as 0-100 (multiply your 0-5 rating by 20).`,
  rubric: {
    excellent:
      'Unified architectural vision (score 90-100 = rating 4.5-5). Code follows consistent patterns, naming conventions, and structural approaches throughout.',
    good: 'Mostly coherent (score 70-89 = rating 3.5-4.4). Minor variations in style or approach that don\'t undermine the overall architecture.',
    acceptable:
      'Generally coherent but inconsistent (score 40-69 = rating 2-3.4). Noticeable differences in approach between agents, but a reasonable architecture can be discerned.',
    poor: 'Fragmented or chaotic (score 0-39 = rating 0-1.9). No unified architecture. Agents clearly worked in isolation, producing incompatible or contradictory designs.',
  },
};

/**
 * Template: Redundancy detection — evaluates how much redundant/duplicated
 * work was done across agents.
 */
export const REDUNDANCY_DETECTION_TEMPLATE: EvaluatorPromptTemplate = {
  id: 'redundancy-detection-v1',
  version: '1.0.0',
  dimension: 'redundancy',
  template: `You are evaluating multi-agent coordination quality. Specifically, you are assessing the amount of redundant or duplicated work performed across agent sessions.

## Ground Truth (Expected Architecture)
{{GROUND_TRUTH}}

## Code Changes (Diffs from all agent sessions)
{{CODE_DIFFS}}

## Coordination Artifacts
{{COORDINATION_ARTIFACTS}}

{{ADDITIONAL_CONTEXT}}

## Your Task
Evaluate the level of redundant work. Consider:
1. Did multiple agents implement the same functionality?
2. Did agents redo work that was already completed?
3. Were there unnecessary reverts followed by re-implementations?
4. What percentage of total work was redundant?

Score 100 = no redundancy; 0 = all work was redundant.`,
  rubric: {
    excellent:
      'No redundant work detected. Each agent built upon prior work without duplication. Estimated redundancy: 0-10%.',
    good: 'Minimal redundancy (10-30%). Some minor overlap in work but agents mostly built on each other\'s output.',
    acceptable:
      'Moderate redundancy (30-60%). Agents repeated some work, possibly due to incomplete awareness of prior sessions.',
    poor: 'High redundancy (>60%). Agents heavily duplicated each other\'s work, indicating poor coordination or no awareness of prior sessions.',
  },
};

/**
 * Get all built-in evaluator templates.
 */
export function getBuiltInTemplates(): EvaluatorPromptTemplate[] {
  return [
    DECISION_CONSISTENCY_TEMPLATE,
    INTEGRATION_QUALITY_TEMPLATE,
    ARCHITECTURAL_COHERENCE_TEMPLATE,
    REDUNDANCY_DETECTION_TEMPLATE,
  ];
}

/**
 * Build an EvaluationContext from RawResults and ground truth.
 *
 * Extracts code diffs from all agent transcripts and serializes the ground
 * truth manifest and any coordination artifacts into a context object
 * suitable for LLM-as-judge evaluation.
 */
export function buildEvaluationContextFromResults(
  rawResults: RawResults,
  groundTruth: ArchitecturalManifest,
  coordinationArtifacts?: string,
): EvaluationContext {
  // Collect all diffs across transcripts
  const codeDiffs = rawResults.transcripts
    .map((t, i) => {
      const diffs = t.fileChanges
        .filter((fc) => fc.diff)
        .map((fc) => `--- ${fc.path}\n${fc.diff}`)
        .join('\n\n');
      return diffs ? `## Agent Session ${i + 1}\n${diffs}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  // Serialize ground truth as structured text
  const groundTruthText = [
    `# ${groundTruth.name}`,
    groundTruth.description,
    '',
    '## Decisions',
    ...groundTruth.decisions.map(
      (d) =>
        `- **${d.id}**: ${d.description}\n  Expected: ${d.expectedPatterns.join(', ')}`,
    ),
  ].join('\n');

  return {
    groundTruth: groundTruthText,
    codeDiffs: codeDiffs || '(no diffs available)',
    coordinationArtifacts: coordinationArtifacts ?? '(no coordination artifacts)',
  };
}
