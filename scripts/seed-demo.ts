import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'trading_bot';

const STOCKS: Record<string, { sector: string; basePrice: number; volatility: number }> = {
  NVDA: { sector: 'Technology', basePrice: 135, volatility: 0.03 },
  AAPL: { sector: 'Technology', basePrice: 198, volatility: 0.015 },
  MSFT: { sector: 'Technology', basePrice: 450, volatility: 0.012 },
  GOOGL: { sector: 'Technology', basePrice: 178, volatility: 0.018 },
  META: { sector: 'Technology', basePrice: 510, volatility: 0.022 },
  AMD: { sector: 'Technology', basePrice: 165, volatility: 0.035 },
  AMZN: { sector: 'Consumer', basePrice: 200, volatility: 0.016 },
  TSLA: { sector: 'Consumer', basePrice: 255, volatility: 0.04 },
  LLY: { sector: 'Healthcare', basePrice: 820, volatility: 0.018 },
  JPM: { sector: 'Finance', basePrice: 210, volatility: 0.012 },
  XOM: { sector: 'Energy', basePrice: 112, volatility: 0.015 },
  COST: { sector: 'Consumer', basePrice: 920, volatility: 0.01 },
  UNH: { sector: 'Healthcare', basePrice: 540, volatility: 0.013 },
  V: { sector: 'Finance', basePrice: 290, volatility: 0.01 },
  CAT: { sector: 'Industrials', basePrice: 360, volatility: 0.014 },
};

const TRIGGERS = ['morning_research', 'sentinel', 'intraday_pulse', 'portfolio_manager'] as const;
const EXIT_REASONS = ['trailing_stop', 'ai_exit', 'ai_trim'] as const;

function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)); }
function pick<T>(arr: readonly T[]): T { return arr[randInt(0, arr.length - 1)]; }
function uuid() { return 'demo-' + Math.random().toString(36).slice(2, 10); }

function tradingDay(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  if (daysAgo === 0) {
    // Use a time clearly "today" in ET (11 AM ET = 15:00 UTC or 16:00 UTC depending on DST)
    d.setUTCHours(15, randInt(0, 59), randInt(0, 59), 0);
  } else {
    d.setHours(randInt(9, 15), randInt(30, 59), randInt(0, 59), 0);
  }
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function priceAt(base: number, vol: number, daysAgo: number): number {
  const drift = (30 - daysAgo) * 0.001;
  const noise = (Math.random() - 0.45) * vol * base * 2;
  return Math.round((base + base * drift + noise) * 100) / 100;
}

const THESES: Record<string, string> = {
  NVDA: 'Data center GPU demand accelerating with enterprise AI adoption. Blackwell ramp ahead of schedule, gross margins expanding. Cloud capex cycle still early innings.',
  AAPL: 'Services revenue hitting new highs with 30%+ margins. iPhone install base at all-time high creates durable upgrade cycle. Apple Intelligence driving replacement demand.',
  MSFT: 'Azure growth reaccelerating on AI workloads. Copilot monetization proving out across enterprise. GitHub Copilot seats growing 40% QoQ.',
  GOOGL: 'Search moat intact despite AI disruption fears. Cloud margins expanding rapidly. Waymo approaching commercial scale in 5 cities.',
  META: 'Reels monetization closing gap with feed. WhatsApp Business API gaining traction. AI-driven ad targeting improving ROAS across advertisers.',
  AMD: 'MI300X gaining share in AI inference workloads. EPYC server CPUs taking share from Intel. Console cycle tailwind persisting.',
  AMZN: 'AWS margin expansion story intact. Same-day delivery investments paying off with higher basket sizes. Advertising segment now $50B+ run rate.',
  TSLA: 'FSD v13 showing step-function improvement. Energy storage deployments doubling. Robotaxi regulatory approval timeline becoming clearer.',
  LLY: 'Mounjaro/Zepbound supply constraints easing. Pipeline depth underappreciated. Obesity market TAM estimates keep rising.',
  JPM: 'Net interest income benefiting from higher-for-longer rates. Investment banking recovery underway. Credit quality holding up better than feared.',
  XOM: 'Pioneer integration ahead of schedule. Permian basin breakeven below $35/bbl. Capital return program among best in sector.',
  COST: 'Membership renewal rates at record highs. E-commerce growth accelerating. Kirkland brand expansion driving margin mix shift.',
  UNH: 'Optum Health segment scaling efficiently. Medicare Advantage enrollment growth steady. Tech investments in care delivery reducing costs.',
  V: 'Cross-border volumes recovering. New flows segment (B2B, government) adding growth vectors. Buyback yield attractive at current levels.',
  CAT: 'Infrastructure spending cycle still early. Services revenue becoming larger mix. Dealer inventory normalization nearly complete.',
};

const HEADLINES = [
  { symbol: 'NVDA', headline: 'NVIDIA reports record Q1 data center revenue of $26.3B, beats estimates by 12%', urgency: 9, direction: 'bullish' as const },
  { symbol: 'TSLA', headline: 'Tesla FSD v13 approved for supervised use in California, Texas, Florida', urgency: 8, direction: 'bullish' as const },
  { symbol: 'AAPL', headline: 'Apple Intelligence adoption reaches 400M devices in first quarter of availability', urgency: 7, direction: 'bullish' as const },
  { symbol: 'AMD', headline: 'AMD MI300X wins major cloud contract, taking share from NVIDIA in inference', urgency: 8, direction: 'bullish' as const },
  { symbol: 'META', headline: 'Meta AI assistant reaches 1B monthly users, ad revenue up 22% YoY', urgency: 7, direction: 'bullish' as const },
  { symbol: 'LLY', headline: 'Eli Lilly obesity drug shows 25% weight loss in Phase 3 orforglipron trial', urgency: 9, direction: 'bullish' as const },
  { symbol: 'GOOGL', headline: 'Waymo expands to 3 new cities, completes 200K paid rides per week', urgency: 6, direction: 'bullish' as const },
  { symbol: 'JPM', headline: 'JPMorgan raises full-year NII guidance by $2B on deposit strength', urgency: 5, direction: 'bullish' as const },
  { symbol: 'XOM', headline: 'Oil prices drop 4% on OPEC+ production increase rumors', urgency: 7, direction: 'bearish' as const },
  { symbol: 'MSFT', headline: 'Microsoft Azure revenue growth accelerates to 33%, Copilot seats top 2M', urgency: 8, direction: 'bullish' as const },
  { symbol: 'AMZN', headline: 'Amazon same-day delivery now covers 90% of US Prime members', urgency: 5, direction: 'bullish' as const },
  { symbol: 'TSLA', headline: 'Tesla Cybertruck recall affects 50K units over brake sensor issue', urgency: 7, direction: 'bearish' as const },
  { symbol: 'NVDA', headline: 'US considers new AI chip export restrictions to Middle East partners', urgency: 8, direction: 'bearish' as const },
  { symbol: 'AMD', headline: 'AMD cuts Q3 guidance on weaker-than-expected PC market demand', urgency: 6, direction: 'bearish' as const },
  { symbol: 'CAT', headline: 'Infrastructure bill Phase 2 funding approved, $120B for transportation', urgency: 6, direction: 'bullish' as const },
  { symbol: 'COST', headline: 'Costco raises membership fees for first time in 7 years, stock rises 3%', urgency: 5, direction: 'bullish' as const },
  { symbol: 'V', headline: 'Visa cross-border volume jumps 18% as international travel normalizes', urgency: 4, direction: 'bullish' as const },
  { symbol: 'UNH', headline: 'CMS proposes 2.5% Medicare Advantage rate increase for 2027', urgency: 5, direction: 'bullish' as const },
];

const AI_REASONINGS = {
  BUY: [
    'Strong momentum with improving fundamentals. Technical setup shows breakout from 3-week consolidation with above-average volume. Risk/reward favorable at current levels.',
    'Earnings catalyst approaching with consensus estimates likely too conservative. Options market pricing in smaller move than historical average. Initiating position ahead of report.',
    'Sector rotation favoring this name. Relative strength improving vs peers. Fund flows turning positive after 2 weeks of outflows.',
    'Price pulled back to 20-day SMA support with RSI resetting from overbought. This is a textbook buy-the-dip setup in an uptrend. Adding exposure.',
    'Management execution has been consistent for 4 quarters straight. Street estimates still haven\'t caught up. Valuation reasonable on forward numbers.',
  ],
  SELL: [
    'Position reached profit target. Momentum fading with declining volume on up days. Locking in gains before sector rotation risk increases.',
    'Thesis partially invalidated by recent management commentary. Reducing exposure while maintaining small watching position.',
    'Risk/reward no longer favorable after 15% move. Taking profits to redeploy capital into higher-conviction ideas.',
    'Trailing stop triggered after 3% pullback from highs. Protecting gains in a position that may need time to consolidate.',
  ],
  HOLD: [
    'Thesis intact. Price action constructive with higher lows forming. No reason to exit, no reason to add at current levels.',
    'Waiting for upcoming catalyst before making changes. Current position size appropriate for conviction level.',
    'Consolidating after strong move. Volume declining normally. Holding for next leg higher.',
  ],
};

async function seed() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  console.log('Connected to MongoDB');

  // Clear existing demo/seed data
  const collections = ['trades', 'positions', 'decision_log', 'alerts', 'daily_summaries', 'trade_outcomes', 'research'];
  for (const col of collections) {
    await db.collection(col).deleteMany({});
    console.log(`  Cleared ${col}`);
  }

  const symbols = Object.keys(STOCKS);

  // --- TRADES (mix of buys and sells over 30 days) ---
  const trades: any[] = [];
  const completedRoundTrips: any[] = [];

  // Generate ~80 trades over 30 days
  for (let day = 30; day >= 0; day--) {
    const tradesPerDay = day === 0 ? randInt(4, 7) : randInt(1, 4);
    for (let t = 0; t < tradesPerDay; t++) {
      const sym = pick(symbols);
      const stock = STOCKS[sym];
      const isBuy = Math.random() > 0.35;
      const price = priceAt(stock.basePrice, stock.volatility, day);
      const qty = Math.max(1, Math.floor(rand(20, 50) / (price / 50)));
      const conviction = isBuy ? randInt(6, 10) : randInt(5, 9);
      const trigger = pick(TRIGGERS);
      const createdAt = tradingDay(day);

      const trade = {
        symbol: sym,
        action: isBuy ? 'BUY' : 'SELL',
        quantity: qty,
        price,
        notional: Math.round(price * qty * 100) / 100,
        orderId: uuid(),
        orderStatus: 'filled',
        trigger,
        aiReasoning: pick(isBuy ? AI_REASONINGS.BUY : AI_REASONINGS.SELL),
        aiConviction: conviction,
        riskChecks: { allPassed: true, details: { positionSize: true, portfolioExposure: true, dailyLoss: true, maxTrades: true, cooldown: true } },
        createdAt,
        filledAt: new Date(createdAt.getTime() + randInt(500, 5000)),
      };
      trades.push(trade);

      // Create matching round-trip outcomes for sells
      if (!isBuy && Math.random() > 0.3) {
        const daysHeld = randInt(1, 14);
        const entryPrice = price * (1 - rand(-0.08, 0.12));
        const plPercent = ((price - entryPrice) / entryPrice) * 100;
        completedRoundTrips.push({
          symbol: sym,
          entryTrigger: pick(TRIGGERS),
          entryPrice: Math.round(entryPrice * 100) / 100,
          exitPrice: price,
          entryDate: new Date(createdAt.getTime() - daysHeld * 24 * 60 * 60 * 1000),
          exitDate: createdAt,
          daysHeld,
          realizedPLPercent: Math.round(plPercent * 100) / 100,
          realizedPLDollars: Math.round((price - entryPrice) * qty * 100) / 100,
          aiConviction: conviction,
          originalThesis: THESES[sym] || 'Position entered based on strong technical and fundamental setup.',
          exitReason: pick(EXIT_REASONS),
          exitWorkflow: pick(['portfolio_manager', 'scout']),
          thesisFreshness: pick(['fresh', 'aging', 'stale']),
          createdAt,
        });
      }
    }
  }

  // Ensure we have trades clearly stamped "today" using an unambiguous UTC timestamp
  const nowUTC = new Date();
  const todayTradeSymbols = ['NVDA', 'AAPL', 'AMD', 'TSLA', 'META', 'MSFT'];
  for (const sym of todayTradeSymbols) {
    const stock = STOCKS[sym];
    const isBuy = Math.random() > 0.3;
    const price = priceAt(stock.basePrice, stock.volatility, 0);
    const qty = Math.max(1, Math.floor(rand(20, 50) / (price / 50)));
    const hoursAgo = rand(1, 6);
    const createdAt = new Date(nowUTC.getTime() - hoursAgo * 60 * 60 * 1000);
    trades.push({
      symbol: sym,
      action: isBuy ? 'BUY' : 'SELL',
      quantity: qty,
      price,
      notional: Math.round(price * qty * 100) / 100,
      orderId: uuid(),
      orderStatus: 'filled',
      trigger: pick(TRIGGERS),
      aiReasoning: pick(isBuy ? AI_REASONINGS.BUY : AI_REASONINGS.SELL),
      aiConviction: randInt(6, 10),
      riskChecks: { allPassed: true, details: { positionSize: true, portfolioExposure: true, dailyLoss: true, maxTrades: true, cooldown: true } },
      createdAt,
      filledAt: new Date(createdAt.getTime() + randInt(500, 5000)),
    });
  }

  if (trades.length > 0) {
    await db.collection('trades').insertMany(trades);
    console.log(`  Inserted ${trades.length} trades`);
  }

  if (completedRoundTrips.length > 0) {
    await db.collection('trade_outcomes').insertMany(completedRoundTrips);
    console.log(`  Inserted ${completedRoundTrips.length} trade outcomes`);
  }

  // --- POSITIONS (5 current open positions) ---
  const openSymbols = ['NVDA', 'AAPL', 'MSFT', 'AMD', 'AMZN'];
  const positions = openSymbols.map((sym) => {
    const stock = STOCKS[sym];
    const entryPrice = priceAt(stock.basePrice, stock.volatility, randInt(2, 12));
    const currentPrice = priceAt(stock.basePrice, stock.volatility, 0);
    const qty = Math.max(1, Math.floor(rand(30, 50) / (currentPrice / 50)));
    const pl = (currentPrice - entryPrice) * qty;
    const daysHeld = randInt(2, 14);
    const freshness = daysHeld <= 1 ? 'fresh' : daysHeld <= 3 ? 'aging' : 'stale';
    return {
      symbol: sym,
      entryPrice: Math.round(entryPrice * 100) / 100,
      currentPrice: Math.round(currentPrice * 100) / 100,
      quantity: qty,
      unrealizedPL: Math.round(pl * 100) / 100,
      unrealizedPLPercent: Math.round(((currentPrice - entryPrice) / entryPrice) * 10000) / 100,
      daysHeld,
      thesis: THESES[sym],
      thesisLastUpdated: tradingDay(daysHeld <= 1 ? 0 : daysHeld),
      thesisFreshness: freshness,
      exitConditions: { profitTarget: '+8% from entry', stopLoss: '-5% from entry' },
      trailingStop: Math.random() > 0.5 ? { activatedAt: '+4% triggered', floor: `$${Math.round(currentPrice * 0.97 * 100) / 100}` } : null,
      entryTrigger: pick(TRIGGERS),
      tags: [stock.sector, 'ai-selected'],
      createdAt: tradingDay(daysHeld),
      lastReviewedAt: tradingDay(Math.min(daysHeld, 1)),
    };
  });
  await db.collection('positions').insertMany(positions);
  console.log(`  Inserted ${positions.length} open positions`);

  // --- DAILY SUMMARIES (30 days of portfolio history for chart) ---
  let portfolioValue = 100000;
  const summaries: any[] = [];
  for (let day = 30; day >= 0; day--) {
    const d = new Date();
    d.setDate(d.getDate() - day);
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const dailyReturn = rand(-0.008, 0.012);
    portfolioValue = portfolioValue * (1 + dailyReturn);
    const dailyPL = portfolioValue * dailyReturn;
    const invested = portfolioValue * rand(0.12, 0.25);
    const tradesExec = day === 0 ? randInt(4, 7) : randInt(1, 6);

    const topSymbol = pick(symbols);
    const worstSymbol = pick(symbols.filter((s) => s !== topSymbol));

    // Use ET-aware date string for today so dashboard's todayExists check passes
    const summaryDate = day === 0
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
      : dateStr(d);

    summaries.push({
      date: summaryDate,
      portfolioValue: Math.round(portfolioValue * 100) / 100,
      cashBalance: Math.round((portfolioValue - invested) * 100) / 100,
      investedValue: Math.round(invested * 100) / 100,
      dailyPL: Math.round(dailyPL * 100) / 100,
      dailyPLPercent: Math.round(dailyReturn * 10000) / 100,
      totalPL: Math.round((portfolioValue - 100000) * 100) / 100,
      tradesExecuted: tradesExec,
      tradesBlocked: randInt(0, 3),
      sentinelAlerts: randInt(0, 5),
      topMover: { symbol: topSymbol, pl: Math.round(rand(5, 45) * 100) / 100 },
      worstMover: { symbol: worstSymbol, pl: Math.round(rand(-40, -2) * 100) / 100 },
      aiSummary: pick([
        `Solid session with ${tradesExec} trades executed. AI maintained bullish stance on tech names. Portfolio exposure managed within risk parameters.`,
        `Mixed day with gains in tech offset by energy weakness. Sentinel caught 2 opportunities. Overall portfolio tracking above baseline.`,
        `Strong morning research session identified 3 high-conviction plays. Executed 2 buys with average conviction of 8.1. Risk gate blocked 1 oversized position.`,
        `Defensive posture today after overnight news flow. Trimmed 1 position, added to NVDA on pullback. Cash allocation increased to preserve optionality.`,
        `Quiet session with mostly HOLD decisions. AI conviction on existing positions remains high. Waiting for earnings catalysts next week.`,
      ]),
      createdAt: d,
    });
  }
  await db.collection('daily_summaries').insertMany(summaries);
  console.log(`  Inserted ${summaries.length} daily summaries`);

  // Force-upsert today's summary so chart shows continuous data
  const todayETDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todayPL = portfolioValue * rand(0.001, 0.005);
  await db.collection('daily_summaries').updateOne(
    { date: todayETDate },
    { $set: {
      date: todayETDate,
      portfolioValue: Math.round(portfolioValue * 100) / 100,
      cashBalance: Math.round(portfolioValue * 0.82 * 100) / 100,
      investedValue: Math.round(portfolioValue * 0.18 * 100) / 100,
      dailyPL: Math.round(todayPL * 100) / 100,
      dailyPLPercent: Math.round((todayPL / portfolioValue) * 10000) / 100,
      totalPL: Math.round((portfolioValue - 100000) * 100) / 100,
      tradesExecuted: 6,
      tradesBlocked: 1,
      sentinelAlerts: 4,
      topMover: { symbol: 'NVDA', pl: 28.50 },
      worstMover: { symbol: 'AMD', pl: -12.30 },
      aiSummary: 'Active session with 6 trades executed. AI bullish on NVDA and AAPL, added AMD on technical breakout. Sentinel flagged 4 news events, 2 triggered deep research. Portfolio up on the day.',
      createdAt: new Date(),
    }},
    { upsert: true },
  );
  console.log(`  Upserted today summary (${todayETDate})`);

  // --- ALERTS (recent sentinel alerts, heavier today) ---
  const alerts: any[] = [];
  for (let day = 14; day >= 0; day--) {
    const count = day === 0 ? randInt(5, 8) : randInt(1, 3);
    for (let i = 0; i < count; i++) {
      const h = pick(HEADLINES);
      const createdAt = day === 0 ? new Date(nowUTC.getTime() - rand(0.5, 6) * 60 * 60 * 1000) : tradingDay(day);
      alerts.push({
        type: pick(['news', 'price_spike', 'volume_spike']),
        symbol: h.symbol,
        urgency: day === 0 ? Math.min(10, h.urgency + randInt(0, 1)) : h.urgency,
        direction: h.direction,
        headline: h.headline,
        aiSummary: `Sentinel flagged this event for ${h.symbol}. ${h.direction === 'bullish' ? 'Positive catalyst could drive near-term upside.' : 'Monitoring for potential downside risk.'}`,
        actionTaken: h.urgency >= 7 ? 'triggered_deep_research' : pick(['queued_for_pulse', 'ignored']),
        resultingTradeId: null,
        createdAt,
      });
    }
  }
  await db.collection('alerts').insertMany(alerts);
  console.log(`  Inserted ${alerts.length} alerts`);

  // --- DECISION LOG (today's decisions for bot mood) ---
  const decisions: any[] = [];
  const todayDecisionSymbols = ['NVDA', 'AAPL', 'MSFT', 'AMD', 'AMZN', 'TSLA', 'META', 'GOOGL'];
  for (const sym of todayDecisionSymbols) {
    const stock = STOCKS[sym];
    const price = priceAt(stock.basePrice, stock.volatility, 0);
    const decision = pick(['HOLD', 'HOLD', 'HOLD', 'BUY', 'BUY', 'ADD'] as const);
    decisions.push({
      symbol: sym,
      workflow: pick(['portfolio_manager', 'scout'] as const),
      decision,
      executed: decision === 'BUY' || decision === 'ADD',
      blockedReason: null,
      aiResponse: {
        action: decision,
        conviction: randInt(6, 9),
        reasoning: pick(decision === 'HOLD' ? AI_REASONINGS.HOLD : AI_REASONINGS.BUY),
      },
      marketDataSnapshot: {
        price,
        volume: randInt(5000000, 80000000),
        changePercent: Math.round(rand(-2.5, 3.5) * 100) / 100,
        rsi: Math.round(rand(35, 72) * 10) / 10,
        vwap: Math.round(price * rand(0.995, 1.005) * 100) / 100,
      },
      createdAt: new Date(nowUTC.getTime() - rand(1, 7) * 60 * 60 * 1000),
    });
  }
  // Add one blocked decision for realism
  decisions.push({
    symbol: 'LLY',
    workflow: 'scout',
    decision: 'BLOCKED',
    executed: false,
    blockedReason: 'Position size exceeds max allowed ($50)',
    aiResponse: { action: 'BUY', conviction: 7, reasoning: 'Strong pharma catalyst but position sizing constraint prevents entry at current price levels.' },
    marketDataSnapshot: { price: 825.40, volume: 12000000, changePercent: 1.8, rsi: 58.3, vwap: 822.10 },
    createdAt: new Date(nowUTC.getTime() - 2 * 60 * 60 * 1000),
  });
  await db.collection('decision_log').insertMany(decisions);
  console.log(`  Inserted ${decisions.length} decisions (today)`);

  // --- RESEARCH (recent research entries) ---
  const researchEntries: any[] = [];
  for (let day = 7; day >= 0; day--) {
    const count = day === 0 ? 5 : randInt(2, 4);
    for (let i = 0; i < count; i++) {
      const sym = pick(symbols);
      const stock = STOCKS[sym];
      const sentiment = pick(['bullish', 'bullish', 'bullish', 'neutral', 'bearish'] as const);
      const conviction = sentiment === 'bullish' ? randInt(6, 10) : sentiment === 'neutral' ? randInt(4, 6) : randInt(2, 5);
      researchEntries.push({
        symbol: sym,
        type: pick(['morning_research', 'deep_dive', 'sentinel_escalation'] as const),
        summary: THESES[sym] || 'Fundamental and technical analysis supports current positioning.',
        fullAnalysis: `Comprehensive analysis of ${sym} covering valuation, technicals, sentiment, and catalyst timeline. ${THESES[sym] || ''}`,
        sentiment,
        conviction,
        catalysts: pick([
          ['Earnings report next week', 'New product launch', 'Analyst upgrade cycle'],
          ['Sector tailwind', 'Margin expansion story', 'Share buyback acceleration'],
          ['Management execution', 'TAM expansion', 'Competitive moat widening'],
        ]),
        risks: pick([
          ['Valuation stretched on near-term metrics', 'Macro headwinds'],
          ['Competition intensifying', 'Regulatory overhang'],
          ['Supply chain constraints', 'Currency headwinds'],
        ]),
        priceTarget: `$${Math.round(stock.basePrice * rand(1.05, 1.25))}`,
        recommendation: sentiment === 'bullish' ? (conviction >= 7 ? 'BUY' : 'HOLD') : sentiment === 'neutral' ? 'HOLD' : 'WATCH',
        modelUsed: pick(['claude-opus-4-20250514', 'claude-sonnet-4-20250514']),
        createdAt: tradingDay(day),
      });
    }
  }
  await db.collection('research').insertMany(researchEntries);
  console.log(`  Inserted ${researchEntries.length} research entries`);

  console.log('\nDemo data seeded successfully!');
  console.log(`  Portfolio value: $${Math.round(portfolioValue).toLocaleString()}`);
  console.log(`  Total P&L: $${Math.round(portfolioValue - 100000).toLocaleString()}`);
  console.log(`  Open positions: ${openSymbols.join(', ')}`);

  await client.close();
}

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
