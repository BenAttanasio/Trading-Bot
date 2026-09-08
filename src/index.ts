import { validateEnv, env } from './config/env';
import { connectDB, disconnectDB } from './services/db/connection';
import { verifyConnection, getAccount } from './services/alpaca/client';
import { getActiveWatchlist } from './services/db/queries';
import { startScheduler, stopScheduler } from './services/scheduler/cron';
import { logMarketState } from './services/scheduler/market-hours';
import { startServer } from './api/server';
import { loadTradingState } from './engine/execution';
import { loadAIUsageState } from './services/ai/client';
import { ensureStartingEquity } from './services/db/bot-state';
import { loadPlaybook } from './services/playbook';
import { reconcileDeployments } from './engine/self-improve';
import logger from './utils/logger';
import { formatCurrency } from './utils/formatters';

async function main() {
  logger.info('═══════════════════════════════════════');
  logger.info('    AI TRADER — Starting Up');
  logger.info('═══════════════════════════════════════');

  // 1. Validate environment
  try {
    validateEnv();
  } catch (error: any) {
    logger.error(`Environment validation failed: ${error.message}`);
    process.exit(1);
  }

  // 2. Connect to MongoDB
  try {
    await connectDB();
  } catch (error: any) {
    logger.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }

  // 2b. Restore persisted runtime state (kill switch, AI usage counters)
  await loadTradingState();
  await loadAIUsageState();
  await loadPlaybook();
  await reconcileDeployments();

  // 3. Connect to Alpaca
  const alpacaOk = await verifyConnection();
  if (!alpacaOk) {
    logger.error('Alpaca connection failed — exiting');
    process.exit(1);
  }

  // 4. Log starting state
  const account = await getAccount();
  const portfolioValue = parseFloat(account.portfolio_value);
  const startingEquity = await ensureStartingEquity(portfolioValue, env.STARTING_EQUITY);
  logger.info(`Portfolio value: ${formatCurrency(portfolioValue)} (baseline ${formatCurrency(startingEquity)})`);
  logger.info(`Cash available: ${formatCurrency(parseFloat(account.cash))}`);
  logger.info(`Mode: ${env.isPaper ? 'PAPER TRADING' : '⚠️  LIVE TRADING'}`);

  // 5. Market state
  const marketState = await logMarketState();

  // 6. Watchlist check
  const watchlist = await getActiveWatchlist();
  logger.info(`Watchlist: ${watchlist.length} stocks active`);

  // 7. Start scheduler (sentinel + cron jobs)
  startScheduler();

  // 8. Start API server
  startServer();

  // 9. Ready
  logger.info('═══════════════════════════════════════');
  logger.info(`  AI Trader ONLINE`);
  logger.info(`  Watching ${watchlist.length} stocks`);
  logger.info(`  Portfolio: ${formatCurrency(portfolioValue)}`);
  logger.info(`  Market: ${marketState.toUpperCase()}`);
  logger.info(`  API: http://localhost:${env.PORT}`);
  logger.info('═══════════════════════════════════════');
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully...`);
  stopScheduler();
  disconnectDB().then(() => {
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

main().catch((error) => {
  logger.error('Fatal startup error', { error });
  process.exit(1);
});
