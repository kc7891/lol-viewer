/**
 * Analytics site interface types
 */

import type { Role } from '../../types/champion.js';

/**
 * Analytics site interface
 */
export interface AnalyticsSite {
  /**
   * Base URL of the analytics site
   */
  readonly baseUrl: string;

  /**
   * Build matchup URL for two champions
   * @param champion1 - First champion name
   * @param champion2 - Second champion name (opponent)
   * @param role - Optional role/lane
   */
  buildMatchupURL(champion1: string, champion2: string, role?: Role): string;

  /**
   * Build counter URL for a champion
   * @param champion - Champion name
   * @param role - Optional role/lane
   */
  buildCounterURL(champion: string, role?: Role): string;

  /**
   * Build build guide URL for a champion
   * @param champion - Champion name
   * @param role - Optional role/lane
   */
  buildBuildURL(champion: string, role?: Role): string;

  /**
   * Build champion page URL
   * @param champion - Champion name
   * @param role - Optional role/lane
   */
  buildChampionURL(champion: string, role?: Role): string;
}
