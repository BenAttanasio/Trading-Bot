import { Router } from 'express';
import { getAccount } from '../../services/alpaca/client';
import { getPositions } from '../../services/alpaca/trading';
import { getAllPositions } from '../../services/db/queries';

export const portfolioRouter = Router();

// GET /api/portfolio — current portfolio overview
portfolioRouter.get('/', async (req, res) => {
  try {
    const [account, alpacaPositions, dbPositions] = await Promise.all([
      getAccount(),
      getPositions(),
      getAllPositions(),
    ]);

    // Merge Alpaca live data with our stored thesis/metadata
    const positions = alpacaPositions.map((ap) => {
      const db = dbPositions.find((d) => d.symbol === ap.symbol);
      return {
        symbol: ap.symbol,
        qty: parseFloat(ap.qty),
        entryPrice: parseFloat(ap.avg_entry_price),
        currentPrice: parseFloat(ap.current_price),
        marketValue: parseFloat(ap.market_value),
        unrealizedPL: parseFloat(ap.unrealized_pl),
        unrealizedPLPercent: parseFloat(ap.unrealized_plpc) * 100,
        changeToday: parseFloat(ap.change_today) * 100,
        thesis: db?.thesis || null,
        thesisFreshness: db?.thesisFreshness || null,
        daysHeld: db?.daysHeld || 0,
        exitConditions: db?.exitConditions || null,
        trailingStop: db?.trailingStop || null,
        lastReviewedAt: db?.lastReviewedAt || null,
      };
    });

    res.json({
      account: {
        portfolioValue: parseFloat(account.portfolio_value),
        cash: parseFloat(account.cash),
        buyingPower: parseFloat(account.buying_power),
        equity: parseFloat(account.equity),
        lastEquity: parseFloat(account.last_equity),
        longMarketValue: parseFloat(account.long_market_value),
        dailyPL: parseFloat(account.equity) - parseFloat(account.last_equity),
        dailyPLPercent: parseFloat(account.last_equity) > 0
          ? ((parseFloat(account.equity) - parseFloat(account.last_equity)) / parseFloat(account.last_equity)) * 100
          : 0,
        tradingBlocked: account.trading_blocked,
        isPaper: account.account_number?.includes('PA') || true,
      },
      positions,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
