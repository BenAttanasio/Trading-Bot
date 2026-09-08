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
  scout.ts                  universe → ONE ranking call (rankUniverse) → per-name decision → sizing → executeTrade → recordPrediction
  sizing.ts                 pure: resolveStop / resolveTarget / sizePosition (risk ÷ stop distance, calibration multiplier)
  stop-guard.ts             pure evaluateGuard/tightenStop + runStopGuard: code-enforced stop/target/time/trailing exits
  exits.ts                  closePosition: the one side-aware way to close/trim + write a trade_outcome
  portfolio-manager.ts      AI position reviews (may only tighten stops), trailing-stop activation
  execution.ts              kill switch (persisted), intents (open/close × long/short), risk gate, order submit
  risk-manager.ts           pre-trade checks incl. HARD_LIMITS, intent-aware (exits never blocked on size); fails closed
  predictions.ts            prediction ledger: dueDateFor / scoreDirection / calibration
  stats.ts                  pure: expectancy, profit factor, Sharpe, drawdown, AI cost vs equity
  reflection.ts             nightly post-mortem + weekly review; params/change requests gated on MIN_SCORED_FOR_TUNING
  benchmark.ts              equity vs SPY
  self-improve.ts           change_request → worktree → claude -p → tests → merge/deploy or await approval
src/services/
  ai/client.ts              callAIStructured / callAIText; model tiers from env (Opus opt-in); caching; token budget; $ cost
  ai/pricing.ts             list prices per model → estimateCostUsd
  ai/schemas.ts             Zod schemas for every structured output (+ normalizers that clamp)
  ai/prompts/*              prompts; ranking.ts is the morning call; system prompts are functions so tuned rules stay current
  playbook.ts               strategy.md + params (Mongo source of truth, mirrored to disk)
  alpaca/*                  REST client, market data (ATR, multi-symbol bars), news, trading, screener, market-context
scripts/replay.ts           offline replay of the ranking prompt over past days; scores calls vs baseline
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
- Every entry carries `stopPrice`, `targetPrice`, `timeStopAt` on its position
  record; the stop guard enforces them without a model. Reviews may only
  tighten a stop (`tightenStop`). Exits go through `exits.ts` so a
  `trade_outcome` is always written.
- Opening intents (`open_long`/`open_short`) get the full risk gate; closing
  intents are never blocked on size. Shorts need `ENABLE_SHORTS=1`, whole
  shares, and easy-to-borrow.
- Model ids come from env; do not hard-code `claude-opus-*` anywhere.

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
