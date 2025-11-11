#!/usr/bin/env python3
"""
LoL Viewer - A simple application to view LoLAnalytics champion builds
"""
import sys
import logging
import os
from datetime import datetime
from PyQt6.QtCore import QUrl, pyqtSignal, Qt, QTimer
from PyQt6.QtGui import QColor, QIcon
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLineEdit, QPushButton, QMessageBox,
    QScrollArea, QSplitter, QListWidget, QListWidgetItem, QLabel,
    QTabWidget, QStackedWidget, QComboBox
)


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
        layout.setContentsMargins(4, 5, 4, 5)
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
            self.visibility_button.setText("👁")
        else:
            self.visibility_button.setText("⚫")

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

    def __init__(self, viewer_id: int, champion_data: ChampionData = None, is_picked: bool = False):
        super().__init__()
        self.viewer_id = viewer_id
        self.current_champion = ""
        self.champion_data = champion_data
        self.current_page_type = ""  # "build" or "counter"
        self.is_picked = is_picked  # Whether this viewer was created from champion pick
        self.init_ui()

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
        self.champion_input.returnPressed.connect(self.open_build)
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
        """)
        self.build_button.clicked.connect(self.open_build)
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
        """)
        self.counter_button.clicked.connect(self.open_counter)
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
        """)
        self.aram_button.clicked.connect(self.open_aram)
        control_layout.addWidget(self.aram_button, stretch=1)

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

        layout.addLayout(control_layout)

        # WebView
        self.web_view = QWebEngineView()
        # Set dark background color for web view to match dark theme
        self.web_view.page().setBackgroundColor(QColor("#1e1e1e"))
        layout.addWidget(self.web_view)

        # Set minimum and preferred width
        self.setMinimumWidth(300)
        self.resize(500, self.height())

    def open_build(self):
        """Open the LoLAnalytics build page for the entered champion"""
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        self.current_champion = champion_name
        self.current_page_type = "build"

        # Get selected lane
        lane = self.lane_selector.currentData()
        url = self.get_lolalytics_build_url(champion_name, lane)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()
        # Notify parent window that champion name has been updated
        self.champion_updated.emit(self)

    def open_counter(self):
        """Open the LoLAnalytics counter page for the entered champion"""
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        self.current_champion = champion_name
        self.current_page_type = "counter"

        # Get selected lane
        lane = self.lane_selector.currentData()
        url = self.get_lolalytics_counter_url(champion_name, lane)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()
        # Notify parent window that champion name has been updated
        self.champion_updated.emit(self)

    def open_aram(self):
        """Open the u.gg ARAM page for the entered champion"""
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        self.current_champion = champion_name
        self.current_page_type = "aram"

        # Always use u.gg ARAM URL
        url = self.get_ugg_aram_build_url(champion_name)
        logger.info(f"Opening ARAM page for {champion_name}: {url}")

        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()
        # Notify parent window that champion name has been updated
        self.champion_updated.emit(self)

    def get_display_name(self) -> str:
        """Get display name for this viewer"""
        if self.current_champion and self.current_page_type:
            if self.is_picked:
                return f"{self.current_champion} | {self.current_page_type} | picked"
            return f"{self.current_champion} | {self.current_page_type}"
        return "(Empty)"

    @staticmethod
    def get_lolalytics_build_url(champion_name: str, lane: str = "") -> str:
        """Generate the LoLAnalytics build URL for a given champion"""
        base_url = f"https://lolalytics.com/lol/{champion_name.lower()}/build/"
        if lane:
            return f"{base_url}?lane={lane}"
        return base_url

    @staticmethod
    def get_lolalytics_counter_url(champion_name: str, lane: str = "") -> str:
        """Generate the LoLAnalytics counter URL for a given champion"""
        base_url = f"https://lolalytics.com/lol/{champion_name.lower()}/counters/"
        if lane:
            return f"{base_url}?lane={lane}"
        return base_url

    @staticmethod
    def get_ugg_aram_build_url(champion_name: str) -> str:
        """Generate the u.gg ARAM build URL for a given champion

        Args:
            champion_name: Champion name (e.g., "Ashe", "MasterYi")

        Returns:
            str: u.gg ARAM URL (e.g., "https://u.gg/lol/champions/aram/ashe-aram")
        """
        # Format champion name for u.gg: lowercase, no spaces
        formatted_name = champion_name.lower().replace(" ", "")
        return f"https://u.gg/lol/champions/aram/{formatted_name}-aram"


class MainWindow(QMainWindow):
    MAX_VIEWERS = 20  # Maximum number of viewers allowed

    def __init__(self):
        super().__init__()
        self.viewers = []  # List of all viewer widgets
        self.hidden_viewers = []  # List of hidden viewer widgets
        self.next_viewer_id = 0  # Counter for assigning viewer IDs
        self.champion_data = ChampionData()  # Load champion data

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
        sidebar_container.setFixedWidth(200)
        sidebar_container.setStyleSheet("QWidget { background-color: #252525; }")
        sidebar_layout = QVBoxLayout(sidebar_container)
        sidebar_layout.setSpacing(0)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)
        sidebar_layout.addWidget(self.sidebar)
        sidebar_layout.addWidget(self.connection_status_widget)

        main_layout.addWidget(sidebar_container)

        # Right side - stacked widget for switching between Live Game and Viewers
        self.main_content_stack = QStackedWidget()

        # Page 0: Live Game
        self.create_live_game_page()
        self.main_content_stack.addWidget(self.live_game_page)

        # Page 1: Viewers
        self.create_viewers_page()
        self.main_content_stack.addWidget(self.viewers_page)

        main_layout.addWidget(self.main_content_stack)

        # Add initial 2 viewers
        self.add_viewer()
        self.add_viewer()

        # Set default tab to Viewers (index 1) after all widgets are created
        self.sidebar.setCurrentIndex(1)
        self.main_content_stack.setCurrentIndex(1)

        # Update viewers list after window is shown to fix initial [Hidden] tag issue
        QTimer.singleShot(0, self.update_viewers_list)

    def create_live_game_page(self):
        """Create the Live Game page with u.gg web view"""
        self.live_game_page = QWidget()
        live_game_layout = QVBoxLayout(self.live_game_page)
        live_game_layout.setSpacing(0)
        live_game_layout.setContentsMargins(0, 0, 0, 0)

        # WebView for u.gg
        self.live_game_web_view = QWebEngineView()
        self.live_game_web_view.page().setBackgroundColor(QColor("#1e1e1e"))
        self.live_game_web_view.setUrl(QUrl("https://u.gg/lol/lg-splash"))
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

        # Start champion detection service
        logger.info("Starting champion detection service")
        self.champion_detector.start(interval_ms=2000)

    def create_sidebar(self):
        """Create the left sidebar with tabs for Live Game and Viewers"""
        self.sidebar = QTabWidget()
        self.sidebar.setFixedWidth(200)
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
                padding: 8px;
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

        # Connect tab change signal to update main content
        self.sidebar.currentChanged.connect(self.on_sidebar_tab_changed)

    def on_sidebar_tab_changed(self, index):
        """Handle sidebar tab change and update main content"""
        # Switch main content stack to match sidebar tab
        self.main_content_stack.setCurrentIndex(index)

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
            QMessageBox.warning(
                self,
                "Maximum Viewers Reached",
                f"You can only have up to {self.MAX_VIEWERS} viewers."
            )
            return None

        # Create new viewer
        viewer = ChampionViewerWidget(self.next_viewer_id, self.champion_data, is_picked)
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

        # Open the build page in the new viewer with lane
        if target_viewer:
            logger.info(f"Auto-opening build page for {champion_name} (lane: {lane}) in new viewer {target_viewer.viewer_id} at leftmost position")
            target_viewer.champion_input.setText(champion_name)

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
