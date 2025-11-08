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
from PyQt6.QtCore import QTimer, QObject, pyqtSignal

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
            return None
        except Exception as e:
            logger.error(f"Unexpected error making request to {endpoint}: {e}")
            return None


class GamePhaseTracker:
    """Tracks the current game phase"""

    def __init__(self, lcu_manager: LCUConnectionManager):
        self.lcu_manager = lcu_manager
        self.current_phase = "None"
        logger.info("GamePhaseTracker initialized")

    def update_phase(self) -> str:
        """Update and return current game phase"""
        try:
            data = self.lcu_manager.make_request("/lol-gameflow/v1/session")
            if data:
                new_phase = data.get('phase', 'None')
                if new_phase != self.current_phase:
                    logger.info(f"Game phase changed: {self.current_phase} -> {new_phase}")
                    self.current_phase = new_phase
                return self.current_phase
            else:
                # If we can't get the session, assume None
                if self.current_phase != "None":
                    logger.debug("Could not get gameflow session, assuming None")
                    self.current_phase = "None"
                return self.current_phase
        except Exception as e:
            logger.error(f"Error updating game phase: {e}")
            return self.current_phase

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

    def detect_champion(self) -> Optional[tuple]:
        """Detect current champion and lane

        Returns:
            Optional[tuple]: (champion_name, lane) or None if no champion detected
        """
        try:
            phase = self.phase_tracker.update_phase()

            if phase == 'ChampSelect':
                # In champion select - get from LCU API
                result = self._detect_from_champ_select()
                if result:
                    champion_id, lane = result
                    if champion_id and champion_id > 0:
                        self.current_champion_id = champion_id
                        self.current_champion_name = self.champion_map.get(champion_id)
                        self.current_lane = lane
                        if self.current_champion_name:
                            logger.info(f"Detected champion in champ select: {self.current_champion_name} (lane: {lane})")
                        return (self.current_champion_name, self.current_lane)
                return None

            elif phase == 'InProgress':
                # In game - return the champion selected during champ select
                if self.current_champion_name:
                    return (self.current_champion_name, self.current_lane)
                return None

            elif phase == 'None' or phase == 'Lobby':
                # Not in game - reset state
                if self.current_champion_name:
                    logger.info("Game ended, resetting champion state")
                self.current_champion_id = None
                self.current_champion_name = None
                self.current_lane = None
                return None

            else:
                # Other phases - keep current state
                if self.current_champion_name:
                    return (self.current_champion_name, self.current_lane)
                return None

        except Exception as e:
            logger.error(f"Error detecting champion: {e}")
            return None

    def _detect_from_champ_select(self) -> Optional[tuple]:
        """Detect champion and lane from champ select session

        Returns:
            Optional[tuple]: (champion_id, lane) or None if not found
        """
        try:
            data = self.lcu_manager.make_request("/lol-champ-select/v1/session")
            if not data:
                return None

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
            logger.error(f"Error detecting from champ select: {e}")
            return None


class ChampionDetectorService(QObject):
    """Qt service for champion detection with signals"""

    champion_detected = pyqtSignal(str, str)  # Emits (champion_name, lane)

    def __init__(self):
        super().__init__()
        log("[LCU] ChampionDetectorService.__init__ called")
        self.lcu_manager = LCUConnectionManager()
        self.phase_tracker = GamePhaseTracker(self.lcu_manager)
        self.detector = ChampionDetector(self.lcu_manager, self.phase_tracker)
        self.timer = QTimer()
        self.timer.timeout.connect(self._check_champion)
        self.last_champion: Optional[str] = None
        self.last_lane: Optional[str] = None
        self.running = False
        self.check_count = 0  # Track number of checks for logging
        log("[LCU] ChampionDetectorService initialized")
        logger.info("ChampionDetectorService initialized")

    def start(self, interval_ms: int = 2000):
        """Start champion detection (polls every interval_ms milliseconds)"""
        log(f"[LCU] Starting champion detection service (interval: {interval_ms}ms)")
        log(f"[LCU] Will check for LoL client every {interval_ms/1000:.1f} seconds")
        logger.info(f"Starting champion detection service (interval: {interval_ms}ms)")
        self.running = True
        self.check_count = 0
        self.timer.start(interval_ms)
        is_active = self.timer.isActive()
        log(f"[LCU] Timer started successfully, is active: {is_active}")
        logger.info(f"Timer started, is active: {is_active}")

    def stop(self):
        """Stop champion detection"""
        logger.info("Stopping champion detection service")
        self.running = False
        self.timer.stop()

    def _check_champion(self):
        """Check for champion changes (called by timer)"""
        try:
            self.check_count += 1
            # Log every 10 checks (every 20 seconds) to avoid spam
            if self.check_count % 10 == 1:
                log(f"[LCU] Polling check #{self.check_count}: connected={self.lcu_manager.connected}")

            logger.debug(f"Check #{self.check_count}: connected={self.lcu_manager.connected}")

            # Try to connect if not connected
            if not self.lcu_manager.connected:
                is_running = self.lcu_manager.is_client_running()
                if self.check_count % 10 == 1:
                    log(f"[LCU] LoL client running: {is_running}")
                logger.debug(f"Client running check: {is_running}")

                if is_running:
                    connected = self.lcu_manager.connect()
                    log(f"[LCU] Connection attempt result: {connected}")
                    logger.info(f"Connection attempt result: {connected}")

            # Detect champion
            if self.lcu_manager.connected:
                result = self.detector.detect_champion()
                if result:
                    champion, lane = result
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

        except Exception as e:
            log(f"[LCU] Error in champion check: {e}")
            logger.error(f"Error in champion check: {e}")
            import traceback
            traceback.print_exc()
