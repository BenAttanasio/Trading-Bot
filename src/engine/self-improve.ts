import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import { env } from '../config/env';
import { ChangeRequest } from '../services/db/models/reflection';
import { getChangeRequests, updateChangeRequest, getChangeRequestById } from '../services/db/learning-queries';
import { notify } from '../services/notify';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('SelfImprove');

/**
 * Self-modification pipeline.
 *
 *   change_request (proposed) → git worktree → `claude -p` implements it →
 *   typecheck + test + build → path gate → merge + deploy (paper, allowlisted)
 *   or hold for a human tap (anything gated, or any change once live).
 *
 * The repo checkout lives at SELF_IMPROVE_REPO_DIR on the Pi. GitHub is optional:
 * if `gh` is authenticated and `origin` exists the branch is pushed and a PR is
 * opened, otherwise the branch just lives in the Pi clone.
 */

// ─── Path gate (pure, tested) ────────────────────────────

const ALLOWLIST: RegExp[] = [
  /^src\/engine\/(scout|portfolio-manager|predictions|benchmark)\.ts$/,
  /^src\/services\/ai\/prompts\/.+\.ts$/,
  /^src\/services\/ai\/schemas\.ts$/,
  /^src\/services\/alpaca\/(market-data|gather-data|news)\.ts$/,
  /^playbook\/.+/,
  /^dashboard\/src\/.+/,
  /^tests\/.+/,
  /^(CLAUDE|README)\.md$/,
];

export function classifyPaths(files: string[]): { allowlisted: string[]; gated: string[] } {
  const allowlisted: string[] = [];
  const gated: string[] = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, '/').trim();
    if (!norm) continue;
    (ALLOWLIST.some((re) => re.test(norm)) ? allowlisted : gated).push(norm);
  }
  return { allowlisted, gated };
}

/** Human approval is required for any gated path, for empty diffs, and for everything once live. */
export function needsApproval(files: string[], isPaper: boolean): { required: boolean; reason: string } {
  if (!isPaper) return { required: true, reason: 'live trading: every code change needs approval' };
  const { gated } = classifyPaths(files);
  if (files.length === 0) return { required: true, reason: 'no files changed' };
  if (gated.length > 0) return { required: true, reason: `touches gated files: ${gated.join(', ')}` };
  return { required: false, reason: 'allowlisted paths only (paper mode)' };
}

// ─── Shell helper ────────────────────────────────────────

interface ShResult {
  code: number;
  stdout: string;
  stderr: string;
}

function sh(cmd: string, args: string[], cwd: string, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<ShResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PATH: `/home/pi/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}`, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const cap = (s: string) => (s.length > 200_000 ? s.slice(-200_000) : s);
    child.stdout.on('data', (d) => (stdout = cap(stdout + d.toString())));
    child.stderr.on('data', (d) => (stderr = cap(stderr + d.toString())));
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          stderr += `\n[timed out after ${opts.timeoutMs}ms]`;
        }, opts.timeoutMs)
      : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

const tail = (s: string, n = 1500) => (s.length > n ? '…' + s.slice(-n) : s);

// ─── The agent prompt ────────────────────────────────────

function buildAgentPrompt(cr: ChangeRequest): string {
  return `You are the AI Trader's own maintenance agent, implementing ONE change request in this repository. Read CLAUDE.md first — it describes the architecture, the invariants, and the self-modification rules (allowlisted paths, required checks, commit format).

CHANGE REQUEST ${cr._id}
Title: ${cr.title}
Priority: ${cr.priority}
What to change: ${cr.description}
Why (evidence from the weekly review): ${cr.rationale}
Suggested files: ${cr.suggestedFiles.join(', ') || '(none suggested — find the right place)'}

Rules:
- Smallest change that satisfies the request. No refactors, no dependency changes, no edits to hard-limits.ts / risk-manager.ts / execution.ts / env.ts unless the request cannot be met otherwise (the pipeline will then hold it for human approval).
- Add or update a vitest test for the behavior you change.
- Run: npm run typecheck && npm test && npm run build (and npm run build:dashboard if you touched dashboard/). Fix what breaks.
- Commit everything with: git add -A && git commit -m "auto: ${cr.title.replace(/"/g, "'")}" -m "Change request ${cr._id}. <one-paragraph rationale>"
- Do not push. Do not touch .env. When done, reply with a 3-5 line summary of what changed and why.`;
}

// ─── Pipeline ────────────────────────────────────────────

let running = false;

function repoDir(): string | null {
  return env.SELF_IMPROVE_REPO_DIR || null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change';
}

async function fail(cr: ChangeRequest, reason: string, extra?: string): Promise<void> {
  log.error(`Change request failed: ${cr.title} — ${reason}`, { extra: extra ? tail(extra, 800) : undefined });
  await updateChangeRequest(cr._id!, { status: 'failed' }, `${reason}${extra ? `\n${tail(extra, 1200)}` : ''}`);
  await notify(`Self-improve failed: ${cr.title}`, reason, 'warn');
}

async function ensureLink(target: string, linkPath: string): Promise<void> {
  if (!fs.existsSync(target) || fs.existsSync(linkPath)) return;
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, 'dir');
}

/** Pick the oldest proposed change request and run the full pipeline on it. */
export async function runSelfImprove(): Promise<void> {
  const repo = repoDir();
  if (!repo) {
    log.info('Self-improve disabled (SELF_IMPROVE_REPO_DIR not set)');
    return;
  }
  if (running) {
    log.warn('Self-improve already running — skipped');
    return;
  }
  running = true;
  const base = env.SELF_IMPROVE_BASE_BRANCH;
  let worktree: string | null = null;
  let cr: ChangeRequest | undefined;

  try {
    const proposed = await getChangeRequests('proposed', 50);
    cr = proposed[proposed.length - 1]; // oldest first
    if (!cr) {
      log.info('No proposed change requests');
      return;
    }
    if (!fs.existsSync(path.join(repo, '.git'))) {
      await fail(cr, `Repo checkout not found at ${repo}`);
      return;
    }

    log.info(`═══ SELF-IMPROVE: ${cr.title} ═══`, { id: String(cr._id), priority: cr.priority });
    await updateChangeRequest(cr._id!, { status: 'in_progress' }, 'Picked up by self-improve');

    // Fresh base
    await sh('git', ['fetch', '--all', '--prune'], repo, { timeoutMs: 120_000 });
    const co = await sh('git', ['checkout', '-q', base], repo);
    if (co.code !== 0) {
      await fail(cr, `Cannot check out base branch ${base}`, co.stderr);
      return;
    }
    await sh('git', ['pull', '--ff-only', '-q'], repo, { timeoutMs: 120_000 });
    const baseSha = (await sh('git', ['rev-parse', '--short', 'HEAD'], repo)).stdout.trim();

    // Worktree on a fresh branch
    const stamp = new Date().toISOString().slice(0, 10);
    let branch = `auto/${stamp}-${slugify(cr.title)}`;
    const exists = await sh('git', ['rev-parse', '--verify', '-q', branch], repo);
    if (exists.code === 0) branch = `${branch}-${Date.now().toString(36)}`;
    worktree = path.join(repo, '.worktrees', slugify(cr.title));
    await sh('git', ['worktree', 'prune'], repo);
    if (fs.existsSync(worktree)) fs.rmSync(worktree, { recursive: true, force: true });
    const wt = await sh('git', ['worktree', 'add', '-b', branch, worktree, base], repo);
    if (wt.code !== 0) {
      await fail(cr, 'git worktree add failed', wt.stderr);
      return;
    }
    // Share installed dependencies with the main checkout (fast; a request that
    // needs a new dependency is gated on package.json anyway).
    await ensureLink(path.join(repo, 'node_modules'), path.join(worktree, 'node_modules'));
    await ensureLink(path.join(repo, 'dashboard', 'node_modules'), path.join(worktree, 'dashboard', 'node_modules'));
    await updateChangeRequest(cr._id!, { branch }, `Worktree ready on ${branch} from ${base}@${baseSha}`);

    // Let Claude Code do the work
    const claudeArgs = [
      '-p', buildAgentPrompt(cr),
      '--output-format', 'json',
      '--permission-mode', 'acceptEdits',
      '--allowedTools',
      'Read', 'Edit', 'Write', 'Grep', 'Glob',
      'Bash(npm run typecheck)', 'Bash(npm test)', 'Bash(npm run build)', 'Bash(npm run build:dashboard)',
      'Bash(git status)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git log:*)',
      '--max-budget-usd', String(env.SELF_IMPROVE_MAX_BUDGET_USD),
      '--no-session-persistence',
    ];
    log.info('Launching claude -p in worktree', { worktree, budgetUsd: env.SELF_IMPROVE_MAX_BUDGET_USD });
    const agent = await sh('claude', claudeArgs, worktree, {
      timeoutMs: 45 * 60_000,
      env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, CI: '1' },
    });
    let agentSummary = '';
    let costUsd: number | null = null;
    try {
      const parsed = JSON.parse(agent.stdout.trim().split('\n').pop() || '{}');
      agentSummary = String(parsed.result ?? '').slice(0, 1500);
      costUsd = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null;
      if (parsed.is_error) log.warn('Agent reported is_error', { summary: agentSummary });
    } catch {
      agentSummary = tail(agent.stdout, 1500);
    }
    await updateChangeRequest(cr._id!, {}, `Agent finished (exit ${agent.code}${costUsd != null ? `, $${costUsd.toFixed(2)}` : ''}): ${agentSummary || tail(agent.stderr, 600)}`);

    // Make sure the work is committed, then diff against base
    const dirty = (await sh('git', ['status', '--porcelain'], worktree)).stdout.trim();
    if (dirty) {
      await sh('git', ['add', '-A'], worktree);
      await sh('git', ['commit', '-q', '-m', `auto: ${cr.title}`, '-m', `Change request ${cr._id} (auto-committed by pipeline)`], worktree);
    }
    const files = (await sh('git', ['diff', '--name-only', `${base}...HEAD`], worktree)).stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (files.length === 0) {
      await fail(cr, 'Agent produced no changes', agentSummary || agent.stderr);
      return;
    }

    // Independent verification (never trust the agent's own report)
    const checks: Array<[string, string[]]> = [
      ['npm', ['run', 'typecheck']],
      ['npm', ['test']],
      ['npm', ['run', 'build']],
    ];
    if (files.some((f) => f.startsWith('dashboard/'))) checks.push(['npm', ['run', 'build:dashboard']]);
    for (const [cmd, args] of checks) {
      const r = await sh(cmd, args, worktree, { timeoutMs: 15 * 60_000 });
      if (r.code !== 0) {
        await fail(cr, `Verification failed: ${cmd} ${args.join(' ')}`, r.stdout + '\n' + r.stderr);
        return;
      }
    }
    const { allowlisted, gated } = classifyPaths(files);
    await updateChangeRequest(cr._id!, {}, `Verified. Changed ${files.length} files (allowlisted ${allowlisted.length}, gated ${gated.length}): ${files.join(', ')}`);

    // Optional PR
    const prUrl = await tryOpenPullRequest(repo, branch, cr, agentSummary);
    if (prUrl) await updateChangeRequest(cr._id!, { prUrl }, `PR opened: ${prUrl}`);

    const approval = needsApproval(files, env.isPaper);
    if (approval.required) {
      await updateChangeRequest(cr._id!, { status: 'awaiting_approval' }, `Held for approval: ${approval.reason}`);
      await notify(
        `Change awaiting approval: ${cr.title}`,
        `${approval.reason}\nBranch: ${branch}${prUrl ? `\nPR: ${prUrl}` : ''}\nApprove from the dashboard (Learning → Changelog) or POST /api/admin/change-requests/${cr._id}/approve`,
        'action'
      );
      return;
    }
    await mergeAndDeploy(cr, branch);
  } catch (error) {
    log.error('Self-improve crashed', { error });
    if (cr?._id) await updateChangeRequest(cr._id, { status: 'failed' }, `Pipeline error: ${String(error)}`);
  } finally {
    if (worktree && repo) {
      await sh('git', ['worktree', 'remove', '--force', worktree], repo);
    }
    running = false;
  }
}

async function tryOpenPullRequest(repo: string, branch: string, cr: ChangeRequest, summary: string): Promise<string | null> {
  const auth = await sh('gh', ['auth', 'status'], repo, { timeoutMs: 30_000 });
  const origin = await sh('git', ['remote', 'get-url', 'origin'], repo);
  if (auth.code !== 0 || origin.code !== 0 || !/github\.com/.test(origin.stdout)) {
    log.info('GitHub not configured on this box — branch stays local', { ghAuth: auth.code === 0, origin: origin.stdout.trim() || 'none' });
    return null;
  }
  const push = await sh('git', ['push', '-u', 'origin', branch], repo, { timeoutMs: 120_000 });
  if (push.code !== 0) {
    log.warn('git push failed', { stderr: tail(push.stderr, 400) });
    return null;
  }
  const body = `Filed by the weekly review.\n\n**Why:** ${cr.rationale}\n\n**What:** ${cr.description}\n\n**Agent summary:**\n${summary}\n\nChange request \`${cr._id}\`\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
  const pr = await sh('gh', ['pr', 'create', '--base', env.SELF_IMPROVE_BASE_BRANCH, '--head', branch, '--title', `auto: ${cr.title}`, '--body', body], repo, { timeoutMs: 60_000 });
  if (pr.code !== 0) {
    log.warn('gh pr create failed', { stderr: tail(pr.stderr, 400) });
    return null;
  }
  return pr.stdout.trim().split('\n').pop() || null;
}

/** Merge the branch into the base branch and kick off a detached Pi-side release build. */
async function mergeAndDeploy(cr: ChangeRequest, branch: string): Promise<void> {
  const repo = repoDir()!;
  const base = env.SELF_IMPROVE_BASE_BRANCH;
  await sh('git', ['checkout', '-q', base], repo);
  const merge = await sh('git', ['merge', '--no-ff', '-q', branch, '-m', `Merge ${branch}: ${cr.title}`], repo);
  if (merge.code !== 0) {
    await sh('git', ['merge', '--abort'], repo);
    await fail(cr, 'Merge into base failed', merge.stderr);
    return;
  }
  const sha = (await sh('git', ['rev-parse', '--short', 'HEAD'], repo)).stdout.trim();
  await updateChangeRequest(cr._id!, { status: 'merged' }, `Merged into ${base} @ ${sha}`);
  // Push the merged base too if GitHub is set up (best effort).
  await sh('git', ['push', 'origin', base], repo, { timeoutMs: 120_000 });

  if (!env.SELF_IMPROVE_AUTO_DEPLOY) {
    await notify(`Merged (deploy disabled): ${cr.title}`, `${base}@${sha} — run ./deploy/deploy.ps1 to ship it.`, 'info');
    return;
  }

  // The deploy restarts THIS process, so the build must run outside our cgroup.
  const script = path.join(repo, 'deploy', 'pi-build-release.sh');
  await updateChangeRequest(cr._id!, { status: 'deploying' }, `Building release ${sha} via systemd-run`);
  const unit = `trading-bot-deploy-${sha}`;
  const run = await sh('systemd-run', ['--user', '--unit', unit, '--collect', 'bash', script, repo, sha], repo, { timeoutMs: 30_000 });
  if (run.code !== 0) {
    await fail(cr, 'Could not launch detached deploy', run.stderr);
    return;
  }
  await notify(`Deploying self-made change: ${cr.title}`, `${base}@${sha} is building on the Pi (unit ${unit}). Status reconciles after restart.`, 'info');
}

/** Called at boot: settle change requests left in `deploying` by the restart their own deploy caused. */
export async function reconcileDeployments(): Promise<void> {
  try {
    const deploying = await getChangeRequests('deploying', 20);
    if (deploying.length === 0) return;
    const releaseFile = env.RELEASE_FILE;
    const live = releaseFile && fs.existsSync(releaseFile) ? fs.readFileSync(releaseFile, 'utf8').trim() : '';
    for (const cr of deploying) {
      const note = (cr.notes ?? []).slice().reverse().find((n) => n.includes('Building release'));
      const sha = note?.match(/release ([0-9a-f]+)/)?.[1];
      if (sha && live.startsWith(sha)) {
        await updateChangeRequest(cr._id!, { status: 'deployed' }, `Live as release ${live}`);
        await notify(`Deployed: ${cr.title}`, `Release ${live} is live on the Pi.`, 'info');
      } else if (Date.now() - new Date(cr.updatedAt).getTime() > 45 * 60_000) {
        await updateChangeRequest(cr._id!, { status: 'failed' }, `Deploy did not become live (current release: ${live || 'unknown'})`);
        await notify(`Deploy failed: ${cr.title}`, `Expected ${sha ?? '?'}, current release ${live || 'unknown'} — remote-install rolled back.`, 'warn');
      }
    }
  } catch (error) {
    log.warn('reconcileDeployments failed', { error });
  }
}

export async function approveChangeRequest(id: string): Promise<{ ok: boolean; message: string }> {
  if (!ObjectId.isValid(id)) return { ok: false, message: 'invalid id' };
  const cr = await getChangeRequestById(new ObjectId(id));
  if (!cr) return { ok: false, message: 'not found' };
  if (cr.status !== 'awaiting_approval' || !cr.branch) return { ok: false, message: `cannot approve from status ${cr.status}` };
  if (running) return { ok: false, message: 'pipeline busy — try again shortly' };
  running = true;
  try {
    await updateChangeRequest(cr._id!, {}, 'Approved by human');
    await mergeAndDeploy(cr, cr.branch);
    return { ok: true, message: 'merging and deploying' };
  } finally {
    running = false;
  }
}

export async function rejectChangeRequest(id: string, reason = 'rejected by human'): Promise<{ ok: boolean; message: string }> {
  if (!ObjectId.isValid(id)) return { ok: false, message: 'invalid id' };
  const cr = await getChangeRequestById(new ObjectId(id));
  if (!cr) return { ok: false, message: 'not found' };
  if (!['proposed', 'awaiting_approval', 'failed'].includes(cr.status)) return { ok: false, message: `cannot reject from status ${cr.status}` };
  await updateChangeRequest(cr._id!, { status: 'rejected' }, reason);
  return { ok: true, message: 'rejected' };
}
