/**
 * Champion-related type definitions
 */

/**
 * League of Legends role/lane positions
 */
export type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

/**
 * Champion interface
 */
export interface Champion {
  /** Champion ID from Riot API */
  readonly id: number;

  /** Champion name (e.g., "Ahri", "Lee Sin") */
  readonly name: string;

  /** Possible roles for this champion */
  readonly roles: readonly Role[];

  /** Predicted role in current team composition */
  predictedRole?: Role;
}

/**
 * Champion data from Data Dragon API
 */
export interface ChampionData {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly tags: readonly string[];
}

/**
 * Mapping of champion ID to champion data
 */
export type ChampionMap = Map<number, Champion>;

/**
 * Team side
 */
export type Team = 'ally' | 'enemy';

/**
 * Champion pick information
 */
export interface ChampionPick {
  readonly champion: Champion;
  readonly team: Team;
  readonly pickOrder: number;
  readonly isPlayerChampion: boolean;
}
