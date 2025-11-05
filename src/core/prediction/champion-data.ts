/**
 * Champion data fetcher using Riot's Data Dragon API
 */

import type { Champion, ChampionData, ChampionMap, Role } from '../../types/champion.js';
import { logger } from '../../utils/logger.js';
import { retry } from '../../utils/retry.js';

/**
 * Data Dragon API base URL
 */
const DATA_DRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com';

/**
 * Cache TTL (Time To Live) in milliseconds - 24 hours
 */
const CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Role mapping from champion tags
 */
const TAG_TO_ROLE_MAP: Record<string, Role[]> = {
  Fighter: ['top', 'jungle'],
  Tank: ['top', 'jungle', 'support'],
  Mage: ['mid', 'support'],
  Assassin: ['mid', 'jungle'],
  Marksman: ['adc'],
  Support: ['support'],
};

/**
 * Cache entry
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Champion data fetcher class
 */
export class ChampionDataFetcher {
  private championCache: CacheEntry<ChampionMap> | null = null;
  private versionCache: CacheEntry<string> | null = null;

  /**
   * Get latest Data Dragon version
   */
  private async getLatestVersion(): Promise<string> {
    // Check cache
    if (this.versionCache && Date.now() - this.versionCache.timestamp < CACHE_TTL) {
      return this.versionCache.data;
    }

    const url = `${DATA_DRAGON_BASE_URL}/api/versions.json`;

    const versions = await retry(
      async () => {
        logger.debug(`Fetching versions from ${url}`);
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch versions: ${response.statusText}`);
        }

        return (await response.json()) as string[];
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: 'exponential',
      }
    );

    const latestVersion = versions[0];
    if (!latestVersion) {
      throw new Error('No versions found in Data Dragon API');
    }

    // Update cache
    this.versionCache = {
      data: latestVersion,
      timestamp: Date.now(),
    };

    logger.info(`Latest Data Dragon version: ${latestVersion}`);
    return latestVersion;
  }

  /**
   * Convert champion tags to roles
   */
  private tagsToRoles(tags: readonly string[]): Role[] {
    const roles = new Set<Role>();

    for (const tag of tags) {
      const mappedRoles = TAG_TO_ROLE_MAP[tag];
      if (mappedRoles) {
        for (const role of mappedRoles) {
          roles.add(role);
        }
      }
    }

    // Default to mid if no roles found
    if (roles.size === 0) {
      roles.add('mid');
    }

    return Array.from(roles);
  }

  /**
   * Fetch all champion data from Data Dragon
   */
  async fetchChampionData(): Promise<ChampionMap> {
    // Check cache
    if (this.championCache && Date.now() - this.championCache.timestamp < CACHE_TTL) {
      logger.debug('Returning cached champion data');
      return this.championCache.data;
    }

    const version = await this.getLatestVersion();
    const url = `${DATA_DRAGON_BASE_URL}/cdn/${version}/data/en_US/champion.json`;

    const data = await retry(
      async () => {
        logger.debug(`Fetching champion data from ${url}`);
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch champion data: ${response.statusText}`);
        }

        return (await response.json()) as {
          data: Record<string, ChampionData>;
        };
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: 'exponential',
      }
    );

    // Convert to ChampionMap
    const championMap = new Map<number, Champion>();

    for (const [, championData] of Object.entries(data.data)) {
      const championId = Number.parseInt(championData.key, 10);
      const roles = this.tagsToRoles(championData.tags);

      const champion: Champion = {
        id: championId,
        name: championData.id,
        roles,
      };

      championMap.set(championId, champion);
    }

    // Update cache
    this.championCache = {
      data: championMap,
      timestamp: Date.now(),
    };

    logger.info(`Fetched ${championMap.size} champions from Data Dragon`);
    return championMap;
  }

  /**
   * Get champion by ID
   */
  async getChampionById(id: number): Promise<Champion | undefined> {
    const championMap = await this.fetchChampionData();
    return championMap.get(id);
  }

  /**
   * Get champion by name (case-insensitive)
   */
  async getChampionByName(name: string): Promise<Champion | undefined> {
    const championMap = await this.fetchChampionData();
    const normalizedName = name.toLowerCase().replace(/\s+/g, '');

    for (const champion of championMap.values()) {
      const championNormalizedName = champion.name.toLowerCase().replace(/\s+/g, '');
      if (championNormalizedName === normalizedName) {
        return champion;
      }
    }

    return undefined;
  }

  /**
   * Clear cache (useful for testing or forcing refresh)
   */
  clearCache(): void {
    this.championCache = null;
    this.versionCache = null;
    logger.debug('Champion data cache cleared');
  }
}

/**
 * Default champion data fetcher instance
 */
export const championDataFetcher = new ChampionDataFetcher();
