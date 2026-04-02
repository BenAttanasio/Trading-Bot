import { EventEmitter } from 'events';

export interface ActivityEvent {
  id: number;
  timestamp: string;
  service: string;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

class ActivityLog extends EventEmitter {
  private buffer: ActivityEvent[] = [];
  private maxSize = 200;
  private nextId = 1;

  constructor() {
    super();
    // Raise limit to accommodate multiple simultaneous dashboard SSE connections
    this.setMaxListeners(50);
  }

  push(service: string, level: string, message: string, meta?: Record<string, unknown>): void {
    const event: ActivityEvent = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      service,
      level,
      message,
      meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
    };

    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    this.emit('event', event);
  }

  getRecent(limit = 50): ActivityEvent[] {
    return this.buffer.slice(-limit);
  }
}

export const activityLog = new ActivityLog();
