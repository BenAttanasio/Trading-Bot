# AI Trader

An autonomous, self-reflecting trading bot. It researches a watchlist with Claude, trades an Alpaca paper (or live) account, records a falsifiable prediction for every decision, scores those predictions when they come due, writes itself a nightly post-mortem and a weekly deep review, maintains its own playbook, and, when the playbook cannot express a fix, files a change request and implements it with Claude Code on the box it runs on.

It ships with a dashboard and a compact `/api/summary` other dashboards can read.

> **Disclaimer:** This software can place real trades with real money. It is provided as-is for educational purposes and is **not financial advice**. You supply your own API keys via a local `.env` (never committed). Use paper trading first, and run live at your own risk.

## How it works

| Workflow | When (ET) | What it does |
|---|---|---|
| **Morning research** | 9:35 Mon–Fri | Opus 5 researches each watchlist symbol; Sonnet 5 decides; top-conviction buys are placed |
| **Intraday pulse** | every 30 min, 4:00–19:59 | Reviews held positions; scouts two unheld watchlist symbols with Haiku 4.5 |
| **Sentinel** | every 60 s during extended hours | Triages news and price spikes; urgency ≥ 7 escalates to immediate research |
| **EOD summary + benchmark** | 16:05 Mon–Fri | Daily summary; records equity next to SPY's close |
| **Nightly reflection** | 19:00 Mon–Fri | Scores due predictions, judges closed trades (thesis right / wrong / right for the wrong reason / timing), appends lessons to the playbook |
| **Weekly deep review** | Sunday 10:00 | Opus 5 with web search rewrites the playbook, tunes parameters (within hard bounds), files code change requests |
| **Self-improve** | Sunday 11:30 + weekday evenings | Implements change requests with Claude Code in a git worktree, verifies, auto-merges/deploys or waits for approval |

Every decision, including HOLD and PASS, is logged with the AI's reasoning, conviction, and a market snapshot. Every BUY and PASS also records a prediction (direction, expected move, horizon, invalidation, confidence) that is scored later, so the bot's calibration is measured, not assumed.

### Safety model

- **Hard limits** (`src/config/hard-limits.ts`) are absolute ceilings enforced in code: max daily loss, max position as % of equity, max trades/day, minimum cooldowns. Neither the playbook nor the self-improvement agent can loosen them.
- **Live gate**: a non-paper Alpaca URL refuses to start unless `LIVE_TRADING=I_UNDERSTAND`.
- **Kill switch** persists across restarts (`bot_state`), as do AI usage counters and the playbook.
- **Risk manager**: 11 pre-trade checks (size, hard % of equity, cooldowns, exposure, daily loss breaker, concentration, oscillation, flip-flop); fails closed.
- **Self-modification gate**: in paper mode only allowlisted paths (strategy, prompts, indicators, dashboard, tests) auto-merge; risk/execution/env/hard-limits/deploy changes wait for a human tap. Once live, every code change waits.
- **Budget**: daily token budget (cache reads counted at 10%), per-change dollar cap for the coding agent.

## Stack

Node 20+, TypeScript, Express, MongoDB, Alpaca (raw REST), Anthropic SDK (structured outputs, adaptive thinking, prompt caching, server-side web search). Dashboard: Vite + React + Tailwind 4. Tests: vitest.

## Quick start (local)

```bash
npm install
cd dashboard && npm install && cd ..
cp .env.example .env      # fill in Alpaca, Anthropic, MongoDB
npm run seed              # default watchlist
npm run dev               # bot + API on :3001 (serves dashboard/dist if built)
cd dashboard && npm run dev   # dashboard dev server on :5173 (proxies /api)
```

`npm test`, `npm run typecheck`, `npm run build`, `npm run build:dashboard`.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness, mode |
| `GET /api/summary` | compact snapshot for external dashboards |
| `GET /api/dashboard` | everything the bundled dashboard needs |
| `GET /api/learning/progress` | equity vs SPY, calibration, recent predictions |
| `GET /api/learning/reflections` | nightly and weekly reflections |
| `GET /api/learning/playbook` | current playbook, tuned params, version history |
| `GET /api/learning/change-requests` | self-modification queue |
| `POST /api/config/pause` / `resume` | kill switch |
| `POST /api/admin/jobs/:name` | run a job now (`morning`, `pulse`, `eod`, `score-predictions`, `nightly-reflection`, `weekly-review`, `self-improve`) |
| `POST /api/admin/change-requests` (+ `/:id/approve`, `/:id/reject`) | file / approve / reject change requests |

Admin routes accept requests from the box itself or a private LAN address; from anywhere else they need the `x-admin-token` header matching `ADMIN_TOKEN`.

## Deploying to the Raspberry Pi

The bot runs as a **systemd user unit** (`trading-bot`) on port 3001 and serves its own dashboard, so there is one process and one bookmark: `http://raspberrypi.local:3001`.

Layout on the Pi:

```
~/trading-bot/releases/<sha>/   built app (dist/, dashboard/dist/, node_modules, playbook/)
~/trading-bot/current -> releases/<sha>
~/trading-bot/shared/.env       secrets (chmod 600)
~/trading-bot/shared/logs/      winston logs + release build logs
~/trading-bot/shared/playbook/  mirror of the live playbook
~/trading-bot/repo/             git checkout used by the self-improvement pipeline
```

From Windows:

```powershell
./deploy/deploy.ps1 -FirstDeploy   # first time: copies .env, installs + enables the unit, ships a release
./deploy/deploy.ps1                # afterwards: build, ship, activate, health-check (auto-rollback on failure)
./deploy/deploy.ps1 -SkipDashboard # backend only
```

`deploy/remote-install.sh` (on the Pi) extracts the release, runs `npm ci --omit=dev`, flips `current`, restarts the unit, health-checks, and rolls back to the previous release if the check fails. `deploy/pi-build-release.sh` is the same flow started from a git commit on the Pi; the self-improvement pipeline launches it detached via `systemd-run` because the deploy restarts the bot itself.

Useful:

```bash
ssh pi@raspberrypi.local 'systemctl --user status trading-bot'
ssh pi@raspberrypi.local 'journalctl --user -u trading-bot -f'
ssh pi@raspberrypi.local 'curl -s localhost:3001/api/summary'
```

MongoDB runs on the Pi in Docker (`mongo:7`, bound to the LAN with auth). Any MongoDB works; set `MONGODB_URI`.

### Self-improvement prerequisites on the Pi

`git`, `gh` (optional — for pushing branches and opening PRs), and `@anthropic-ai/claude-code` installed globally; a checkout at `SELF_IMPROVE_REPO_DIR`; `ANTHROPIC_API_KEY` in `shared/.env`. Set `SELF_IMPROVE_BASE_BRANCH` to the branch the bot should build on.

## Unified Dashboard integration

The bot exposes `GET /api/summary`. A separate kiosk dashboard can poll it every minute and render a Trading view without sharing any code; only the base URL is configured on that side.

## Configuration

See `.env.example` for every variable. The env values are defaults; the playbook may tighten the tunable ones at runtime (bounded by `TUNABLE_BOUNDS`), and the dashboard's Learning → Playbook tab shows the current effective values.

## License

MIT — see [LICENSE](LICENSE).
