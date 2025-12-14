#!/usr/bin/env python3
"""
LoL Viewer - A simple application to view LoLAnalytics champion builds
"""
import sys
import logging
import os
from datetime import datetime
from PyQt6.QtCore import QUrl, pyqtSignal, Qt, QTimer, QSettings
from PyQt6.QtGui import QColor, QIcon
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLineEdit, QPushButton, QMessageBox,
    QScrollArea, QSplitter, QListWidget, QListWidgetItem, QLabel,
    QTabWidget, QStackedWidget, QComboBox, QCheckBox, QButtonGroup
)

# Application version
__version__ = "0.12.4"

# Default analytics URLs
DEFAULT_BUILD_URL = "https://lolalytics.com/lol/{name}/build/"
DEFAULT_COUNTER_URL = "https://lolalytics.com/lol/{name}/counters/"
DEFAULT_ARAM_URL = "https://u.gg/lol/champions/aram/{name}-aram"
DEFAULT_LIVE_GAME_URL = "https://u.gg/lol/lg-splash"

# Feature flags (toggle in Settings page).
# Add new flags here when introducing gated behavior.
# NOTE: Keys are persisted via QSettings at "feature_flags/<key>".
FEATURE_FLAG_DEFINITIONS = {
    # Example flags (safe defaults OFF). Wire them into behavior as needed.
    "experimental_features": {
        "label": "Enable experimental features",
        "description": "Turns on experimental behaviors that may be unstable.",
        "default": False,
    },
    "auto_open_aram_tab_on_pick": {
        "label": "Auto-open ARAM tab on pick (ARAM / ARAM: Mayhem)",
        "description": "When enabled, during champ select in ARAM (including ARAM: Mayhem), auto-open the ARAM page instead of Build.",
        "default": False,
    },
}

# Queue IDs used to detect ARAM / ARAM: Mayhem.
# - ARAM (Howling Abyss): 450 (current), plus a few legacy/special variants.
# - ARAM: Mayhem queue IDs are not present in Riot's static queues.json; these IDs
#   are confirmed from CommunityDragon queue metadata:
#   https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/queues.json
ARAM_QUEUE_IDS = {450, 65, 100, 720}
ARAM_MAYHEM_QUEUE_IDS = {2400, 2401, 2403, 2405, 3240, 3270}


class LCUConnectionStatusWidget(QWidget):
    """Widget displaying LCU connection status with animated dots"""

    def __init__(self):
        super().__init__()
        self.current_status = "connecting"
        self.dot_count = 1  # For animating dots (1, 2, 3)
        self.init_ui()

        # Timer for dot animation (500ms interval)
        self.animation_timer = QTimer()
        self.animation_timer.timeout.connect(self.update_dots)
        self.animation_timer.start(500)

    def init_ui(self):
        """Initialize the UI"""
        self.setStyleSheet("QWidget { background-color: #252525; }")
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 5, 10, 5)

        self.status_label = QLabel("connecting.")
        self.status_label.setStyleSheet("""
            QLabel {
                font-size: 10px;
                color: #cccccc;
                background-color: transparent;
            }
        """)
        layout.addWidget(self.status_label)

    def update_dots(self):
        """Update dot animation for connecting status"""
        if self.current_status == "connecting":
            dots = "." * self.dot_count
            self.status_label.setText(f"connecting{dots}")
            self.dot_count = (self.dot_count % 3) + 1  # Cycle: 1 -> 2 -> 3 -> 1

    def set_status(self, status: str):
        """Set connection status

        Args:
            status: One of "connecting", "connected", "disconnected"
        """
        self.current_status = status

        if status == "connected":
            self.status_label.setText("connected")
        elif status == "disconnected":
            self.status_label.setText("disconnected")
        elif status == "connecting":
            self.dot_count = 1
            self.status_label.setText("connecting.")
from PyQt6.QtWebEngineWidgets import QWebEngineView


def _webengine_disabled() -> bool:
    """Whether QWebEngine should be disabled (e.g., headless test runs)."""
    if os.environ.get("LOL_VIEWER_DISABLE_WEBENGINE") == "1":
        return True
    # Common headless platforms for Qt tests.
    if os.environ.get("QT_QPA_PLATFORM") in {"offscreen", "minimal"}:
        return True
    # Pytest sets this env var for the current test item.
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    return False


def _lcu_service_disabled() -> bool:
    """Whether background LCU polling should be disabled (e.g., tests)."""
    if os.environ.get("LOL_VIEWER_DISABLE_LCU_SERVICE") == "1":
        return True
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    return False


def _ui_dialogs_disabled() -> bool:
    """Disable modal dialogs in headless/test environments."""
    if os.environ.get("LOL_VIEWER_DISABLE_DIALOGS") == "1":
        return True
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    if os.environ.get("QT_QPA_PLATFORM") in {"offscreen", "minimal"}:
        return True
    return False


class NullWebView(QWidget):
    """Fallback widget when QWebEngineView cannot be used (headless/CI).

    Provides a minimal subset of QWebEngineView's API used by the app.
    """

    def __init__(self):
        super().__init__()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        label = QLabel("Web view disabled (headless mode)")
        label.setStyleSheet("QLabel { color: #aaaaaa; padding: 10px; }")
        label.setWordWrap(True)
        layout.addWidget(label)
        self._last_url = None

    def page(self):
        return self

    def setBackgroundColor(self, _color: QColor):
        # No-op for compatibility
        return None

    def setUrl(self, url: QUrl):
        self._last_url = url

    def reload(self):
        return None


def setup_logging():
    """Setup logging configuration based on executable name"""
    # Check if running as debug.exe, debug.py, or lol-viewer-debug.exe
    executable_name = os.path.basename(sys.argv[0])
    is_debug = 'debug' in executable_name.lower()

    # Configure logging level
    log_level = logging.DEBUG if is_debug else logging.INFO

    # Create formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Console handler (always enabled)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # File handler (only in debug mode)
    if is_debug:
        # Create logs directory if it doesn't exist
        log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
        os.makedirs(log_dir, exist_ok=True)

        # Create log file with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        log_file = os.path.join(log_dir, f'lol_viewer_{timestamp}.log')

        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

        logging.info(f"Debug mode enabled. Logging to {log_file}")
    else:
        logging.info("Normal mode. Logging to console only.")

    return is_debug


logger = logging.getLogger(__name__)

# Import these after logger setup
from champion_data import ChampionData, setup_champion_input
from logger import log
from lcu_detector import ChampionDetectorService



class ViewerListItemWidget(QWidget):
    """Custom widget for viewer list items with visibility toggle and close buttons"""

    def __init__(self, display_name: str, viewer: 'ChampionViewerWidget', parent_window: 'MainWindow'):
        super().__init__()
        self.viewer = viewer
        self.parent_window = parent_window
        self.init_ui(display_name)

    def init_ui(self, display_name: str):
        """Initialize the UI components"""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)
        layout.setSpacing(4)

        # Visibility toggle button (placed first)
        self.visibility_button = QPushButton()
        self.update_visibility_icon()
        self.visibility_button.setToolTip("Toggle visibility")
        self.visibility_button.setStyleSheet("""
            QPushButton {
                padding: 0px;
                background-color: #3a3a3a;
                border: 1px solid #555555;
                border-radius: 3px;
                min-width: 26px;
                max-width: 26px;
                min-height: 26px;
                max-height: 26px;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #4a4a4a;
                border: 1px solid #666666;
            }
            QPushButton:pressed {
                background-color: #2a2a2a;
            }
        """)
        self.visibility_button.clicked.connect(self.toggle_visibility)
        layout.addWidget(self.visibility_button)

        # Close button (placed second)
        self.close_button = QPushButton("✕")
        self.close_button.setToolTip("Close viewer")
        self.close_button.setStyleSheet("""
            QPushButton {
                padding: 0px;
                background-color: #3a3a3a;
                color: #cccccc;
                border: 1px solid #555555;
                border-radius: 3px;
                font-size: 14px;
                font-weight: bold;
                min-width: 26px;
                max-width: 26px;
                min-height: 26px;
                max-height: 26px;
            }
            QPushButton:hover {
                background-color: #5a3a3a;
                border: 1px solid #aa5555;
                color: #ffffff;
            }
            QPushButton:pressed {
                background-color: #4a2a2a;
            }
        """)
        self.close_button.clicked.connect(self.close_viewer)
        layout.addWidget(self.close_button)

        # Display name label (placed last, with stretch)
        self.name_label = QLabel(display_name)
        self.name_label.setStyleSheet("""
            QLabel {
                color: #ffffff;
                font-size: 12px;
                background-color: transparent;
            }
        """)
        layout.addWidget(self.name_label, 1)  # Stretch to take available space

    def update_visibility_icon(self):
        """Update visibility button icon based on viewer visibility"""
        if self.viewer.isVisible():
            self.visibility_button.setText("−")
        else:
            self.visibility_button.setText("+")

    def toggle_visibility(self):
        """Toggle viewer visibility"""
        if self.viewer.isVisible():
            self.viewer.hide()
            if self.viewer not in self.parent_window.hidden_viewers:
                self.parent_window.hidden_viewers.append(self.viewer)
        else:
            self.viewer.show()
            if self.viewer in self.parent_window.hidden_viewers:
                self.parent_window.hidden_viewers.remove(self.viewer)

        self.update_visibility_icon()
        self.parent_window.update_viewers_list()

    def close_viewer(self):
        """Close the viewer"""
        self.parent_window.close_viewer(self.viewer)


class ChampionViewerWidget(QWidget):
    """Widget containing champion input, build/counter buttons, and web view"""

    close_requested = pyqtSignal(object)  # Signal to request closing this viewer
    hide_requested = pyqtSignal(object)   # Signal to request hiding this viewer
    champion_updated = pyqtSignal(object)  # Signal when champion name is updated

    def __init__(self, viewer_id: int, champion_data: ChampionData = None, is_picked: bool = False, main_window=None):
        super().__init__()
        self.viewer_id = viewer_id
        self.current_champion = ""
        self.champion_data = champion_data
        self.current_page_type = ""  # "build" or "counter"
        # UI-selected mode (0=Build, 1=Counter, 2=ARAM). This is the "tab" the user selected,
        # and can be set even before a champion is entered.
        self.selected_mode_index = 0
        self.current_url = ""  # Store the current URL for refresh functionality
        self.is_picked = is_picked  # Whether this viewer was created from champion pick
        self.main_window = main_window  # Reference to MainWindow for URL settings
        self.init_ui()

    @staticmethod
    def get_lolalytics_build_url(champion_name: str) -> str:
        """Legacy helper used by tests: build URL for a champion."""
        return DEFAULT_BUILD_URL.replace("{name}", champion_name)

    @staticmethod
    def get_lolalytics_counter_url(champion_name: str) -> str:
        """Legacy helper used by tests: counter URL for a champion."""
        return DEFAULT_COUNTER_URL.replace("{name}", champion_name)

    def init_ui(self):
        """Initialize the UI components"""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        # Header layout with close and hide buttons
        header_layout = QHBoxLayout()
        header_layout.setSpacing(4)

        header_layout.addStretch()

        # Hide button
        self.hide_button = QPushButton("−")
        self.hide_button.setToolTip("Hide this viewer")
        self.hide_button.setStyleSheet("""
            QPushButton {
                padding: 4px 8px;
                font-size: 12pt;
                font-weight: bold;
                background-color: #555555;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                min-width: 30px;
                max-width: 30px;
                min-height: 30px;
                max-height: 30px;
            }
            QPushButton:hover {
                background-color: #666666;
            }
        """)
        self.hide_button.clicked.connect(lambda: self.hide_requested.emit(self))
        header_layout.addWidget(self.hide_button)

        # Close button
        self.close_button = QPushButton("×")
        self.close_button.setToolTip("Close this viewer")
        self.close_button.setStyleSheet("""
            QPushButton {
                padding: 4px 8px;
                font-size: 14pt;
                font-weight: bold;
                background-color: #d95d39;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                min-width: 30px;
                max-width: 30px;
                min-height: 30px;
                max-height: 30px;
            }
            QPushButton:hover {
                background-color: #e67e50;
            }
        """)
        self.close_button.clicked.connect(lambda: self.close_requested.emit(self))
        header_layout.addWidget(self.close_button)

        layout.addLayout(header_layout)

        # Control panel layout
        control_layout = QHBoxLayout()
        control_layout.setSpacing(8)

        # Champion name input
        self.champion_input = QLineEdit()
        self.champion_input.setPlaceholderText("Champion name (e.g., ashe, swain, アッシュ)")
        self.champion_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 11pt;
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #444444;
                border-radius: 4px;
            }
            QLineEdit:focus {
                border: 1px solid #0d7377;
            }
        """)
        # Open the currently selected mode when pressing Enter.
        self.champion_input.returnPressed.connect(self.open_selected_mode)
        control_layout.addWidget(self.champion_input, stretch=3)

        # Set up autocomplete if champion data is available
        if self.champion_data:
            setup_champion_input(self.champion_input, self.champion_data)

        # Build button
        self.build_button = QPushButton("Build")
        self.build_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 11pt;
                background-color: #0d7377;
                color: #ffffff;
                border: none;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #14a0a6;
            }
            QPushButton:pressed {
                background-color: #0a5c5f;
            }
            QPushButton:checked {
                background-color: #0a5c5f;
            }
        """)
        self.build_button.clicked.connect(lambda _=False: self._on_mode_button_clicked(0))
        control_layout.addWidget(self.build_button, stretch=1)

        # Counter button
        self.counter_button = QPushButton("Counter")
        self.counter_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 11pt;
                background-color: #d95d39;
                color: #ffffff;
                border: none;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #e67e50;
            }
            QPushButton:pressed {
                background-color: #b34b2d;
            }
            QPushButton:checked {
                background-color: #b34b2d;
            }
        """)
        self.counter_button.clicked.connect(lambda _=False: self._on_mode_button_clicked(1))
        control_layout.addWidget(self.counter_button, stretch=1)

        # ARAM button
        self.aram_button = QPushButton("ARAM")
        self.aram_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 11pt;
                background-color: #8b5cf6;
                color: #ffffff;
                border: none;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #a78bfa;
            }
            QPushButton:pressed {
                background-color: #7c3aed;
            }
            QPushButton:checked {
                background-color: #7c3aed;
            }
        """)
        self.aram_button.clicked.connect(lambda _=False: self._on_mode_button_clicked(2))
        control_layout.addWidget(self.aram_button, stretch=1)

        # Treat Build/Counter/ARAM as "tabs" (exclusive selection).
        self.mode_button_group = QButtonGroup(self)
        self.mode_button_group.setExclusive(True)
        for idx, btn in enumerate([self.build_button, self.counter_button, self.aram_button]):
            btn.setCheckable(True)
            self.mode_button_group.addButton(btn, idx)

        # Default Viewer-internal tab to 0 (Build).
        self._set_selected_mode_index(0)

        # Lane selector
        self.lane_selector = QComboBox()
        self.lane_selector.addItem("Lane", "")  # Default: no lane selected
        self.lane_selector.addItem("Top", "top")
        self.lane_selector.addItem("JG", "jungle")
        self.lane_selector.addItem("Mid", "middle")
        self.lane_selector.addItem("Bot", "bottom")
        self.lane_selector.addItem("Sup", "support")
        self.lane_selector.setStyleSheet("""
            QComboBox {
                padding: 8px;
                font-size: 11pt;
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #444444;
                border-radius: 4px;
                min-width: 40px;
            }
            QComboBox:hover {
                border: 1px solid #0d7377;
            }
            QComboBox::drop-down {
                border: none;
                width: 0px;
            }
            QComboBox::down-arrow {
                image: none;
                width: 0px;
                height: 0px;
            }
            QComboBox QAbstractItemView {
                background-color: #2b2b2b;
                color: #ffffff;
                selection-background-color: #0d7377;
                border: 1px solid #444444;
            }
        """)
        control_layout.addWidget(self.lane_selector, stretch=1)

        # Refresh button
        self.refresh_button = QPushButton("⟳")
        self.refresh_button.setToolTip("Refresh page")
        self.refresh_button.setStyleSheet("""
            QPushButton {
                padding: 8px;
                font-size: 14pt;
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #444444;
                border-radius: 4px;
                min-width: 40px;
                max-width: 40px;
            }
            QPushButton:hover {
                background-color: #3a3a3a;
                border: 1px solid #0d7377;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """)
        self.refresh_button.clicked.connect(self.refresh_page)
        control_layout.addWidget(self.refresh_button)

        layout.addLayout(control_layout)

        # WebView
        self.web_view = NullWebView() if _webengine_disabled() else QWebEngineView()
        # Set dark background color for web view to match dark theme (no-op in NullWebView)
        self.web_view.page().setBackgroundColor(QColor("#1e1e1e"))
        layout.addWidget(self.web_view)

        # Set minimum and preferred width
        self.setMinimumWidth(300)
        self.resize(500, self.height())

    def _set_selected_mode_index(self, index: int):
        """Update the selected mode tab (0=Build, 1=Counter, 2=ARAM) without forcing navigation."""
        try:
            index = int(index)
        except Exception:
            index = 0
        if index not in (0, 1, 2):
            index = 0
        self.selected_mode_index = index
        if hasattr(self, "mode_button_group") and self.mode_button_group:
            btn = self.mode_button_group.button(index)
            if btn is not None and not btn.isChecked():
                btn.setChecked(True)

    def _on_mode_button_clicked(self, index: int):
        """Handle user selecting a mode 'tab'. If a champion is entered, navigate immediately."""
        self._set_selected_mode_index(index)
        champion_name = self.champion_input.text().strip().lower()
        if not champion_name:
            # Allow selecting the tab without showing an error.
            self.champion_input.setFocus()
            return
        self.open_selected_mode()

    def open_selected_mode(self):
        """Open the page for the currently selected mode tab."""
        index = getattr(self, "selected_mode_index", 0)
        if index == 1:
            return self.open_counter()
        if index == 2:
            return self.open_aram()
        return self.open_build()

    def open_build(self):
        """Open the build page for the entered champion"""
        self._set_selected_mode_index(0)
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        self.current_champion = champion_name
        self.current_page_type = "build"

        # Get selected lane
        lane = self.lane_selector.currentData()
        url = self.get_build_url(champion_name, lane)
        self.current_url = url  # Store URL for refresh functionality
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()
        # Notify parent window that champion name has been updated
        self.champion_updated.emit(self)

    def open_counter(self):
        """Open the counter page for the entered champion"""
        self._set_selected_mode_index(1)
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        self.current_champion = champion_name
        self.current_page_type = "counter"

        # Get selected lane
        lane = self.lane_selector.currentData()
        url = self.get_counter_url(champion_name, lane)
        self.current_url = url  # Store URL for refresh functionality
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()
        # Notify parent window that champion name has been updated
        self.champion_updated.emit(self)

    def open_aram(self):
        """Open the ARAM page for the entered champion"""
        self._set_selected_mode_index(2)
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        self.current_champion = champion_name
        self.current_page_type = "aram"

        url = self.get_aram_url(champion_name)
        logger.info(f"Opening ARAM page for {champion_name}: {url}")

        self.current_url = url  # Store URL for refresh functionality
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()
        # Notify parent window that champion name has been updated
        self.champion_updated.emit(self)

    def refresh_page(self):
        """Refresh the current web page by reopening the original URL"""
        if self.current_url:
            logger.info(f"Refreshing web page by reopening URL: {self.current_url}")
            self.web_view.setUrl(QUrl(self.current_url))
        else:
            logger.info("No URL stored, using standard reload")
            self.web_view.reload()

    def get_display_name(self) -> str:
        """Get display name for this viewer (used in sidebar)."""
        # Prefer meaningful labels over internal viewer numbering.
        # Regression fix: avoid showing "View #n" labels in the sidebar.
        champ_raw = (self.current_champion or "").strip()
        champ_display = champ_raw.title() if champ_raw else ""

        if not champ_display:
            return "(Empty)"

        parts = [champ_display]
        if self.current_page_type:
            parts.append(self.current_page_type)
        if self.is_picked:
            parts.append("picked")
        return " | ".join(parts)

    def get_build_url(self, champion_name: str, lane: str = "") -> str:
        """Generate the build URL for a given champion using configured URL template"""
        if not self.main_window:
            # Fallback to default URL if main_window reference is not available
            base_url = DEFAULT_BUILD_URL.replace("{name}", champion_name.lower())
        else:
            base_url = self.main_window.build_url.replace("{name}", champion_name.lower())

        if lane:
            # Add lane as query parameter
            return f"{base_url}?lane={lane}"
        return base_url

    def get_counter_url(self, champion_name: str, lane: str = "") -> str:
        """Generate the counter URL for a given champion using configured URL template"""
        if not self.main_window:
            # Fallback to default URL if main_window reference is not available
            base_url = DEFAULT_COUNTER_URL.replace("{name}", champion_name.lower())
        else:
            base_url = self.main_window.counter_url.replace("{name}", champion_name.lower())

        if lane:
            # Add lane as query parameter
            return f"{base_url}?lane={lane}"
        return base_url

    def get_aram_url(self, champion_name: str) -> str:
        """Generate the ARAM URL for a given champion using configured URL template"""
        if not self.main_window:
            # Fallback to default URL if main_window reference is not available
            # Format champion name: lowercase, no spaces (for compatibility with u.gg format)
            formatted_name = champion_name.lower().replace(" ", "")
            return DEFAULT_ARAM_URL.replace("{name}", formatted_name)
        else:
            # Format champion name: lowercase, no spaces (for compatibility with u.gg format)
            formatted_name = champion_name.lower().replace(" ", "")
            return self.main_window.aram_url.replace("{name}", formatted_name)


class MainWindow(QMainWindow):
    MAX_VIEWERS = 20  # Maximum number of viewers allowed

    def __init__(self):
        super().__init__()
        self.viewers = []  # List of all viewer widgets
        self.hidden_viewers = []  # List of hidden viewer widgets
        self.next_viewer_id = 0  # Counter for assigning viewer IDs
        self.champion_data = ChampionData()  # Load champion data

        # Load URL settings
        self.settings = QSettings("LoLViewer", "LoLViewer")
        self.build_url = self.settings.value("build_url", DEFAULT_BUILD_URL, type=str)
        self.counter_url = self.settings.value("counter_url", DEFAULT_COUNTER_URL, type=str)
        self.aram_url = self.settings.value("aram_url", DEFAULT_ARAM_URL, type=str)
        self.live_game_url = self.settings.value("live_game_url", DEFAULT_LIVE_GAME_URL, type=str)

        # Load feature flags
        self.feature_flags = self.load_feature_flags()

        # Initialize champion detector service
        logger.info("Initializing ChampionDetectorService...")
        self.champion_detector = ChampionDetectorService()
        self.champion_detector.champion_detected.connect(self.on_champion_detected)
        self.champion_detector.enemy_champion_detected.connect(self.on_enemy_champion_detected)
        logger.info("ChampionDetectorService initialized and connected")

        # Create connection status widget
        self.connection_status_widget = LCUConnectionStatusWidget()

        self.init_ui()

        # Connect status signal after UI is initialized
        self.champion_detector.connection_status_changed.connect(self.connection_status_widget.set_status)

    def _current_queue_snapshot(self) -> tuple[object, object]:
        """Best-effort snapshot of current (queue_id, game_mode) from LCU."""
        try:
            queue_id = None
            game_mode = None
            if hasattr(self, "champion_detector") and self.champion_detector:
                queue_id = self.champion_detector.get_current_queue_id()
                game_mode = self.champion_detector.get_current_game_mode()
            return queue_id, game_mode
        except Exception:
            return None, None

    def _is_aram_like_mode(self) -> bool:
        """Return True if current match is ARAM or ARAM: Mayhem."""
        queue_id, game_mode = self._current_queue_snapshot()
        if queue_id in ARAM_MAYHEM_QUEUE_IDS:
            return True
        if queue_id in ARAM_QUEUE_IDS:
            return True
        if isinstance(game_mode, str) and game_mode.strip().upper() == "ARAM":
            return True
        return False

    @staticmethod
    def get_resource_path(relative_path):
        """Get absolute path to resource, works for dev and for PyInstaller"""
        try:
            # PyInstaller creates a temp folder and stores path in _MEIPASS
            base_path = sys._MEIPASS
        except AttributeError:
            # Running in normal Python environment
            base_path = os.path.abspath(".")

        return os.path.join(base_path, relative_path)

    def init_ui(self):
        """Initialize the user interface"""
        self.setWindowTitle("LoL Viewer")
        self.resize(1600, 900)

        # Set window icon
        icon_path = self.get_resource_path('assets/icons/main-icon.png')
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        # Apply dark theme to the main window
        self.setStyleSheet("""
            QMainWindow {
                background-color: #1e1e1e;
            }
            QWidget {
                background-color: #1e1e1e;
                color: #ffffff;
            }
            QScrollBar:horizontal {
                border: none;
                background: #2b2b2b;
                height: 12px;
                margin: 0px 0px 0px 0px;
            }
            QScrollBar::handle:horizontal {
                background: #555555;
                min-width: 20px;
                border-radius: 6px;
            }
            QScrollBar::handle:horizontal:hover {
                background: #666666;
            }
            QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
                border: none;
                background: none;
            }
        """)

        # Create central widget and layout
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)
        main_layout.setSpacing(0)
        main_layout.setContentsMargins(0, 0, 0, 0)

        # Left sidebar with tabs
        self.create_sidebar()

        # Create sidebar container with status widget at bottom
        sidebar_container = QWidget()
        sidebar_container.setMinimumWidth(150)
        sidebar_container.setStyleSheet("QWidget { background-color: #252525; }")
        sidebar_layout = QVBoxLayout(sidebar_container)
        sidebar_layout.setSpacing(0)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)
        sidebar_layout.addWidget(self.sidebar)
        sidebar_layout.addWidget(self.connection_status_widget)

        # Create splitter for resizable sidebar
        self.main_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.main_splitter.setChildrenCollapsible(False)
        self.main_splitter.setStyleSheet("""
            QSplitter::handle {
                background-color: #444444;
                width: 2px;
            }
            QSplitter::handle:hover {
                background-color: #0d7377;
            }
        """)
        self.main_splitter.addWidget(sidebar_container)

        # Right side - stacked widget for switching between Live Game and Viewers
        self.main_content_stack = QStackedWidget()

        # Page 0: Live Game
        self.create_live_game_page()
        self.main_content_stack.addWidget(self.live_game_page)

        # Page 1: Viewers
        self.create_viewers_page()
        self.main_content_stack.addWidget(self.viewers_page)

        # Page 2: Settings
        self.create_settings_page()
        self.main_content_stack.addWidget(self.settings_page)

        # Add main content to splitter
        self.main_splitter.addWidget(self.main_content_stack)

        # Add splitter to main layout
        main_layout.addWidget(self.main_splitter)

        # Restore saved sidebar width
        self.restore_sidebar_width()

        # Connect splitter moved signal to save width
        self.main_splitter.splitterMoved.connect(self.save_sidebar_width)

        # Set default tab to Viewers (index 1) after all widgets are created
        self.sidebar.setCurrentIndex(1)
        self.main_content_stack.setCurrentIndex(1)

        # Update viewers list after window is shown to fix initial [Hidden] tag issue
        QTimer.singleShot(0, self.update_viewers_list)

    def create_live_game_page(self):
        """Create the Live Game page with web view using configured URL"""
        self.live_game_page = QWidget()
        live_game_layout = QVBoxLayout(self.live_game_page)
        live_game_layout.setSpacing(0)
        live_game_layout.setContentsMargins(0, 0, 0, 0)

        # WebView using configured live game URL
        self.live_game_web_view = NullWebView() if _webengine_disabled() else QWebEngineView()
        self.live_game_web_view.page().setBackgroundColor(QColor("#1e1e1e"))
        self.live_game_web_view.setUrl(QUrl(self.live_game_url))
        live_game_layout.addWidget(self.live_game_web_view)

    def create_viewers_page(self):
        """Create the Viewers page with toolbar and viewers splitter"""
        self.viewers_page = QWidget()
        viewers_layout = QVBoxLayout(self.viewers_page)
        viewers_layout.setSpacing(0)
        viewers_layout.setContentsMargins(0, 0, 0, 0)

        # Top toolbar with add and close all buttons
        self.create_toolbar()
        viewers_layout.addWidget(self.toolbar)

        # Splitter for resizable viewers
        self.viewers_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.viewers_splitter.setStyleSheet("""
            QSplitter::handle {
                background-color: #444444;
                width: 2px;
            }
            QSplitter::handle:hover {
                background-color: #0d7377;
            }
        """)
        self.viewers_splitter.setHandleWidth(6)
        self.viewers_splitter.setChildrenCollapsible(False)

        viewers_layout.addWidget(self.viewers_splitter)

        # Create initial viewers (default 2) if none exist yet
        if len(self.viewers) == 0:
            self.add_viewer()
            self.add_viewer()

        # Start champion detection service (disabled in tests/headless if needed)
        if _lcu_service_disabled():
            logger.info("LCU champion detection service disabled")
        else:
            logger.info("Starting champion detection service")
            self.champion_detector.start(interval_ms=2000)

    def create_settings_page(self):
        """Create the Settings page with version information and update check"""
        self.settings_page = QWidget()
        settings_scroll = QScrollArea()
        settings_scroll.setWidgetResizable(True)
        settings_scroll.setStyleSheet("""
            QScrollArea {
                border: none;
                background-color: #1e1e1e;
            }
        """)

        settings_content = QWidget()
        settings_layout = QVBoxLayout(settings_content)
        settings_layout.setSpacing(20)
        settings_layout.setContentsMargins(40, 40, 40, 40)

        # Title
        title_label = QLabel("Settings")
        title_label.setStyleSheet("""
            QLabel {
                font-size: 18pt;
                font-weight: bold;
                color: #ffffff;
                background-color: transparent;
            }
        """)
        settings_layout.addWidget(title_label)

        # Analytics URLs section
        url_group = QWidget()
        url_layout = QVBoxLayout(url_group)
        url_layout.setSpacing(15)

        url_title = QLabel("Analytics URLs")
        url_title.setStyleSheet("""
            QLabel {
                font-size: 12pt;
                font-weight: bold;
                color: #ffffff;
                background-color: transparent;
            }
        """)
        url_layout.addWidget(url_title)

        url_description = QLabel("Configure URLs for each analytics type. Use {name} as placeholder for champion name, {lane} for lane parameter.")
        url_description.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #aaaaaa;
                background-color: transparent;
                padding: 5px;
            }
        """)
        url_description.setWordWrap(True)
        url_layout.addWidget(url_description)

        # Build URL
        build_url_label = QLabel("Build URL:")
        build_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #cccccc; background-color: transparent; }")
        url_layout.addWidget(build_url_label)

        self.build_url_input = QLineEdit()
        self.build_url_input.setPlaceholderText("e.g., https://lolalytics.com/lol/{name}/build/")
        self.build_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #444444;
                border-radius: 4px;
            }
            QLineEdit:focus {
                border: 1px solid #0d7377;
            }
        """)
        url_layout.addWidget(self.build_url_input)

        # Counter URL
        counter_url_label = QLabel("Counter URL:")
        counter_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #cccccc; background-color: transparent; }")
        url_layout.addWidget(counter_url_label)

        self.counter_url_input = QLineEdit()
        self.counter_url_input.setPlaceholderText("e.g., https://lolalytics.com/lol/{name}/counters/")
        self.counter_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #444444;
                border-radius: 4px;
            }
            QLineEdit:focus {
                border: 1px solid #0d7377;
            }
        """)
        url_layout.addWidget(self.counter_url_input)

        # ARAM URL
        aram_url_label = QLabel("ARAM URL:")
        aram_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #cccccc; background-color: transparent; }")
        url_layout.addWidget(aram_url_label)

        self.aram_url_input = QLineEdit()
        self.aram_url_input.setPlaceholderText("e.g., https://u.gg/lol/champions/aram/{name}-aram")
        self.aram_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #444444;
                border-radius: 4px;
            }
            QLineEdit:focus {
                border: 1px solid #0d7377;
            }
        """)
        url_layout.addWidget(self.aram_url_input)

        # Live Game URL
        live_game_url_label = QLabel("Live Game URL:")
        live_game_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #cccccc; background-color: transparent; }")
        url_layout.addWidget(live_game_url_label)

        self.live_game_url_input = QLineEdit()
        self.live_game_url_input.setPlaceholderText("e.g., https://u.gg/lol/lg-splash")
        self.live_game_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #444444;
                border-radius: 4px;
            }
            QLineEdit:focus {
                border: 1px solid #0d7377;
            }
        """)
        url_layout.addWidget(self.live_game_url_input)

        # URL buttons
        url_buttons_layout = QHBoxLayout()

        self.save_urls_button = QPushButton("Save URLs")
        self.save_urls_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 10pt;
                background-color: #0d7377;
                color: #ffffff;
                border: none;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #14a0a6;
            }
            QPushButton:pressed {
                background-color: #0a5c5f;
            }
        """)
        self.save_urls_button.clicked.connect(self.save_url_settings)
        url_buttons_layout.addWidget(self.save_urls_button)

        self.reset_urls_button = QPushButton("Reset to Defaults")
        self.reset_urls_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 10pt;
                background-color: #3a3a3a;
                color: #aaaaaa;
                border: 1px solid #555555;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #4a4a4a;
                color: #ffffff;
            }
            QPushButton:pressed {
                background-color: #2a2a2a;
            }
        """)
        self.reset_urls_button.clicked.connect(self.reset_url_settings)
        url_buttons_layout.addWidget(self.reset_urls_button)

        url_buttons_layout.addStretch()
        url_layout.addLayout(url_buttons_layout)

        # URL save status label
        self.url_status_label = QLabel("")
        self.url_status_label.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #aaaaaa;
                background-color: transparent;
                padding: 5px;
            }
        """)
        url_layout.addWidget(self.url_status_label)

        settings_layout.addWidget(url_group)

        # LCU connection controls
        connection_group = QWidget()
        connection_layout = QVBoxLayout(connection_group)
        connection_layout.setSpacing(10)

        connection_title = QLabel("LCU Connection")
        connection_title.setStyleSheet("""
            QLabel {
                font-size: 12pt;
                font-weight: bold;
                color: #ffffff;
                background-color: transparent;
            }
        """)
        connection_layout.addWidget(connection_title)

        connection_description = QLabel("LoLクライアントを後から起動した場合は、下のボタンを押すと即座に接続を再試行します。")
        connection_description.setWordWrap(True)
        connection_description.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #aaaaaa;
                background-color: transparent;
                padding: 5px 0px;
            }
        """)
        connection_layout.addWidget(connection_description)

        self.lcu_connect_button = QPushButton("Retry LCU Connection")
        self.lcu_connect_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 10pt;
                background-color: #3a3a3a;
                color: #aaaaaa;
                border: 1px solid #555555;
                border-radius: 4px;
            }
            QPushButton:hover:enabled {
                background-color: #4a4a4a;
                color: #ffffff;
            }
            QPushButton:pressed:enabled {
                background-color: #2a2a2a;
            }
            QPushButton:disabled {
                background-color: #2a2a2a;
                color: #666666;
            }
        """)
        self.lcu_connect_button.clicked.connect(self.manual_connect_lcu)
        connection_layout.addWidget(self.lcu_connect_button)

        settings_layout.addWidget(connection_group)

        # Version section
        version_group = QWidget()
        version_layout = QVBoxLayout(version_group)
        version_layout.setSpacing(10)

        version_title = QLabel("Version Information")
        version_title.setStyleSheet("""
            QLabel {
                font-size: 12pt;
                font-weight: bold;
                color: #ffffff;
                background-color: transparent;
            }
        """)
        version_layout.addWidget(version_title)

        # Current version
        self.current_version_label = QLabel(f"Current version: {__version__}")
        self.current_version_label.setStyleSheet("""
            QLabel {
                font-size: 11pt;
                color: #cccccc;
                background-color: transparent;
                padding: 5px;
            }
        """)
        version_layout.addWidget(self.current_version_label)

        # Latest version (initially unknown)
        self.latest_version_label = QLabel("Latest version: Checking...")
        self.latest_version_label.setStyleSheet("""
            QLabel {
                font-size: 11pt;
                color: #cccccc;
                background-color: transparent;
                padding: 5px;
            }
        """)
        version_layout.addWidget(self.latest_version_label)

        # Status message
        self.status_label = QLabel("")
        self.status_label.setStyleSheet("""
            QLabel {
                font-size: 10pt;
                color: #aaaaaa;
                background-color: transparent;
                padding: 5px;
            }
        """)
        self.status_label.setWordWrap(True)
        version_layout.addWidget(self.status_label)

        settings_layout.addWidget(version_group)

        # Update button
        self.update_button = QPushButton("Check for Updates")
        self.update_button.setStyleSheet("""
            QPushButton {
                padding: 10px 20px;
                font-size: 11pt;
                background-color: #0d7377;
                color: #ffffff;
                border: none;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #14a0a6;
            }
            QPushButton:pressed {
                background-color: #0a5c5f;
            }
            QPushButton:disabled {
                background-color: #555555;
                color: #888888;
            }
        """)
        self.update_button.clicked.connect(self.check_for_updates)
        settings_layout.addWidget(self.update_button)

        # Feature flags section (bottom)
        flags_group = QWidget()
        flags_layout = QVBoxLayout(flags_group)
        flags_layout.setSpacing(10)

        flags_title = QLabel("Feature Flags")
        flags_title.setStyleSheet("""
            QLabel {
                font-size: 12pt;
                font-weight: bold;
                color: #ffffff;
                background-color: transparent;
            }
        """)
        flags_layout.addWidget(flags_title)

        flags_description = QLabel(
            "Toggle experimental or gated features. If something breaks, turn the flag OFF and restart the app."
        )
        flags_description.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #aaaaaa;
                background-color: transparent;
                padding: 5px;
            }
        """)
        flags_description.setWordWrap(True)
        flags_layout.addWidget(flags_description)

        self.feature_flag_checkboxes = {}
        if not FEATURE_FLAG_DEFINITIONS:
            no_flags_label = QLabel("No feature flags available in this build.")
            no_flags_label.setStyleSheet("QLabel { font-size: 10pt; color: #cccccc; background-color: transparent; padding: 5px; }")
            flags_layout.addWidget(no_flags_label)
        else:
            for key, meta in FEATURE_FLAG_DEFINITIONS.items():
                checkbox = QCheckBox(meta.get("label", key))
                checkbox.setChecked(bool(self.feature_flags.get(key, meta.get("default", False))))
                if meta.get("description"):
                    checkbox.setToolTip(meta["description"])
                checkbox.setStyleSheet("""
                    QCheckBox {
                        font-size: 10pt;
                        color: #cccccc;
                        background-color: transparent;
                        padding: 4px;
                    }
                    QCheckBox::indicator {
                        width: 16px;
                        height: 16px;
                    }
                """)
                checkbox.stateChanged.connect(lambda state, k=key: self.set_feature_flag(k, state == 2))
                self.feature_flag_checkboxes[key] = checkbox
                flags_layout.addWidget(checkbox)

        flags_buttons_layout = QHBoxLayout()
        self.reset_flags_button = QPushButton("Reset Flags to Defaults")
        self.reset_flags_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 10pt;
                background-color: #3a3a3a;
                color: #aaaaaa;
                border: 1px solid #555555;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #4a4a4a;
                color: #ffffff;
            }
            QPushButton:pressed {
                background-color: #2a2a2a;
            }
        """)
        self.reset_flags_button.clicked.connect(self.reset_feature_flags)
        flags_buttons_layout.addWidget(self.reset_flags_button)
        flags_buttons_layout.addStretch()
        flags_layout.addLayout(flags_buttons_layout)

        self.flags_status_label = QLabel("")
        self.flags_status_label.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #aaaaaa;
                background-color: transparent;
                padding: 5px;
            }
        """)
        flags_layout.addWidget(self.flags_status_label)

        settings_layout.addWidget(flags_group)
        settings_layout.addStretch()

        settings_scroll.setWidget(settings_content)

        # Set scroll area as the settings page content
        page_layout = QVBoxLayout(self.settings_page)
        page_layout.setContentsMargins(0, 0, 0, 0)
        page_layout.addWidget(settings_scroll)

        # Load saved URL settings
        self.load_url_settings()
        self.load_feature_flag_settings()

    def create_sidebar(self):
        """Create the left sidebar with tabs for Live Game and Viewers"""
        self.sidebar = QTabWidget()
        self.sidebar.setStyleSheet("""
            QTabWidget {
                background-color: #252525;
                border-right: 1px solid #444444;
            }
            QTabWidget::pane {
                border: none;
                background-color: #252525;
            }
            QTabBar::tab {
                background-color: #2b2b2b;
                color: #ffffff;
                padding: 8px 16px;
                border: none;
                border-bottom: 2px solid transparent;
            }
            QTabBar::tab:selected {
                background-color: #0d7377;
                border-bottom: 2px solid #14a0a6;
            }
            QTabBar::tab:hover {
                background-color: #3a3a3a;
            }
        """)

        # Live Game tab (empty for now, will show web view in main content)
        live_game_widget = QWidget()
        live_game_layout = QVBoxLayout(live_game_widget)
        live_game_layout.setContentsMargins(10, 10, 10, 10)

        live_game_label = QLabel("Live Game\n\nSelect this tab to view\nu.gg live game splash")
        live_game_label.setStyleSheet("""
            QLabel {
                font-size: 10pt;
                color: #aaaaaa;
                padding: 10px;
            }
        """)
        live_game_label.setWordWrap(True)
        live_game_layout.addWidget(live_game_label)
        live_game_layout.addStretch()

        self.sidebar.addTab(live_game_widget, "Live Game")

        # Viewers tab
        viewers_widget = QWidget()
        viewers_layout = QVBoxLayout(viewers_widget)
        viewers_layout.setSpacing(10)
        viewers_layout.setContentsMargins(10, 10, 10, 10)

        # List of all viewers
        self.viewers_list = QListWidget()
        self.viewers_list.setStyleSheet("""
            QListWidget {
                background-color: #2b2b2b;
                border: 1px solid #444444;
                border-radius: 4px;
                color: #ffffff;
                padding: 5px;
            }
            QListWidget::item {
                padding: 0px;
                border-radius: 4px;
            }
            QListWidget::item:hover {
                background-color: #3a3a3a;
            }
            QListWidget::item:selected {
                background-color: #0d7377;
            }
        """)
        self.viewers_list.itemDoubleClicked.connect(self.toggle_viewer_visibility)
        viewers_layout.addWidget(self.viewers_list)

        self.sidebar.addTab(viewers_widget, "Viewers")

        # Settings tab
        settings_widget = QWidget()
        settings_sidebar_layout = QVBoxLayout(settings_widget)
        settings_sidebar_layout.setContentsMargins(10, 10, 10, 10)

        settings_label = QLabel("Settings\n\nSelect this tab to view\napplication settings")
        settings_label.setStyleSheet("""
            QLabel {
                font-size: 10pt;
                color: #aaaaaa;
                padding: 10px;
            }
        """)
        settings_label.setWordWrap(True)
        settings_sidebar_layout.addWidget(settings_label)
        settings_sidebar_layout.addStretch()

        self.sidebar.addTab(settings_widget, "Settings")

        # Connect tab change signal to update main content
        self.sidebar.currentChanged.connect(self.on_sidebar_tab_changed)

    def on_sidebar_tab_changed(self, index):
        """Handle sidebar tab change and update main content"""
        # Switch main content stack to match sidebar tab
        self.main_content_stack.setCurrentIndex(index)

        # When settings tab is selected (index 2), check for updates
        if index == 2:
            QTimer.singleShot(100, self.check_latest_version)

    def load_url_settings(self):
        """Load URL settings from QSettings and populate input fields"""
        self.build_url_input.setText(self.build_url)
        self.counter_url_input.setText(self.counter_url)
        self.aram_url_input.setText(self.aram_url)
        self.live_game_url_input.setText(self.live_game_url)

    def load_feature_flags(self) -> dict:
        """Load feature flags from QSettings using definitions as defaults."""
        flags = {}
        for key, meta in FEATURE_FLAG_DEFINITIONS.items():
            default_value = bool(meta.get("default", False))
            flags[key] = self.settings.value(f"feature_flags/{key}", default_value, type=bool)
        return flags

    def load_feature_flag_settings(self):
        """Populate feature flag checkboxes from loaded flags."""
        if not hasattr(self, "feature_flag_checkboxes"):
            return
        for key, checkbox in self.feature_flag_checkboxes.items():
            meta = FEATURE_FLAG_DEFINITIONS.get(key, {})
            checkbox.setChecked(bool(self.feature_flags.get(key, meta.get("default", False))))

    def set_feature_flag(self, key: str, enabled: bool):
        """Persist a feature flag change and update in-memory state."""
        self.feature_flags[key] = bool(enabled)
        self.settings.setValue(f"feature_flags/{key}", bool(enabled))
        if hasattr(self, "flags_status_label"):
            self.flags_status_label.setText(f"✓ Flag '{key}' set to {'ON' if enabled else 'OFF'} (restart may be required)")
            self.flags_status_label.setStyleSheet("""
                QLabel {
                    font-size: 9pt;
                    color: #4a9d4a;
                    background-color: transparent;
                    padding: 5px;
                }
            """)
        logger.info(f"Feature flag updated: {key}={enabled}")

    def reset_feature_flags(self):
        """Reset all feature flags to their default values."""
        for key, meta in FEATURE_FLAG_DEFINITIONS.items():
            default_value = bool(meta.get("default", False))
            self.feature_flags[key] = default_value
            self.settings.setValue(f"feature_flags/{key}", default_value)
        self.load_feature_flag_settings()
        if hasattr(self, "flags_status_label"):
            self.flags_status_label.setText("✓ Feature flags reset to defaults")
            self.flags_status_label.setStyleSheet("""
                QLabel {
                    font-size: 9pt;
                    color: #4a9d4a;
                    background-color: transparent;
                    padding: 5px;
                }
            """)
        logger.info("Feature flags reset to defaults")

    def save_url_settings(self):
        """Save URL settings to QSettings"""
        self.build_url = self.build_url_input.text().strip()
        self.counter_url = self.counter_url_input.text().strip()
        self.aram_url = self.aram_url_input.text().strip()
        self.live_game_url = self.live_game_url_input.text().strip()

        # Validate that URLs are not empty
        if not self.build_url or not self.counter_url or not self.aram_url or not self.live_game_url:
            self.url_status_label.setText("✗ Error: All URLs must be filled")
            self.url_status_label.setStyleSheet("""
                QLabel {
                    font-size: 9pt;
                    color: #d95d39;
                    background-color: transparent;
                    padding: 5px;
                }
            """)
            return

        self.settings.setValue("build_url", self.build_url)
        self.settings.setValue("counter_url", self.counter_url)
        self.settings.setValue("aram_url", self.aram_url)
        self.settings.setValue("live_game_url", self.live_game_url)

        # Update live game URL immediately
        self.live_game_web_view.setUrl(QUrl(self.live_game_url))

        self.url_status_label.setText("✓ URLs saved successfully")
        self.url_status_label.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #4a9d4a;
                background-color: transparent;
                padding: 5px;
            }
        """)

        logger.info(f"URL settings saved - Build: {self.build_url}, Counter: {self.counter_url}, ARAM: {self.aram_url}, Live Game: {self.live_game_url}")

    def reset_url_settings(self):
        """Reset URL settings to defaults"""
        self.build_url = DEFAULT_BUILD_URL
        self.counter_url = DEFAULT_COUNTER_URL
        self.aram_url = DEFAULT_ARAM_URL
        self.live_game_url = DEFAULT_LIVE_GAME_URL

        self.build_url_input.setText(self.build_url)
        self.counter_url_input.setText(self.counter_url)
        self.aram_url_input.setText(self.aram_url)
        self.live_game_url_input.setText(self.live_game_url)

        self.settings.setValue("build_url", self.build_url)
        self.settings.setValue("counter_url", self.counter_url)
        self.settings.setValue("aram_url", self.aram_url)
        self.settings.setValue("live_game_url", self.live_game_url)

        # Update live game URL immediately
        self.live_game_web_view.setUrl(QUrl(self.live_game_url))

        self.url_status_label.setText("✓ URLs reset to defaults")
        self.url_status_label.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #4a9d4a;
                background-color: transparent;
                padding: 5px;
            }
        """)

        logger.info("URL settings reset to defaults")

    def manual_connect_lcu(self):
        """Trigger an immediate attempt to connect to the LoL client."""
        if not hasattr(self, "lcu_connect_button"):
            return

        button = self.lcu_connect_button
        if not button.isEnabled():
            return

        button.setEnabled(False)
        button.setText("Connecting...")
        QApplication.processEvents()

        try:
            if hasattr(self, "champion_detector"):
                self.champion_detector.manual_connect_attempt()
        finally:
            QTimer.singleShot(1500, self.reset_lcu_connect_button)

    def reset_lcu_connect_button(self):
        """Restore the LCU connect button state."""
        if hasattr(self, "lcu_connect_button"):
            self.lcu_connect_button.setEnabled(True)
            self.lcu_connect_button.setText("Retry LCU Connection")

    def save_sidebar_width(self):
        """Save the current sidebar width to settings"""
        sizes = self.main_splitter.sizes()
        if len(sizes) > 0:
            self.settings.setValue("sidebar_width", sizes[0])

    def restore_sidebar_width(self):
        """Restore the sidebar width from settings"""
        saved_width = self.settings.value("sidebar_width", 200, type=int)
        # Always set sidebar width explicitly using window's initial width
        # This prevents QSplitter from defaulting to 50/50 split on first launch
        initial_window_width = 1600  # Default window width set in init_ui
        self.main_splitter.setSizes([saved_width, initial_window_width - saved_width])

    def create_toolbar(self):
        """Create the top toolbar with add and close all buttons"""
        self.toolbar = QWidget()
        self.toolbar.setStyleSheet("""
            QWidget {
                background-color: #252525;
                border-bottom: 1px solid #444444;
            }
        """)
        self.toolbar.setFixedHeight(60)

        toolbar_layout = QHBoxLayout(self.toolbar)
        toolbar_layout.setSpacing(10)
        toolbar_layout.setContentsMargins(10, 10, 10, 10)

        toolbar_layout.addStretch()

        # Close all button
        self.close_all_button = QPushButton("Close All")
        self.close_all_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 10pt;
                background-color: #3a3a3a;
                color: #aaaaaa;
                border: 1px solid #555555;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #4a4a4a;
                color: #ffffff;
            }
            QPushButton:pressed {
                background-color: #2a2a2a;
            }
        """)
        self.close_all_button.clicked.connect(self.close_all_viewers)
        toolbar_layout.addWidget(self.close_all_button)

        # Add viewer button
        self.add_button = QPushButton("＋ Add Viewer")
        self.add_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 10pt;
                background-color: #3a3a3a;
                color: #aaaaaa;
                border: 1px solid #555555;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #4a4a4a;
                color: #ffffff;
            }
            QPushButton:pressed {
                background-color: #2a2a2a;
            }
        """)
        self.add_button.clicked.connect(self.add_viewer)
        toolbar_layout.addWidget(self.add_button)

    def add_viewer(self, position: int = -1, is_picked: bool = False):
        """Add a new viewer widget

        Args:
            position: Position to insert the viewer (-1 for append, 0 for leftmost)
            is_picked: Whether this viewer was created from champion pick
        """
        if len(self.viewers) >= self.MAX_VIEWERS:
            if _ui_dialogs_disabled():
                logger.warning("Maximum viewers reached; dialog suppressed in headless/test mode")
            else:
                QMessageBox.warning(
                    self,
                    "Maximum Viewers Reached",
                    f"You can only have up to {self.MAX_VIEWERS} viewers."
                )
            return None

        # Create new viewer with reference to main window for URL settings
        viewer = ChampionViewerWidget(self.next_viewer_id, self.champion_data, is_picked, main_window=self)
        self.next_viewer_id += 1

        # Connect signals
        viewer.close_requested.connect(self.close_viewer)
        viewer.hide_requested.connect(self.hide_viewer)
        viewer.champion_updated.connect(self.update_champion_name)

        # Add to splitter and viewers list at the specified position
        if position == -1 or position >= len(self.viewers):
            # Append to the end
            self.viewers_splitter.addWidget(viewer)
            self.viewers.append(viewer)
        else:
            # Insert at the specified position (leftmost = 0)
            self.viewers_splitter.insertWidget(position, viewer)
            self.viewers.insert(position, viewer)

        # Set initial size for the new viewer
        sizes = self.viewers_splitter.sizes()
        if len(sizes) > 1:
            # Distribute space evenly among all viewers
            new_sizes = [500] * len(sizes)
            self.viewers_splitter.setSizes(new_sizes)

        # Update sidebar list
        self.update_viewers_list()

        return viewer

    def close_viewer(self, viewer: ChampionViewerWidget):
        """Close a viewer widget"""
        if viewer in self.viewers:
            self.viewers.remove(viewer)
            viewer.setParent(None)
            viewer.deleteLater()

        # Also remove from hidden list if present
        if viewer in self.hidden_viewers:
            self.hidden_viewers.remove(viewer)

        # Update sidebar list
        self.update_viewers_list()

    def hide_viewer(self, viewer: ChampionViewerWidget):
        """Hide a viewer widget"""
        if viewer in self.viewers and viewer not in self.hidden_viewers:
            viewer.hide()
            self.hidden_viewers.append(viewer)
            self.update_viewers_list()

    def toggle_viewer_visibility(self, item: QListWidgetItem):
        """Toggle visibility of a viewer when double-clicked in sidebar"""
        index = self.viewers_list.row(item)

        # Get sorted viewers list (same as in update_viewers_list)
        picked_viewers = [v for v in self.viewers if v.is_picked]
        regular_viewers = [v for v in self.viewers if not v.is_picked]
        sorted_viewers = picked_viewers + regular_viewers

        if 0 <= index < len(sorted_viewers):
            viewer = sorted_viewers[index]
            if viewer.isVisible():
                # Hide the viewer
                viewer.hide()
                if viewer not in self.hidden_viewers:
                    self.hidden_viewers.append(viewer)
            else:
                # Show the viewer
                viewer.show()
                if viewer in self.hidden_viewers:
                    self.hidden_viewers.remove(viewer)
            self.update_viewers_list()

    def update_champion_name(self, viewer: ChampionViewerWidget):
        """Update sidebar when a viewer's champion name is changed"""
        self.update_viewers_list()

    def update_viewers_list(self):
        """Update the list of all viewers in the sidebar, with picked viewers at the top"""
        self.viewers_list.clear()

        # Sort viewers: picked viewers first, then others (maintaining original order within each group)
        picked_viewers = [v for v in self.viewers if v.is_picked]
        regular_viewers = [v for v in self.viewers if not v.is_picked]
        sorted_viewers = picked_viewers + regular_viewers

        for viewer in sorted_viewers:
            display_name = viewer.get_display_name()
            if not viewer.isVisible():
                display_name = f"[Hidden] {display_name}"

            # Create list item
            item = QListWidgetItem()
            self.viewers_list.addItem(item)

            # Create custom widget for this item
            item_widget = ViewerListItemWidget(display_name, viewer, self)
            item.setSizeHint(item_widget.sizeHint())
            self.viewers_list.setItemWidget(item, item_widget)

    def close_all_viewers(self):
        """Close all viewer widgets"""
        # Create a copy of the list to avoid modification during iteration
        viewers_copy = self.viewers.copy()
        for viewer in viewers_copy:
            self.close_viewer(viewer)

    def on_champion_detected(self, champion_name: str, lane: str):
        """Handle champion detection - automatically open build page

        Args:
            champion_name: Name of the detected champion
            lane: Detected lane (top, jungle, middle, bottom, support)
        """
        logger.info(f"Champion detected: {champion_name} (lane: {lane})")

        # Always create a new viewer at the leftmost position (index 0)
        if len(self.viewers) >= self.MAX_VIEWERS:
            logger.warning("Cannot auto-open champion build: maximum viewers reached")
            return

        # Create new viewer at position 0 (leftmost) with is_picked=True
        target_viewer = self.add_viewer(position=0, is_picked=True)

        # Open the appropriate page in the new viewer.
        if target_viewer:
            auto_aram = bool(self.feature_flags.get("auto_open_aram_tab_on_pick", False))
            open_aram = auto_aram and self._is_aram_like_mode()

            logger.info(
                f"Auto-opening {'ARAM' if open_aram else 'build'} page for {champion_name} (lane: {lane}) "
                f"in new viewer {target_viewer.viewer_id} at leftmost position"
            )
            target_viewer.champion_input.setText(champion_name)

            if open_aram:
                target_viewer.open_aram()
            else:
                # Set lane selector if lane was detected
                if lane:
                    # Find the index of the lane in the combo box
                    lane_found = False
                    for i in range(target_viewer.lane_selector.count()):
                        if target_viewer.lane_selector.itemData(i) == lane:
                            target_viewer.lane_selector.setCurrentIndex(i)
                            logger.debug(f"Set lane selector to: {lane}")
                            lane_found = True
                            break

                    if not lane_found:
                        logger.warning(f"Lane '{lane}' not found in lane selector options")

                target_viewer.open_build()

    def on_enemy_champion_detected(self, champion_name: str):
        """Handle enemy champion detection - automatically open counter page

        Args:
            champion_name: Name of the detected enemy champion
        """
        logger.info(f"Enemy champion detected: {champion_name}")

        if len(self.viewers) >= self.MAX_VIEWERS:
            logger.warning("Cannot auto-open enemy champion counter: maximum viewers reached")
            return

        # Determine position: if own pick exists (is_picked=True), insert at position 1, else position 0
        has_own_pick = any(viewer.is_picked for viewer in self.viewers)
        position = 1 if has_own_pick else 0

        # Create new viewer at the determined position with is_picked=False
        target_viewer = self.add_viewer(position=position, is_picked=False)

        # Open the counter page in the new viewer (no lane specified)
        if target_viewer:
            logger.info(f"Auto-opening counter page for enemy {champion_name} in new viewer {target_viewer.viewer_id} at position {position}")
            target_viewer.champion_input.setText(champion_name)
            target_viewer.open_counter()

            # Hide opponent pick window by default
            self.hide_viewer(target_viewer)
            logger.info(f"Opponent pick window for {champion_name} hidden by default")

    def check_latest_version(self):
        """Check latest version without prompting update"""
        try:
            from updater import Updater
            updater = Updater(__version__, parent_widget=self.settings_page)

            has_update, release_info = updater.check_for_updates()

            if release_info:
                latest_version = release_info.get('tag_name', 'Unknown').lstrip('v')
                self.latest_version_label.setText(f"Latest version: {latest_version}")

                if has_update:
                    self.status_label.setText("✓ New version available!")
                    self.status_label.setStyleSheet("""
                        QLabel {
                            font-size: 10pt;
                            color: #14a0a6;
                            background-color: transparent;
                            padding: 5px;
                        }
                    """)
                else:
                    self.status_label.setText("✓ You have the latest version")
                    self.status_label.setStyleSheet("""
                        QLabel {
                            font-size: 10pt;
                            color: #4a9d4a;
                            background-color: transparent;
                            padding: 5px;
                        }
                    """)
            else:
                self.latest_version_label.setText("Latest version: Unable to check")
                self.status_label.setText("⚠ Could not connect to update server")
                self.status_label.setStyleSheet("""
                    QLabel {
                        font-size: 10pt;
                        color: #d95d39;
                        background-color: transparent;
                        padding: 5px;
                    }
                """)

        except Exception as e:
            logger.error(f"Error checking for updates: {e}")
            self.latest_version_label.setText("Latest version: Error")
            self.status_label.setText(f"✗ Error: {str(e)}")
            self.status_label.setStyleSheet("""
                QLabel {
                    font-size: 10pt;
                    color: #d95d39;
                    background-color: transparent;
                    padding: 5px;
                }
            """)

    def check_for_updates(self):
        """Manual update check with full update flow"""
        self.update_button.setEnabled(False)
        self.update_button.setText("Checking...")
        self.status_label.setText("Checking for updates...")

        try:
            from updater import Updater
            updater = Updater(__version__, parent_widget=self.settings_page)

            logger.info("Manual update check initiated from settings")
            # check_and_update will handle the full update flow
            updater.check_and_update()

            # If we reach here, no update was applied or user declined
            self.check_latest_version()

        except Exception as e:
            logger.error(f"Error during manual update check: {e}")
            self.status_label.setText(f"✗ Error: {str(e)}")
            self.status_label.setStyleSheet("""
                QLabel {
                    font-size: 10pt;
                    color: #d95d39;
                    background-color: transparent;
                    padding: 5px;
                }
            """)
        finally:
            self.update_button.setEnabled(True)
            self.update_button.setText("Check for Updates")

    def closeEvent(self, event):
        """Handle window close event"""
        logger.info("Application closing, stopping champion detection service")
        self.champion_detector.stop()
        super().closeEvent(event)


def main():
    """Main entry point of the application"""
    try:
        # Setup logging first
        is_debug = setup_logging()
        logger.info("=" * 60)
        logger.info("Starting LoL Viewer...")
        logger.info(f"Debug mode: {is_debug}")
        logger.info("=" * 60)

        app = QApplication(sys.argv)
        logger.info("QApplication created")

        window = MainWindow()
        logger.info("MainWindow created")

        window.show()
        logger.info("Window shown")
        logger.info("Application ready - check for autocomplete by typing in champion name field")

        sys.exit(app.exec())
    except Exception as e:
        logger.exception(f"Exception caught: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
