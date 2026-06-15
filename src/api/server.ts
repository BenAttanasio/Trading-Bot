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
import { activityRouter } from './routes/activity';
import { outcomesRouter } from './routes/outcomes';
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
  app.use('/api/activity', activityRouter);
  app.use('/api/outcomes', outcomesRouter);

  return app;
}

export function startServer(maxRetries = 10): void {
  const app = createServer();
  let port = env.PORT;
  let attempt = 0;

  function tryListen(): void {
    const server = app.listen(port, () => {
      log.info(`API server running on port ${port}`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attempt < maxRetries) {
        attempt++;
        port++;
        log.info(`Port ${port - 1} in use, trying port ${port}...`);
        tryListen();
      } else {
        throw err;
      }
    });
  }

  tryListen();
}
