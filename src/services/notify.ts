import { env } from '../config/env';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Notify');

export type NotifyLevel = 'info' | 'warn' | 'action';

/**
 * Human channel for the things that matter: a change awaiting approval, a
 * deploy, the nightly headline. Discord webhook if configured; always logged.
 */
export async function notify(title: string, body: string, level: NotifyLevel = 'info'): Promise<void> {
  const prefix = level === 'action' ? '🟠 ACTION NEEDED' : level === 'warn' ? '🟡' : '🟢';
  log.info(`[notify:${level}] ${title}`, { body: body.slice(0, 300) });
  if (!env.DISCORD_WEBHOOK_URL) return;
  try {
    const content = `${prefix} **${title}**\n${body}`.slice(0, 1900);
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) log.warn(`Discord webhook returned ${res.status}`);
  } catch (err) {
    log.warn('Discord webhook failed', { err });
  }
}
