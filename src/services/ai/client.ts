import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('AI');

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export type ModelTier = 'fast' | 'deep';

const MODELS: Record<ModelTier, string> = {
  fast: 'claude-sonnet-4-20250514',
  deep: 'claude-opus-4-6',
};

export interface AIRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: ModelTier;
  maxTokens?: number;
  temperature?: number;
}

export async function callAI(options: AIRequestOptions): Promise<string> {
  const {
    systemPrompt,
    userPrompt,
    model = 'fast',
    maxTokens = 2048,
    temperature = 0.3,
  } = options;

  const modelId = MODELS[model];
  log.info(`AI request [${model}/${modelId}]`, {
    promptLength: userPrompt.length,
    maxTokens,
  });

  try {
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock ? textBlock.text : '';

    log.info(`AI response received`, {
      model: modelId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    });

    return text;
  } catch (error: any) {
    log.error('AI request failed', {
      model: modelId,
      error: error.message,
      status: error.status,
    });

    // Handle rate limits with exponential backoff
    if (error.status === 429) {
      log.warn('Rate limited by Anthropic API, waiting 30s...');
      await new Promise((r) => setTimeout(r, 30000));
      return callAI(options); // retry once
    }

    throw error;
  }
}

export async function callAIJson<T>(options: AIRequestOptions): Promise<T> {
  const raw = await callAI(options);

  // Try to extract JSON from response (handle markdown code blocks)
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch (error) {
    log.error('Failed to parse AI JSON response', {
      raw: raw.substring(0, 500),
      error,
    });
    throw new Error(`AI returned invalid JSON: ${raw.substring(0, 200)}`);
  }
}
