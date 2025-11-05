/**
 * Custom error classes
 */

/**
 * LCU connection error
 */
export class LCUConnectionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'LCUConnectionError';
  }
}

/**
 * Champion not found error
 */
export class ChampionNotFoundError extends Error {
  constructor(public readonly championId: number | string) {
    super(`Champion not found: ${championId}`);
    this.name = 'ChampionNotFoundError';
  }
}

/**
 * Browser launch error
 */
export class BrowserLaunchError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'BrowserLaunchError';
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
