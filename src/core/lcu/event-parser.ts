/**
 * LCU event parser
 */

import type {
  ChampSelectEvent,
  ChampSelectEventType,
  LCUEvent,
  GameStartEvent,
} from '../../types/event.js';
import type { Team } from '../../types/champion.js';
import { logger } from '../../utils/logger.js';

/**
 * Champion select session data structure
 */
interface ChampSelectSession {
  actions: Action[][];
  localPlayerCellId: number;
  myTeam: TeamMember[];
  theirTeam: TeamMember[];
}

interface Action {
  actorCellId: number;
  championId: number;
  completed: boolean;
  id: number;
  isAllyAction: boolean;
  type: 'ban' | 'pick';
}

interface TeamMember {
  cellId: number;
  championId: number;
  championPickIntent: number;
}

/**
 * Champion select event parser
 */
export class ChampSelectEventParser {
  /**
   * Parse champion select event from LCU event
   */
  parseChampSelectEvent(lcuEvent: LCUEvent): ChampSelectEvent | null {
    // Check if this is a champion select event
    if (!lcuEvent.uri.includes('/lol-champ-select/v1/session')) {
      return null;
    }

    try {
      const session = lcuEvent.data as ChampSelectSession;

      if (!session || !session.actions) {
        return null;
      }

      // Find the most recent action
      const allActions: Action[] = [];
      for (const actionGroup of session.actions) {
        allActions.push(...actionGroup);
      }

      // Get the latest completed action
      const latestAction = allActions
        .filter((action) => action.completed)
        .sort((a, b) => b.id - a.id)[0];

      if (!latestAction || latestAction.championId === 0) {
        return null;
      }

      // Determine event type
      const eventType: ChampSelectEventType = latestAction.type === 'ban' ? 'ban' : 'pick';

      // Determine team
      const team: Team = latestAction.isAllyAction ? 'ally' : 'enemy';

      // Check if this is the local player
      const isLocalPlayer = latestAction.actorCellId === session.localPlayerCellId;

      // Calculate pick order (1-5)
      const pickOrder = latestAction.actorCellId + 1;

      const champSelectEvent: ChampSelectEvent = {
        type: eventType,
        championId: latestAction.championId,
        championName: '', // Will be filled by champion data fetcher
        playerId: latestAction.actorCellId.toString(),
        position: 'unknown',
        team,
        pickOrder,
        isLocalPlayer,
        timestamp: new Date(),
      };

      logger.debug('Parsed champion select event', {
        type: eventType,
        championId: latestAction.championId,
        team,
        isLocalPlayer,
      });

      return champSelectEvent;
    } catch (error) {
      logger.error('Failed to parse champion select event', error as Error);
      return null;
    }
  }

  /**
   * Parse game start event from LCU event
   */
  parseGameStartEvent(lcuEvent: LCUEvent): GameStartEvent | null {
    // Check if this is a game start event
    if (!lcuEvent.uri.includes('/lol-gameflow/v1/gameflow-phase')) {
      return null;
    }

    try {
      const phase = lcuEvent.data as string;

      if (phase !== 'InProgress') {
        return null;
      }

      // Note: We'll need to get champion info from the in-game API
      const gameStartEvent: GameStartEvent = {
        gameId: '', // Will be filled from in-game API
        championId: 0, // Will be filled from in-game API
        championName: '', // Will be filled from in-game API
        gameMode: '', // Will be filled from in-game API
        timestamp: new Date(),
      };

      logger.info('Game started');

      return gameStartEvent;
    } catch (error) {
      logger.error('Failed to parse game start event', error as Error);
      return null;
    }
  }
}
