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
configRouter.post('/pause', (req, res) => {
  pauseTrading();
  res.json({ success: true, tradingPaused: true, message: 'Trading paused' });
});

// POST /api/config/resume — resume trading
configRouter.post('/resume', (req, res) => {
  resumeTrading();
  res.json({ success: true, tradingPaused: false, message: 'Trading resumed' });
});
