import { Router } from 'express';
import { getRecentResearch, getResearchForSymbol } from '../../services/db/queries';

export const researchRouter = Router();

// GET /api/research — recent research reports
researchRouter.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const research = await getRecentResearch(limit);
    res.json({ research });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/research/:symbol — research for specific stock
researchRouter.get('/:symbol', async (req, res) => {
  try {
    const research = await getResearchForSymbol(req.params.symbol.toUpperCase());
    res.json({ research });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
