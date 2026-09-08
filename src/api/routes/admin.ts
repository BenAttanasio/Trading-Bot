import { Router, Request } from 'express';
import { env } from '../../config/env';
import { runMorningCycle, runIntradayPulse } from '../../engine/orchestrator';
import { eodSummaryJob } from '../../services/scheduler/jobs/eod-summary';
import { runNightlyReflection, runWeeklyReview } from '../../engine/reflection';
import { scoreDuePredictions } from '../../engine/predictions';
import { runSelfImprove, approveChangeRequest, rejectChangeRequest } from '../../engine/self-improve';
import { runStopGuard } from '../../engine/stop-guard';
import { insertChangeRequest } from '../../services/db/learning-queries';
import { ChangeRequest } from '../../services/db/models/reflection';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('Admin');

export const adminRouter = Router();

const JOBS: Record<string, () => Promise<unknown>> = {
  morning: runMorningCycle,
  pulse: runIntradayPulse,
  eod: eodSummaryJob,
  'score-predictions': () => scoreDuePredictions(),
  'nightly-reflection': runNightlyReflection,
  'weekly-review': runWeeklyReview,
  'self-improve': runSelfImprove,
  'stop-guard': runStopGuard,
};

/** Loopback or RFC1918 private ranges (home LAN). Anything else needs ADMIN_TOKEN. */
function isPrivateAddress(req: Request): boolean {
  const raw = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (raw === '127.0.0.1' || raw === '::1') return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(raw);
}

function authorized(req: Request): boolean {
  if (env.ADMIN_TOKEN && req.header('x-admin-token') === env.ADMIN_TOKEN) return true;
  return isPrivateAddress(req);
}

adminRouter.use((req, res, next) => {
  if (req.method === 'GET' || authorized(req)) return next();
  return res.status(403).json({ error: 'forbidden' });
});

adminRouter.get('/jobs', (req, res) => {
  res.json({ jobs: Object.keys(JOBS) });
});

// POST /api/admin/jobs/:name — fire a job now (runs in the background)
adminRouter.post('/jobs/:name', (req, res) => {
  const job = JOBS[req.params.name];
  if (!job) return res.status(404).json({ error: `unknown job; try one of ${Object.keys(JOBS).join(', ')}` });
  log.warn(`Manual job trigger: ${req.params.name}`, { from: req.ip });
  job().catch((err) => log.error(`Manual job ${req.params.name} failed`, { err }));
  return res.json({ started: true, job: req.params.name });
});

// POST /api/admin/change-requests — file a change request by hand
adminRouter.post('/change-requests', async (req, res) => {
  const { title, description, rationale, priority, suggestedFiles } = req.body ?? {};
  if (!title || !description) return res.status(400).json({ error: 'title and description are required' });
  const cr: ChangeRequest = {
    title: String(title).slice(0, 120),
    description: String(description).slice(0, 4000),
    rationale: String(rationale ?? 'manual request').slice(0, 2000),
    suggestedFiles: Array.isArray(suggestedFiles) ? suggestedFiles.map(String).slice(0, 20) : [],
    priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
    status: 'proposed',
    source: 'manual',
    reflectionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    notes: [],
  };
  const id = await insertChangeRequest(cr);
  return res.json({ id: String(id), status: 'proposed' });
});

adminRouter.post('/change-requests/:id/approve', async (req, res) => {
  log.warn(`Change request approve: ${req.params.id}`, { from: req.ip });
  const result = await approveChangeRequest(req.params.id);
  return res.status(result.ok ? 200 : 400).json(result);
});

adminRouter.post('/change-requests/:id/reject', async (req, res) => {
  log.warn(`Change request reject: ${req.params.id}`, { from: req.ip });
  const result = await rejectChangeRequest(req.params.id, req.body?.reason);
  return res.status(result.ok ? 200 : 400).json(result);
});
