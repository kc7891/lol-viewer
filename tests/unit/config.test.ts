/**
 * Config loader unit tests
 */

import { describe, it, expect } from '@jest/globals';
import { loadConfigSync } from '../../src/utils/config.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';

describe('Config Loader', () => {
  describe('loadConfigSync', () => {
    it('should return default config', () => {
      const config = loadConfigSync();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should have valid browser config', () => {
      const config = loadConfigSync();
      expect(config.browser.type).toBe('chromium');
      expect(config.browser.width).toBe(1200);
      expect(config.browser.height).toBe(800);
    });

    it('should have valid LoL Analytics config', () => {
      const config = loadConfigSync();
      expect(config.lolAnalytics.baseUrl).toBe('https://lolanalytics.com');
      expect(config.lolAnalytics.autoOpenDelay).toBe(2000);
    });

    it('should have all features configured', () => {
      const config = loadConfigSync();
      const features = config.lolAnalytics.features;

      expect(features.matchup.enabled).toBe(true);
      expect(features.myCounters.enabled).toBe(true);
      expect(features.enemyCounters.enabled).toBe(true);
      expect(features.buildGuide.enabled).toBe(true);
      expect(features.buildGuide.inGame).toBe(true);
    });

    it('should have valid LCU config', () => {
      const config = loadConfigSync();
      expect(config.lcu.autoDetect).toBe(true);
      expect(config.lcu.maxRetries).toBe(10);
      expect(config.lcu.retryInterval).toBe(5000);
    });
  });
});
