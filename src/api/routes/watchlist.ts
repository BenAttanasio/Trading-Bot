import { Router } from 'express';
import { getActiveWatchlist, addToWatchlist, removeFromWatchlist } from '../../services/db/queries';
import { WatchlistItem } from '../../services/db/models/watchlist';

export const watchlistRouter = Router();

// GET /api/watchlist — current watchlist
watchlistRouter.get('/', async (req, res) => {
  try {
    const watchlist = await getActiveWatchlist();
    res.json({ watchlist });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/watchlist — add stock to watchlist
watchlistRouter.post('/', async (req, res) => {
  try {
    const { symbol, sector, reason } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    const item: WatchlistItem = {
      symbol: symbol.toUpperCase(),
      sector: sector || 'Unknown',
      reason: reason || 'Added manually',
      addedAt: new Date(),
      active: true,
    };

    await addToWatchlist(item);
    res.json({ success: true, item });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/watchlist/:symbol — remove stock from watchlist
watchlistRouter.delete('/:symbol', async (req, res) => {
  try {
    await removeFromWatchlist(req.params.symbol.toUpperCase());
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
