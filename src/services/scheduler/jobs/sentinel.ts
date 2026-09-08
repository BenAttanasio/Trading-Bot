import { getNews } from '../../alpaca/news';
import { getSnapshots, getBars, calculateVolumeAverage } from '../../alpaca/market-data';
import { callAIStructured, BudgetExceededError } from '../../ai/client';
import { SENTINEL_SYSTEM_PROMPT, buildSentinelEvaluatePrompt } from '../../ai/prompts/sentinel-evaluate';
import { SentinelEvaluationSchema, normalizeSentinelEvaluation, SentinelEvaluation } from '../../ai/schemas';
import { getActiveWatchlist, insertAlert } from '../../db/queries';
import { Alert } from '../../db/models/alert';
import { handleSentinelEscalation } from '../../../engine/orchestrator';
import { isExtendedHours } from '../market-hours';
import { TRADING_RULES } from '../../../config/trading-rules';
import { createServiceLogger } from '../../../utils/logger';

const log = createServiceLogger('Sentinel');

// Track last known prices for spike detection
const lastPrices: Map<string, { price: number; timestamp: number }> = new Map();

// Track already-seen news IDs to avoid duplicates
const seenNewsIds = new Set<number>();

// Track last escalation time per symbol to prevent dual-escalation within a tick or rapid re-fire
const lastEscalated: Map<string, number> = new Map();

let sentinelInterval: ReturnType<typeof setInterval> | null = null;

export function startSentinel(): void {
  if (sentinelInterval) {
    log.warn('Sentinel already running');
    return;
  }

  const intervalMs = TRADING_RULES.sentinelPollIntervalSeconds * 1000;
  log.info(`Sentinel started (polling every ${TRADING_RULES.sentinelPollIntervalSeconds}s)`);

  // Run immediately, then on interval
  sentinelTick();
  sentinelInterval = setInterval(sentinelTick, intervalMs);
}

export function stopSentinel(): void {
  if (sentinelInterval) {
    clearInterval(sentinelInterval);
    sentinelInterval = null;
    log.info('Sentinel stopped');
  }
}

async function sentinelTick(): Promise<void> {
  try {
    // Only run during extended hours
    const inHours = await isExtendedHours();
    if (!inHours) return;

    const watchlist = await getActiveWatchlist();
    if (watchlist.length === 0) return;

    const symbols = watchlist.map((w) => w.symbol);

    // Check news and price snapshots in parallel
    await Promise.all([
      checkNews(symbols, watchlist),
      checkPriceSpikes(symbols, watchlist),
    ]);
  } catch (error) {
    log.error('Sentinel tick failed', { error });
  }
}

async function checkNews(
  symbols: string[],
  watchlist: Array<{ symbol: string; sector: string }>
): Promise<void> {
  const news = await getNews(symbols, 20);

  for (const item of news) {
    if (seenNewsIds.has(item.id)) continue;
    seenNewsIds.add(item.id);

    // Limit set size to prevent memory leaks
    if (seenNewsIds.size > 10000) {
      const oldest = Array.from(seenNewsIds).slice(0, 5000);
      oldest.forEach((id) => seenNewsIds.delete(id));
    }

    // Evaluate each relevant symbol in the news
    for (const symbol of item.symbols) {
      if (!symbols.includes(symbol)) continue;

      try {
        const snapshot = lastPrices.get(symbol);
        const evaluation = await evaluateNewsItem(symbol, item.headline, item.summary, snapshot?.price || 0);

        // Store alert
        const alert: Alert = {
          type: 'news',
          symbol,
          urgency: evaluation.urgency,
          direction: evaluation.direction,
          headline: item.headline,
          aiSummary: evaluation.summary,
          actionTaken: evaluation.suggestedAction === 'escalate' ? 'triggered_deep_research'
            : evaluation.suggestedAction === 'queue' ? 'queued_for_pulse'
            : 'ignored',
          resultingTradeId: null,
          createdAt: new Date(),
        };
        await insertAlert(alert);

        // Escalate if urgent — guard against dual-escalation from concurrent news+spike checks
        if (evaluation.urgency >= TRADING_RULES.urgencyEscalationThreshold) {
          const cooldownMs = TRADING_RULES.sentinelEscalationCooldownMinutes * 60 * 1000;
          const lastTime = lastEscalated.get(symbol) ?? 0;
          if (Date.now() - lastTime < cooldownMs) {
            log.info(`Sentinel escalation skipped for ${symbol} — cooldown active (${TRADING_RULES.sentinelEscalationCooldownMinutes}m)`);
          } else {
            lastEscalated.set(symbol, Date.now());
            const wlItem = watchlist.find((w) => w.symbol === symbol);
            await handleSentinelEscalation(
              symbol,
              wlItem?.sector || '',
              item.headline,
              evaluation.urgency,
              evaluation.direction
            );
          }
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          log.warn('Daily token budget exceeded — pausing sentinel news evaluation');
          return;
        }
        log.error(`Failed to evaluate news for ${symbol}`, { error, headline: item.headline });
      }
    }
  }
}

async function checkPriceSpikes(
  symbols: string[],
  watchlist: Array<{ symbol: string; sector: string }>
): Promise<void> {
  try {
    const snapshots = await getSnapshots(symbols);

    for (const [symbol, snapshot] of Object.entries(snapshots)) {
      const currentPrice = snapshot.latestTrade.p;
      const last = lastPrices.get(symbol);

      if (last) {
        const timeDiffMinutes = (Date.now() - last.timestamp) / (1000 * 60);
        if (timeDiffMinutes <= 15) {
          const priceChange = ((currentPrice - last.price) / last.price) * 100;

          if (Math.abs(priceChange) >= TRADING_RULES.priceSpikeTriggerPercent) {
            log.warn(`Price spike detected: ${symbol} ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}% in ${timeDiffMinutes.toFixed(0)}m`);

            const alert: Alert = {
              type: 'price_spike',
              symbol,
              urgency: Math.min(10, Math.round(Math.abs(priceChange) * 2)),
              direction: priceChange > 0 ? 'bullish' : 'bearish',
              headline: `${symbol} ${priceChange > 0 ? 'surged' : 'dropped'} ${Math.abs(priceChange).toFixed(1)}% in ${timeDiffMinutes.toFixed(0)} minutes`,
              aiSummary: '',
              actionTaken: Math.abs(priceChange) >= 5 ? 'triggered_deep_research' : 'queued_for_pulse',
              resultingTradeId: null,
              createdAt: new Date(),
            };
            await insertAlert(alert);

            if (Math.abs(priceChange) >= 5) {
              const cooldownMs = TRADING_RULES.sentinelEscalationCooldownMinutes * 60 * 1000;
              const lastTime = lastEscalated.get(symbol) ?? 0;
              if (Date.now() - lastTime < cooldownMs) {
                log.info(`Sentinel spike escalation skipped for ${symbol} — cooldown active (${TRADING_RULES.sentinelEscalationCooldownMinutes}m)`);
              } else {
                lastEscalated.set(symbol, Date.now());
                const wlItem = watchlist.find((w) => w.symbol === symbol);
                await handleSentinelEscalation(
                  symbol,
                  wlItem?.sector || '',
                  alert.headline,
                  alert.urgency,
                  alert.direction
                );
              }
            }
          }
        }
      }

      lastPrices.set(symbol, { price: currentPrice, timestamp: Date.now() });
    }

    // Clean up stale price entries (symbols removed from watchlist or not seen in >30m)
    const staleThresholdMs = 30 * 60 * 1000;
    for (const [sym, entry] of lastPrices) {
      if (Date.now() - entry.timestamp > staleThresholdMs) {
        lastPrices.delete(sym);
      }
    }
  } catch (error) {
    log.error('Price spike check failed', { error });
  }
}

async function evaluateNewsItem(
  symbol: string,
  headline: string,
  summary: string,
  currentPrice: number
): Promise<SentinelEvaluation> {
  const parsed = await callAIStructured({
    schema: SentinelEvaluationSchema,
    systemPrompt: SENTINEL_SYSTEM_PROMPT,
    userPrompt: buildSentinelEvaluatePrompt({
      symbol,
      headline,
      summary: summary || headline,
      currentPrice,
    }),
    model: 'budget',
    budgetSensitive: true,
    purpose: `sentinel ${symbol}`,
  });

  return normalizeSentinelEvaluation(parsed);
}
