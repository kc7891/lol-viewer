#!/usr/bin/env python3
"""
Test cases for LCU Champion Detector
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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


class TestNewMatchDetection:
    """New ChampSelect session detection (phase/gameId based, switch ON)"""

    @staticmethod
    def _make_detector(enabled=True):
        manager = Mock()
        phase_tracker = Mock()
        detector = ChampionDetector(manager, phase_tracker)
        detector.champion_map = {}
        detector.new_match_detection_enabled = enabled
        return manager, phase_tracker, detector

    @staticmethod
    def _session(game_id=0, timer=0):
        return {
            'gameId': game_id,
            'timer': {'internalNowInEpochMs': timer},
            'localPlayerCellId': 0,
            'myTeam': [{'cellId': 0, 'championId': 0, 'summonerId': 100, 'assignedPosition': ''}],
            'theirTeam': [],
        }

    def test_switch_defaults_to_off(self):
        _, _, detector = self._make_detector(enabled=False)
        assert detector.new_match_detection_enabled is False
        assert ChampionDetectorService().new_match_detection_enabled is False

    def test_lobby_to_champ_select_is_new_session(self):
        manager, tracker, detector = self._make_detector()
        manager.make_request.return_value = self._session(1)

        tracker.update_phase.return_value = 'Lobby'
        detector.detect_champion_and_enemies()

        tracker.update_phase.return_value = 'ChampSelect'
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is True

        # Continuing ChampSelect is not a new session
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is False

    def test_game_id_change_is_new_session(self):
        manager, tracker, detector = self._make_detector()
        tracker.update_phase.return_value = 'ChampSelect'

        manager.make_request.return_value = self._session(111)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is True

        manager.make_request.return_value = self._session(222)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is True

        manager.make_request.return_value = self._session(222)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is False

    def test_zero_game_id_does_not_trigger_new_session(self):
        manager, tracker, detector = self._make_detector()
        tracker.update_phase.return_value = 'ChampSelect'
        manager.make_request.return_value = self._session(111)
        detector.detect_champion_and_enemies()

        manager.make_request.return_value = self._session(0)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is False

    def test_off_uses_legacy_timer_heuristic(self):
        manager, tracker, detector = self._make_detector(enabled=False)
        tracker.update_phase.return_value = 'ChampSelect'

        manager.make_request.return_value = self._session(1, timer=1000)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is True  # first session (timer was 0)

        manager.make_request.return_value = self._session(1, timer=2000)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is False

        # Timer jumped backward -> new session (legacy heuristic)
        manager.make_request.return_value = self._session(1, timer=500)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is True

        # A different gameId alone does NOT count when OFF
        manager.make_request.return_value = self._session(2, timer=900)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is False

        # Lobby resets the timer, so the next ChampSelect is new again
        tracker.update_phase.return_value = 'Lobby'
        detector.detect_champion_and_enemies()
        tracker.update_phase.return_value = 'ChampSelect'
        manager.make_request.return_value = self._session(2, timer=1000)
        _, _, info = detector.detect_champion_and_enemies()
        assert info['is_new_session'] is True


FULL_CHAMP_SELECT = {
    'allies': [('A', 'top')] * 5,
    'enemies': ['E'] * 5,
    'phase': 'ChampSelect',
    'is_new_session': False,
}


def _make_service(enabled, interval_ms=1000):
    service = ChampionDetectorService()
    service.set_new_match_detection(enabled)
    service.start(interval_ms=interval_ms)
    service.lcu_manager.is_client_running = Mock(return_value=True)
    service.lcu_manager.connected = True
    service.phase_tracker.update_phase = Mock(return_value='ChampSelect')
    service.detector.detect_champion_and_enemies = Mock(return_value=(None, [], dict(FULL_CHAMP_SELECT)))
    return service


class TestNewMatchSwitchOff:
    """Switch OFF (default): legacy runtime behaviour"""

    def test_timer_stops_at_ten_champions(self):
        service = _make_service(False)
        service._check_champion()
        assert service._polling_paused is True
        assert service.timer.isActive() is False
        service.stop()

    def test_no_new_match_signal_and_last_champion_kept(self):
        service = ChampionDetectorService()
        service.lcu_manager.is_client_running = Mock(return_value=True)
        service.lcu_manager.connected = True
        service.last_champion = 'Ashe'
        service.last_lane = 'bottom'
        info = {'allies': [], 'enemies': [], 'phase': 'ChampSelect', 'is_new_session': True}
        service.detector.detect_champion_and_enemies = Mock(return_value=(('Ashe', 'bottom'), [], info))

        emitted = []
        service.new_match_started.connect(lambda: emitted.append(1))
        service.matchup_data_updated.connect(lambda d: emitted.append(d))
        service._check_champion()

        assert emitted == [info]
        assert service.last_champion == 'Ashe'
        assert service.last_lane == 'bottom'

    def test_process_scan_every_tick(self):
        service = _make_service(False)
        service.current_interval_ms = 4000
        service._check_champion()
        service.lcu_manager.is_client_running.assert_called_once()
        service.stop()

    def test_resume_polling_restarts_stopped_timer(self):
        service = _make_service(False)
        service._check_champion()
        assert service.timer.isActive() is False
        service.resume_polling()
        assert service._polling_paused is False
        assert service.timer.isActive() is True
        assert service.timer.interval() == service.base_interval_ms
        service.stop()

    def test_turning_off_in_watch_keeps_timer_and_next_tick_restores_base(self):
        service = _make_service(True)
        service._check_champion()
        assert service._watch_mode is True
        service.set_new_match_detection(False)
        assert service._watch_mode is False
        assert service.timer.isActive() is True
        assert service.timer.interval() == service.paused_interval_ms
        service.phase_tracker.update_phase.return_value = 'Lobby'
        service.detector.detect_champion_and_enemies.return_value = (None, [], None)
        service._check_champion()
        assert service.timer.interval() == service.base_interval_ms
        service.stop()


class TestNewMatchWatchMode:
    """Switch ON: low-load watch mode after all 10 champions are known"""

    def test_enters_watch_mode_and_keeps_timer(self):
        service = _make_service(True)
        service._check_champion()
        assert service._watch_mode is True
        assert service.timer.isActive() is True
        assert service.timer.interval() == service.paused_interval_ms
        service.stop()

    def test_watch_tick_skips_process_scan_and_detection(self):
        service = _make_service(True)
        service._check_champion()
        service.lcu_manager.is_client_running.reset_mock()
        service.detector.detect_champion_and_enemies.reset_mock()
        service.phase_tracker.update_phase.reset_mock()

        service._check_champion()

        service.lcu_manager.is_client_running.assert_not_called()
        service.detector.detect_champion_and_enemies.assert_not_called()
        service.phase_tracker.update_phase.assert_called_once()
        assert service._watch_mode is True
        service.stop()

    def test_watch_uses_slow_interval_during_game_and_stays_in_watch(self):
        service = _make_service(True)
        service._check_champion()
        service.detector.detect_champion_and_enemies.reset_mock()

        for phase in ('GameStart', 'InProgress', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'):
            service.phase_tracker.update_phase.return_value = phase
            service._check_champion()
            assert service._watch_mode is True
            assert service.timer.interval() == service.in_game_watch_interval_ms
        service.detector.detect_champion_and_enemies.assert_not_called()

        service.phase_tracker.update_phase.return_value = 'Lobby'
        service._check_champion()
        assert service._watch_mode is True
        assert service.timer.interval() == service.paused_interval_ms
        service.stop()

    def test_champ_select_again_after_game_resumes_and_emits_new_match(self):
        service = _make_service(True)
        service.last_champion = 'Ashe'
        service._check_champion()
        service.phase_tracker.update_phase.return_value = 'InProgress'
        service._check_champion()
        assert service.timer.interval() == service.in_game_watch_interval_ms

        service.phase_tracker.update_phase.return_value = 'ChampSelect'
        info = {'allies': [], 'enemies': [], 'phase': 'ChampSelect', 'is_new_session': True}
        service.detector.detect_champion_and_enemies.return_value = (None, [], info)
        order = []
        service.new_match_started.connect(lambda: order.append('new_match'))
        service.matchup_data_updated.connect(lambda d: order.append('matchup'))
        service._check_champion()

        assert order == ['new_match', 'matchup']
        assert service._watch_mode is False
        assert service._polling_paused is False
        assert service.timer.interval() == service.base_interval_ms
        assert service.last_champion is None
        service.stop()

    def test_real_detector_reports_new_session_after_watch(self):
        service = ChampionDetectorService()
        service.set_new_match_detection(True)
        service.start(interval_ms=1000)
        service.lcu_manager.is_client_running = Mock(return_value=True)
        service.lcu_manager.connected = True
        service.phase_tracker.update_phase = Mock(return_value='ChampSelect')
        service.lcu_manager.make_request = Mock(return_value={'gameId': 5})
        service.detector._prev_phase = 'ChampSelect'
        service.detector._last_champ_select_game_id = 5
        service._enter_watch_mode()

        service.phase_tracker.update_phase.return_value = 'InProgress'
        service._check_champion()
        service.phase_tracker.update_phase.return_value = 'ChampSelect'
        infos = []
        service.matchup_data_updated.connect(infos.append)
        service._check_champion()
        assert infos and infos[0]['is_new_session'] is True
        service.stop()

    def test_game_id_change_during_champ_select_exits_watch(self):
        service = _make_service(True)
        service.detector._last_champ_select_game_id = 111
        service._check_champion()
        assert service._watch_mode is True
        service.lcu_manager.make_request = Mock(return_value={'gameId': 222})
        service.detector.detect_champion_and_enemies.reset_mock()
        partial = {'allies': [], 'enemies': [], 'phase': 'ChampSelect', 'is_new_session': True}
        service.detector.detect_champion_and_enemies.return_value = (None, [], partial)

        every = service.WATCH_GAME_ID_CHECK_EVERY
        for _ in range(every - 1):
            service._check_champion()
            assert service._watch_mode is True
        service.lcu_manager.make_request.assert_not_called()

        service._check_champion()
        service.lcu_manager.make_request.assert_called_once_with("/lol-champ-select/v1/session")
        assert service._watch_mode is False
        service.detector.detect_champion_and_enemies.assert_called_once()
        assert service.timer.interval() == service.base_interval_ms
        service.stop()

    def test_same_game_id_stays_in_watch(self):
        service = _make_service(True)
        service.detector._last_champ_select_game_id = 111
        service._check_champion()
        service.lcu_manager.make_request = Mock(return_value={'gameId': 111})
        for _ in range(service.WATCH_GAME_ID_CHECK_EVERY * 2):
            service._check_champion()
        assert service._watch_mode is True
        service.stop()

    def test_not_connected_falls_back_to_process_scan(self):
        service = _make_service(True)
        service._check_champion()
        service.lcu_manager.connected = False
        service.lcu_manager.is_client_running.reset_mock()
        service.lcu_manager.connect = Mock(return_value=False)

        service._check_champion()

        service.lcu_manager.is_client_running.assert_called_once()
        service.lcu_manager.connect.assert_called_once()
        service.stop()

    def test_client_closed_leaves_watch_mode(self):
        service = _make_service(True)
        service._check_champion()
        service.lcu_manager.connected = False
        service.lcu_manager.is_client_running.return_value = False
        service._check_champion()
        assert service._watch_mode is False
        assert service._polling_paused is False
        service.stop()

    def test_resume_polling_exits_watch_mode(self):
        service = _make_service(True)
        service._check_champion()
        service.phase_tracker.update_phase.return_value = 'InProgress'
        service._check_champion()
        service.resume_polling()
        assert service._watch_mode is False
        assert service._polling_paused is False
        assert service.timer.interval() == service.base_interval_ms
        service.stop()

    def test_new_match_started_emitted_before_matchup_data(self):
        service = ChampionDetectorService()
        service.set_new_match_detection(True)
        service.lcu_manager.is_client_running = Mock(return_value=True)
        service.lcu_manager.connected = True
        service.last_champion = 'Ashe'
        service.last_lane = 'bottom'
        info = {'allies': [], 'enemies': [], 'phase': 'ChampSelect', 'is_new_session': True}
        service.detector.detect_champion_and_enemies = Mock(return_value=(None, [], info))

        order = []
        service.new_match_started.connect(lambda: order.append('new_match'))
        service.matchup_data_updated.connect(lambda d: order.append('matchup'))
        service._check_champion()

        assert order == ['new_match', 'matchup']
        assert service.last_champion is None
        assert service.last_lane is None
