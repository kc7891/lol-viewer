/**
 * LCU Event type definitions
 */

import type { Role, Team } from './champion.js';

/**
 * Champion select event types
 */
export type ChampSelectEventType = 'ban' | 'pick' | 'hover' | 'lock-in';

/**
 * Game phase types
 */
export type GamePhase =
  | 'none'
  | 'lobby'
  | 'matchmaking'
  | 'ready-check'
  | 'champ-select'
  | 'in-game'
  | 'post-game';

/**
 * Champion select event
 */
export interface ChampSelectEvent {
  /** Event type */
  readonly type: ChampSelectEventType;

  /** Champion ID */
  readonly championId: number;

  /** Champion name */
  readonly championName: string;

  /** Player/summoner ID */
  readonly playerId: string;

  /** Predicted position/role */
  readonly position: Role | 'unknown';

  /** Team side */
  readonly team: Team;

  /** Pick order (1-5) */
  readonly pickOrder: number;

  /** Whether this is the local player */
  readonly isLocalPlayer: boolean;

  /** Event timestamp */
  readonly timestamp: Date;
}

/**
 * Game start event
 */
export interface GameStartEvent {
  /** Game ID */
  readonly gameId: string;

  /** Local player's champion ID */
  readonly championId: number;

  /** Local player's champion name */
  readonly championName: string;

  /** Game mode */
  readonly gameMode: string;

  /** Event timestamp */
  readonly timestamp: Date;
}

/**
 * Raw LCU WebSocket event
 */
export interface LCUEvent {
  readonly uri: string;
  readonly eventType: string;
  readonly data: unknown;
}

/**
 * LCU Connection status
 */
export type LCUConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;
