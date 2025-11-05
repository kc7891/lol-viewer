/**
 * Lane/role predictor
 */

import type { Champion, Role, ChampionPick } from '../../types/champion.js';
import { logger } from '../../utils/logger.js';

/**
 * Pick order patterns for role prediction
 * Different pick positions tend to favor different roles
 */
const PICK_ORDER_ROLE_PREFERENCES: Record<number, Role[]> = {
  1: ['top', 'jungle', 'support'], // First pick often top or jungle
  2: ['jungle', 'top', 'mid'], // Second pick
  3: ['mid', 'adc', 'top'], // Middle picks
  4: ['adc', 'support', 'mid'], // Late picks
  5: ['support', 'adc', 'mid'], // Last pick often support/adc
};

/**
 * Lane predictor class
 */
export class LanePredictor {
  /**
   * Predict lane for a champion based on context
   *
   * @param champion - Champion to predict lane for
   * @param team - Current team composition
   * @param pickOrder - Pick order (1-5)
   * @returns Predicted role or null if cannot determine
   */
  predict(champion: Champion, team: ChampionPick[], pickOrder: number): Role | null {
    logger.debug('Predicting lane', {
      champion: champion.name,
      pickOrder,
      teamSize: team.length,
    });

    // Get already occupied roles
    const occupiedRoles = new Set<Role>(
      team.map((pick) => pick.champion.predictedRole).filter((role): role is Role => role !== undefined)
    );

    // Get champion's possible roles
    const possibleRoles = champion.roles.filter((role) => !occupiedRoles.has(role));

    if (possibleRoles.length === 0) {
      logger.warn('No available roles for champion', {
        champion: champion.name,
        occupiedRoles: Array.from(occupiedRoles),
      });
      return null;
    }

    // If only one possible role, return it
    if (possibleRoles.length === 1) {
      const predictedRole = possibleRoles[0];
      logger.debug('Predicted lane (only option)', {
        champion: champion.name,
        role: predictedRole,
      });
      return predictedRole;
    }

    // Use pick order preferences to break ties
    const pickOrderPreferences = PICK_ORDER_ROLE_PREFERENCES[pickOrder] ?? [];

    for (const preferredRole of pickOrderPreferences) {
      if (possibleRoles.includes(preferredRole)) {
        logger.debug('Predicted lane (pick order preference)', {
          champion: champion.name,
          role: preferredRole,
          pickOrder,
        });
        return preferredRole;
      }
    }

    // Fallback to champion's primary role (first in the list)
    const fallbackRole = possibleRoles[0];
    logger.debug('Predicted lane (fallback to primary)', {
      champion: champion.name,
      role: fallbackRole,
    });

    return fallbackRole;
  }

  /**
   * Predict matchup lane (which enemy laner to compare against)
   *
   * @param myRole - My champion's role
   * @param enemyTeam - Enemy team composition
   * @returns Enemy champion in the same lane, or null if not found
   */
  predictMatchupOpponent(myRole: Role, enemyTeam: ChampionPick[]): ChampionPick | null {
    // Find enemy champion in the same role
    const opponent = enemyTeam.find((pick) => pick.champion.predictedRole === myRole);

    if (opponent) {
      logger.debug('Found matchup opponent', {
        myRole,
        opponent: opponent.champion.name,
      });
      return opponent;
    }

    logger.debug('No matchup opponent found', { myRole });
    return null;
  }

  /**
   * Predict lane from team composition (when champion is being hovered)
   *
   * @param champion - Champion being hovered
   * @param teamComposition - Current team composition
   * @returns Most likely role
   */
  predictFromTeamComposition(champion: Champion, teamComposition: ChampionPick[]): Role | null {
    // Get occupied roles
    const occupiedRoles = new Set<Role>(
      teamComposition
        .map((pick) => pick.champion.predictedRole)
        .filter((role): role is Role => role !== undefined)
    );

    // Find first available role from champion's roles
    for (const role of champion.roles) {
      if (!occupiedRoles.has(role)) {
        logger.debug('Predicted lane from team composition', {
          champion: champion.name,
          role,
        });
        return role;
      }
    }

    // If all roles are occupied, return champion's primary role
    const primaryRole = champion.roles[0] ?? null;
    logger.debug('All roles occupied, using primary', {
      champion: champion.name,
      role: primaryRole,
    });

    return primaryRole;
  }
}

/**
 * Default lane predictor instance
 */
export const lanePredictor = new LanePredictor();
