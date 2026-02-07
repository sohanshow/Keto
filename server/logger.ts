/**
 * Simple logger for the voice agent server
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 50,
};

class Logger {
  private minLevel: LogLevel;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
    this.minLevel = ['debug', 'info', 'warn', 'error'].includes(envLevel) ? envLevel : 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    console.log('\x1b[32m%s\x1b[0m', this.formatMessage('info', message, meta));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return;
    console.log('\x1b[36m%s\x1b[0m', this.formatMessage('debug', message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return;
    console.log('\x1b[33m%s\x1b[0m', this.formatMessage('warn', message, meta));
  }

  error(error: unknown, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('error')) return;
    const message = error instanceof Error ? error.message : String(error);
    console.log('\x1b[31m%s\x1b[0m', this.formatMessage('error', message, meta));
  }
}

export const logger = new Logger();
