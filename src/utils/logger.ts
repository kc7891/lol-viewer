/**
 * Logger utility with support for different log levels and structured logging
 */

import chalk from 'chalk';
import type { UIConfig } from '../types/config.js';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Log entry metadata
 */
export interface LogMetadata {
  [key: string]: unknown;
}

/**
 * Logger class
 */
export class Logger {
  private level: LogLevel;
  private colorEnabled: boolean;

  constructor(config?: Partial<UIConfig>) {
    this.level = config?.verbose ? LogLevel.DEBUG : LogLevel.INFO;
    this.colorEnabled = config?.colorEnabled ?? true;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Enable or disable colors
   */
  setColorEnabled(enabled: boolean): void {
    this.colorEnabled = enabled;
  }

  /**
   * Debug log
   */
  debug(message: string, metadata?: LogMetadata): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, chalk.gray, metadata);
    }
  }

  /**
   * Info log
   */
  info(message: string, metadata?: LogMetadata): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, chalk.blue, metadata);
    }
  }

  /**
   * Warning log
   */
  warn(message: string, metadata?: LogMetadata): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, chalk.yellow, metadata);
    }
  }

  /**
   * Error log
   */
  error(message: string, error?: Error | LogMetadata): void {
    if (this.level <= LogLevel.ERROR) {
      const metadata = error instanceof Error ? { error: error.message, stack: error.stack } : error;
      this.log('ERROR', message, chalk.red, metadata);
    }
  }

  /**
   * Success log (special case of info)
   */
  success(message: string, metadata?: LogMetadata): void {
    if (this.level <= LogLevel.INFO) {
      this.log('SUCCESS', message, chalk.green, metadata);
    }
  }

  /**
   * Internal log method
   */
  private log(
    level: string,
    message: string,
    colorFn: (text: string) => string,
    metadata?: LogMetadata
  ): void {
    const timestamp = new Date().toISOString();
    const levelStr = this.colorEnabled ? colorFn(`[${level}]`) : `[${level}]`;
    const timeStr = this.colorEnabled ? chalk.dim(timestamp) : timestamp;

    let output = `${timeStr} ${levelStr} ${message}`;

    if (metadata && Object.keys(metadata).length > 0) {
      const metadataStr = JSON.stringify(metadata, null, 2);
      output += `\n${this.colorEnabled ? chalk.dim(metadataStr) : metadataStr}`;
    }

    if (level === 'ERROR') {
      console.error(output);
    } else {
      console.log(output);
    }
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Create a new logger instance with custom configuration
 */
export function createLogger(config?: Partial<UIConfig>): Logger {
  return new Logger(config);
}
