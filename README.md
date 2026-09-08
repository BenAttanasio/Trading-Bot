# AI Trader

An autonomous, self-reflecting trading bot. It researches a watchlist with Claude, trades an Alpaca paper (or live) account, records a falsifiable prediction for every decision, scores those predictions when they come due, writes itself a nightly post-mortem and a weekly deep review, maintains its own playbook, and, when the playbook cannot express a fix, files a change request and implements it with Claude Code on the box it runs on.

It ships with a dashboard and a compact `/api/summary` other dashboards can read.

> **Disclaimer:** This software can place real trades with real money. It is provided as-is for educational purposes and is **not financial advice**. You supply your own API keys via a local `.env` (never committed). Use paper trading first, and run live at your own risk.

## How it works

| Workflow | When (ET) | What it does |
|---|---|---|
| **Morning ranking** | 9:35 Mon–Fri | Builds the universe (watchlist + Alpaca movers/most-actives screener, liquidity-filtered), gathers bars/news/ATR and recent **SEC filings** (8-K item codes, 10-Q/K, 13D, offerings) for every name plus SPY/QQQ/sector-ETF context, and asks Sonnet 5 for **one cross-sectional ranking**. The top longs (and shorts, if enabled) get a per-name decision, a volatility-scaled size, and code-enforced stop/target/time-stop |
| **Stop guard** | every 60 s during extended hours | No model in the loop: closes any position that crosses its stop or target, breaks its trailing floor, or outlives its horizon |
| **Intraday pulse** | every 30 min, 4:00–19:59 | Reviews held positions (reviews may only *tighten* stops); scouts only names the sentinel queued since the last pulse, with Haiku 4.5 |
| **Sentinel** | every 60 s during extended hours | Triages news and price spikes; urgency ≥ 7 escalates to immediate research, 4–6 is queued for the pulse |
| **EOD summary + benchmark** | 16:05 Mon–Fri | Daily summary; records equity next to SPY's close |
| **Nightly reflection** | 19:00 Mon–Fri | Scores due predictions, judges closed trades (thesis right / wrong / right for the wrong reason / timing), appends lessons to the playbook |
| **Weekly deep review** | Sunday 10:00 | Sonnet 5 (deep tier) with web search rewrites the playbook. Parameter changes and code change requests are applied only once `MIN_SCORED_FOR_TUNING` predictions have been scored — before that they are recorded as proposals |
| **Self-improve** | Sunday 11:30 + weekday evenings | Implements change requests with Claude Code in a git worktree, verifies, auto-merges/deploys or waits for approval |

Every decision, including HOLD and PASS, is logged with the AI's reasoning, conviction, and a market snapshot. Every BUY and PASS also records a prediction (direction, expected move, horizon, invalidation, confidence) that is scored later, so the bot's calibration is measured, not assumed.

### Models and cost

Model per tier comes from env (`AI_BUDGET_MODEL`, `AI_FAST_MODEL`, `AI_DEEP_MODEL`). The defaults use **Haiku 4.5** for triage and **Sonnet 5** for everything else, including the "deep" tier (same model, higher effort). Opus is opt-in. Every response's usage is priced at list and accumulated per day; the Learning → Edge tab shows AI cost per day and annualized as a percentage of equity, which has to stay far below any plausible edge.

### Sizing and exits

Position size is `equity × RISK_PER_TRADE_PERCENT × calibration multiplier ÷ stop distance`, capped by `MAX_POSITION_SIZE_DOLLARS` and the hard 25%-of-equity ceiling. The stop is the decision's invalidation price when it is sane, otherwise `atrStopMultiple × ATR(14)`. The calibration multiplier is 1 until `MIN_SCORED_FOR_TUNING` predictions are scored, then scales with the measured hit rate (bounded 0.25–1.5). Stops, targets and time stops are stored on the position and enforced in code by the stop guard; an AI review may tighten a stop but never loosen it. Shorts are off by default (`ENABLE_SHORTS=0`); when on, they require whole shares and easy-to-borrow names.

### Replay (offline evidence before capital)

```bash
npm run replay -- --from 2026-06-01 --to 2026-08-29            # Haiku, seed watchlist, top 5
npm run replay -- --from 2026-07-01 --to 2026-08-29 --model fast --top 5 --shorts
npm run replay -- --from 2026-07-01 --to 2026-08-29 --dry       # baseline only, no AI spend
```

The replay runs the **same** ranking prompt over past trading days using only bars and news that existed before each open, scores every side call at its horizon, and prints hit rate vs the always-up baseline, Brier, calibration buckets, hit rate by |score|, and a top-k long basket vs SPY. Reports land in `replay-results/` (git-ignored). Until the replay beats the baseline over a few hundred calls, treat live paper results as noise.

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
| `GET /api/learning/stats` | expectancy, profit factor, Sharpe, max drawdown, AI cost vs equity, tuning gate |
| `GET /api/learning/ranking` | the latest morning ranking snapshot |
| `GET /api/learning/reflections` | nightly and weekly reflections |
| `GET /api/learning/playbook` | current playbook, tuned params, version history |
| `GET /api/learning/change-requests` | self-modification queue |
| `POST /api/config/pause` / `resume` | kill switch |
| `POST /api/admin/jobs/:name` | run a job now (`morning`, `pulse`, `eod`, `stop-guard`, `score-predictions`, `nightly-reflection`, `weekly-review`, `self-improve`) |
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
