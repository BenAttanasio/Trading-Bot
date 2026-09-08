import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
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
import { summaryRouter } from './routes/summary';
import { learningRouter } from './routes/learning';
import { adminRouter } from './routes/admin';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('API');

/** Where the built React dashboard lives. Overridable so releases can point at their own copy. */
export function resolveDashboardDist(): string | null {
  const candidate = env.DASHBOARD_DIST || path.resolve(__dirname, '../../dashboard/dist');
  return fs.existsSync(path.join(candidate, 'index.html')) ? candidate : null;
}

export function createServer(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      mode: env.isPaper ? 'paper' : 'live',
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
  app.use('/api/summary', summaryRouter);
  app.use('/api/learning', learningRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
  });

  // Static dashboard (single-process deploy). Anything that isn't /api falls back to index.html.
  const dist = resolveDashboardDist();
  if (dist) {
    app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
    log.info(`Serving dashboard from ${dist}`);
  } else {
    log.warn('No built dashboard found — API only. Run `npm run build` in dashboard/ or set DASHBOARD_DIST.');
  }

  return app;
}

export function startServer(): void {
  const app = createServer();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    log.info(`API + dashboard listening on http://0.0.0.0:${env.PORT}`);
  });

  // Fail loudly: a silently shifted port is how the dashboard used to 502.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Port ${env.PORT} is already in use — refusing to start on a different port. Stop the other process or change PORT.`);
    } else {
      log.error('HTTP server error', { error: err.message });
    }
    process.exit(1);
  });
}
