/**
 * Browser controller for opening URLs
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { logger } from '../../utils/logger.js';

const execAsync = promisify(exec);

/**
 * Get the appropriate command to open a URL based on the platform
 */
function getOpenCommand(): string {
  const platformName = platform();

  switch (platformName) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'start';
    default:
      return 'xdg-open';
  }
}

/**
 * Browser controller class
 */
export class BrowserController {
  private openCommand: string;

  constructor() {
    this.openCommand = getOpenCommand();
    logger.debug(`Using browser open command: ${this.openCommand}`);
  }

  /**
   * Escape URL for shell command
   */
  private escapeUrl(url: string): string {
    // For Windows, escape special characters
    if (platform() === 'win32') {
      // Replace problematic characters for Windows cmd
      return url.replace(/([&|<>^%])/g, '^$1');
    }
    // For Unix-like systems, single quotes are safer
    return url.replace(/'/g, "'\\''");
  }

  /**
   * Open a URL in the default browser
   *
   * @param url - URL to open
   */
  async open(url: string): Promise<void> {
    try {
      logger.info(`Opening URL: ${url}`);

      // Platform-specific command formatting
      let command: string;
      const platformName = platform();

      if (platformName === 'win32') {
        // Windows: start "" "url" (empty string for window title)
        const escapedUrl = this.escapeUrl(url);
        command = `start "" "${escapedUrl}"`;
      } else if (platformName === 'darwin') {
        // macOS: open 'url' (use single quotes for better escaping)
        command = `open '${this.escapeUrl(url)}'`;
      } else {
        // Linux: xdg-open 'url' (use single quotes for better escaping)
        command = `xdg-open '${this.escapeUrl(url)}'`;
      }

      await execAsync(command);
      logger.debug(`Successfully opened URL in browser`);
    } catch (error) {
      logger.error('Failed to open URL in browser', error as Error);
      throw new Error(
        `Failed to open URL: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Open multiple URLs at once
   *
   * @param urls - Array of URLs to open
   */
  async openMultiple(urls: string[]): Promise<void> {
    logger.info(`Opening ${urls.length} URLs`);

    // Open all URLs in parallel
    await Promise.all(urls.map((url) => this.open(url)));

    logger.success(`Opened ${urls.length} URLs successfully`);
  }
}

/**
 * Default browser controller instance
 */
export const browserController = new BrowserController();
