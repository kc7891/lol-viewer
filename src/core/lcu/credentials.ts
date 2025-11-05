/**
 * LCU credentials fetcher
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { logger } from '../../utils/logger.js';
import { LCUConnectionError } from '../../utils/errors.js';

const execAsync = promisify(exec);

/**
 * LCU credentials
 */
export interface LCUCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Get League Client process information
 */
async function getLeagueClientProcess(): Promise<string> {
  const platformName = platform();

  try {
    if (platformName === 'win32') {
      // Windows: Use WMIC
      const { stdout } = await execAsync(
        'wmic PROCESS WHERE name="LeagueClientUx.exe" GET commandline'
      );
      return stdout;
    } else if (platformName === 'darwin') {
      // macOS: Use ps
      const { stdout } = await execAsync('ps aux | grep LeagueClientUx');
      return stdout;
    } else {
      // Linux: Use ps
      const { stdout } = await execAsync('ps aux | grep LeagueClientUx');
      return stdout;
    }
  } catch (error) {
    throw new LCUConnectionError(
      'League Client process not found. Make sure League of Legends client is running.',
      error as Error
    );
  }
}

/**
 * Extract port from command line
 */
function extractPort(commandLine: string): number {
  const match = commandLine.match(/--app-port=(\d+)/);

  if (!match || !match[1]) {
    throw new LCUConnectionError('Failed to extract LCU port from command line');
  }

  return Number.parseInt(match[1], 10);
}

/**
 * Extract auth token from command line
 */
function extractToken(commandLine: string): string {
  const match = commandLine.match(/--remoting-auth-token=([\w-]+)/);

  if (!match || !match[1]) {
    throw new LCUConnectionError('Failed to extract LCU auth token from command line');
  }

  return match[1];
}

/**
 * Get LCU credentials from running League Client process
 *
 * @returns LCU credentials
 * @throws LCUConnectionError if League Client is not running or credentials cannot be extracted
 */
export async function getLCUCredentials(): Promise<LCUCredentials> {
  logger.debug('Fetching LCU credentials from process...');

  const processInfo = await getLeagueClientProcess();

  if (!processInfo || processInfo.trim().length === 0) {
    throw new LCUConnectionError('League Client process not found');
  }

  const port = extractPort(processInfo);
  const token = extractToken(processInfo);

  const credentials: LCUCredentials = {
    host: '127.0.0.1',
    port,
    username: 'riot',
    password: token,
  };

  logger.info('LCU credentials obtained', { host: credentials.host, port: credentials.port });

  return credentials;
}
