import express from 'express';
import cors from 'cors';
import { env } from '../config/env';
import { portfolioRouter } from './routes/portfolio';
import { tradesRouter } from './routes/trades';
import { researchRouter } from './routes/research';
import { alertsRouter } from './routes/alerts';
import { configRouter } from './routes/config';
import { watchlistRouter } from './routes/watchlist';
import { dashboardRouter } from './routes/dashboard';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('API');

export function createServer(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Routes
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/trades', tradesRouter);
  app.use('/api/research', researchRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/dashboard', dashboardRouter);

  return app;
}

export function startServer(): void {
  const app = createServer();

  app.listen(env.PORT, () => {
    log.info(`API server running on port ${env.PORT}`);
  });
}
