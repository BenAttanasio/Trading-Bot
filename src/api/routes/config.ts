import { Router } from 'express';
import { TRADING_RULES } from '../../config/trading-rules';
import { pauseTrading, resumeTrading, isTradingPaused } from '../../engine/execution';

export const configRouter = Router();

// GET /api/config — current trading configuration
configRouter.get('/', (req, res) => {
  res.json({
    rules: TRADING_RULES,
    tradingPaused: isTradingPaused(),
  });
});

// POST /api/config/pause — kill switch: pause all trading
configRouter.post('/pause', async (req, res) => {
  try {
    await pauseTrading();
    res.json({ success: true, tradingPaused: true, message: 'Trading paused' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/config/resume — resume trading
configRouter.post('/resume', async (req, res) => {
  try {
    await resumeTrading();
    res.json({ success: true, tradingPaused: false, message: 'Trading resumed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
