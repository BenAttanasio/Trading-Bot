import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { createServiceLogger } from '../../utils/logger';
import { TRADING_RULES } from '../../config/trading-rules';

const log = createServiceLogger('AI');

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: TRADING_RULES.aiTimeoutMs,
});

export type ModelTier = 'budget' | 'fast' | 'deep';

const MODELS: Record<ModelTier, string> = {
  budget: 'claude-haiku-4-5-20251001', // ~4× cheaper than Sonnet — use for sentinel, intraday pulse
  fast: 'claude-sonnet-4-6',           // Updated from claude-sonnet-4-20250514
  deep: 'claude-opus-4-6',             // Morning research, stale thesis reviews
};

// Daily token budget circuit breaker
let dailyInputTokens = 0;
let dailyOutputTokens = 0;
let dailyTokensByModel: Record<ModelTier, number> = { budget: 0, fast: 0, deep: 0 };
let budgetResetDate = new Date().toDateString();

function checkAndResetBudget(): void {
  const today = new Date().toDateString();
  if (today !== budgetResetDate) {
    dailyInputTokens = 0;
    dailyOutputTokens = 0;
    dailyTokensByModel = { budget: 0, fast: 0, deep: 0 };
    budgetResetDate = today;
    log.info('Daily AI token budget reset', { date: today });
  }
}

export function getDailyTokenUsage(): { inputTokens: number; outputTokens: number; total: number; budget: number } {
  checkAndResetBudget();
  return {
    inputTokens: dailyInputTokens,
    outputTokens: dailyOutputTokens,
    total: dailyInputTokens + dailyOutputTokens,
    budget: env.DAILY_AI_TOKEN_BUDGET,
  };
}

export function getDetailedTokenUsage(): {
  total: number;
  budget: number;
  byModel: Record<ModelTier, number>;
} {
  checkAndResetBudget();
  return {
    total: dailyInputTokens + dailyOutputTokens,
    budget: env.DAILY_AI_TOKEN_BUDGET,
    byModel: { ...dailyTokensByModel },
  };
}

export interface AIRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: ModelTier;
  maxTokens?: number;
  temperature?: number;
  /** If true, this call is skipped when the daily token budget is exceeded */
  budgetSensitive?: boolean;
}

export class BudgetExceededError extends Error {
  constructor() {
    super('Daily AI token budget exceeded — skipping non-critical call');
    this.name = 'BudgetExceededError';
  }
}

export async function callAI(options: AIRequestOptions): Promise<string> {
  const {
    systemPrompt,
    userPrompt,
    model = 'fast',
    maxTokens = 2048,
    temperature = 0.3,
    budgetSensitive = false,
  } = options;

  checkAndResetBudget();

  // Enforce daily budget for non-critical calls
  if (budgetSensitive) {
    const totalUsed = dailyInputTokens + dailyOutputTokens;
    const budget = env.DAILY_AI_TOKEN_BUDGET;
    if (totalUsed >= budget) {
      log.warn('Daily AI token budget exceeded — skipping budget-sensitive call', {
        totalUsed,
        budget,
        model,
      });
      throw new BudgetExceededError();
    }
    if (totalUsed >= budget * 0.9) {
      log.warn('Daily AI token budget at 90% — approaching limit', { totalUsed, budget });
    }
  }

  const modelId = MODELS[model];
  log.info(`AI request [${model}/${modelId}]`, {
    promptLength: userPrompt.length,
    maxTokens,
    dailyTokensUsed: dailyInputTokens + dailyOutputTokens,
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

    dailyInputTokens += response.usage.input_tokens;
    dailyOutputTokens += response.usage.output_tokens;
    dailyTokensByModel[model] += response.usage.input_tokens + response.usage.output_tokens;

    log.info(`AI response received`, {
      model: modelId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      dailyTotal: dailyInputTokens + dailyOutputTokens,
      stopReason: response.stop_reason,
    });

    return text;
  } catch (error: any) {
    if (error instanceof BudgetExceededError) throw error;

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
