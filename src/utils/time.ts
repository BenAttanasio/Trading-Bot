/**
 * Eastern Time helpers for market hours calculations.
 * Uses Intl.DateTimeFormat.formatToParts() for reliable cross-platform behavior.
 */

const ET_TIMEZONE = 'America/New_York';

const hourMinuteFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  weekday: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function nowET(): Date {
  return new Date();
}

export function toET(date: Date): string {
  return date.toLocaleString('en-US', { timeZone: ET_TIMEZONE });
}

export function getETHour(date: Date = new Date()): number {
  const parts = hourMinuteFormatter.formatToParts(date);
  let hour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  // hour12: false can return 24 for midnight on some platforms
  if (hour === 24) hour = 0;
  return hour + minute / 60;
}

export function getETDateString(date: Date = new Date()): string {
  return dateFormatter.format(date);
}

/** Returns YYYY-MM-DD in Eastern Time */
export function getETDateISO(date: Date = new Date()): string {
  return isoDateFormatter.format(date);
}

/** Returns a Date representing midnight ET today (as a UTC instant).
 *  Correctly handles EST (-05:00) vs EDT (-04:00). */
export function getStartOfETDay(date: Date = new Date()): Date {
  const etDateStr = getETDateISO(date);
  // Determine current ET offset by comparing UTC hour to ET hour
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const etHour = getETHour(date);
  let offset = Math.round(utcHour - etHour);
  // Normalize: ET is always UTC-5 (EST) or UTC-4 (EDT)
  if (offset !== 4 && offset !== 5) {
    // Handle wrap-around near midnight (e.g., UTC 1:00 = ET 20:00 prev day)
    offset = offset < 0 ? offset + 24 : offset;
    if (offset !== 4 && offset !== 5) offset = 5; // fallback to EST
  }
  const offsetStr = `-${String(offset).padStart(2, '0')}:00`;
  return new Date(`${etDateStr}T00:00:00${offsetStr}`);
}

export function daysSince(date: Date): number {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function minutesSince(date: Date): number {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60));
}

export function hoursSince(date: Date): number {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60));
}

export function isWeekday(date: Date = new Date()): boolean {
  const dayStr = weekdayFormatter.format(date);
  return dayStr !== 'Sat' && dayStr !== 'Sun';
}
