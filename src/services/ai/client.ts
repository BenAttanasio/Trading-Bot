import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type * as z from 'zod/v4';
import { env } from '../../config/env';
import { TRADING_RULES } from '../../config/trading-rules';
import { getBotState, setBotState } from '../db/bot-state';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('AI');

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: TRADING_RULES.aiTimeoutMs, // milliseconds (TypeScript SDK)
  maxRetries: 3, // SDK retries 429 / 5xx / connection errors with backoff
});

export type ModelTier = 'budget' | 'fast' | 'deep';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Model IDs are complete as-is — never append date suffixes. */
export const MODEL_IDS: Record<ModelTier, string> = {
  budget: 'claude-haiku-4-5', // sentinel triage, intraday scouting
  fast: 'claude-sonnet-5',    // trade decisions, position reviews, EOD, nightly reflection
  deep: 'claude-opus-5',      // morning research, stale-thesis reviews, weekly review
};

const DEFAULT_MAX_TOKENS: Record<ModelTier, number> = { budget: 1024, fast: 4096, deep: 8192 };
/** Haiku 4.5 predates adaptive thinking / effort; the 5-series rejects sampling params. */
const ADAPTIVE_THINKING: Record<ModelTier, boolean> = { budget: false, fast: true, deep: true };

/** Server-side research tools (Opus 5 / Sonnet 5). Usage is metered per search. */
export const WEB_RESEARCH_TOOLS: Anthropic.MessageCreateParams['tools'] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
];

// ─── Daily token budget (persisted so restarts don't reset it) ──────────────

interface AIUsageState {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  byModel: Record<ModelTier, number>;
}

const USAGE_KEY = 'aiUsage';

function freshUsage(): AIUsageState {
  return {
    date: new Date().toDateString(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    byModel: { budget: 0, fast: 0, deep: 0 },
  };
}

let usage: AIUsageState = freshUsage();
let persistTimer: NodeJS.Timeout | null = null;

/** Budget-relevant tokens. Cache reads cost ~10% of input, so they count at 10%. */
function budgetTokensUsed(): number {
  return usage.inputTokens + usage.cacheWriteTokens + usage.outputTokens + Math.round(usage.cacheReadTokens * 0.1);
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    setBotState(USAGE_KEY, usage).catch((err) => log.warn('Failed to persist AI usage', { err }));
  }, 2000);
}

function checkAndResetBudget(): void {
  const today = new Date().toDateString();
  if (today !== usage.date) {
    usage = freshUsage();
    log.info('Daily AI token budget reset', { date: today });
    schedulePersist();
  }
}

/** Call once after the DB is connected so a restart doesn't zero the counters. */
export async function loadAIUsageState(): Promise<void> {
  try {
    const saved = await getBotState<AIUsageState>(USAGE_KEY);
    if (saved && saved.date === new Date().toDateString()) {
      usage = { ...freshUsage(), ...saved, byModel: { ...freshUsage().byModel, ...saved.byModel } };
      log.info('Restored AI usage counters', { total: budgetTokensUsed() });
    }
  } catch (err) {
    log.warn('Could not restore AI usage state', { err });
  }
}

export function getDailyTokenUsage(): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  total: number;
  budget: number;
} {
  checkAndResetBudget();
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    total: budgetTokensUsed(),
    budget: env.DAILY_AI_TOKEN_BUDGET,
  };
}

export function getDetailedTokenUsage(): {
  total: number;
  budget: number;
  byModel: Record<ModelTier, number>;
  cacheReadTokens: number;
} {
  checkAndResetBudget();
  return {
    total: budgetTokensUsed(),
    budget: env.DAILY_AI_TOKEN_BUDGET,
    byModel: { ...usage.byModel },
    cacheReadTokens: usage.cacheReadTokens,
  };
}

function recordUsage(tier: ModelTier, u: Anthropic.Usage): void {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  usage.inputTokens += u.input_tokens;
  usage.outputTokens += u.output_tokens;
  usage.cacheReadTokens += cacheRead;
  usage.cacheWriteTokens += cacheWrite;
  usage.byModel[tier] += u.input_tokens + cacheWrite + u.output_tokens + Math.round(cacheRead * 0.1);
  schedulePersist();
}

// ─── Request plumbing ───────────────────────────────────────────────────────

export interface AIRequestOptions {
  /** Stable text — first block of the cached prefix. Keep timestamps and per-call data out of it. */
  systemPrompt: string;
  /** Additional stable blocks (e.g. the playbook) — also cached; the breakpoint sits after the last one. */
  cachedBlocks?: string[];
  /** Volatile system additions appended AFTER the cache breakpoint. */
  contextBlocks?: string[];
  userPrompt: string;
  model?: ModelTier;
  maxTokens?: number;
  /** Adaptive-thinking depth for fast/deep tiers. Ignored for budget. */
  effort?: Effort;
  /** If true, this call is skipped when the daily token budget is exceeded. */
  budgetSensitive?: boolean;
  /** Server-side tools (see WEB_RESEARCH_TOOLS). */
  tools?: Anthropic.MessageCreateParams['tools'];
  /** How many `pause_turn` continuations to allow when tools are in play. */
  maxToolRounds?: number;
  /** Free-text label for logs. */
  purpose?: string;
}

export class BudgetExceededError extends Error {
  constructor() {
    super('Daily AI token budget exceeded — skipping non-critical call');
    this.name = 'BudgetExceededError';
  }
}

export class AIRefusalError extends Error {
  constructor(public readonly category: string | null, explanation?: string | null) {
    super(`AI declined the request${category ? ` (${category})` : ''}${explanation ? `: ${explanation}` : ''}`);
    this.name = 'AIRefusalError';
  }
}

function enforceBudget(options: AIRequestOptions): void {
  if (!options.budgetSensitive) return;
  const totalUsed = budgetTokensUsed();
  const budget = env.DAILY_AI_TOKEN_BUDGET;
  if (totalUsed >= budget) {
    log.warn('Daily AI token budget exceeded — skipping budget-sensitive call', {
      totalUsed,
      budget,
      model: options.model ?? 'fast',
    });
    throw new BudgetExceededError();
  }
  if (totalUsed >= budget * 0.9) {
    log.warn('Daily AI token budget at 90% — approaching limit', { totalUsed, budget });
  }
}

const nonEmpty = (t: unknown): t is string => typeof t === 'string' && t.trim().length > 0;

function buildBaseParams(options: AIRequestOptions): Anthropic.MessageCreateParamsNonStreaming {
  const tier = options.model ?? 'fast';
  const stable = [options.systemPrompt, ...(options.cachedBlocks ?? []).filter(nonEmpty)];
  const system: Anthropic.TextBlockParam[] = [
    ...stable.map((text, i) =>
      i === stable.length - 1
        ? // One breakpoint after the last stable block caches the whole prefix.
          // Caching engages once the prefix exceeds the model minimum (1024-4096 tokens).
          ({ type: 'text', text, cache_control: { type: 'ephemeral' } } as Anthropic.TextBlockParam)
        : ({ type: 'text', text } as Anthropic.TextBlockParam)
    ),
    ...(options.contextBlocks ?? []).filter(nonEmpty).map((text) => ({ type: 'text' as const, text })),
  ];

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL_IDS[tier],
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS[tier],
    system,
    messages: [{ role: 'user', content: options.userPrompt }],
  };

  if (ADAPTIVE_THINKING[tier]) {
    params.thinking = { type: 'adaptive' };
    params.output_config = { effort: options.effort ?? 'medium' };
  }
  if (options.tools && options.tools.length > 0) {
    params.tools = options.tools;
  }

  return params;
}

function logRequest(options: AIRequestOptions, params: Anthropic.MessageCreateParamsNonStreaming): void {
  log.info(`AI request [${options.model ?? 'fast'}/${params.model}]${options.purpose ? ` ${options.purpose}` : ''}`, {
    promptLength: options.userPrompt.length,
    maxTokens: params.max_tokens,
    effort: params.output_config?.effort,
    tools: params.tools?.map((t) => ('name' in t ? t.name : t.type)),
    dailyTokensUsed: budgetTokensUsed(),
  });
}

function logResponse(tier: ModelTier, response: Anthropic.Message): void {
  const searches = response.usage.server_tool_use?.web_search_requests ?? 0;
  log.info('AI response received', {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    ...(searches ? { webSearches: searches } : {}),
    dailyTotal: budgetTokensUsed(),
    stopReason: response.stop_reason,
    tier,
  });
}

function throwIfRefused(response: Anthropic.Message): void {
  if (response.stop_reason === 'refusal') {
    throw new AIRefusalError(response.stop_details?.category ?? null, response.stop_details?.explanation ?? null);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Free-form text completion (used by narrative jobs). */
export async function callAIText(options: AIRequestOptions): Promise<string> {
  checkAndResetBudget();
  enforceBudget(options);
  const tier = options.model ?? 'fast';
  const params = buildBaseParams(options);
  logRequest(options, params);

  try {
    const response = await anthropic.messages.create(params);
    recordUsage(tier, response.usage);
    logResponse(tier, response);
    throwIfRefused(response);
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (error: any) {
    if (error instanceof BudgetExceededError || error instanceof AIRefusalError) throw error;
    log.error('AI request failed', { model: params.model, error: error.message, status: error.status });
    throw error;
  }
}

/**
 * Structured completion: the response is constrained to `schema` server-side and
 * returned already parsed. Handles `pause_turn` continuations when server tools
 * (web search / fetch) are in play. Callers should still run the matching
 * normalizer to clamp numeric ranges.
 */
export async function callAIStructured<S extends z.ZodType>(
  options: AIRequestOptions & { schema: S }
): Promise<z.infer<S>> {
  checkAndResetBudget();
  enforceBudget(options);
  const tier = options.model ?? 'fast';
  const base = buildBaseParams(options);
  logRequest(options, base);

  const maxRounds = Math.max(1, options.maxToolRounds ?? 5);
  let messages: Anthropic.MessageParam[] = base.messages;

  try {
    for (let round = 1; round <= maxRounds; round++) {
      const response = await anthropic.messages.parse({
        ...base,
        messages,
        output_config: { ...(base.output_config ?? {}), format: zodOutputFormat(options.schema) },
      });
      recordUsage(tier, response.usage);
      logResponse(tier, response);
      throwIfRefused(response);

      if (response.stop_reason === 'pause_turn' && round < maxRounds) {
        // Server-side tool loop paused; hand the partial turn back and continue.
        messages = [...messages, { role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] }];
        continue;
      }

      if (response.parsed_output == null) {
        throw new Error(`AI returned no parseable output (stop_reason: ${response.stop_reason})`);
      }
      return response.parsed_output;
    }
    throw new Error(`AI did not finish within ${maxRounds} tool rounds`);
  } catch (error: any) {
    if (error instanceof BudgetExceededError || error instanceof AIRefusalError) throw error;
    log.error('AI structured request failed', { model: base.model, error: error.message, status: error.status });
    throw error;
  }
}
