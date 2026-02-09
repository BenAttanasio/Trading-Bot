import { Router } from 'express';
import { getRecentAlerts } from '../../services/db/queries';

export const alertsRouter = Router();

// GET /api/alerts — recent sentinel alerts
alertsRouter.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const alerts = await getRecentAlerts(limit);
    res.json({ alerts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
