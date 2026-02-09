import { Router } from 'express';
import { getRecentTrades, getTradesToday } from '../../services/db/queries';

export const tradesRouter = Router();

// GET /api/trades — recent trade history
tradesRouter.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const trades = await getRecentTrades(limit);
    res.json({ trades });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/trades/today — today's trades
tradesRouter.get('/today', async (req, res) => {
  try {
    const trades = await getTradesToday();
    res.json({
      trades,
      count: trades.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
