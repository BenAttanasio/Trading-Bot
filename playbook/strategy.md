# Playbook

This file is the bot's own, self-maintained strategy memory. The nightly
reflection appends lessons; the weekly review consolidates them into rules.
Hard limits in `src/config/hard-limits.ts` always win over anything here.

## Edge we are trying to capture

- Short-horizon (1-30 day) moves in liquid US equities driven by identifiable
  catalysts (earnings, guidance, contracts, regulatory news) confirmed by
  price/volume momentum.
- We are small and fast: we can act within minutes of a catalyst and size
  positions without moving the market. We cannot out-analyze the market on
  stale information, so a thesis without a fresh catalyst is a PASS.

## Entry rules

- Require at least one concrete catalyst dated within the last 5 trading days,
  or a price/volume anomaly (>= 3x average volume or >= 3% move) with a
  plausible explanation.
- Prefer names above their 20-day SMA with RSI between 45 and 75. Below 40 is a
  falling knife unless the catalyst is transformational.
- Never chase a move that is already > 8% on the day without a limit entry.

## Exit rules

- Every entry states a profit target, a stop, and a time horizon. When the
  horizon passes without the catalyst playing out, exit — do not "give it
  more time" without a new reason.
- Trailing stop rules are enforced in code; do not fight them.

## Sizing

- Size scales with conviction and with how testable the thesis is. If the
  invalidation condition is vague, size small.

## Known mistakes (keep this list honest)

- (none recorded yet)

## Recent lessons (auto-appended nightly, consolidated weekly)

- (none yet)
