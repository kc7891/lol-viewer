/**
 * URL Builder unit tests
 */

import { describe, it, expect } from '@jest/globals';
import { URLBuilder } from '../../src/core/analytics/url-builder.js';
import { LoLAnalyticsSite } from '../../src/core/analytics/sites/lol-analytics.js';

describe('LoLAnalyticsSite', () => {
  const site = new LoLAnalyticsSite('https://lolanalytics.com');

  describe('buildMatchupURL', () => {
    it('should build matchup URL without role', () => {
      const url = site.buildMatchupURL('Ahri', 'Zed');
      expect(url).toBe('https://lolanalytics.com/champion/Ahri/matchup/Zed');
    });

    it('should build matchup URL with role', () => {
      const url = site.buildMatchupURL('Ahri', 'Zed', 'mid');
      expect(url).toBe('https://lolanalytics.com/champion/Ahri/matchup/Zed/mid');
    });

    it('should normalize champion names', () => {
      const url = site.buildMatchupURL("Kai'Sa", 'Lee Sin');
      expect(url).toBe('https://lolanalytics.com/champion/KaiSa/matchup/LeeSin');
    });
  });

  describe('buildCounterURL', () => {
    it('should build counter URL without role', () => {
      const url = site.buildCounterURL('Yasuo');
      expect(url).toBe('https://lolanalytics.com/champion/Yasuo/counters');
    });

    it('should build counter URL with role', () => {
      const url = site.buildCounterURL('Yasuo', 'mid');
      expect(url).toBe('https://lolanalytics.com/champion/Yasuo/counters/mid');
    });
  });

  describe('buildBuildURL', () => {
    it('should build build URL without role', () => {
      const url = site.buildBuildURL('Jinx');
      expect(url).toBe('https://lolanalytics.com/champion/Jinx/build');
    });

    it('should build build URL with role', () => {
      const url = site.buildBuildURL('Jinx', 'adc');
      expect(url).toBe('https://lolanalytics.com/champion/Jinx/build/adc');
    });
  });

  describe('buildChampionURL', () => {
    it('should build champion URL without role', () => {
      const url = site.buildChampionURL('Garen');
      expect(url).toBe('https://lolanalytics.com/champion/Garen');
    });

    it('should build champion URL with role', () => {
      const url = site.buildChampionURL('Garen', 'top');
      expect(url).toBe('https://lolanalytics.com/champion/Garen/top');
    });
  });
});

describe('URLBuilder', () => {
  it('should create LoLAnalyticsSite by default', () => {
    const builder = new URLBuilder();
    const url = builder.buildMatchupURL('Ahri', 'Zed');
    expect(url).toContain('lolanalytics.com');
  });

  it('should use custom base URL', () => {
    const builder = new URLBuilder('lol-analytics', 'https://custom.com');
    const url = builder.buildMatchupURL('Ahri', 'Zed');
    expect(url).toBe('https://custom.com/champion/Ahri/matchup/Zed');
  });
});
