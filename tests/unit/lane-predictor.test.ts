/**
 * Lane Predictor unit tests
 */

import { describe, it, expect } from '@jest/globals';
import { LanePredictor } from '../../src/core/prediction/lane-predictor.js';
import type { Champion, ChampionPick } from '../../src/types/champion.js';

describe('LanePredictor', () => {
  const predictor = new LanePredictor();

  const createChampion = (name: string, roles: string[]): Champion => ({
    id: 1,
    name,
    roles: roles as any,
  });

  const createPick = (
    champion: Champion,
    role: string,
    team: 'ally' | 'enemy' = 'ally'
  ): ChampionPick => ({
    champion: { ...champion, predictedRole: role as any },
    team,
    pickOrder: 1,
    isPlayerChampion: false,
  });

  describe('predict', () => {
    it('should predict top for top-focused champion', () => {
      const darius = createChampion('Darius', ['top', 'jungle']);
      const role = predictor.predict(darius, [], 1);
      expect(role).toBe('top');
    });

    it('should skip occupied roles', () => {
      const garen = createChampion('Garen', ['top', 'mid']);
      const team = [createPick(createChampion('Darius', ['top']), 'top')];

      const role = predictor.predict(garen, team, 2);
      expect(role).toBe('mid');
    });

    it('should return null when all roles are occupied', () => {
      const ahri = createChampion('Ahri', ['mid']);
      const team = [createPick(createChampion('Zed', ['mid']), 'mid')];

      const role = predictor.predict(ahri, team, 2);
      expect(role).toBeNull();
    });

    it('should use pick order preferences', () => {
      const lux = createChampion('Lux', ['mid', 'support']);
      const role = predictor.predict(lux, [], 5);
      expect(role).toBe('support'); // Pick 5 prefers support
    });
  });

  describe('predictMatchupOpponent', () => {
    it('should find opponent in same lane', () => {
      const enemyTeam = [
        createPick(createChampion('Zed', ['mid']), 'mid', 'enemy'),
        createPick(createChampion('Darius', ['top']), 'top', 'enemy'),
      ];

      const opponent = predictor.predictMatchupOpponent('mid', enemyTeam);
      expect(opponent).not.toBeNull();
      expect(opponent?.champion.name).toBe('Zed');
    });

    it('should return null when no opponent in lane', () => {
      const enemyTeam = [createPick(createChampion('Darius', ['top']), 'top', 'enemy')];

      const opponent = predictor.predictMatchupOpponent('mid', enemyTeam);
      expect(opponent).toBeNull();
    });
  });

  describe('predictFromTeamComposition', () => {
    it('should predict first available role', () => {
      const ahri = createChampion('Ahri', ['mid', 'support']);
      const team = [createPick(createChampion('Lux', ['mid']), 'mid')];

      const role = predictor.predictFromTeamComposition(ahri, team);
      expect(role).toBe('support');
    });

    it('should return primary role when all occupied', () => {
      const yasuo = createChampion('Yasuo', ['mid', 'top']);
      const team = [
        createPick(createChampion('Zed', ['mid']), 'mid'),
        createPick(createChampion('Darius', ['top']), 'top'),
      ];

      const role = predictor.predictFromTeamComposition(yasuo, team);
      expect(role).toBe('mid'); // Primary role
    });
  });
});
