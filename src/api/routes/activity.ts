import { Router } from 'express';
import { activityLog, ActivityEvent } from '../../services/activity-log';

export const activityRouter = Router();

// GET /api/activity — recent log entries (REST fallback)
activityRouter.get('/', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(activityLog.getRecent(limit));
});

// GET /api/activity/stream — SSE endpoint for real-time log streaming
activityRouter.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send recent history as initial burst
  const recent = activityLog.getRecent(30);
  for (const event of recent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Stream new events
  const handler = (event: ActivityEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  activityLog.on('event', handler);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    activityLog.off('event', handler);
    clearInterval(heartbeat);
  });
});
