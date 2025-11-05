/**
 * LoL Analytics site URL builder
 */

import type { Role } from '../../../types/champion.js';
import type { AnalyticsSite } from '../types.js';

/**
 * Normalize champion name for URL (replace spaces with hyphens, etc.)
 */
function normalizeChampionName(name: string): string {
  return name.replace(/['\s]/g, '').replace(/\./g, '');
}

/**
 * LoL Analytics site implementation
 */
export class LoLAnalyticsSite implements AnalyticsSite {
  constructor(public readonly baseUrl: string = 'https://lolanalytics.com') {}

  buildMatchupURL(champion1: string, champion2: string, role?: Role): string {
    const champ1 = normalizeChampionName(champion1);
    const champ2 = normalizeChampionName(champion2);

    if (role) {
      return `${this.baseUrl}/champion/${champ1}/matchup/${champ2}/${role}`;
    }

    return `${this.baseUrl}/champion/${champ1}/matchup/${champ2}`;
  }

  buildCounterURL(champion: string, role?: Role): string {
    const champ = normalizeChampionName(champion);

    if (role) {
      return `${this.baseUrl}/champion/${champ}/counters/${role}`;
    }

    return `${this.baseUrl}/champion/${champ}/counters`;
  }

  buildBuildURL(champion: string, role?: Role): string {
    const champ = normalizeChampionName(champion);

    if (role) {
      return `${this.baseUrl}/champion/${champ}/build/${role}`;
    }

    return `${this.baseUrl}/champion/${champ}/build`;
  }

  buildChampionURL(champion: string, role?: Role): string {
    const champ = normalizeChampionName(champion);

    if (role) {
      return `${this.baseUrl}/champion/${champ}/${role}`;
    }

    return `${this.baseUrl}/champion/${champ}`;
  }
}
