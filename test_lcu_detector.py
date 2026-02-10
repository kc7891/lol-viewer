#!/usr/bin/env python3
"""
Test cases for LCU Champion Detector
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from lcu_detector import (
    LCUConnectionManager,
    GamePhaseTracker,
    ChampionDetector,
    ChampionDetectorService
)


class TestLCUConnectionManager:
    """Test cases for LCUConnectionManager"""

    @patch('lcu_detector.psutil.process_iter')
    def test_get_credentials_success(self, mock_process_iter):
        """Test successful credential retrieval from process"""
        # Mock process with LCU command line
        mock_proc = Mock()
        mock_proc.info = {
            'name': 'LeagueClientUx.exe',
            'cmdline': [
                'LeagueClientUx.exe',
                '--app-port=12345',
                '--remoting-auth-token=test-token-123'
            ]
        }
        mock_process_iter.return_value = [mock_proc]

        manager = LCUConnectionManager()
        result = manager.connect()

        assert result is True
        assert manager.port == '12345'
        assert manager.password == 'test-token-123'
        assert manager.connected is True

    @patch('lcu_detector.psutil.process_iter')
    def test_get_credentials_no_process(self, mock_process_iter):
        """Test credential retrieval when process not found"""
        mock_process_iter.return_value = []

        manager = LCUConnectionManager()
        result = manager.connect()

        assert result is False
        assert manager.connected is False

    @patch('lcu_detector.psutil.process_iter')
    def test_is_client_running_true(self, mock_process_iter):
        """Test client running detection when client is running"""
        mock_proc = Mock()
        mock_proc.info = {'name': 'LeagueClientUx.exe'}
        mock_process_iter.return_value = [mock_proc]

        manager = LCUConnectionManager()
        assert manager.is_client_running() is True

    @patch('lcu_detector.psutil.process_iter')
    def test_is_client_running_false(self, mock_process_iter):
        """Test client running detection when client is not running"""
        mock_process_iter.return_value = []

        manager = LCUConnectionManager()
        assert manager.is_client_running() is False

    def test_get_auth_header(self):
        """Test authorization header generation"""
        manager = LCUConnectionManager()
        manager.password = 'test-password'

        header = manager.get_auth_header()
        assert header.startswith('Basic ')
        assert 'riot:test-password' in header or header  # Base64 encoded

    @patch('lcu_detector.requests.get')
    def test_make_request_success(self, mock_get):
        """Test successful API request"""
        manager = LCUConnectionManager()
        manager.connected = True
        manager.port = '12345'
        manager.password = 'test-password'

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'phase': 'ChampSelect'}
        mock_get.return_value = mock_response

        result = manager.make_request('/test-endpoint')

        assert result == {'phase': 'ChampSelect'}
        mock_get.assert_called_once()

    @patch('lcu_detector.requests.get')
    def test_make_request_not_connected(self, mock_get):
        """Test API request when not connected"""
        manager = LCUConnectionManager()
        manager.connected = False

        result = manager.make_request('/test-endpoint')

        assert result is None
        mock_get.assert_not_called()


class TestGamePhaseTracker:
    """Test cases for GamePhaseTracker"""

    def test_initial_phase(self):
        """Test initial game phase"""
        manager = Mock()
        tracker = GamePhaseTracker(manager)

        assert tracker.current_phase == "None"

    def test_update_phase_success(self):
        """Test phase update with successful response"""
        manager = Mock()
        manager.make_request.return_value = {'phase': 'ChampSelect'}

        tracker = GamePhaseTracker(manager)
        phase = tracker.update_phase()

        assert phase == 'ChampSelect'
        assert tracker.current_phase == 'ChampSelect'

    def test_update_phase_no_response_during_game_keeps_phase(self):
        """Test that transient API failure during InProgress keeps the phase"""
        manager = Mock()
        manager.make_request.return_value = None

        tracker = GamePhaseTracker(manager)
        tracker.current_phase = 'InProgress'
        phase = tracker.update_phase()

        assert phase == 'InProgress'
        assert tracker.current_phase == 'InProgress'

    def test_update_phase_no_response_outside_game_resets(self):
        """Test that API failure outside of game resets phase to None"""
        manager = Mock()
        manager.make_request.return_value = None

        tracker = GamePhaseTracker(manager)
        tracker.current_phase = 'Lobby'
        phase = tracker.update_phase()

        assert phase == 'None'
        assert tracker.current_phase == 'None'

    def test_is_in_champ_select(self):
        """Test champion select detection"""
        manager = Mock()
        tracker = GamePhaseTracker(manager)

        tracker.current_phase = 'ChampSelect'
        assert tracker.is_in_champ_select() is True

        tracker.current_phase = 'InProgress'
        assert tracker.is_in_champ_select() is False

    def test_is_in_game(self):
        """Test in-game detection"""
        manager = Mock()
        tracker = GamePhaseTracker(manager)

        tracker.current_phase = 'InProgress'
        assert tracker.is_in_game() is True

        tracker.current_phase = 'ChampSelect'
        assert tracker.is_in_game() is False


class TestChampionDetector:
    """Test cases for ChampionDetector"""

    @patch('lcu_detector.requests.get')
    def test_load_champion_map_success(self, mock_get):
        """Test successful champion map loading"""
        # Mock version response
        mock_version_response = Mock()
        mock_version_response.json.return_value = ['13.24.1', '13.24.0']

        # Mock champion data response
        mock_champion_response = Mock()
        mock_champion_response.json.return_value = {
            'data': {
                'Ashe': {'key': '22'},
                'Jinx': {'key': '222'}
            }
        }

        mock_get.side_effect = [mock_version_response, mock_champion_response]

        manager = Mock()
        phase_tracker = Mock()
        detector = ChampionDetector(manager, phase_tracker)

        assert 22 in detector.champion_map
        assert detector.champion_map[22] == 'Ashe'
        assert 222 in detector.champion_map
        assert detector.champion_map[222] == 'Jinx'

    def test_detect_champion_in_champ_select(self):
        """Test champion detection in champ select"""
        manager = Mock()
        manager.make_request.return_value = {
            'localPlayerCellId': 0,
            'myTeam': [
                {'cellId': 0, 'championId': 22}
            ]
        }

        phase_tracker = Mock()
        phase_tracker.update_phase.return_value = 'ChampSelect'

        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {22: 'Ashe'}

        champion = detector.detect_champion()

        assert champion == 'Ashe'
        assert detector.current_champion_name == 'Ashe'

    def test_detect_champion_in_progress(self):
        """Test champion detection in-game"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.update_phase.return_value = 'InProgress'

        detector = ChampionDetector(manager, phase_tracker)
        detector.current_champion_name = 'Ashe'

        champion = detector.detect_champion()

        assert champion == 'Ashe'

    def test_detect_champion_none_phase(self):
        """Test champion detection when phase is None"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.update_phase.return_value = 'None'

        detector = ChampionDetector(manager, phase_tracker)
        detector.current_champion_name = 'Ashe'

        champion = detector.detect_champion()

        assert champion is None
        assert detector.current_champion_name is None


class TestChampionDetectorService:
    """Test cases for ChampionDetectorService"""

    def test_initialization(self):
        """Test service initialization"""
        service = ChampionDetectorService()

        assert service.lcu_manager is not None
        assert service.phase_tracker is not None
        assert service.detector is not None
        assert service.last_champion is None
        assert service.running is False

    def test_start_stop(self):
        """Test starting and stopping the service"""
        service = ChampionDetectorService()

        service.start(interval_ms=1000)
        assert service.running is True
        assert service.timer.isActive() is True

        service.stop()
        assert service.running is False
        assert service.timer.isActive() is False


class TestMatchupPairs:
    """Test cases for matchup pair extraction"""

    def test_get_matchup_pairs_from_champ_select_data(self):
        """Test matchup pairs from ChampSelect myTeam/theirTeam"""
        manager = Mock()
        phase_tracker = Mock()
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {22: 'Ashe', 51: 'Caitlyn', 238: 'Zed'}

        data = {
            'myTeam': [{'championId': 22}],
            'theirTeam': [{'championId': 51}, {'championId': 238}],
        }
        pairs = detector.get_matchup_pairs_from_data(data)
        assert pairs == [('Ashe', 'Caitlyn'), ('', 'Zed')]

    def test_get_matchup_pairs_unpicked(self):
        """Test that unpicked champions (id=0) show as empty string"""
        manager = Mock()
        phase_tracker = Mock()
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {22: 'Ashe'}

        data = {
            'myTeam': [{'championId': 22}, {'championId': 0}],
            'theirTeam': [{'championId': 0}, {'championId': 0}],
        }
        pairs = detector.get_matchup_pairs_from_data(data)
        assert pairs == [('Ashe', ''), ('', '')]

    def test_get_matchup_pairs_from_gamedata_team_one(self):
        """Test matchup pairs from gameData when player is on teamOne"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [{'summonerId': 100, 'championId': 22}],
                'teamTwo': [{'summonerId': 200, 'championId': 51}],
            }
        }
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {22: 'Ashe', 51: 'Caitlyn'}
        detector.current_summoner_id = 100

        pairs = detector.get_matchup_pairs_from_gamedata()
        assert len(pairs) == 5
        assert pairs[0] == ('Ashe', 'Caitlyn')

    def test_get_matchup_pairs_from_gamedata_team_two(self):
        """Test matchup pairs from gameData when player is on teamTwo"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [{'summonerId': 200, 'championId': 51}],
                'teamTwo': [{'summonerId': 100, 'championId': 22}],
            }
        }
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {22: 'Ashe', 51: 'Caitlyn'}
        detector.current_summoner_id = 100

        pairs = detector.get_matchup_pairs_from_gamedata()
        # ally=Ashe (teamTwo), enemy=Caitlyn (teamOne)
        assert len(pairs) == 5
        assert pairs[0] == ('Ashe', 'Caitlyn')

    def test_get_matchup_pairs_from_gamedata_no_session(self):
        """Test matchup pairs when no session data is available"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.last_session_data = None
        detector = ChampionDetector(manager, phase_tracker)

        assert detector.get_matchup_pairs_from_gamedata() == []

    def test_detect_champion_and_enemies_clears_on_lobby(self):
        """Test that None/Lobby phase resets summoner_id and returns empty pairs"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.update_phase.return_value = 'Lobby'
        detector = ChampionDetector(manager, phase_tracker)
        detector.current_champion_name = 'Ashe'
        detector.current_summoner_id = 100

        result = detector.detect_champion_and_enemies()
        assert result == (None, [], [])
        assert detector.current_summoner_id is None

    def test_detect_champion_and_enemies_in_progress_uses_gamedata(self):
        """Test that InProgress phase uses gameData for matchup pairs"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.update_phase.return_value = 'InProgress'
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [{'summonerId': 100, 'championId': 22}],
                'teamTwo': [{'summonerId': 200, 'championId': 51}],
            }
        }
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {22: 'Ashe', 51: 'Caitlyn'}
        detector.current_champion_name = 'Ashe'
        detector.current_lane = 'bottom'
        detector.current_summoner_id = 100

        own, enemies, pairs = detector.detect_champion_and_enemies()
        assert own == ('Ashe', 'bottom')
        assert enemies == []
        assert len(pairs) == 5
        assert pairs[0] == ('Ashe', 'Caitlyn')


    def test_matchup_pairs_locked_after_10_champions(self):
        """Test that matchup pairs are locked once all 10 champions are confirmed"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [
                    {'summonerId': 100, 'championId': 22},
                    {'summonerId': 101, 'championId': 51},
                    {'summonerId': 102, 'championId': 86},
                    {'summonerId': 103, 'championId': 99},
                    {'summonerId': 104, 'championId': 40},
                ],
                'teamTwo': [
                    {'summonerId': 200, 'championId': 238},
                    {'summonerId': 201, 'championId': 157},
                    {'summonerId': 202, 'championId': 67},
                    {'summonerId': 203, 'championId': 63},
                    {'summonerId': 204, 'championId': 37},
                ],
            }
        }
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {
            22: 'Ashe', 51: 'Caitlyn', 86: 'Garen', 99: 'Lux', 40: 'Janna',
            238: 'Zed', 157: 'Yasuo', 67: 'Vayne', 63: 'Brand', 37: 'Sona',
        }
        detector.current_summoner_id = 100

        pairs = detector.get_matchup_pairs_from_gamedata()
        assert len(pairs) == 5
        assert all(ally and enemy for ally, enemy in pairs)
        assert detector._matchup_pairs_locked is True

    def test_locked_pairs_not_overwritten_by_incomplete_data(self):
        """Test that once locked, incomplete API data does not overwrite the list"""
        manager = Mock()
        phase_tracker = Mock()
        # First call: full data
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [
                    {'summonerId': 100, 'championId': 22},
                    {'summonerId': 101, 'championId': 51},
                    {'summonerId': 102, 'championId': 86},
                    {'summonerId': 103, 'championId': 99},
                    {'summonerId': 104, 'championId': 40},
                ],
                'teamTwo': [
                    {'summonerId': 200, 'championId': 238},
                    {'summonerId': 201, 'championId': 157},
                    {'summonerId': 202, 'championId': 67},
                    {'summonerId': 203, 'championId': 63},
                    {'summonerId': 204, 'championId': 37},
                ],
            }
        }
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {
            22: 'Ashe', 51: 'Caitlyn', 86: 'Garen', 99: 'Lux', 40: 'Janna',
            238: 'Zed', 157: 'Yasuo', 67: 'Vayne', 63: 'Brand', 37: 'Sona',
        }
        detector.current_summoner_id = 100

        original_pairs = detector.get_matchup_pairs_from_gamedata()
        assert detector._matchup_pairs_locked is True

        # Second call: API returns incomplete data (first player championId=0)
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [
                    {'summonerId': 100, 'championId': 0},  # Missing!
                    {'summonerId': 101, 'championId': 51},
                    {'summonerId': 102, 'championId': 86},
                    {'summonerId': 103, 'championId': 99},
                    {'summonerId': 104, 'championId': 40},
                ],
                'teamTwo': [
                    {'summonerId': 200, 'championId': 0},  # Missing!
                    {'summonerId': 201, 'championId': 157},
                    {'summonerId': 202, 'championId': 67},
                    {'summonerId': 203, 'championId': 63},
                    {'summonerId': 204, 'championId': 37},
                ],
            }
        }
        locked_pairs = detector.get_matchup_pairs_from_gamedata()
        # Locked pairs must be identical to the original full list
        assert locked_pairs == original_pairs

    def test_locked_pairs_not_overwritten_by_none_session(self):
        """Test that locked pairs survive when session data becomes None"""
        manager = Mock()
        phase_tracker = Mock()
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [
                    {'summonerId': 100, 'championId': 22},
                    {'summonerId': 101, 'championId': 51},
                    {'summonerId': 102, 'championId': 86},
                    {'summonerId': 103, 'championId': 99},
                    {'summonerId': 104, 'championId': 40},
                ],
                'teamTwo': [
                    {'summonerId': 200, 'championId': 238},
                    {'summonerId': 201, 'championId': 157},
                    {'summonerId': 202, 'championId': 67},
                    {'summonerId': 203, 'championId': 63},
                    {'summonerId': 204, 'championId': 37},
                ],
            }
        }
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {
            22: 'Ashe', 51: 'Caitlyn', 86: 'Garen', 99: 'Lux', 40: 'Janna',
            238: 'Zed', 157: 'Yasuo', 67: 'Vayne', 63: 'Brand', 37: 'Sona',
        }
        detector.current_summoner_id = 100

        original_pairs = detector.get_matchup_pairs_from_gamedata()
        assert detector._matchup_pairs_locked is True

        # Session becomes None (transient failure)
        phase_tracker.last_session_data = None
        pairs_after = detector.get_matchup_pairs_from_gamedata()
        assert pairs_after == original_pairs

    def test_lock_cleared_on_game_end(self):
        """Test that the lock is cleared when game ends (None/Lobby phase)"""
        manager = Mock()
        phase_tracker = Mock()

        # Start in InProgress with full data
        phase_tracker.update_phase.return_value = 'InProgress'
        phase_tracker.last_session_data = {
            'gameData': {
                'teamOne': [
                    {'summonerId': 100, 'championId': 22},
                    {'summonerId': 101, 'championId': 51},
                    {'summonerId': 102, 'championId': 86},
                    {'summonerId': 103, 'championId': 99},
                    {'summonerId': 104, 'championId': 40},
                ],
                'teamTwo': [
                    {'summonerId': 200, 'championId': 238},
                    {'summonerId': 201, 'championId': 157},
                    {'summonerId': 202, 'championId': 67},
                    {'summonerId': 203, 'championId': 63},
                    {'summonerId': 204, 'championId': 37},
                ],
            }
        }
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {
            22: 'Ashe', 51: 'Caitlyn', 86: 'Garen', 99: 'Lux', 40: 'Janna',
            238: 'Zed', 157: 'Yasuo', 67: 'Vayne', 63: 'Brand', 37: 'Sona',
        }
        detector.current_summoner_id = 100
        detector.current_champion_name = 'Ashe'
        detector.current_lane = 'bottom'

        detector.detect_champion_and_enemies()
        assert detector._matchup_pairs_locked is True

        # Game ends
        phase_tracker.update_phase.return_value = 'Lobby'
        detector.detect_champion_and_enemies()
        assert detector._matchup_pairs_locked is False
        assert detector._cached_matchup_pairs == []

    def test_phase_tracker_keeps_phase_during_transient_failure(self):
        """Test that phase tracker does not reset to None during InProgress API failure"""
        manager = Mock()
        tracker = GamePhaseTracker(manager)

        # Simulate being in InProgress
        manager.make_request.return_value = {'phase': 'InProgress'}
        phase = tracker.update_phase()
        assert phase == 'InProgress'

        # Simulate API failure (returns None)
        manager.make_request.return_value = None
        phase = tracker.update_phase()
        # Should keep InProgress, not reset to None
        assert phase == 'InProgress'
        # last_session_data should be preserved (not set to None)
        assert tracker.last_session_data is not None

    def test_phase_tracker_resets_when_not_in_game(self):
        """Test that phase tracker resets to None when API fails outside of game"""
        manager = Mock()
        tracker = GamePhaseTracker(manager)

        # Not in game
        tracker.current_phase = "None"
        manager.make_request.return_value = None
        phase = tracker.update_phase()
        assert phase == 'None'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
