/**
 * Eastern Time helpers for market hours calculations.
 */

const ET_TIMEZONE = 'America/New_York';

export function nowET(): Date {
  return new Date();
}

export function toET(date: Date): string {
  return date.toLocaleString('en-US', { timeZone: ET_TIMEZONE });
}

export function getETHour(date: Date = new Date()): number {
  const etStr = date.toLocaleString('en-US', {
    timeZone: ET_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const [hours, minutes] = etStr.split(':').map(Number);
  return hours + minutes / 60;
}

export function getETDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
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
  const etDay = new Date(date.toLocaleString('en-US', { timeZone: ET_TIMEZONE }));
  const day = etDay.getDay();
  return day >= 1 && day <= 5;
}
