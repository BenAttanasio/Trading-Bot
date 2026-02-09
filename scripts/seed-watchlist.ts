import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '../.env') });

import { connectDB, disconnectDB } from '../src/services/db/connection';
import { addToWatchlist } from '../src/services/db/queries';
import { DEFAULT_WATCHLIST } from '../src/config/watchlist';
import { WatchlistItem } from '../src/services/db/models/watchlist';

async function seed() {
  console.log('Seeding watchlist...');

  await connectDB();

  for (const entry of DEFAULT_WATCHLIST) {
    const item: WatchlistItem = {
      symbol: entry.symbol,
      sector: entry.sector,
      reason: entry.reason,
      addedAt: new Date(),
      active: true,
    };

    await addToWatchlist(item);
    console.log(`  ✓ ${entry.symbol} (${entry.sector})`);
  }

  console.log(`\nSeeded ${DEFAULT_WATCHLIST.length} stocks to watchlist`);
  await disconnectDB();
}

seed().catch(console.error);
