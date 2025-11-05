/**
 * URL Builder factory for multiple analytics sites
 */

import type { Role } from '../../types/champion.js';
import type { AnalyticsSite } from './types.js';
import { LoLAnalyticsSite } from './sites/lol-analytics.js';

/**
 * Supported analytics sites
 */
export type AnalyticsSiteType = 'lol-analytics' | 'u.gg' | 'op.gg';

/**
 * URL Builder class that supports multiple analytics sites
 */
export class URLBuilder {
  private site: AnalyticsSite;

  constructor(siteType: AnalyticsSiteType = 'lol-analytics', customBaseUrl?: string) {
    switch (siteType) {
      case 'lol-analytics':
        this.site = new LoLAnalyticsSite(customBaseUrl);
        break;
      case 'u.gg':
        // TODO: Implement UGGSite in future
        throw new Error('u.gg site not implemented yet');
      case 'op.gg':
        // TODO: Implement OPGGSite in future
        throw new Error('op.gg site not implemented yet');
      default:
        throw new Error(`Unknown analytics site: ${siteType}`);
    }
  }

  /**
   * Build matchup URL
   */
  buildMatchupURL(champion1: string, champion2: string, role?: Role): string {
    return this.site.buildMatchupURL(champion1, champion2, role);
  }

  /**
   * Build counter URL
   */
  buildCounterURL(champion: string, role?: Role): string {
    return this.site.buildCounterURL(champion, role);
  }

  /**
   * Build build guide URL
   */
  buildBuildURL(champion: string, role?: Role): string {
    return this.site.buildBuildURL(champion, role);
  }

  /**
   * Build champion page URL
   */
  buildChampionURL(champion: string, role?: Role): string {
    return this.site.buildChampionURL(champion, role);
  }

  /**
   * Get the underlying analytics site
   */
  getSite(): AnalyticsSite {
    return this.site;
  }
}
