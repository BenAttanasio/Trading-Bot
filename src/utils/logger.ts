import winston from 'winston';
import Transport from 'winston-transport';
import path from 'path';
import { activityLog } from '../services/activity-log';

// Custom transport that feeds log events into the activity log (for SSE streaming)
class ActivityLogTransport extends Transport {
  log(info: any, callback: () => void): void {
    setImmediate(() => {
      const { level, message, service, timestamp, ...meta } = info;
      // Strip ANSI color codes from level
      const cleanLevel = level.replace(/\u001b\[\d+m/g, '');
      activityLog.push(
        service || 'System',
        cleanLevel,
        message,
        Object.keys(meta).length > 0 ? meta : undefined
      );
    });
    callback();
  }
}

// LOG_DIR lets a release-based deploy keep logs outside the release directory.
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '../../logs');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const svc = service ? `[${service}]` : '';
    const serializeError = (_k: string, v: unknown) =>
      v instanceof Error ? { message: v.message, name: v.name, stack: v.stack?.split('\n').slice(0, 2).join(' → ') } : v;
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta, serializeError)}` : '';
    return `${timestamp} ${level.toUpperCase().padEnd(5)} ${svc} ${message}${metaStr}`;
  })
);

const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
    }),
    new ActivityLogTransport(),
  ],
});

export function createServiceLogger(service: string) {
  return logger.child({ service });
}

export default logger;
