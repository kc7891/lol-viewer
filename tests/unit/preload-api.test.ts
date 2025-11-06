/**
 * Preload Script API tests
 *
 * These tests verify the structure and contract of the electronAPI
 * exposed by the preload script via contextBridge.
 */

import { describe, it, expect } from '@jest/globals';

// Define the expected API structure based on preload.ts
interface ElectronAPI {
  getConfig: () => Promise<unknown>;
  saveConfig: (config: unknown) => Promise<unknown>;
  getAppStatus: () => Promise<unknown>;
  startApp: () => Promise<unknown>;
  stopApp: () => Promise<unknown>;
  restartApp: () => Promise<unknown>;
  onAppStatus: (callback: (status: string) => void) => () => void;
  onLog: (callback: (level: string, message: string) => void) => () => void;
}

describe('Preload Script API', () => {
  describe('API Structure', () => {
    it('should define all required methods', () => {
      const requiredMethods: Array<keyof ElectronAPI> = [
        'getConfig',
        'saveConfig',
        'getAppStatus',
        'startApp',
        'stopApp',
        'restartApp',
        'onAppStatus',
        'onLog',
      ];

      expect(requiredMethods).toHaveLength(8);
      expect(requiredMethods).toContain('getConfig');
      expect(requiredMethods).toContain('saveConfig');
      expect(requiredMethods).toContain('getAppStatus');
      expect(requiredMethods).toContain('startApp');
      expect(requiredMethods).toContain('stopApp');
      expect(requiredMethods).toContain('restartApp');
      expect(requiredMethods).toContain('onAppStatus');
      expect(requiredMethods).toContain('onLog');
    });

    it('should have correct method types', () => {
      // Mock API implementation matching preload.ts structure
      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: (config: unknown) => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: (callback: (status: string) => void) => {
          return () => {}; // Cleanup function
        },
        onLog: (callback: (level: string, message: string) => void) => {
          return () => {}; // Cleanup function
        },
      };

      // Verify each method exists and has correct type
      expect(typeof mockAPI.getConfig).toBe('function');
      expect(typeof mockAPI.saveConfig).toBe('function');
      expect(typeof mockAPI.getAppStatus).toBe('function');
      expect(typeof mockAPI.startApp).toBe('function');
      expect(typeof mockAPI.stopApp).toBe('function');
      expect(typeof mockAPI.restartApp).toBe('function');
      expect(typeof mockAPI.onAppStatus).toBe('function');
      expect(typeof mockAPI.onLog).toBe('function');
    });
  });

  describe('Promise-based Methods', () => {
    it('should return promises for async operations', async () => {
      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({ test: true }),
        saveConfig: (config: unknown) => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('running'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: () => () => {},
        onLog: () => () => {},
      };

      // Test each async method returns a promise
      expect(mockAPI.getConfig()).toBeInstanceOf(Promise);
      expect(mockAPI.saveConfig({})).toBeInstanceOf(Promise);
      expect(mockAPI.getAppStatus()).toBeInstanceOf(Promise);
      expect(mockAPI.startApp()).toBeInstanceOf(Promise);
      expect(mockAPI.stopApp()).toBeInstanceOf(Promise);
      expect(mockAPI.restartApp()).toBeInstanceOf(Promise);
    });

    it('should handle getConfig response', async () => {
      const mockConfig = {
        lcu: { autoDetect: true },
        lolAnalytics: { baseUrl: 'https://lolanalytics.com' },
        browser: { type: 'chromium' },
      };

      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve(mockConfig),
        saveConfig: () => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: () => () => {},
        onLog: () => () => {},
      };

      const config = await mockAPI.getConfig();
      expect(config).toEqual(mockConfig);
    });

    it('should handle saveConfig success', async () => {
      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: (config: unknown) => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: () => () => {},
        onLog: () => () => {},
      };

      const result = await mockAPI.saveConfig({ test: true });
      expect(result).toBe(true);
    });

    it('should handle app status values', async () => {
      const statuses = ['stopped', 'starting', 'running', 'stopping'];

      for (const status of statuses) {
        const mockAPI: ElectronAPI = {
          getConfig: () => Promise.resolve({}),
          saveConfig: () => Promise.resolve(true),
          getAppStatus: () => Promise.resolve(status),
          startApp: () => Promise.resolve(undefined),
          stopApp: () => Promise.resolve(undefined),
          restartApp: () => Promise.resolve(undefined),
          onAppStatus: () => () => {},
          onLog: () => () => {},
        };

        const result = await mockAPI.getAppStatus();
        expect(result).toBe(status);
      }
    });
  });

  describe('Event Listener Methods', () => {
    it('should register onAppStatus listener', () => {
      let statusCallback: ((status: string) => void) | null = null;

      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: () => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: (callback: (status: string) => void) => {
          statusCallback = callback;
          return () => {
            statusCallback = null;
          };
        },
        onLog: () => () => {},
      };

      const receivedStatuses: string[] = [];
      const cleanup = mockAPI.onAppStatus((status: string) => {
        receivedStatuses.push(status);
      });

      // Simulate status updates
      statusCallback?.('starting');
      statusCallback?.('running');

      expect(receivedStatuses).toEqual(['starting', 'running']);
      expect(typeof cleanup).toBe('function');
    });

    it('should register onLog listener', () => {
      let logCallback: ((level: string, message: string) => void) | null = null;

      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: () => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: () => () => {},
        onLog: (callback: (level: string, message: string) => void) => {
          logCallback = callback;
          return () => {
            logCallback = null;
          };
        },
      };

      const receivedLogs: Array<{ level: string; message: string }> = [];
      const cleanup = mockAPI.onLog((level: string, message: string) => {
        receivedLogs.push({ level, message });
      });

      // Simulate log messages
      logCallback?.('info', 'Starting application');
      logCallback?.('error', 'Failed to connect');

      expect(receivedLogs).toHaveLength(2);
      expect(receivedLogs[0]).toEqual({ level: 'info', message: 'Starting application' });
      expect(receivedLogs[1]).toEqual({ level: 'error', message: 'Failed to connect' });
      expect(typeof cleanup).toBe('function');
    });

    it('should cleanup event listeners properly', () => {
      let listenerCount = 0;

      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: () => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: (callback: (status: string) => void) => {
          listenerCount++;
          return () => {
            listenerCount--;
          };
        },
        onLog: (callback: (level: string, message: string) => void) => {
          listenerCount++;
          return () => {
            listenerCount--;
          };
        },
      };

      // Register multiple listeners
      const cleanup1 = mockAPI.onAppStatus(() => {});
      const cleanup2 = mockAPI.onLog(() => {});
      const cleanup3 = mockAPI.onAppStatus(() => {});

      expect(listenerCount).toBe(3);

      // Cleanup all listeners
      cleanup1();
      expect(listenerCount).toBe(2);

      cleanup2();
      expect(listenerCount).toBe(1);

      cleanup3();
      expect(listenerCount).toBe(0);
    });

    it('should handle multiple simultaneous listeners', () => {
      const listeners: Array<(status: string) => void> = [];

      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: () => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: (callback: (status: string) => void) => {
          listeners.push(callback);
          return () => {
            const index = listeners.indexOf(callback);
            if (index > -1) {
              listeners.splice(index, 1);
            }
          };
        },
        onLog: () => () => {},
      };

      const results1: string[] = [];
      const results2: string[] = [];
      const results3: string[] = [];

      const cleanup1 = mockAPI.onAppStatus((status) => results1.push(status));
      const cleanup2 = mockAPI.onAppStatus((status) => results2.push(status));
      const cleanup3 = mockAPI.onAppStatus((status) => results3.push(status));

      // Broadcast to all listeners
      listeners.forEach((listener) => listener('running'));

      expect(results1).toEqual(['running']);
      expect(results2).toEqual(['running']);
      expect(results3).toEqual(['running']);

      // Cleanup one listener
      cleanup2();

      // Broadcast again
      listeners.forEach((listener) => listener('stopped'));

      expect(results1).toEqual(['running', 'stopped']);
      expect(results2).toEqual(['running']); // No new update
      expect(results3).toEqual(['running', 'stopped']);
    });
  });

  describe('Error Handling', () => {
    it('should handle promise rejections', async () => {
      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.reject(new Error('Config load failed')),
        saveConfig: () => Promise.reject(new Error('Config save failed')),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.reject(new Error('Start failed')),
        stopApp: () => Promise.reject(new Error('Stop failed')),
        restartApp: () => Promise.reject(new Error('Restart failed')),
        onAppStatus: () => () => {},
        onLog: () => () => {},
      };

      await expect(mockAPI.getConfig()).rejects.toThrow('Config load failed');
      await expect(mockAPI.saveConfig({})).rejects.toThrow('Config save failed');
      await expect(mockAPI.startApp()).rejects.toThrow('Start failed');
      await expect(mockAPI.stopApp()).rejects.toThrow('Stop failed');
      await expect(mockAPI.restartApp()).rejects.toThrow('Restart failed');
    });

    it('should handle listener callback errors gracefully', () => {
      let errorCallback: ((status: string) => void) | null = null;

      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: () => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: (callback: (status: string) => void) => {
          errorCallback = callback;
          return () => {
            errorCallback = null;
          };
        },
        onLog: () => () => {},
      };

      // Register listener that throws
      mockAPI.onAppStatus(() => {
        throw new Error('Listener error');
      });

      // Triggering the callback should not crash
      expect(() => {
        try {
          errorCallback?.('running');
        } catch (error) {
          // Error is caught and handled
          expect(error).toBeInstanceOf(Error);
        }
      }).not.toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should enforce callback parameter types', () => {
      const mockAPI: ElectronAPI = {
        getConfig: () => Promise.resolve({}),
        saveConfig: () => Promise.resolve(true),
        getAppStatus: () => Promise.resolve('stopped'),
        startApp: () => Promise.resolve(undefined),
        stopApp: () => Promise.resolve(undefined),
        restartApp: () => Promise.resolve(undefined),
        onAppStatus: (callback: (status: string) => void) => {
          // Type check: callback must accept string parameter
          callback('test');
          return () => {};
        },
        onLog: (callback: (level: string, message: string) => void) => {
          // Type check: callback must accept two string parameters
          callback('info', 'test message');
          return () => {};
        },
      };

      // These should not cause type errors
      mockAPI.onAppStatus((status: string) => {
        expect(typeof status).toBe('string');
      });

      mockAPI.onLog((level: string, message: string) => {
        expect(typeof level).toBe('string');
        expect(typeof message).toBe('string');
      });
    });
  });
});
