# AI Trader

Autonomous AI-powered stock trading bot with a real-time dashboard. Researches your watchlist using Claude (Opus/Sonnet/Haiku), manages an Alpaca paper or live portfolio, and streams live decisions to a React dashboard.

## How It Works

The bot runs several overlapping workflows:

| Workflow | When | What it does |
|----------|------|-------------|
| **Morning Research** | 9:35 AM ET | Researches all watchlist stocks with Claude Opus, buys top 3 conviction plays |
| **Intraday Pulse** | Every 30 min, 4 AM–8 PM ET | Reviews all held positions, scouts 2 unwatched symbols with Haiku |
| **Sentinel** | Every 60s, always-on | Watches news and price spikes; escalates urgency ≥ 7 or moves ≥ 5% to immediate deep research |
| **EOD Summary** | 4:05 PM ET | Generates a daily summary of trades, P&L, and portfolio state |

Every decision — including HOLDs — is logged to `decision_log` in MongoDB with the AI reasoning, conviction score, and market snapshot.

### Robustness Guardrails

The bot is designed to run 24/7 without supervision. Key protections:

- **Position review cooldown** (default 90 min) — the AI only re-evaluates a held position every 90 minutes, preventing margin-of-error false signals from accumulating across dozens of daily checks
- **Sell cooldown** (default 60 min) — once a symbol is sold, it can't be sold again for 60 minutes, guarding against duplicate executions if jobs overlap
- **Sentinel deduplication** — a per-symbol escalation cooldown (default 30 min) prevents simultaneous news + price-spike events from triggering two concurrent research calls on the same stock
- **Job concurrency guard** — if a pulse or morning cycle is still running when the next cron fires, the new invocation is skipped rather than running in parallel
- **API timeouts** — all Alpaca requests abort after 15 seconds; all AI SDK calls abort after 60 seconds; a hung API cannot block the pipeline indefinitely
- **Daily AI token budget** — configurable cap on Anthropic token usage; budget-sensitive calls (sentinel, intraday pulse) skip silently when the budget is exhausted
- **Risk manager** — 10 pre-trade checks including position size, portfolio exposure, daily loss circuit breaker, cooldown, oscillation detection, and AI flip-flop guard
- **Kill switch** — `pauseTrading()` / `resumeTrading()` halt all execution immediately without stopping the process
- **MongoDB TTL** — `decision_log` (90 days), `alerts` (30 days), `research` (90 days) auto-expire; trades and summaries are kept forever as financial records

---

## Prerequisites

- **[Alpaca](https://alpaca.markets)** account — free paper trading or funded live account
- **[Anthropic](https://console.anthropic.com)** API key — Claude Opus/Sonnet/Haiku
- **[MongoDB](https://www.mongodb.com/atlas)** — free Atlas cluster works fine, or local `mongod`
- **Node.js 20+**

---

## Quick Start (PC / Local)

### 1. Install dependencies

```bash
npm install
cd dashboard && npm install && cd ..
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
# Alpaca
ALPACA_API_KEY=your_key
ALPACA_SECRET_KEY=your_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets   # or live: https://api.alpaca.markets
ALPACA_DATA_URL=https://data.alpaca.markets

# Anthropic
ANTHROPIC_API_KEY=your_key

# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
MONGODB_DB_NAME=trading_bot

# Optional tuning (shown with defaults)
MAX_POSITION_SIZE_DOLLARS=50
MAX_PORTFOLIO_EXPOSURE=500
MAX_DAILY_TRADES=10
MAX_DAILY_LOSS_PERCENT=3
COOLDOWN_MINUTES=120
REVENGE_TRADE_COOLDOWN_HOURS=24
SELL_COOLDOWN_MINUTES=60
POSITION_REVIEW_COOLDOWN_MINUTES=90
SENTINEL_ESCALATION_COOLDOWN_MINUTES=30
SENTINEL_POLL_INTERVAL_SECONDS=60
INTRADAY_PULSE_INTERVAL_MINUTES=30
DAILY_AI_TOKEN_BUDGET=200000
ALPACA_API_TIMEOUT_MS=15000
AI_TIMEOUT_MS=60000
```

### 3. Seed watchlist

```bash
npm run seed
```

### 4. Run

Open two terminals:

**Terminal 1 — Backend** (project root):
```bash
npm run dev
```
Wait for `API server running on port 3001`.

**Terminal 2 — Dashboard** (`dashboard/` folder):
```bash
cd dashboard
npm run dev
```

Open **http://localhost:5173**.

---

## Deploying to a Server / Cloud

Build and run the compiled output:

```bash
npm run build          # compiles TypeScript → dist/
npm start              # runs dist/index.js

cd dashboard
npm run build          # builds React → dashboard/dist/
npm run preview        # serves the built dashboard
```

For persistent hosting use [PM2](https://pm2.keymetrics.io):

```bash
npm install -g pm2
pm2 start pm2.config.js
pm2 save
pm2 startup            # enable autostart on reboot
```

The included `pm2.config.js` defines both the backend (`ai-trader`) and dashboard (`ai-trader-dashboard`) processes.

---

## Deploying to a Raspberry Pi (headless kiosk)

These steps work for any Node.js + PM2 project on a Pi. Tested on **Raspberry Pi 5, Raspberry OS (64-bit), Wayland/labwc**.

### Prerequisites on the Pi

```bash
# Node.js 20 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
sudo npm install -g pm2

# Chromium (for kiosk display)
sudo apt-get install -y chromium
```

### First-time deployment

From your dev machine (Windows/Mac/Linux):

```bash
# 1. Bundle source (exclude secrets and build artifacts)
tar -czf /tmp/tb.tar.gz \
  --exclude="Trading Bot/node_modules" \
  --exclude="Trading Bot/dist" \
  --exclude="Trading Bot/.git" \
  --exclude="Trading Bot/.env" \
  "Trading Bot"

# 2. Push to Pi
scp /tmp/tb.tar.gz pi@raspberrypi.local:~/
ssh pi@raspberrypi.local "tar -xzf tb.tar.gz && mv 'Trading Bot' trading-bot && rm tb.tar.gz"

# 3. Push .env separately (never bundle secrets)
scp "Trading Bot/.env" pi@raspberrypi.local:~/trading-bot/.env

# 4. Install, build, start
ssh pi@raspberrypi.local "cd ~/trading-bot && npm install && npm run build && pm2 start pm2.config.js && pm2 save"
```

### Incremental updates (source file changes only)

```bash
# Bundle only changed source files
tar -czf /tmp/tb-src.tar.gz \
  "Trading Bot/src/path/to/changed.ts" \
  "Trading Bot/src/other/file.ts"

scp /tmp/tb-src.tar.gz pi@raspberrypi.local:~/
ssh pi@raspberrypi.local "tar -xzf tb-src.tar.gz --strip-components=1 -C ~/trading-bot/ && rm tb-src.tar.gz"

# Rebuild and restart
ssh pi@raspberrypi.local "cd ~/trading-bot && npm run build && pm2 restart ai-trader"
```

### Kiosk display (Wayland)

The included `launch-dashboard.sh` opens Chromium in full-screen kiosk mode and is wired to autostart via `~/.config/autostart/trading-dashboard.desktop`.

Key flags for Wayland (labwc) on Pi:
```bash
WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 \
  chromium --ozone-platform=wayland \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  http://localhost:5173
```

> **Note:** Use `--kiosk` not `--start-fullscreen`. On labwc, `--start-fullscreen` is unreliable; `--kiosk` gives true borderless fullscreen consistently. The binary is `chromium`, not `chromium-browser`.

### Useful Pi commands

```bash
# Check running processes
ssh pi@raspberrypi.local "pm2 status"

# Tail logs
ssh pi@raspberrypi.local "pm2 logs ai-trader --lines 50 --nostream"

# Restart bot only (no rebuild)
ssh pi@raspberrypi.local "pm2 restart ai-trader"

# Reload PM2 config (after pm2.config.js changes)
ssh pi@raspberrypi.local "pm2 reload pm2.config.js && pm2 save"

# Health check
ssh pi@raspberrypi.local "curl -s http://localhost:3001/api/health"

# Reboot Pi
ssh pi@raspberrypi.local "sudo reboot"
```

### Gotchas

| Issue | Fix |
|-------|-----|
| `sudo` via SSH leaks Windows PATH | Use full path: `sudo /usr/bin/env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |
| PM2 script fails for dashboard | Use `script: 'npm'` + `args: 'run preview -- --host'`, not `script: 'vite'` |
| Dashboard blocked in browser | Add `preview: { allowedHosts: ['raspberrypi.local', 'localhost'] }` to `vite.config.ts` |
| API proxy 502 in dashboard | Set `API_PORT: '3001'` in PM2 env for the dashboard process (matches `PORT` in backend) |
| Chromium not fullscreen | Use `--kiosk` not `--start-fullscreen`; Pi uses Wayland not X11 |

---

## Commands Reference

| Command | Where | What it does |
|---------|-------|-------------|
| `npm run dev` | root | Start bot with auto-reload (tsx watch) |
| `npm run build` | root | Compile TypeScript → `dist/` |
| `npm start` | root | Run compiled build |
| `npm run seed` | root | Seed watchlist with default stocks |
| `npm run dev` | `dashboard/` | Start dashboard Vite dev server |
| `npm run build` | `dashboard/` | Production build of dashboard → `dashboard/dist/` |
| `npm run preview` | `dashboard/` | Serve production build locally |
