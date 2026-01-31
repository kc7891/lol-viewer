#!/usr/bin/env python3
"""
LCU Champion Detector - Detects current champion from League Client
"""
import base64
import logging
import re
import time
from typing import Optional, Dict, Callable
import requests
import urllib3
import psutil
from PyQt6.QtCore import QTimer, QObject, pyqtSignal, QCoreApplication

# Import logger for debug output
try:
    from logger import log
except ImportError:
    # Fallback if logger module is not available
    def log(msg):
        print(msg)


# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)


class LCUConnectionManager:
    """Manages connection to the LCU API"""

    def __init__(self):
        self.port: Optional[str] = None
        self.password: Optional[str] = None
        self.connected = False
        log("[LCU] LCUConnectionManager initialized")
        logger.info("LCUConnectionManager initialized")

    def connect(self) -> bool:
        """Connect to LCU by getting credentials from process"""
        try:
            credentials = self._get_lcu_credentials_from_process()
            if credentials:
                self.port = credentials['port']
                self.password = credentials['password']
                self.connected = True
                log(f"[LCU] Connected to LCU on port {self.port}")
                logger.info(f"Connected to LCU on port {self.port}")
                return True
            else:
                self.connected = False
                log("[LCU] LoL client not found in process list")
                logger.debug("LoL client not found")
                return False
        except Exception as e:
            log(f"[LCU] Error connecting to LCU: {e}")
            logger.error(f"Error connecting to LCU: {e}")
            self.connected = False
            return False

    def _get_lcu_credentials_from_process(self) -> Optional[Dict[str, str]]:
        """Get LCU credentials from LeagueClientUx process"""
        try:
            for proc in psutil.process_iter(['name', 'cmdline']):
                if proc.info['name'] in ['LeagueClientUx.exe', 'LeagueClientUx']:
                    cmdline = ' '.join(proc.info['cmdline'])

                    # Extract --app-port=12345
                    port_match = re.search(r'--app-port=(\d+)', cmdline)
                    # Extract --remoting-auth-token=abc123
                    token_match = re.search(r'--remoting-auth-token=([\w-]+)', cmdline)

                    if port_match and token_match:
                        logger.debug(f"Found LCU process with port {port_match.group(1)}")
                        return {
                            'port': port_match.group(1),
                            'password': token_match.group(1)
                        }
        except Exception as e:
            logger.error(f"Error getting LCU credentials: {e}")

        return None

    def is_client_running(self) -> bool:
        """Check if LoL client is running"""
        try:
            for proc in psutil.process_iter(['name']):
                if proc.info['name'] in ['LeagueClient.exe', 'LeagueClientUx.exe']:
                    return True
        except Exception as e:
            logger.error(f"Error checking if client is running: {e}")
        return False

    def disconnect(self, reason: str = ""):
        """Reset connection credentials."""
        if self.connected:
            msg = f"Disconnected from LCU"
            if reason:
                msg += f": {reason}"
            log(f"[LCU] {msg}")
            logger.info(msg)
        self.connected = False
        self.port = None
        self.password = None

    def get_auth_header(self) -> str:
        """Get authorization header for LCU API"""
        credentials = f"riot:{self.password}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded}"

    def make_request(self, endpoint: str) -> Optional[dict]:
        """Make a request to LCU API"""
        if not self.connected or not self.port or not self.password:
            return None

        try:
            url = f"https://127.0.0.1:{self.port}{endpoint}"
            headers = {'Authorization': self.get_auth_header()}
            response = requests.get(url, headers=headers, verify=False, timeout=5)

            if response.status_code == 200:
                return response.json()
            else:
                logger.debug(f"LCU API returned status {response.status_code} for {endpoint}")
                return None
        except requests.exceptions.RequestException as e:
            logger.debug(f"Request error for {endpoint}: {e}")
            self.disconnect(reason=str(e))
            return None
        except Exception as e:
            logger.error(f"Unexpected error making request to {endpoint}: {e}")
            self.disconnect(reason=str(e))
            return None


class GamePhaseTracker:
    """Tracks the current game phase"""

    def __init__(self, lcu_manager: LCUConnectionManager):
        self.lcu_manager = lcu_manager
        self.current_phase = "None"
        # Cache the last gameflow session payload so other components can
        # read queue/gameMode without issuing extra requests.
        self.last_session_data: Optional[dict] = None
        logger.info("GamePhaseTracker initialized")

    def update_phase(self) -> str:
        """Update and return current game phase"""
        try:
            data = self.lcu_manager.make_request("/lol-gameflow/v1/session")
            if data:
                self.last_session_data = data
                new_phase = data.get('phase', 'None')
                if new_phase != self.current_phase:
                    logger.info(f"Game phase changed: {self.current_phase} -> {new_phase}")
                    self.current_phase = new_phase
                return self.current_phase
            else:
                # If we can't get the session, assume None
                self.last_session_data = None
                if self.current_phase != "None":
                    logger.debug("Could not get gameflow session, assuming None")
                    self.current_phase = "None"
                return self.current_phase
        except Exception as e:
            logger.error(f"Error updating game phase: {e}")
            return self.current_phase

    def get_queue_id(self) -> Optional[int]:
        """Best-effort extraction of queueId from cached gameflow session."""
        data = self.last_session_data or {}
        game_data = data.get("gameData") or {}
        queue = game_data.get("queue")
        # Common shapes:
        # - {"queue": {"id": 450, "gameMode": "ARAM", ...}}
        # - {"queue": {"queueId": 450, ...}}
        # - {"queue": 450}
        if isinstance(queue, int):
            return queue
        if isinstance(queue, dict):
            for key in ("id", "queueId"):
                if key in queue and queue[key] is not None:
                    try:
                        return int(queue[key])
                    except Exception:
                        return None
        return None

    def get_queue_game_mode(self) -> Optional[str]:
        """Best-effort extraction of queue gameMode from cached gameflow session."""
        data = self.last_session_data or {}
        game_data = data.get("gameData") or {}
        queue = game_data.get("queue") or {}
        if isinstance(queue, dict):
            mode = queue.get("gameMode") or queue.get("mode")
            if isinstance(mode, str) and mode:
                return mode
        # Sometimes gameMode is at gameData root.
        mode = game_data.get("gameMode")
        if isinstance(mode, str) and mode:
            return mode
        return None

    def is_in_champ_select(self) -> bool:
        """Check if currently in champion select"""
        return self.current_phase == "ChampSelect"

    def is_in_game(self) -> bool:
        """Check if currently in game"""
        return self.current_phase == "InProgress"


class ChampionDetector:
    """Detects current champion from LCU API"""

    def __init__(self, lcu_manager: LCUConnectionManager, phase_tracker: GamePhaseTracker):
        self.lcu_manager = lcu_manager
        self.phase_tracker = phase_tracker
        self.current_champion_id: Optional[int] = None
        self.current_champion_name: Optional[str] = None
        self.current_lane: Optional[str] = None
        self.detected_enemy_champions: set = set()  # Track detected enemy champions by ID
        self.champion_map: Dict[int, str] = {}
        logger.info("ChampionDetector initialized")
        self._load_champion_map()

    def _load_champion_map(self):
        """Load champion ID to name mapping from Data Dragon"""
        try:
            # Get latest version
            version_url = "https://ddragon.leagueoflegends.com/api/versions.json"
            versions = requests.get(version_url, timeout=10).json()
            latest_version = versions[0]
            logger.info(f"Using Data Dragon version: {latest_version}")

            # Get champion data
            champion_url = f"https://ddragon.leagueoflegends.com/cdn/{latest_version}/data/en_US/champion.json"
            data = requests.get(champion_url, timeout=10).json()

            # Create ID to name mapping
            self.champion_map = {int(v['key']): k for k, v in data['data'].items()}
            logger.info(f"Loaded {len(self.champion_map)} champions from Data Dragon")

        except Exception as e:
            logger.error(f"Error loading champion map: {e}")
            self.champion_map = {}

    def detect_champion_and_enemies(self) -> tuple:
        """Detect own champion and enemy champions in a single API call

        Returns:
            tuple: ((champion_name, lane), [enemy_champion_names], [(ally, enemy) matchup_pairs])
        """
        try:
            phase = self.phase_tracker.update_phase()

            if phase == 'ChampSelect':
                # In champion select - get from LCU API
                data = self.lcu_manager.make_request("/lol-champ-select/v1/session")
                if not data:
                    return (None, [], [])

                # Detect own champion
                own_champion_result = self._detect_own_champion_from_data(data)

                # Update own champion state
                if own_champion_result:
                    champion_id, lane = own_champion_result
                    if champion_id and champion_id > 0:
                        self.current_champion_id = champion_id
                        self.current_champion_name = self.champion_map.get(champion_id)
                        self.current_lane = lane
                        if self.current_champion_name:
                            logger.info(f"Detected champion in champ select: {self.current_champion_name} (lane: {lane})")

                # Detect enemy champions
                enemy_champions = self._detect_enemy_champions_from_data(data)

                # Extract matchup pairs
                matchup_pairs = self.get_matchup_pairs_from_data(data)

                own_result = (self.current_champion_name, self.current_lane) if self.current_champion_name else None
                return (own_result, enemy_champions, matchup_pairs)

            elif phase == 'InProgress':
                # In game - return the champion selected during champ select
                own_result = (self.current_champion_name, self.current_lane) if self.current_champion_name else None
                return (own_result, [], [])

            elif phase == 'None' or phase == 'Lobby':
                # Not in game - reset state
                if self.current_champion_name:
                    logger.info("Game ended, resetting champion state")
                self.current_champion_id = None
                self.current_champion_name = None
                self.current_lane = None
                self.detected_enemy_champions.clear()
                return (None, [], [])

            else:
                # Other phases - keep current state
                own_result = (self.current_champion_name, self.current_lane) if self.current_champion_name else None
                return (own_result, [], [])

        except Exception as e:
            logger.error(f"Error detecting champions: {e}")
            return (None, [], [])

    def detect_champion(self) -> Optional[str]:
        """Detect own champion only (backwards-compatible helper).

        Returns:
            Optional[str]: champion name if detected, otherwise None.
        """
        try:
            phase = self.phase_tracker.update_phase()

            if phase == 'ChampSelect':
                data = self.lcu_manager.make_request("/lol-champ-select/v1/session")
                if not data:
                    return None

                own_champion_result = self._detect_own_champion_from_data(data)
                if own_champion_result:
                    champion_id, lane = own_champion_result
                    if champion_id and champion_id > 0:
                        self.current_champion_id = champion_id
                        self.current_champion_name = self.champion_map.get(champion_id)
                        self.current_lane = lane
                        if self.current_champion_name:
                            logger.info(
                                f"Detected champion in champ select: {self.current_champion_name} (lane: {lane})"
                            )
                return self.current_champion_name

            if phase == 'InProgress':
                return self.current_champion_name

            if phase == 'None' or phase == 'Lobby':
                # Not in game - reset state
                if self.current_champion_name:
                    logger.info("Game ended, resetting champion state")
                self.current_champion_id = None
                self.current_champion_name = None
                self.current_lane = None
                self.detected_enemy_champions.clear()
                return None

            # Other phases - keep current state
            return self.current_champion_name

        except Exception as e:
            logger.error(f"Error detecting champion: {e}")
            return None

    def _detect_own_champion_from_data(self, data: dict) -> Optional[tuple]:
        """Detect own champion and lane from champ select session data

        Args:
            data: Champ select session data from LCU API

        Returns:
            Optional[tuple]: (champion_id, lane) or None if not found
        """
        try:
            local_player_cell_id = data.get('localPlayerCellId')
            if local_player_cell_id is None:
                return None

            # Find our champion and lane from myTeam
            for player in data.get('myTeam', []):
                if player.get('cellId') == local_player_cell_id:
                    champion_id = player.get('championId', 0)
                    assigned_position = player.get('assignedPosition', '')

                    # Convert LCU lane names to our format
                    # LCU uses: "top", "jungle", "middle", "bottom", "utility"
                    # We use: "top", "jungle", "middle", "bottom", "support"
                    lane = assigned_position.lower()
                    if lane == 'utility':
                        lane = 'support'

                    if champion_id > 0:
                        logger.debug(f"Found champion ID {champion_id} in lane {lane}")
                        return (champion_id, lane)

            return None

        except Exception as e:
            logger.error(f"Error detecting own champion from data: {e}")
            return None

    def _detect_enemy_champions_from_data(self, data: dict) -> list:
        """Detect newly picked enemy champions from champ select session data

        Args:
            data: Champ select session data from LCU API

        Returns:
            list: List of newly picked enemy champion names
        """
        try:
            new_enemy_champions = []

            # Get enemy team champions
            for player in data.get('theirTeam', []):
                champion_id = player.get('championId', 0)
                if champion_id > 0 and champion_id not in self.detected_enemy_champions:
                    # New enemy champion detected
                    champion_name = self.champion_map.get(champion_id)
                    if champion_name:
                        self.detected_enemy_champions.add(champion_id)
                        new_enemy_champions.append(champion_name)
                        logger.info(f"Detected enemy champion: {champion_name}")

            return new_enemy_champions

        except Exception as e:
            logger.error(f"Error detecting enemy champions from data: {e}")
            return []

    def get_matchup_pairs_from_data(self, data: dict) -> list:
        """Extract positional matchup pairs (ally, enemy) from champ select data.

        Returns:
            list of (ally_champion_name, enemy_champion_name) tuples (up to 5).
            Empty string is used when a champion is not yet picked.
        """
        try:
            my_team = data.get('myTeam', [])
            their_team = data.get('theirTeam', [])

            pairs = []
            for i in range(max(len(my_team), len(their_team))):
                ally = ""
                enemy = ""
                if i < len(my_team):
                    cid = my_team[i].get('championId', 0)
                    if cid > 0:
                        ally = self.champion_map.get(cid, "")
                if i < len(their_team):
                    cid = their_team[i].get('championId', 0)
                    if cid > 0:
                        enemy = self.champion_map.get(cid, "")
                pairs.append((ally, enemy))

            return pairs[:5]
        except Exception as e:
            logger.error(f"Error extracting matchup pairs: {e}")
            return []


class ChampionDetectorService(QObject):
    """Qt service for champion detection with signals"""

    champion_detected = pyqtSignal(str, str)  # Emits (champion_name, lane)
    enemy_champion_detected = pyqtSignal(str)  # Emits enemy champion_name
    matchup_pairs_updated = pyqtSignal(list)  # Emits list of (ally_name, enemy_name) tuples (up to 5)
    connection_status_changed = pyqtSignal(str)  # Emits connection status: "connecting", "connected", "disconnected"

    def __init__(self):
        super().__init__()
        # Ensure a Qt event loop exists so QTimer can run in headless/tests.
        # (Tests may instantiate this service without creating QApplication.)
        self._qt_app = None
        if QCoreApplication.instance() is None:
            self._qt_app = QCoreApplication([])
        log("[LCU] ChampionDetectorService.__init__ called")
        self.lcu_manager = LCUConnectionManager()
        self.phase_tracker = GamePhaseTracker(self.lcu_manager)
        self.detector = ChampionDetector(self.lcu_manager, self.phase_tracker)
        self.timer = QTimer()
        self.timer.timeout.connect(self._check_champion)
        self.last_champion: Optional[str] = None
        self.last_lane: Optional[str] = None
        self.last_connection_status: str = "connecting"  # Track connection status
        self.running = False
        self.check_count = 0  # Track number of checks for logging
        self.base_interval_ms = 2000
        self.max_interval_ms = 60000
        self.current_interval_ms = self.base_interval_ms
        self.is_checking = False
        log("[LCU] ChampionDetectorService initialized")
        logger.info("ChampionDetectorService initialized")

    def _set_connection_status(self, status: str):
        """Emit connection status changes once."""
        if self.last_connection_status != status:
            self.last_connection_status = status
            self.connection_status_changed.emit(status)
            log(f"[LCU] Status changed to: {status}")
            logger.info(f"Status changed to: {status}")

    def _clear_champion_state(self):
        """Reset cached champion data when connection drops."""
        if self.last_champion or self.last_lane:
            log(f"[LCU] Clearing cached champion data due to disconnect")
            logger.debug("Clearing cached champion data after disconnect")
        self.last_champion = None
        self.last_lane = None
        self.detector.current_champion_id = None
        self.detector.current_champion_name = None
        self.detector.current_lane = None
        self.detector.detected_enemy_champions.clear()

    def start(self, interval_ms: int = 2000, max_interval_ms: int = 60000):
        """Start champion detection (polls every interval_ms milliseconds)"""
        log(f"[LCU] Starting champion detection service (interval: {interval_ms}ms)")
        log(f"[LCU] Will check for LoL client every {interval_ms/1000:.1f} seconds")
        logger.info(f"Starting champion detection service (interval: {interval_ms}ms)")
        self.running = True
        self.check_count = 0
        self.base_interval_ms = interval_ms
        self.max_interval_ms = max(interval_ms, max_interval_ms)
        self.current_interval_ms = self.base_interval_ms
        self._set_timer_interval(self.base_interval_ms)
        is_active = self.timer.isActive()
        log(f"[LCU] Timer started successfully, is active: {is_active}")
        logger.info(f"Timer started, is active: {is_active}")

    def stop(self):
        """Stop champion detection"""
        logger.info("Stopping champion detection service")
        self.running = False
        self.timer.stop()

    def manual_connect_attempt(self):
        """Immediately try to connect to the client on user request."""
        log("[LCU] Manual connection attempt requested")
        logger.info("Manual LCU connection attempt requested")
        if not self.running:
            log("[LCU] Service not running; starting with default interval")
            self.start(self.base_interval_ms, self.max_interval_ms)
            return

        self._reset_backoff()
        if not self.timer.isActive():
            self._set_timer_interval(self.current_interval_ms)
        self._set_connection_status("connecting")
        self._check_champion(force=True)

    def _set_timer_interval(self, interval_ms: int):
        """Update timer interval if it changed."""
        if interval_ms <= 0:
            interval_ms = self.base_interval_ms

        if interval_ms != self.current_interval_ms:
            log(f"[LCU] Updating polling interval: {self.current_interval_ms} -> {interval_ms} ms")
            logger.info(f"Polling interval updated: {self.current_interval_ms} -> {interval_ms} ms")
        self.current_interval_ms = interval_ms
        if self.running:
            self.timer.start(self.current_interval_ms)

    def _increase_backoff(self):
        """Exponential backoff when client is not running."""
        if self.current_interval_ms >= self.max_interval_ms:
            return

        new_interval = min(self.current_interval_ms * 2, self.max_interval_ms)
        if new_interval != self.current_interval_ms:
            log(f"[LCU] Client not found; backing off to {new_interval}ms")
            logger.debug(f"Backoff applied, new interval: {new_interval}ms")
            self._set_timer_interval(new_interval)

    def _reset_backoff(self):
        """Reset polling interval to the base value."""
        if self.current_interval_ms != self.base_interval_ms:
            log(f"[LCU] Resetting polling interval to base {self.base_interval_ms}ms")
            logger.info("Polling interval reset to base")
            self._set_timer_interval(self.base_interval_ms)

    def _check_champion(self, force: bool = False):
        """Check for champion changes (called by timer)"""
        if force:
            logger.debug("Forced champion check triggered")
        if self.is_checking:
            logger.debug("Skipping check; previous check still running")
            return

        self.is_checking = True
        try:
            self.check_count += 1
            # Log every 10 checks (every 20 seconds) to avoid spam
            if self.check_count % 10 == 1:
                log(f"[LCU] Polling check #{self.check_count}: connected={self.lcu_manager.connected}")

            logger.debug(f"Check #{self.check_count}: connected={self.lcu_manager.connected}")

            is_running = self.lcu_manager.is_client_running()
            logger.debug(f"Client running: {is_running}, connected={self.lcu_manager.connected}")

            if not is_running:
                if self.check_count % 10 == 1:
                    log("[LCU] LoL client not running")
                if self.lcu_manager.connected:
                    self.lcu_manager.disconnect("client closed")
                self._increase_backoff()
                self._set_connection_status("disconnected")
                self._clear_champion_state()
                return

            # LoL client is running - ensure we're polling quickly
            self._reset_backoff()

            # Try to connect if not connected
            if not self.lcu_manager.connected:
                self._set_connection_status("connecting")
                connected = self.lcu_manager.connect()
                log(f"[LCU] Connection attempt result: {connected}")
                logger.info(f"Connection attempt result: {connected}")
                if not connected:
                    return

            # Ensure status reflects active connection
            self._set_connection_status("connected")

            own_result = None
            enemy_champions = []
            matchup_pairs = []

            # Detect champions (both own and enemy in a single API call)
            if self.lcu_manager.connected:
                own_result, enemy_champions, matchup_pairs = self.detector.detect_champion_and_enemies()
            else:
                # Connection dropped during detection attempt, retry next tick
                self._set_connection_status("connecting")
                return

            # Emit matchup pairs if available
            if matchup_pairs:
                self.matchup_pairs_updated.emit(matchup_pairs)

            # Handle own champion detection
            if own_result:
                champion, lane = own_result
                log(f"[LCU] Detected champion: {champion} (lane: {lane})")
                logger.debug(f"Detected champion: {champion} (lane: {lane})")

                # Emit signal if champion or lane changed
                if champion != self.last_champion or lane != self.last_lane:
                    log(f"[LCU] Champion/lane changed: ({self.last_champion}, {self.last_lane}) -> ({champion}, {lane})")
                    logger.info(f"Champion/lane changed: ({self.last_champion}, {self.last_lane}) -> ({champion}, {lane})")
                    self.last_champion = champion
                    self.last_lane = lane
                    self.champion_detected.emit(champion, lane)
            elif self.last_champion:
                # Champion was cleared
                log(f"[LCU] Champion cleared: {self.last_champion}")
                logger.debug(f"Champion cleared: {self.last_champion}")
                self.last_champion = None
                self.last_lane = None

            # Handle enemy champion detection
            for enemy_champion in enemy_champions:
                log(f"[LCU] Enemy champion detected: {enemy_champion}")
                logger.info(f"Enemy champion detected: {enemy_champion}")
                self.enemy_champion_detected.emit(enemy_champion)

            # Connection might have been lost during API calls
            if not self.lcu_manager.connected:
                self._set_connection_status("connecting")

        except Exception as e:
            log(f"[LCU] Error in champion check: {e}")
            logger.error(f"Error in champion check: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.is_checking = False

    def get_current_queue_id(self) -> Optional[int]:
        """Return current queueId (best effort, cached from gameflow)."""
        if not self.lcu_manager.connected:
            return None
        # Ensure phase_tracker has attempted at least one update recently.
        if self.phase_tracker.last_session_data is None:
            self.phase_tracker.update_phase()
        return self.phase_tracker.get_queue_id()

    def get_current_game_mode(self) -> Optional[str]:
        """Return current gameMode (best effort, cached from gameflow)."""
        if not self.lcu_manager.connected:
            return None
        if self.phase_tracker.last_session_data is None:
            self.phase_tracker.update_phase()
        return self.phase_tracker.get_queue_game_mode()
