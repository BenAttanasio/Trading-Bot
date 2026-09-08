# AI Trader — agent guide

This repo is an autonomous, self-reflecting paper/live trading bot (TypeScript,
Node 20+, Express, MongoDB, Alpaca, Anthropic SDK) plus a React dashboard. It
runs on a Raspberry Pi 5 as the `trading-bot` systemd user unit on port 3001.

> ⚠️ **THIS REPO IS PUBLIC.** Never commit secrets, account ids, or `.env`.
> Strategy specifics live in the playbook (Mongo + `playbook/`), never in prompts
> hard-coded with account data.

## Who edits this repo

1. Ben, via Claude Code on Windows.
2. **The bot itself** (`src/engine/self-improve.ts`), which runs Claude Code
   headless on the Pi in a git worktree to implement a `change_request` filed by
   the weekly review. If you are that agent, read the rules under
   "Self-modification rules" and keep changes minimal and tested.

## Architecture

```
src/index.ts                boot: env → Mongo → bot_state/playbook → Alpaca → scheduler → HTTP
src/config/
  env.ts                    all env vars; LIVE_TRADING gate (non-paper URL refuses to start without it)
  hard-limits.ts            ABSOLUTE ceilings + TUNABLE_BOUNDS. Never loosened by playbook or agent.
  trading-rules.ts          live rules: env defaults + playbook-tuned params (clamped)
src/engine/
  orchestrator.ts           dispatch: morning cycle, intraday pulse, sentinel escalation
  scout.ts                  research → trade decision → executeTrade → recordPrediction (BUY and PASS)
  portfolio-manager.ts      position reviews, trailing stops, trade outcomes
  execution.ts              kill switch (persisted), risk gate, order submit, decision log
  risk-manager.ts           11 pre-trade checks incl. HARD_LIMITS; fails closed
  predictions.ts            prediction ledger: dueDateFor / scoreDirection / calibration
  reflection.ts             nightly post-mortem (Sonnet 5) + weekly deep review (Opus 5 + web search)
  benchmark.ts              equity vs SPY
  self-improve.ts           change_request → worktree → claude -p → tests → merge/deploy or await approval
src/services/
  ai/client.ts              callAIStructured / callAIText; model tiers; prompt caching; token budget
  ai/schemas.ts             Zod schemas for every structured output (+ normalizers that clamp)
  ai/prompts/*              prompts; system prompts are functions so tuned rules stay current
  playbook.ts               strategy.md + params (Mongo source of truth, mirrored to disk)
  alpaca/*                  REST client, market data, news, trading
  db/*                      Mongo connection, models, queries, learning-queries, bot-state
  scheduler/*               node-cron jobs + sentinel loop
src/api/                    Express routes; also serves dashboard/dist
dashboard/                  Vite + React; tokens shared with the Unified Dashboard
playbook/                   seed only — runtime playbook lives in Mongo
deploy/                     systemd unit, deploy.ps1 (Windows → Pi), remote-install.sh (Pi)
tests/                      vitest (`npm test`)
```

Data flow: scheduler → engine → Alpaca/Anthropic → Mongo. The dashboard and the
Unified Dashboard's Trading view read `/api/*` only.

## Invariants (do not break)

- `HARD_LIMITS` are enforced in code (`risk-manager.ts`, `hard-limits.ts`) and
  are never referenced as "guidance" — they are ceilings.
- Every AI call goes through `callAIStructured`/`callAIText` with a Zod schema
  from `schemas.ts`. No raw JSON parsing, no `temperature`, model ids only from
  `MODEL_IDS`.
- Every BUY/PASS decision records a prediction. Every closed position records a
  `trade_outcome`. The reflection layer depends on both.
- `tradingPaused`, AI usage, starting equity, and the playbook persist in
  `bot_state`; a restart must never silently resume or reset them.
- The playbook may tune only `TUNABLE_BOUNDS` keys, always clamped.
- Stable prompt text goes in `systemPrompt`/`cachedBlocks`; anything per-call
  goes in `userPrompt`/`contextBlocks` (prompt caching depends on it).

## Self-modification rules (for the headless agent)

- You are implementing ONE change request. Read it, find the smallest change
  that satisfies it, and stop. No drive-by refactors, no dependency upgrades.
- Allowed paths without human approval (paper mode):
  `src/engine/scout.ts`, `src/engine/portfolio-manager.ts`, `src/engine/predictions.ts`,
  `src/engine/benchmark.ts`, `src/services/ai/prompts/**`, `src/services/ai/schemas.ts`,
  `src/services/alpaca/market-data.ts`, `src/services/alpaca/gather-data.ts`,
  `src/services/alpaca/news.ts`, `playbook/**`, `dashboard/src/**`, `tests/**`, `CLAUDE.md`, `README.md`.
- Anything else — especially `hard-limits.ts`, `risk-manager.ts`, `execution.ts`,
  `env.ts`, `self-improve.ts`, `deploy/**`, `package.json` — requires a human tap.
  You may still edit those files if the request truly needs it; the pipeline
  will hold the branch for approval instead of auto-merging.
- Must pass before you finish: `npm run typecheck`, `npm test`, `npm run build`
  (and `cd dashboard && npm run build` if you touched `dashboard/`).
- Add or update a test for behavior you change. Keep functions pure where the
  existing code does (`predictions.ts`, `benchmark.ts`, `schemas.ts` normalizers).
- Commit message: `auto: <title>` followed by a short rationale and the change
  request id. Do not push; the pipeline handles branches, PRs, and deploys.

## Local commands

```
npm run dev            # bot with reload (needs .env)
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build          # → dist/
cd dashboard && npm run dev | npm run build
./deploy/deploy.ps1    # Windows → Pi release (see deploy/)
```

## Verification habits

After deploying, always check from the outside: `systemctl --user is-active trading-bot`,
`curl localhost:3001/api/health`, `/api/summary`, `/api/learning/playbook`, and
`journalctl --user -u trading-bot -n 50`. Never ask the user to test by hand.
