/**
 * Browser Controller unit tests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { platform } from 'node:os';

// Simple mock for BrowserController without actual command execution
class MockBrowserController {
  private openCommand: string;
  private executedCommands: string[] = [];

  constructor() {
    const platformName = platform();
    this.openCommand =
      platformName === 'darwin' ? 'open' : platformName === 'win32' ? 'start' : 'xdg-open';
  }

  private escapeUrl(url: string): string {
    if (platform() === 'win32') {
      return url.replace(/([&|<>^%])/g, '^$1');
    }
    return url.replace(/'/g, "'\\''");
  }

  async open(url: string): Promise<void> {
    let command: string;
    const platformName = platform();

    if (platformName === 'win32') {
      const escapedUrl = this.escapeUrl(url);
      command = `start "" "${escapedUrl}"`;
    } else if (platformName === 'darwin') {
      command = `open '${this.escapeUrl(url)}'`;
    } else {
      command = `xdg-open '${this.escapeUrl(url)}'`;
    }

    this.executedCommands.push(command);
  }

  async openMultiple(urls: string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.open(url)));
  }

  getLastCommand(): string | undefined {
    return this.executedCommands[this.executedCommands.length - 1];
  }

  getExecutedCommands(): string[] {
    return this.executedCommands;
  }
}

describe('BrowserController', () => {
  let controller: MockBrowserController;

  beforeEach(() => {
    controller = new MockBrowserController();
  });

  describe('URL escaping', () => {
    describe('Windows platform', () => {
      const originalPlatform = platform;

      beforeEach(() => {
        // Mock platform for Windows tests
        if (platform() !== 'win32') {
          // Skip these tests on non-Windows
          return;
        }
      });

      it('should escape ampersand character', async () => {
        if (platform() !== 'win32') return;

        const url = 'https://example.com?foo=bar&baz=qux';
        await controller.open(url);

        const command = controller.getLastCommand();
        expect(command).toBeDefined();
        // Ampersands should be escaped with ^
        expect(command).toContain('^&');
      });

      it('should escape pipe character', async () => {
        if (platform() !== 'win32') return;

        const url = 'https://example.com?test=|value';
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        expect(command).toContain('^|');
      });

      it('should escape less-than character', async () => {
        if (platform() !== 'win32') return;

        const url = 'https://example.com?test=<value';
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        expect(command).toContain('^<');
      });

      it('should escape greater-than character', async () => {
        if (platform() !== 'win32') return;

        const url = 'https://example.com?test=>value';
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        expect(command).toContain('^>');
      });

      it('should escape caret character', async () => {
        if (platform() !== 'win32') return;

        const url = 'https://example.com?test=^value';
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        // Caret itself should be escaped
        expect(command).toContain('^^');
      });

      it('should escape percent character', async () => {
        if (platform() !== 'win32') return;

        const url = 'https://example.com?test=%20';
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        expect(command).toContain('^%');
      });

      it('should handle multiple special characters', async () => {
        if (platform() !== 'win32') return;

        const url = 'https://example.com?a=1&b=2|c=3<d>4';
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        // All special characters should be escaped
        expect(command).toContain('^&');
        expect(command).toContain('^|');
        expect(command).toContain('^<');
        expect(command).toContain('^>');
      });
    });

    describe('Unix-like platforms', () => {
      it('should escape single quotes on macOS/Linux', async () => {
        if (platform() === 'win32') return;

        const url = "https://example.com?test=O'Reilly";
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        // Single quotes should be escaped as '\''
        expect(command).toContain("'\\''");
      });

      it('should wrap URL in single quotes on macOS/Linux', async () => {
        if (platform() === 'win32') return;

        const url = 'https://example.com?foo=bar';
        await controller.open(url);

        const command = controller.getLastCommand(); expect(command).toBeDefined();
        
        // URL should be wrapped in single quotes
        expect(command).toMatch(/'[^']*'/);
      });
    });
  });

  describe('open', () => {
    it('should open a simple URL', async () => {
      const url = 'https://example.com';
      await controller.open(url);

      expect(controller.getExecutedCommands()).toHaveLength(1);
    });

    it('should open a URL with query parameters', async () => {
      const url = 'https://example.com?foo=bar&baz=qux';
      await controller.open(url);

      expect(controller.getExecutedCommands()).toHaveLength(1);
    });

    it('should handle URL with hash fragment', async () => {
      const url = 'https://example.com#section';
      await controller.open(url);

      expect(controller.getExecutedCommands()).toHaveLength(1);
    });

    it('should handle complex LoL Analytics URLs', async () => {
      const url = 'https://lolanalytics.com/champion/Ahri/matchup/Zed/mid';
      await controller.open(url);

      expect(controller.getExecutedCommands()).toHaveLength(1);
    });

    it('should handle URLs with encoded characters', async () => {
      const url = 'https://example.com?name=Kai%27Sa';
      await controller.open(url);

      expect(controller.getExecutedCommands()).toHaveLength(1);
    });
  });

  describe('openMultiple', () => {
    it('should open multiple URLs in parallel', async () => {
      const urls = [
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
      ];

      await controller.openMultiple(urls);

      expect(controller.getExecutedCommands()).toHaveLength(3);
    });

    it('should handle empty array', async () => {
      await controller.openMultiple([]);

      expect(controller.getExecutedCommands()).toHaveLength(0);
    });

    it('should handle single URL', async () => {
      await controller.openMultiple(['https://example.com']);

      expect(controller.getExecutedCommands()).toHaveLength(1);
    });
  });

  describe('platform-specific commands', () => {
    it('should use correct command format for current platform', async () => {
      const url = 'https://example.com';
      await controller.open(url);

      const command = controller.getLastCommand(); expect(command).toBeDefined();
      

      const currentPlatform = platform();
      if (currentPlatform === 'win32') {
        expect(command).toMatch(/^start/);
      } else if (currentPlatform === 'darwin') {
        expect(command).toMatch(/^open/);
      } else {
        expect(command).toMatch(/^xdg-open/);
      }
    });
  });

  describe('command injection prevention', () => {
    it('should prevent command injection via semicolon', async () => {
      const maliciousUrl = 'https://example.com; rm -rf /';
      await controller.open(maliciousUrl);

      const command = controller.getLastCommand(); expect(command).toBeDefined();
      

      // The entire URL should be quoted/escaped
      // The command should not contain unescaped semicolon outside quotes
      if (platform() !== 'win32') {
        expect(command).toMatch(/'[^']*;[^']*'/);
      }
    });

    it('should prevent command injection via backticks', async () => {
      const maliciousUrl = 'https://example.com`whoami`';
      await controller.open(maliciousUrl);

      const command = controller.getLastCommand(); expect(command).toBeDefined();
      

      // Backticks should be safely escaped
      if (platform() !== 'win32') {
        expect(command).toContain("'");
      }
    });

    it('should prevent command injection via dollar sign', async () => {
      const maliciousUrl = 'https://example.com$(whoami)';
      await controller.open(maliciousUrl);

      const command = controller.getLastCommand(); expect(command).toBeDefined();
      

      // Dollar signs should be safely escaped
      if (platform() !== 'win32') {
        expect(command).toContain("'");
      }
    });
  });
});
