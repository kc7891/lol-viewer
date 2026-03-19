#!/usr/bin/env python3
"""
LoL Viewer - Main application window.
"""
import sys
import logging
import os
from datetime import datetime
from typing import List, Optional

from PyQt6.QtCore import QUrl, pyqtSignal, Qt, QTimer, QSettings, QByteArray, QSize
from PyQt6.QtGui import QColor, QIcon, QPixmap
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLineEdit, QPushButton, QMessageBox,
    QScrollArea, QSplitter, QListWidget, QListWidgetItem, QLabel,
    QTabWidget, QStackedWidget, QComboBox, QCheckBox, QButtonGroup, QFrame
)

from constants import (
    __version__, DEFAULT_BUILD_URL, DEFAULT_COUNTER_URL,
    DEFAULT_MATCHUP_URL, DEFAULT_ARAM_URL, DEFAULT_LIVE_GAME_URL,
    CLOSE_BUTTON_GLYPH, FEATURE_FLAG_DEFINITIONS,
    ARAM_QUEUE_IDS, ARAM_MAYHEM_QUEUE_IDS,
    UI_SIZE_PRESETS, get_ui_sizes,
)
from widgets import (
    LCUConnectionStatusWidget, NullWebView, QrCodeOverlay,
    _install_qr_overlay, _webengine_disabled,
    ViewerListItemWidget, ChampionViewerWidget,
    DraggableMatchupLabel, MatchupRowWidget,
)
from champion_data import ChampionData, ChampionImageCache, setup_champion_input, setup_opponent_champion_input
from logger import log
from lcu_detector import ChampionDetectorService

from PyQt6.QtWebEngineWidgets import QWebEngineView


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
        self.matchup_url = self.settings.value("matchup_url", DEFAULT_MATCHUP_URL, type=str)
        self.counter_url = self.settings.value("counter_url", DEFAULT_COUNTER_URL, type=str)
        self.aram_url = self.settings.value("aram_url", DEFAULT_ARAM_URL, type=str)
        self.live_game_url = self.settings.value("live_game_url", DEFAULT_LIVE_GAME_URL, type=str)

        # Cleanup deprecated/unknown persisted feature flags (avoid leaving "junk" data)
        self.cleanup_feature_flag_settings()

        # Load feature flags
        self.feature_flags = self.load_feature_flags()

        # Load display settings
        self.qr_overlay_enabled = self.settings.value("display/qr_code_overlay", True, type=bool)

        # Initialize champion detector service
        logger.info("Initializing ChampionDetectorService...")
        self.champion_detector = ChampionDetectorService()
        self.champion_detector.champion_detected.connect(self.on_champion_detected)
        self.champion_detector.enemy_champion_detected.connect(self.on_enemy_champion_detected)
        self.champion_detector.matchup_data_updated.connect(self.on_matchup_data_updated)
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
                background-color: #0d1117;
            }
            QWidget {
                background-color: #0d1117;
                color: #e2e8f0;
            }
            QScrollBar:horizontal {
                border: none;
                background: #141b24;
                height: 12px;
                margin: 0px 0px 0px 0px;
            }
            QScrollBar::handle:horizontal {
                background: #222a35;
                min-width: 20px;
                border-radius: 6px;
            }
            QScrollBar::handle:horizontal:hover {
                background: #00d6a1;
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

        # Image cache for sidebar champion icons
        self._sidebar_image_cache = ChampionImageCache()

        # Left sidebar with tabs
        self.create_sidebar()

        # Create sidebar container with status widget at bottom
        sidebar_container = QWidget()
        sidebar_container.setMinimumWidth(150)
        sidebar_container.setStyleSheet("QWidget { background-color: #090e14; }")
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
                background-color: #222a35;
                width: 2px;
            }
            QSplitter::handle:hover {
                background-color: #00d6a1;
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
        self.live_game_web_view.page().setBackgroundColor(QColor("#0d1117"))
        self.live_game_web_view.setUrl(QUrl(self.live_game_url))
        live_game_layout.addWidget(self.live_game_web_view)

        # QR code overlay for live game
        self._live_game_qr_overlay: Optional[QrCodeOverlay] = None
        if self.qr_overlay_enabled:
            self._live_game_qr_overlay = _install_qr_overlay(self.live_game_page, self.live_game_web_view)
            self._live_game_qr_overlay.set_url(self.live_game_url)

    def create_viewers_page(self):
        """Create the Viewers page with toolbar and viewers splitter"""
        self.viewers_page = QWidget()
        viewers_layout = QVBoxLayout(self.viewers_page)
        viewers_layout.setSpacing(0)
        viewers_layout.setContentsMargins(0, 0, 0, 0)

        # Matchup list (ally vs enemy, 5 rows)
        self.matchup_list_widget = self._create_matchup_list_widget()
        viewers_layout.addWidget(self.matchup_list_widget)

        # Splitter for resizable viewers
        self.viewers_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.viewers_splitter.setStyleSheet("""
            QSplitter::handle {
                background-color: #222a35;
                width: 2px;
            }
            QSplitter::handle:hover {
                background-color: #00d6a1;
            }
        """)
        self.viewers_splitter.setHandleWidth(6)
        self.viewers_splitter.setChildrenCollapsible(False)

        viewers_layout.addWidget(self.viewers_splitter)

        # Do not auto-create viewers on launch (default 0).

        # Start champion detection service (disabled in tests/headless if needed)
        if _lcu_service_disabled():
            logger.info("LCU champion detection service disabled")
        else:
            logger.info("Starting champion detection service")
            self.champion_detector.start(interval_ms=2000)

    def create_settings_page(self):
        """Create the Settings page with version information and update check"""
        sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        self.settings_page = QWidget()
        settings_scroll = QScrollArea()
        settings_scroll.setWidgetResizable(True)
        settings_scroll.setStyleSheet("""
            QScrollArea {
                border: none;
                background-color: #0d1117;
            }
        """)

        settings_content = QWidget()
        settings_layout = QVBoxLayout(settings_content)
        settings_layout.setSpacing(20)
        settings_layout.setContentsMargins(40, 40, 40, 40)

        # Title
        title_label = QLabel("Settings")
        title_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_page_title']};
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }}
        """)
        settings_layout.addWidget(title_label)

        # Analytics URLs section
        url_group = QWidget()
        url_layout = QVBoxLayout(url_group)
        url_layout.setSpacing(15)

        url_title = QLabel("Analytics URLs")
        url_title.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_section']};
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }}
        """)
        url_layout.addWidget(url_title)

        url_description = QLabel(
            "Configure URLs for each analytics type. Use {name} as placeholder for champion name, {lane} for lane parameter. "
            "For matchup URLs, use {champion_name1}, {champion_name2}, {lane_name}."
        )
        url_description.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_desc']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        url_description.setWordWrap(True)
        url_layout.addWidget(url_description)

        # Build URL
        build_url_label = QLabel("Build URL:")
        build_url_label.setStyleSheet(f"QLabel {{ font-size: {sz['font_settings_label']}; color: #c1c9d4; background-color: transparent; }}")
        url_layout.addWidget(build_url_label)

        self.build_url_input = QLineEdit()
        self.build_url_input.setPlaceholderText("e.g., https://lolalytics.com/lol/{name}/build/")
        self.build_url_input.setStyleSheet(f"""
            QLineEdit {{
                padding: {sz['padding_settings_input']};
                font-size: {sz['font_settings_input']};
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QLineEdit:focus {{
                border: 1px solid #00d6a1;
            }}
        """)
        url_layout.addWidget(self.build_url_input)

        # Matchup URL
        matchup_url_label = QLabel("Matchup URL:")
        matchup_url_label.setStyleSheet(f"QLabel {{ font-size: {sz['font_settings_label']}; color: #c1c9d4; background-color: transparent; }}")
        url_layout.addWidget(matchup_url_label)

        self.matchup_url_input = QLineEdit()
        self.matchup_url_input.setPlaceholderText(
            "e.g., https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}"
        )
        self.matchup_url_input.setStyleSheet(f"""
            QLineEdit {{
                padding: {sz['padding_settings_input']};
                font-size: {sz['font_settings_input']};
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QLineEdit:focus {{
                border: 1px solid #00d6a1;
            }}
        """)
        url_layout.addWidget(self.matchup_url_input)

        # Counter URL
        counter_url_label = QLabel("Counter URL:")
        counter_url_label.setStyleSheet(f"QLabel {{ font-size: {sz['font_settings_label']}; color: #c1c9d4; background-color: transparent; }}")
        url_layout.addWidget(counter_url_label)

        self.counter_url_input = QLineEdit()
        self.counter_url_input.setPlaceholderText("e.g., https://lolalytics.com/lol/{name}/counters/")
        self.counter_url_input.setStyleSheet(f"""
            QLineEdit {{
                padding: {sz['padding_settings_input']};
                font-size: {sz['font_settings_input']};
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QLineEdit:focus {{
                border: 1px solid #00d6a1;
            }}
        """)
        url_layout.addWidget(self.counter_url_input)

        # ARAM URL
        aram_url_label = QLabel("ARAM URL:")
        aram_url_label.setStyleSheet(f"QLabel {{ font-size: {sz['font_settings_label']}; color: #c1c9d4; background-color: transparent; }}")
        url_layout.addWidget(aram_url_label)

        self.aram_url_input = QLineEdit()
        self.aram_url_input.setPlaceholderText("e.g., https://u.gg/lol/champions/aram/{name}-aram")
        self.aram_url_input.setStyleSheet(f"""
            QLineEdit {{
                padding: {sz['padding_settings_input']};
                font-size: {sz['font_settings_input']};
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QLineEdit:focus {{
                border: 1px solid #00d6a1;
            }}
        """)
        url_layout.addWidget(self.aram_url_input)

        # Live Game URL
        live_game_url_label = QLabel("Live Game URL:")
        live_game_url_label.setStyleSheet(f"QLabel {{ font-size: {sz['font_settings_label']}; color: #c1c9d4; background-color: transparent; }}")
        url_layout.addWidget(live_game_url_label)

        self.live_game_url_input = QLineEdit()
        self.live_game_url_input.setPlaceholderText("e.g., https://u.gg/lol/lg-splash")
        self.live_game_url_input.setStyleSheet(f"""
            QLineEdit {{
                padding: {sz['padding_settings_input']};
                font-size: {sz['font_settings_input']};
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QLineEdit:focus {{
                border: 1px solid #00d6a1;
            }}
        """)
        url_layout.addWidget(self.live_game_url_input)

        # URL buttons
        url_buttons_layout = QHBoxLayout()

        self.save_urls_button = QPushButton("Save URLs")
        self.save_urls_button.setStyleSheet(f"""
            QPushButton {{
                padding: {sz['padding_primary_btn']};
                font-size: {sz['font_settings_input']};
                background-color: #00d6a1;
                color: #0d1117;
                border: none;
                border-radius: 6px;
            }}
            QPushButton:hover {{
                background-color: #00efb3;
            }}
            QPushButton:pressed {{
                background-color: #00b888;
            }}
        """)
        self.save_urls_button.clicked.connect(self.save_url_settings)
        url_buttons_layout.addWidget(self.save_urls_button)

        self.reset_urls_button = QPushButton("Reset to Defaults")
        self.reset_urls_button.setStyleSheet(f"""
            QPushButton {{
                padding: {sz['padding_primary_btn']};
                font-size: {sz['font_settings_input']};
                background-color: #1c2330;
                color: #c1c9d4;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QPushButton:hover {{
                background-color: #222a35;
                color: #e2e8f0;
            }}
            QPushButton:pressed {{
                background-color: #141b24;
            }}
        """)
        self.reset_urls_button.clicked.connect(self.reset_url_settings)
        url_buttons_layout.addWidget(self.reset_urls_button)

        url_buttons_layout.addStretch()
        url_layout.addLayout(url_buttons_layout)

        # URL save status label
        self.url_status_label = QLabel("")
        self.url_status_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_desc']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        url_layout.addWidget(self.url_status_label)

        settings_layout.addWidget(url_group)

        # LCU connection controls
        connection_group = QWidget()
        connection_layout = QVBoxLayout(connection_group)
        connection_layout.setSpacing(10)

        connection_title = QLabel("LCU Connection")
        connection_title.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_section']};
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }}
        """)
        connection_layout.addWidget(connection_title)

        connection_description = QLabel("LoLクライアントを後から起動した場合は、下のボタンを押すと即座に接続を再試行します。")
        connection_description.setWordWrap(True)
        connection_description.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_desc']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px 0px;
            }}
        """)
        connection_layout.addWidget(connection_description)

        self.lcu_connect_button = QPushButton("Retry LCU Connection")
        self.lcu_connect_button.setStyleSheet(f"""
            QPushButton {{
                padding: {sz['padding_primary_btn']};
                font-size: {sz['font_settings_input']};
                background-color: #1c2330;
                color: #c1c9d4;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QPushButton:hover:enabled {{
                background-color: #222a35;
                color: #e2e8f0;
            }}
            QPushButton:pressed:enabled {{
                background-color: #141b24;
            }}
            QPushButton:disabled {{
                background-color: #141b24;
                color: #6d7a8a;
            }}
        """)
        self.lcu_connect_button.clicked.connect(self.manual_connect_lcu)
        connection_layout.addWidget(self.lcu_connect_button)

        settings_layout.addWidget(connection_group)

        # Version section
        version_group = QWidget()
        version_layout = QVBoxLayout(version_group)
        version_layout.setSpacing(10)

        version_title = QLabel("Version Information")
        version_title.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_section']};
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }}
        """)
        version_layout.addWidget(version_title)

        # Current version
        self.current_version_label = QLabel(f"Current version: {__version__}")
        self.current_version_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_version']};
                color: #c1c9d4;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        version_layout.addWidget(self.current_version_label)

        # Latest version (initially unknown)
        self.latest_version_label = QLabel("Latest version: Checking...")
        self.latest_version_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_version']};
                color: #c1c9d4;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        version_layout.addWidget(self.latest_version_label)

        # Status message
        self.status_label = QLabel("")
        self.status_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_label']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        self.status_label.setWordWrap(True)
        version_layout.addWidget(self.status_label)

        settings_layout.addWidget(version_group)

        # Update button
        self.update_button = QPushButton("Check for Updates")
        self.update_button.setStyleSheet(f"""
            QPushButton {{
                padding: {sz['padding_primary_btn']};
                font-size: {sz['font_settings_version']};
                background-color: #00d6a1;
                color: #0d1117;
                border: none;
                border-radius: 6px;
            }}
            QPushButton:hover {{
                background-color: #00efb3;
            }}
            QPushButton:pressed {{
                background-color: #00b888;
            }}
            QPushButton:disabled {{
                background-color: #1c2330;
                color: #6d7a8a;
            }}
        """)
        self.update_button.clicked.connect(self.check_for_updates)
        settings_layout.addWidget(self.update_button)

        # Display Settings section
        display_group = QWidget()
        display_layout = QVBoxLayout(display_group)
        display_layout.setSpacing(10)

        display_title = QLabel("Display Settings")
        display_title.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_section']};
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }}
        """)
        display_layout.addWidget(display_title)

        display_description = QLabel(
            "Configure display-related options."
        )
        display_description.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_desc']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        display_description.setWordWrap(True)
        display_layout.addWidget(display_description)

        # UI Size selector
        ui_size_row = QHBoxLayout()
        ui_size_label = QLabel("UI Size")
        ui_size_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_label']};
                color: #c1c9d4;
                background-color: transparent;
                padding: 4px;
            }}
        """)
        ui_size_row.addWidget(ui_size_label)

        self.ui_size_combo = QComboBox()
        self.ui_size_combo.addItems(["Small", "Medium", "Large"])
        current_size = QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium")
        size_map = {"small": 0, "medium": 1, "large": 2}
        self.ui_size_combo.setCurrentIndex(size_map.get(current_size, 0))
        self.ui_size_combo.setStyleSheet(f"""
            QComboBox {{
                font-size: {sz['font_settings_label']};
                padding: 4px 8px;
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 4px;
                min-width: {sz['min_width_combobox']}px;
            }}
            QComboBox:hover {{ border-color: #00d6a1; }}
            QComboBox::drop-down {{
                border: none;
                padding-right: 8px;
            }}
            QComboBox QAbstractItemView {{
                background-color: #141b24;
                color: #e2e8f0;
                selection-background-color: #00d6a1;
                selection-color: #0d1117;
                border: 1px solid #222a35;
            }}
        """)
        self.ui_size_combo.currentIndexChanged.connect(self._on_ui_size_changed)
        ui_size_row.addWidget(self.ui_size_combo)
        ui_size_row.addStretch()
        display_layout.addLayout(ui_size_row)

        ui_size_hint = QLabel("Requires restart to take effect.")
        ui_size_hint.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_desc']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 0px 4px;
            }}
        """)
        display_layout.addWidget(ui_size_hint)

        self.qr_overlay_checkbox = QCheckBox("QR Code Overlay")
        self.qr_overlay_checkbox.setChecked(self.qr_overlay_enabled)
        self.qr_overlay_checkbox.setToolTip(
            "Show a QR code of the current page URL on the bottom-right of each web view"
        )
        self.qr_overlay_checkbox.setStyleSheet(f"""
            QCheckBox {{
                font-size: {sz['font_settings_label']};
                color: #c1c9d4;
                background-color: transparent;
                padding: 4px;
            }}
            QCheckBox::indicator {{
                width: {sz['icon_size_checkbox']}px;
                height: {sz['icon_size_checkbox']}px;
            }}
        """)
        self.qr_overlay_checkbox.stateChanged.connect(
            lambda state: self._set_qr_overlay_enabled(state == 2)
        )
        display_layout.addWidget(self.qr_overlay_checkbox)

        settings_layout.addWidget(display_group)

        # Feature flags section (bottom)
        # Only render if this build defines any flags.
        if FEATURE_FLAG_DEFINITIONS:
            flags_group = QWidget()
            flags_layout = QVBoxLayout(flags_group)
            flags_layout.setSpacing(10)

            flags_title = QLabel("Feature Flags")
            flags_title.setStyleSheet(f"""
                QLabel {{
                    font-size: {sz['font_section']};
                    font-weight: bold;
                    color: #e2e8f0;
                    background-color: transparent;
                }}
            """)
            flags_layout.addWidget(flags_title)

            flags_description = QLabel(
                "Toggle experimental or gated features. If something breaks, turn the flag OFF and restart the app."
            )
            flags_description.setStyleSheet(f"""
                QLabel {{
                    font-size: {sz['font_settings_desc']};
                    color: #6d7a8a;
                    background-color: transparent;
                    padding: 5px;
                }}
            """)
            flags_description.setWordWrap(True)
            flags_layout.addWidget(flags_description)

            self.feature_flag_checkboxes = {}
            for key, meta in FEATURE_FLAG_DEFINITIONS.items():
                checkbox = QCheckBox(meta.get("label", key))
                checkbox.setChecked(bool(self.feature_flags.get(key, meta.get("default", False))))
                if meta.get("description"):
                    checkbox.setToolTip(meta["description"])
                checkbox.setStyleSheet(f"""
                    QCheckBox {{
                        font-size: {sz['font_settings_label']};
                        color: #c1c9d4;
                        background-color: transparent;
                        padding: 4px;
                    }}
                    QCheckBox::indicator {{
                        width: {sz['icon_size_checkbox']}px;
                        height: {sz['icon_size_checkbox']}px;
                    }}
                """)
                checkbox.stateChanged.connect(lambda state, k=key: self.set_feature_flag(k, state == 2))
                self.feature_flag_checkboxes[key] = checkbox
                flags_layout.addWidget(checkbox)

            flags_buttons_layout = QHBoxLayout()
            self.reset_flags_button = QPushButton("Reset Flags to Defaults")
            self.reset_flags_button.setStyleSheet(f"""
                QPushButton {{
                    padding: {sz['padding_primary_btn']};
                    font-size: {sz['font_settings_input']};
                    background-color: #1c2330;
                    color: #c1c9d4;
                    border: 1px solid #222a35;
                    border-radius: 6px;
                }}
                QPushButton:hover {{
                    background-color: #222a35;
                    color: #e2e8f0;
                }}
                QPushButton:pressed {{
                    background-color: #141b24;
                }}
            """)
            self.reset_flags_button.clicked.connect(self.reset_feature_flags)
            flags_buttons_layout.addWidget(self.reset_flags_button)
            flags_buttons_layout.addStretch()
            flags_layout.addLayout(flags_buttons_layout)

            self.flags_status_label = QLabel("")
            self.flags_status_label.setStyleSheet(f"""
                QLabel {{
                    font-size: {sz['font_settings_desc']};
                    color: #6d7a8a;
                    background-color: transparent;
                    padding: 5px;
                }}
            """)
            flags_layout.addWidget(self.flags_status_label)

            settings_layout.addWidget(flags_group)

        # Debug section — manually add champions to the matchup list for testing
        debug_group = QWidget()
        debug_layout = QVBoxLayout(debug_group)
        debug_layout.setSpacing(10)

        debug_title = QLabel("Debug")
        debug_title.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_section']};
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }}
        """)
        debug_layout.addWidget(debug_title)

        debug_description = QLabel(
            "Manually add champions to the Matchup List for testing."
        )
        debug_description.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_desc']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        debug_description.setWordWrap(True)
        debug_layout.addWidget(debug_description)

        # Champion input row with Add Ally / Add Enemy buttons
        debug_input_row = QHBoxLayout()

        self._debug_champion_input = QLineEdit()
        self._debug_champion_input.setPlaceholderText("Champion name (e.g., ahri, lux)")
        self._debug_champion_input.setStyleSheet(f"""
            QLineEdit {{
                padding: {sz['padding_settings_input']};
                font-size: {sz['font_settings_input']};
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }}
            QLineEdit:focus {{
                border: 1px solid #00d6a1;
            }}
        """)
        debug_input_row.addWidget(self._debug_champion_input, 1)

        # Set up champion autocomplete if champion_data is available
        if self.champion_data:
            setup_champion_input(self._debug_champion_input, self.champion_data)

        add_ally_btn = QPushButton("Add Ally")
        add_ally_btn.setStyleSheet(f"""
            QPushButton {{
                padding: {sz['padding_primary_btn']};
                font-size: {sz['font_settings_input']};
                background-color: #0078f5;
                color: #ffffff;
                border: none;
                border-radius: 6px;
            }}
            QPushButton:hover {{
                background-color: #1a8aff;
            }}
            QPushButton:pressed {{
                background-color: #0060c0;
            }}
        """)
        add_ally_btn.clicked.connect(lambda: self._debug_add_to_matchup("ally"))
        debug_input_row.addWidget(add_ally_btn)

        add_enemy_btn = QPushButton("Add Enemy")
        add_enemy_btn.setStyleSheet(f"""
            QPushButton {{
                padding: {sz['padding_primary_btn']};
                font-size: {sz['font_settings_input']};
                background-color: #e0342c;
                color: #ffffff;
                border: none;
                border-radius: 6px;
            }}
            QPushButton:hover {{
                background-color: #f04038;
            }}
            QPushButton:pressed {{
                background-color: #c02820;
            }}
        """)
        add_enemy_btn.clicked.connect(lambda: self._debug_add_to_matchup("enemy"))
        debug_input_row.addWidget(add_enemy_btn)

        debug_layout.addLayout(debug_input_row)

        self._debug_status_label = QLabel("")
        self._debug_status_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_settings_desc']};
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }}
        """)
        debug_layout.addWidget(self._debug_status_label)

        settings_layout.addWidget(debug_group)
        settings_layout.addStretch()

        settings_scroll.setWidget(settings_content)

        # Set scroll area as the settings page content
        page_layout = QVBoxLayout(self.settings_page)
        page_layout.setContentsMargins(0, 0, 0, 0)
        page_layout.addWidget(settings_scroll)

        # Load saved URL settings
        self.load_url_settings()
        if FEATURE_FLAG_DEFINITIONS:
            self.load_feature_flag_settings()

    def create_sidebar(self):
        """Create the left sidebar with tabs for Live Game and Viewers"""
        sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        self.sidebar = QTabWidget()
        self.sidebar.setStyleSheet(f"""
            QTabWidget {{
                background-color: #090e14;
                border-right: 1px solid #1c2330;
            }}
            QTabWidget::pane {{
                border: none;
                background-color: #090e14;
            }}
            QTabBar::tab {{
                background-color: #141b24;
                color: #c1c9d4;
                padding: 8px 16px;
                font-size: {sz['font_sidebar_item']};
                border: none;
                border-bottom: 2px solid transparent;
            }}
            QTabBar::tab:selected {{
                background-color: #00d6a1;
                color: #0d1117;
                border-bottom: 2px solid #00efb3;
            }}
            QTabBar::tab:hover {{
                background-color: #171e28;
            }}
        """)

        # Live Game tab (empty for now, will show web view in main content)
        live_game_widget = QWidget()
        live_game_layout = QVBoxLayout(live_game_widget)
        live_game_layout.setContentsMargins(10, 10, 10, 10)

        live_game_label = QLabel("Live Game\n\nSelect this tab to view\nu.gg live game splash")
        live_game_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_base']};
                color: #6d7a8a;
                padding: 10px;
            }}
        """)
        live_game_label.setWordWrap(True)
        live_game_layout.addWidget(live_game_label)
        live_game_layout.addStretch()

        self.sidebar.addTab(live_game_widget, "Live Game")

        # Viewers tab
        viewers_widget = QWidget()
        viewers_widget.setStyleSheet("QWidget { background-color: #090e14; }")
        viewers_layout = QVBoxLayout(viewers_widget)
        viewers_layout.setSpacing(6)
        viewers_layout.setContentsMargins(10, 10, 10, 10)

        # Header row: "WINDOWS" label + "+" button
        header_layout = QHBoxLayout()
        header_layout.setContentsMargins(0, 0, 0, 0)
        windows_label = QLabel("TABS")
        windows_label.setStyleSheet(f"""
            QLabel {{
                color: #6d7a8a;
                font-size: {sz['font_sidebar_type']};
                font-weight: bold;
                letter-spacing: 1px;
                background-color: transparent;
            }}
        """)
        header_layout.addWidget(windows_label)
        header_layout.addStretch()

        sidebar_close_all_button = QPushButton(CLOSE_BUTTON_GLYPH)
        sidebar_close_all_button.setToolTip("Close All")
        sidebar_close_all_button.setStyleSheet(f"""
            QPushButton {{
                padding: 0px;
                background-color: transparent;
                color: #6d7a8a;
                border: none;
                font-size: {sz['font_sidebar_btn']};
                min-width: {sz['icon_size_sidebar_btn']}px;
                max-width: {sz['icon_size_sidebar_btn']}px;
                min-height: {sz['icon_size_sidebar_btn']}px;
                max-height: {sz['icon_size_sidebar_btn']}px;
            }}
            QPushButton:hover {{
                color: #e2e8f0;
            }}
        """)
        sidebar_close_all_button.clicked.connect(self.close_all_viewers)
        header_layout.addWidget(sidebar_close_all_button)

        sidebar_add_button = QPushButton("+")
        sidebar_add_button.setToolTip("Add Viewer")
        sidebar_add_button.setStyleSheet(f"""
            QPushButton {{
                padding: 0px;
                background-color: transparent;
                color: #6d7a8a;
                border: none;
                font-size: {sz['font_sidebar_btn']};
                font-weight: bold;
                min-width: {sz['icon_size_sidebar_btn']}px;
                max-width: {sz['icon_size_sidebar_btn']}px;
                min-height: {sz['icon_size_sidebar_btn']}px;
                max-height: {sz['icon_size_sidebar_btn']}px;
            }}
            QPushButton:hover {{
                color: #e2e8f0;
            }}
        """)
        sidebar_add_button.clicked.connect(self.add_viewer)
        header_layout.addWidget(sidebar_add_button)
        viewers_layout.addLayout(header_layout)

        # List of all viewers
        self.viewers_list = QListWidget()
        self.viewers_list.setStyleSheet("""
            QListWidget {
                background-color: #090e14;
                border: none;
                color: #e2e8f0;
                padding: 0px;
                outline: none;
            }
            QListWidget::item {
                padding: 0px;
                border-left: 3px solid transparent;
                border-radius: 0px;
                outline: none;
            }
            QListWidget::item:focus {
                outline: none;
                border: none;
                border-left: 3px solid transparent;
            }
            QListWidget::item:hover {
                background-color: #171e28;
            }
            QListWidget::item:selected {
                background-color: #141b24;
                border-left: 3px solid #00d6a1;
                outline: none;
            }
        """)
        self.viewers_list.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.viewers_list.itemDoubleClicked.connect(self.toggle_viewer_visibility)
        viewers_layout.addWidget(self.viewers_list)

        self.sidebar.addTab(viewers_widget, "Viewers")

        # Settings tab
        settings_widget = QWidget()
        settings_sidebar_layout = QVBoxLayout(settings_widget)
        settings_sidebar_layout.setContentsMargins(10, 10, 10, 10)

        settings_label = QLabel("Settings\n\nSelect this tab to view\napplication settings")
        settings_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_base']};
                color: #6d7a8a;
                padding: 10px;
            }}
        """)
        settings_label.setWordWrap(True)
        settings_sidebar_layout.addWidget(settings_label)
        settings_sidebar_layout.addStretch()

        self.sidebar.addTab(settings_widget, "Settings")

        # Connect tab change signal to update main content
        self.sidebar.currentChanged.connect(self.on_sidebar_tab_changed)

    # Lane order used when opening viewer from matchup list (#68)
    MATCHUP_LANE_ORDER = ["top", "jungle", "middle", "bottom", "support"]

    # Lane labels for matchup list rows (#73)
    MATCHUP_LANE_LABELS = ["Top", "Jungle", "Mid", "Bot", "Support"]

    def _create_matchup_list_widget(self) -> QWidget:
        """Create the 5-row matchup list widget showing ally vs enemy picks.

        Design spec (#73):
        - Section title height: 24px (compact)
        - Individual item height: 33px
        - Separator color: rgba(34, 39, 47, 0.5)
        - Arrows: small vertically-stacked arrows
        - No swap button next to VS
        - Open button: open-blank style icon
        """
        sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        container = QWidget()
        # Title + 5 rows + 5 separators
        container_h = sz["height_matchup_title"] + 5 * sz["height_matchup_row"] + 5
        container.setFixedHeight(container_h)
        container.setStyleSheet("QWidget { background-color: #090e14; }")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(8, 0, 8, 0)
        layout.setSpacing(0)

        # Section title bar (#73): "CURRENT MATCHUP" left, "Ally vs Enemy" right
        title_row = QWidget()
        title_row.setFixedHeight(sz["height_matchup_title"])
        title_layout = QHBoxLayout(title_row)
        title_layout.setContentsMargins(4, 0, 4, 0)
        title_layout.setSpacing(0)

        title_left = QLabel("CURRENT MATCHUP")
        title_left.setStyleSheet(
            f"QLabel {{ font-size: {sz['font_matchup_title']}; font-weight: bold; color: #c1c9d4;"
            " background-color: transparent; }"
        )
        title_left.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

        title_right = QLabel(
            '<span style="color: #0078f5;">Ally</span>'
            ' <span style="color: #6d7a8a;">vs</span>'
            ' <span style="color: #e0342c;">Enemy</span>'
        )
        title_right.setTextFormat(Qt.TextFormat.RichText)
        title_right.setStyleSheet(
            f"QLabel {{ font-size: {sz['font_matchup_title']}; background-color: transparent; }}"
        )
        title_right.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setStyleSheet(
            f"QPushButton {{ font-size: {sz['font_matchup_title']}; padding: 1px 6px; background-color: transparent;"
            " color: #6d7a8a; border: 1px solid #6d7a8a; border-radius: 3px; }"
            "QPushButton:hover { color: #c1c9d4; border-color: #c1c9d4; }"
            "QPushButton:pressed { color: #e2e8f0; border-color: #e2e8f0; }"
        )
        refresh_btn.setFixedHeight(sz['height_matchup_btn'])
        refresh_btn.setToolTip("Clear all matchup data and re-fetch")
        refresh_btn.clicked.connect(self._refresh_matchup_list)

        title_layout.addWidget(title_left, 1)
        title_layout.addWidget(refresh_btn, 0)
        title_layout.addSpacing(6)
        title_layout.addWidget(title_right, 0)
        layout.addWidget(title_row)

        self._matchup_image_cache = ChampionImageCache()
        # Each row: (ally_icon, ally_name, enemy_name, enemy_icon)
        self._matchup_rows: list[tuple[QLabel, QLabel, QLabel, QLabel]] = []
        self._matchup_data: list[tuple[str, str]] = [("", "")] * 5  # (ally, enemy)
        self._matchup_row_widgets: list[MatchupRowWidget] = []

        icon_size = sz["icon_size_matchup"]
        lane_label_style = f"QLabel {{ font-size: {sz['font_matchup_title']}; color: #6d7a8a; background-color: transparent; }}"
        name_style = f"QLabel {{ font-size: {sz['font_matchup_name']}; font-weight: bold; color: #e2e8f0; background-color: transparent; }}"
        vs_style = f"QLabel {{ font-size: {sz['font_matchup_title']}; color: #6d7a8a; background-color: transparent; }}"
        icon_style = "QLabel { background-color: transparent; }"
        separator_style = "QFrame { background-color: rgba(34, 39, 47, 128); }"
        open_btn_style = f"""
            QPushButton {{
                font-size: {sz['font_matchup_name']}; padding: 0px; min-width: {sz['height_matchup_btn']}px; max-width: {sz['height_matchup_btn']}px;
                min-height: {sz['height_matchup_btn']}px; max-height: {sz['height_matchup_btn']}px; background-color: transparent;
                color: #6d7a8a; border: none;
            }}
            QPushButton:hover {{ color: #c1c9d4; }}
            QPushButton:pressed {{ color: #e2e8f0; }}
        """

        for i in range(5):
            # Separator line between rows (#73)
            sep = QFrame()
            sep.setFrameShape(QFrame.Shape.HLine)
            sep.setFixedHeight(1)
            sep.setStyleSheet(separator_style)
            layout.addWidget(sep)

            row = MatchupRowWidget(row_index=i, main_window=self)
            row.setFixedHeight(sz["height_matchup_row"])
            row_layout = QHBoxLayout(row)
            row_layout.setContentsMargins(4, 0, 4, 0)
            row_layout.setSpacing(4)

            # Lane label (#73)
            lane_label = QLabel(self.MATCHUP_LANE_LABELS[i])
            lane_label.setFixedWidth(sz['width_matchup_lane'])
            lane_label.setStyleSheet(lane_label_style)
            lane_label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

            ally_icon = QLabel()
            ally_icon.setFixedSize(icon_size, icon_size)
            ally_icon.setStyleSheet(icon_style)

            ally_name = DraggableMatchupLabel("-", row_index=i, side="ally")
            ally_name.setStyleSheet(name_style)
            ally_name.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

            # VS label (#73) — no swap button
            vs_label = QLabel("VS")
            vs_label.setStyleSheet(vs_style)
            vs_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

            enemy_name = DraggableMatchupLabel("-", row_index=i, side="enemy")
            enemy_name.setStyleSheet(name_style)
            enemy_name.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

            enemy_icon = QLabel()
            enemy_icon.setFixedSize(icon_size, icon_size)
            enemy_icon.setStyleSheet(icon_style)

            # Open viewer button (#68) — open-blank style icon
            open_btn = QPushButton("⧉")
            open_btn.setToolTip("Open matchup in viewer")
            open_btn.setStyleSheet(open_btn_style)
            open_btn.clicked.connect(lambda _, idx=i: self._open_matchup_viewer(idx))

            row_layout.addWidget(lane_label, 0)
            row_layout.addWidget(ally_icon, 0)
            row_layout.addWidget(ally_name, 1)
            row_layout.addWidget(vs_label, 0)
            row_layout.addWidget(enemy_name, 1)
            row_layout.addWidget(enemy_icon, 0)
            row_layout.addWidget(open_btn, 0)

            layout.addWidget(row)
            self._matchup_rows.append((ally_icon, ally_name, enemy_name, enemy_icon))
            self._matchup_row_widgets.append(row)

        self._apply_matchup_dnd_state()
        return container

    @staticmethod
    def _safe_set_matchup_pixmap(label: QLabel, pixmap, size: int):
        """Set pixmap on a matchup label, ignoring if the C++ object was deleted."""
        try:
            label.setPixmap(
                pixmap.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            )
        except RuntimeError:
            pass

    def _set_matchup_icon(self, icon_label: QLabel, champion_name: str):
        """Set a matchup row icon from champion image URL."""
        size = icon_label.width() or 24
        if not champion_name:
            try:
                icon_label.clear()
            except RuntimeError:
                pass
            return
        champ = self.champion_data.get_champion(champion_name)
        if not champ:
            try:
                icon_label.clear()
            except RuntimeError:
                pass
            return
        url = champ.get("image_url", "")
        if not url:
            try:
                icon_label.clear()
            except RuntimeError:
                pass
            return
        pixmap = self._matchup_image_cache.get_image(
            url,
            callback=lambda pm, lbl=icon_label, s=size: MainWindow._safe_set_matchup_pixmap(lbl, pm, s),
        )
        if pixmap:
            MainWindow._safe_set_matchup_pixmap(icon_label, pixmap, size)

    def update_matchup_list(self):
        """Refresh the matchup list widget from current matchup data."""
        try:
            for i, (ally_icon, ally_name, enemy_name, enemy_icon) in enumerate(self._matchup_rows):
                ally, enemy = self._matchup_data[i] if i < len(self._matchup_data) else ("", "")
                try:
                    ally_name.setText(ally if ally else "-")
                    enemy_name.setText(enemy if enemy else "-")
                except RuntimeError:
                    continue
                self._set_matchup_icon(ally_icon, ally)
                self._set_matchup_icon(enemy_icon, enemy)
        except Exception as e:
            logger.error(f"Error updating matchup list: {e}")

    def set_matchup_entry(self, index: int, ally: str = "", enemy: str = ""):
        """Set a single matchup row (0-4)."""
        if 0 <= index < 5:
            self._matchup_data[index] = (ally, enemy)
            self.update_matchup_list()

    # Lane name → row index mapping for placing allies by assigned lane
    LANE_TO_INDEX = {"top": 0, "jungle": 1, "middle": 2, "bottom": 3, "support": 4}
    # Row index → champions.json lane key mapping for enemy placement by aptitude
    INDEX_TO_LANE_JSON = ["top", "jg", "mid", "bot", "sup"]

    def clear_matchup_list(self):
        """Clear all matchup entries."""
        self._matchup_data = [("", "")] * 5
        self.update_matchup_list()

    def _refresh_matchup_list(self):
        """Refresh button handler: clear all matchup data and trigger re-fetch."""
        self._matchup_data = [("", "")] * 5
        self.update_matchup_list()
        # Trigger immediate re-check from detector
        if hasattr(self, 'champion_detector') and self.champion_detector:
            self.champion_detector.resume_polling()
            self.champion_detector._check_champion(force=True)

    def on_matchup_data_updated(self, data: dict):
        """Handle structured matchup data from champion detector.

        Core principles:
        - Once a champion name is placed in a row, it is never automatically removed.
        - New champions are only placed in empty slots.
        - On new ChampSelect session, all rows are auto-cleared first.
        - Allies are placed by lane (if available) or in first empty slot.
        - Enemies are placed in first empty slot (pick order).
        """
        if not isinstance(data, dict):
            return

        try:
            # New ChampSelect session → auto-clear before applying new data
            if data.get("is_new_session"):
                self._matchup_data = [("", "")] * 5

            allies = data.get("allies", [])
            enemies = data.get("enemies", [])

            self._apply_new_allies(allies)
            self._apply_new_enemies(enemies)
            self.update_matchup_list()
        except Exception as e:
            logger.error(f"Error processing matchup data: {e}")

    def _apply_new_allies(self, allies: list):
        """Place new ally champions into matchup rows.

        - If a champion is already present in any ally slot, skip it.
        - Lane-assigned allies are placed first (in their lane row).
        - Then no-lane allies fill the first empty ally slot.
        """
        # Partition: lane-assigned first, then no-lane
        with_lane = [(n, l) for n, l in allies if n and l and l in self.LANE_TO_INDEX]
        without_lane = [(n, l) for n, l in allies if n and (not l or l not in self.LANE_TO_INDEX)]

        # Pass 1: place lane-assigned allies
        for name, lane in with_lane:
            if any(self._matchup_data[i][0] == name for i in range(5)):
                continue
            lane_idx = self.LANE_TO_INDEX[lane]
            if not self._matchup_data[lane_idx][0]:
                _, enemy = self._matchup_data[lane_idx]
                self._matchup_data[lane_idx] = (name, enemy)
            else:
                # Lane row occupied → first empty ally slot
                for i in range(5):
                    if not self._matchup_data[i][0]:
                        _, enemy = self._matchup_data[i]
                        self._matchup_data[i] = (name, enemy)
                        break

        # Pass 2: place no-lane allies by lane aptitude (or first empty slot as fallback)
        for name, _ in without_lane:
            if any(self._matchup_data[i][0] == name for i in range(5)):
                continue
            empty_indices = [i for i in range(5) if not self._matchup_data[i][0]]
            if not empty_indices:
                break
            best_idx = empty_indices[0]
            champ_info = None
            try:
                if self.champion_data:
                    champ_info = self.champion_data.get_champion(name)
            except (AttributeError, RuntimeError):
                pass
            if champ_info:
                lanes = champ_info.get("lanes", {})
                best_score = -1
                for i in empty_indices:
                    score = lanes.get(self.INDEX_TO_LANE_JSON[i], 0)
                    if score > best_score:
                        best_score = score
                        best_idx = i
            _, enemy = self._matchup_data[best_idx]
            self._matchup_data[best_idx] = (name, enemy)

    def _apply_new_enemies(self, enemies: list):
        """Place new enemy champions into matchup rows based on lane aptitude.

        - If a champion is already present in any enemy slot, skip it.
        - Place in the empty row with the highest lane aptitude from champions.json.
        - If aptitude data is unavailable, fall back to the first empty slot.
        - Ties are broken by row order (top → jungle → middle → bottom → support).
        """
        for name in enemies:
            if not name:
                continue
            # Already placed?
            if any(self._matchup_data[i][1] == name for i in range(5)):
                continue

            # Collect empty row indices
            empty_indices = [i for i in range(5) if not self._matchup_data[i][1]]
            if not empty_indices:
                break

            # Get champion lane aptitude
            best_idx = empty_indices[0]  # Fallback: first empty row
            champ_info = None
            try:
                if self.champion_data:
                    champ_info = self.champion_data.get_champion(name)
            except (AttributeError, RuntimeError):
                # champion_data not available or object not properly initialized
                pass
            if champ_info:
                lanes = champ_info.get("lanes", {})
                # Find empty row with highest aptitude (ties broken by row order)
                best_score = -1
                for i in empty_indices:
                    score = lanes.get(self.INDEX_TO_LANE_JSON[i], 0)
                    if score > best_score:
                        best_score = score
                        best_idx = i

            ally, _ = self._matchup_data[best_idx]
            self._matchup_data[best_idx] = (ally, name)

    def _matchup_swap_enemies(self, index: int):
        """Swap the enemy champion between row *index* and the next row.

        Allies stay fixed; only enemies are swapped.
        """
        target = index + 1
        if target >= 5:
            return
        ally_a, enemy_a = self._matchup_data[index]
        ally_b, enemy_b = self._matchup_data[target]
        self._matchup_data[index] = (ally_a, enemy_b)
        self._matchup_data[target] = (ally_b, enemy_a)
        self.update_matchup_list()

    def _matchup_dnd_drop(self, source_index: int, target_index: int, side: str):
        """Handle a drag-and-drop swap between two matchup rows."""
        if source_index == target_index:
            return
        if source_index < 0 or source_index >= 5 or target_index < 0 or target_index >= 5:
            return
        ally_a, enemy_a = self._matchup_data[source_index]
        ally_b, enemy_b = self._matchup_data[target_index]
        if side == "ally":
            self._matchup_data[source_index] = (ally_b, enemy_a)
            self._matchup_data[target_index] = (ally_a, enemy_b)
        elif side == "enemy":
            self._matchup_data[source_index] = (ally_a, enemy_b)
            self._matchup_data[target_index] = (ally_b, enemy_a)
        else:
            return
        self.update_matchup_list()

    def _apply_matchup_dnd_state(self):
        """Enable matchup drag-and-drop (always on)."""
        for _ally_icon, ally_name, enemy_name, _enemy_icon in self._matchup_rows:
            if isinstance(ally_name, DraggableMatchupLabel):
                ally_name.set_drag_enabled(True)
            if isinstance(enemy_name, DraggableMatchupLabel):
                enemy_name.set_drag_enabled(True)
        if hasattr(self, "_matchup_row_widgets"):
            for row_widget in self._matchup_row_widgets:
                row_widget.setAcceptDrops(True)

    def _debug_add_to_matchup(self, side: str):
        """Add a champion to the matchup list from the debug input field."""
        if not hasattr(self, "_debug_champion_input"):
            return
        name = self._debug_champion_input.text().strip()
        if not name:
            return
        for i in range(5):
            if side == "ally" and not self._matchup_data[i][0]:
                _, enemy = self._matchup_data[i]
                self._matchup_data[i] = (name, enemy)
                self._debug_status_label.setText(f"Added {name} as ally to row {i}")
                break
            elif side == "enemy" and not self._matchup_data[i][1]:
                ally, _ = self._matchup_data[i]
                self._matchup_data[i] = (ally, name)
                self._debug_status_label.setText(f"Added {name} as enemy to row {i}")
                break
        else:
            self._debug_status_label.setText(f"No empty {side} slot available")
            return
        self._debug_champion_input.clear()
        self.update_matchup_list()

    def _open_matchup_viewer(self, index: int):
        """Open a viewer with the matchup from row *index*. (#68)

        Lane is determined by row position (0=top … 4=support).
        Reuses the same logic as the Build button.
        """
        try:
            if index < 0 or index >= len(self._matchup_data):
                return
            ally, enemy = self._matchup_data[index]
            if not ally:
                return
            lane = self.MATCHUP_LANE_ORDER[index] if index < len(self.MATCHUP_LANE_ORDER) else ""

            # Create (or reuse) a viewer and trigger the build flow
            viewer = self.add_viewer()
            if not viewer:
                return
            viewer.champion_input.setText(ally)
            if hasattr(viewer, "_update_champion_selector_btn"):
                viewer._update_champion_selector_btn(ally)
            if enemy and hasattr(viewer, "opponent_champion_input") and viewer.opponent_champion_input is not None:
                viewer.opponent_champion_input.setText(enemy)
                if hasattr(viewer, "_update_opponent_selector_btn"):
                    viewer._update_opponent_selector_btn(enemy)
            # Set lane
            if lane:
                for i in range(viewer.lane_selector.count()):
                    if viewer.lane_selector.itemData(i) == lane:
                        viewer.lane_selector.setCurrentIndex(i)
                        break
                # Update the visible lane selector button and list selection
                if hasattr(viewer, "_lane_selector_btn"):
                    lane_display_map = {"top": "Top", "jungle": "Jungle", "middle": "Mid", "bottom": "Bot", "support": "Support"}
                    display = lane_display_map.get(lane, "Lane")
                    viewer._lane_selector_btn.setText(f"{display} \u25be")
                if hasattr(viewer, "_lane_list_widget"):
                    for i in range(viewer._lane_list_widget.count()):
                        item = viewer._lane_list_widget.item(i)
                        if item.data(Qt.ItemDataRole.UserRole) == lane:
                            viewer._lane_list_widget.setCurrentItem(item)
                            break
            viewer.open_build()
        except Exception as e:
            logger.error(f"Error opening matchup viewer: {e}")

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
        if hasattr(self, "matchup_url_input"):
            self.matchup_url_input.setText(self.matchup_url)
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

    def cleanup_feature_flag_settings(self):
        """Remove persisted feature flag keys that are no longer defined.

        This prevents old FeatureFlag settings from staying on user machines forever
        after a feature becomes standard (or a flag is removed).
        """
        if not hasattr(self, "settings") or self.settings is None:
            return

        defined = set(FEATURE_FLAG_DEFINITIONS.keys())
        persisted: set[str] = set()

        try:
            self.settings.beginGroup("feature_flags")
            persisted = set(self.settings.childKeys())
        except Exception as e:
            logger.warning(f"Failed to list persisted feature flags: {e}")
            return
        finally:
            try:
                self.settings.endGroup()
            except Exception:
                pass

        to_remove = sorted(persisted - defined)
        if not to_remove:
            return

        try:
            self.settings.beginGroup("feature_flags")
            for key in to_remove:
                self.settings.remove(key)
        except Exception as e:
            logger.warning(f"Failed to cleanup persisted feature flags: {e}")
        finally:
            try:
                self.settings.endGroup()
            except Exception:
                pass

        logger.info(f"Removed deprecated feature flag keys: {to_remove}")

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
            _sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
            self.flags_status_label.setText(f"✓ Flag '{key}' set to {'ON' if enabled else 'OFF'} (restart may be required)")
            self.flags_status_label.setStyleSheet(f"""
                QLabel {{
                    font-size: {_sz['font_settings_desc']};
                    color: #22c55e;
                    background-color: transparent;
                    padding: 5px;
                }}
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
            _sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
            self.flags_status_label.setText("✓ Feature flags reset to defaults")
            self.flags_status_label.setStyleSheet(f"""
                QLabel {{
                    font-size: {_sz['font_settings_desc']};
                    color: #22c55e;
                    background-color: transparent;
                    padding: 5px;
                }}
            """)
        logger.info("Feature flags reset to defaults")

    def _set_qr_overlay_enabled(self, enabled: bool):
        """Persist QR overlay display setting and apply immediately."""
        self.qr_overlay_enabled = bool(enabled)
        self.settings.setValue("display/qr_code_overlay", bool(enabled))
        logger.info(f"Display setting updated: qr_code_overlay={enabled}")
        self._apply_qr_overlay_setting(enabled)

    def _apply_qr_overlay_setting(self, enabled: bool):
        """Dynamically add or remove QR overlays on all web views."""
        # Live game page
        if enabled:
            if not getattr(self, "_live_game_qr_overlay", None):
                self._live_game_qr_overlay = _install_qr_overlay(self.live_game_page, self.live_game_web_view)
            self._live_game_qr_overlay.set_url(self.live_game_url)
        else:
            if getattr(self, "_live_game_qr_overlay", None):
                self._live_game_qr_overlay.hide()
                self._live_game_qr_overlay.deleteLater()
                self._live_game_qr_overlay = None

        # Champion viewers
        for viewer in self.viewers:
            if enabled:
                if viewer._qr_overlay is None:
                    viewer._qr_overlay = _install_qr_overlay(viewer, viewer.web_view)
                if viewer.current_url:
                    viewer._qr_overlay.set_url(viewer.current_url)
            else:
                if viewer._qr_overlay is not None:
                    viewer._qr_overlay.hide()
                    viewer._qr_overlay.deleteLater()
                    viewer._qr_overlay = None

    def _on_ui_size_changed(self, index: int):
        """Handle UI size combo box change."""
        size_names = ["small", "medium", "large"]
        size_name = size_names[index] if 0 <= index < len(size_names) else "small"
        self.settings.setValue("display/ui_size", size_name)
        logger.info(f"Display setting updated: ui_size={size_name}")

    def save_url_settings(self):
        """Save URL settings to QSettings"""
        self.build_url = self.build_url_input.text().strip()
        if hasattr(self, "matchup_url_input"):
            self.matchup_url = self.matchup_url_input.text().strip()
        self.counter_url = self.counter_url_input.text().strip()
        self.aram_url = self.aram_url_input.text().strip()
        self.live_game_url = self.live_game_url_input.text().strip()

        # Validate that URLs are not empty
        required = [self.build_url, self.matchup_url, self.counter_url, self.aram_url, self.live_game_url]
        if not all(required):
            _sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
            self.url_status_label.setText("✗ Error: All URLs must be filled")
            self.url_status_label.setStyleSheet(f"""
                QLabel {{
                    font-size: {_sz['font_settings_desc']};
                    color: #e0342c;
                    background-color: transparent;
                    padding: 5px;
                }}
            """)
            return

        self.settings.setValue("build_url", self.build_url)
        if hasattr(self, "matchup_url_input"):
            self.settings.setValue("matchup_url", self.matchup_url)
        self.settings.setValue("counter_url", self.counter_url)
        self.settings.setValue("aram_url", self.aram_url)
        self.settings.setValue("live_game_url", self.live_game_url)

        # Update live game URL immediately
        self.live_game_web_view.setUrl(QUrl(self.live_game_url))

        _sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        self.url_status_label.setText("✓ URLs saved successfully")
        self.url_status_label.setStyleSheet(f"""
            QLabel {{
                font-size: {_sz['font_settings_desc']};
                color: #22c55e;
                background-color: transparent;
                padding: 5px;
            }}
        """)

        logger.info(
            "URL settings saved - Build: %s, Matchup: %s, Counter: %s, ARAM: %s, Live Game: %s",
            self.build_url,
            getattr(self, "matchup_url", ""),
            self.counter_url,
            self.aram_url,
            self.live_game_url,
        )

    def reset_url_settings(self):
        """Reset URL settings to defaults"""
        self.build_url = DEFAULT_BUILD_URL
        self.counter_url = DEFAULT_COUNTER_URL
        self.matchup_url = DEFAULT_MATCHUP_URL
        self.aram_url = DEFAULT_ARAM_URL
        self.live_game_url = DEFAULT_LIVE_GAME_URL

        self.build_url_input.setText(self.build_url)
        if hasattr(self, "matchup_url_input"):
            self.matchup_url_input.setText(self.matchup_url)
        self.counter_url_input.setText(self.counter_url)
        self.aram_url_input.setText(self.aram_url)
        self.live_game_url_input.setText(self.live_game_url)

        self.settings.setValue("build_url", self.build_url)
        if hasattr(self, "matchup_url_input"):
            self.settings.setValue("matchup_url", self.matchup_url)
        self.settings.setValue("counter_url", self.counter_url)
        self.settings.setValue("aram_url", self.aram_url)
        self.settings.setValue("live_game_url", self.live_game_url)

        # Update live game URL immediately
        self.live_game_web_view.setUrl(QUrl(self.live_game_url))

        _sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        self.url_status_label.setText("✓ URLs reset to defaults")
        self.url_status_label.setStyleSheet(f"""
            QLabel {{
                font-size: {_sz['font_settings_desc']};
                color: #22c55e;
                background-color: transparent;
                padding: 5px;
            }}
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
            # Disconnect signals before scheduling deletion to prevent
            # callbacks firing on a partially-destroyed widget.
            try:
                viewer.close_requested.disconnect()
                viewer.champion_updated.disconnect()
            except (TypeError, RuntimeError):
                pass
            viewer.setParent(None)
            viewer.deleteLater()

        # Also remove from hidden list if present
        if viewer in self.hidden_viewers:
            self.hidden_viewers.remove(viewer)

        # Update sidebar list
        self.update_viewers_list()

    def _schedule_auto_viewer_creation(self, champion_name: str, creator_fn):
        """Schedule viewer creation to the next event-loop tick.

        CRITICAL SAFETY PATTERN — all signal-triggered viewer creation MUST
        go through this method.  The LCU detector emits matchup_data_updated
        (layout work) synchronously before champion detection signals.
        Creating a QWebEngineView in the same call stack crashes the Chromium
        rendering layer.  See PR #103, #104, #105 and docs/architecture.md.
        """
        QTimer.singleShot(0, creator_fn)

    def _open_url_and_hide(self, viewer, open_fn):
        """Open a URL and schedule hide in the next tick.

        CRITICAL SAFETY PATTERN — setUrl() and hide() must NEVER run in the
        same event-loop tick. This method guarantees that constraint by
        bundling them together. See PR #103, #105 and docs/architecture.md.
        """
        open_fn()  # e.g. viewer.open_counter() — calls setUrl() internally
        QTimer.singleShot(0, lambda v=viewer: self.hide_viewer(v))

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
            # Force layout calculation so sizeHint returns the real height
            item_widget.adjustSize()
            item.setSizeHint(item_widget.sizeHint())
            self.viewers_list.setItemWidget(item, item_widget)

    def get_open_champion_suggestions(self, exclude_viewer: Optional[ChampionViewerWidget] = None) -> List[str]:
        """Return opponent champion suggestions.

        If the Current Matchup section has enemy picks, return those.
        Otherwise fall back to champion names shown across all viewers.
        """
        # Prefer enemy picks from Current Matchup data
        try:
            matchup_data = self._matchup_data
        except RuntimeError:
            matchup_data = []
        if matchup_data:
            enemies: List[str] = []
            seen: set = set()
            for _ally, enemy in matchup_data:
                if not enemy:
                    continue
                normalized = enemy.lower()
                if normalized in seen:
                    continue
                seen.add(normalized)
                enemies.append(enemy)
            if enemies:
                return enemies

        # Fallback: collect from open viewers
        suggestions: List[str] = []
        seen = set()

        for viewer in self.viewers:
            if exclude_viewer is not None and viewer is exclude_viewer:
                continue

            candidates = [
                getattr(viewer, "current_champion", ""),
                getattr(viewer, "current_opponent_champion", ""),
            ]

            for name in candidates:
                if not name:
                    continue
                normalized = name.lower()
                if normalized in seen:
                    continue
                seen.add(normalized)
                suggestions.append(name)

        return suggestions

    def close_all_viewers(self):
        """Close all viewer widgets"""
        # Create a copy of the list to avoid modification during iteration
        viewers_copy = self.viewers.copy()
        for viewer in viewers_copy:
            self.close_viewer(viewer)

    def on_champion_detected(self, champion_name: str, lane: str):
        """Handle own champion detection — schedule build page opening."""
        self._schedule_auto_viewer_creation(
            champion_name,
            lambda name=champion_name, ln=lane: self._create_ally_viewer(name, ln),
        )

    def _create_ally_viewer(self, champion_name: str, lane: str):
        """Deferred handler for own champion viewer creation (Phase 1)."""
        try:
            logger.info(f"Champion detected: {champion_name} (lane: {lane})")

            # Always create a new viewer at the leftmost position (index 0)
            if len(self.viewers) >= self.MAX_VIEWERS:
                logger.warning("Cannot auto-open champion build: maximum viewers reached")
                return

            # Create new viewer at position 0 (leftmost) with is_picked=True
            target_viewer = self.add_viewer(position=0, is_picked=True)

            # Open the appropriate page in the new viewer.
            if target_viewer:
                open_aram = self._is_aram_like_mode()

                logger.info(
                    f"Auto-opening {'ARAM' if open_aram else 'build'} page for {champion_name} (lane: {lane}) "
                    f"in new viewer {target_viewer.viewer_id} at leftmost position"
                )
                target_viewer.champion_input.blockSignals(True)
                target_viewer.champion_input.setText(champion_name)
                target_viewer.champion_input.blockSignals(False)

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

                        # Update the visible lane selector button and list selection
                        if lane_found and hasattr(target_viewer, "_lane_selector_btn"):
                            lane_display_map = {"top": "Top", "jungle": "Jungle", "middle": "Mid", "bottom": "Bot", "support": "Support"}
                            display = lane_display_map.get(lane, "Lane")
                            target_viewer._lane_selector_btn.setText(f"{display} \u25be")
                        if lane_found and hasattr(target_viewer, "_lane_list_widget"):
                            for i in range(target_viewer._lane_list_widget.count()):
                                item = target_viewer._lane_list_widget.item(i)
                                if item.data(Qt.ItemDataRole.UserRole) == lane:
                                    target_viewer._lane_list_widget.setCurrentItem(item)
                                    break

                    target_viewer.open_build()
        except Exception as e:
            logger.error(f"Error in _create_ally_viewer: {e}")

    def on_enemy_champion_detected(self, champion_name: str):
        """Handle enemy champion detection — schedule counter page opening."""
        self._schedule_auto_viewer_creation(
            champion_name,
            lambda name=champion_name: self._create_enemy_viewer(name),
        )

    def _create_enemy_viewer(self, champion_name: str):
        """Deferred handler for enemy champion viewer creation.

        Phase 1 (this method): create the viewer, set the champion, load the URL.
        Phase 2 (next tick): hide the viewer -- must be a separate event-loop
        iteration because hiding a QWebEngineView in the same tick as setUrl()
        crashes the Chromium rendering layer (see PR #103).
        """
        try:
            logger.info(f"Enemy champion detected: {champion_name}")

            if len(self.viewers) >= self.MAX_VIEWERS:
                logger.warning("Cannot auto-open enemy champion counter: maximum viewers reached")
                return

            has_own_pick = any(viewer.is_picked for viewer in self.viewers)
            position = 1 if has_own_pick else 0
            target_viewer = self.add_viewer(position=position, is_picked=False)

            if target_viewer:
                logger.info(
                    f"Auto-opening counter page for enemy {champion_name} "
                    f"in new viewer {target_viewer.viewer_id} at position {position}"
                )
                target_viewer.champion_input.blockSignals(True)
                target_viewer.champion_input.setText(champion_name)
                target_viewer.champion_input.blockSignals(False)
                self._open_url_and_hide(target_viewer, target_viewer.open_counter)
                logger.info(f"Opponent pick window for {champion_name} hidden by default")
        except Exception as e:
            logger.error(f"Error in on_enemy_champion_detected: {e}")

    def check_latest_version(self):
        """Check latest version without prompting update"""
        try:
            from updater import Updater
            updater = Updater(__version__, parent_widget=self.settings_page)

            has_update, release_info = updater.check_for_updates()

            if release_info:
                latest_version = release_info.get('tag_name', 'Unknown').lstrip('v')
                self.latest_version_label.setText(f"Latest version: {latest_version}")

                sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
                if has_update:
                    self.status_label.setText("✓ New version available!")
                    self.status_label.setStyleSheet(f"""
                        QLabel {{
                            font-size: {sz['font_base']};
                            color: #00d6a1;
                            background-color: transparent;
                            padding: 5px;
                        }}
                    """)
                else:
                    self.status_label.setText("✓ You have the latest version")
                    self.status_label.setStyleSheet(f"""
                        QLabel {{
                            font-size: {sz['font_base']};
                            color: #22c55e;
                            background-color: transparent;
                            padding: 5px;
                        }}
                    """)
            else:
                sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
                self.latest_version_label.setText("Latest version: Unable to check")
                self.status_label.setText("⚠ Could not connect to update server")
                self.status_label.setStyleSheet(f"""
                    QLabel {{
                        font-size: {sz['font_base']};
                        color: #e0342c;
                        background-color: transparent;
                        padding: 5px;
                    }}
                """)

        except Exception as e:
            sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
            logger.error(f"Error checking for updates: {e}")
            self.latest_version_label.setText("Latest version: Error")
            self.status_label.setText(f"✗ Error: {str(e)}")
            self.status_label.setStyleSheet(f"""
                QLabel {{
                    font-size: {sz['font_base']};
                    color: #e0342c;
                    background-color: transparent;
                    padding: 5px;
                }}
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
            sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
            logger.error(f"Error during manual update check: {e}")
            self.status_label.setText(f"✗ Error: {str(e)}")
            self.status_label.setStyleSheet(f"""
                QLabel {{
                    font-size: {sz['font_base']};
                    color: #e0342c;
                    background-color: transparent;
                    padding: 5px;
                }}
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
