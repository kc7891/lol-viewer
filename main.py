#!/usr/bin/env python3
"""
LoL Viewer - A simple application to view LoLAnalytics champion builds
"""
import sys
import logging
import os
import io
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

# Application version
__version__ = "0.21.0"

# Default analytics URLs
DEFAULT_BUILD_URL = "https://lolalytics.com/lol/{name}/build/"
DEFAULT_COUNTER_URL = "https://lolalytics.com/lol/{name}/counters/"
DEFAULT_MATCHUP_URL = (
    "https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/"
    "?lane={lane_name}&vslane={lane_name}"
)
DEFAULT_ARAM_URL = "https://u.gg/lol/champions/aram/{name}-aram"
DEFAULT_LIVE_GAME_URL = "https://u.gg/lol/lg-splash"

# UI glyphs
# Keep these consistent across the app to avoid subtle visual mismatches.
CLOSE_BUTTON_GLYPH = "×"

# Feature flags (toggle in Settings page).
# NOTE: Keys are persisted via QSettings at "feature_flags/<key>".
#
# This build currently ships with no gated/experimental features.
FEATURE_FLAG_DEFINITIONS: dict = {
    "matchup_list": {
        "label": "Matchup List",
        "description": "Show a 5-row matchup list above the viewer toolbar displaying ally vs enemy champion picks.",
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
        self.setFixedHeight(48)
        self.setStyleSheet("""
            QWidget {
                background-color: #090e14;
                border-top: 1px solid #1c2330;
            }
        """)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 0, 10, 0)

        # Inner container for vertically centering content
        inner = QWidget()
        inner.setFixedHeight(30)
        inner.setStyleSheet("QWidget { border: none; }")
        inner_layout = QHBoxLayout(inner)
        inner_layout.setContentsMargins(0, 0, 0, 0)
        inner_layout.setSpacing(6)

        # Green/yellow/red dot indicator
        self.dot_label = QLabel("\u25cf")
        self.dot_label.setFixedSize(10, 30)
        self.dot_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.dot_label.setStyleSheet("""
            QLabel {
                font-size: 8px;
                color: #6d7a8a;
                background-color: transparent;
                border: none;
            }
        """)
        inner_layout.addWidget(self.dot_label)

        # Status text
        self.status_label = QLabel("Riot API: Connecting")
        self.status_label.setStyleSheet("""
            QLabel {
                font-size: 10px;
                color: #6d7a8a;
                background-color: transparent;
                border: none;
            }
        """)
        inner_layout.addWidget(self.status_label, 1)

        layout.addWidget(inner)

    def _apply_status_color(self, color: str):
        """Apply color to all status indicator elements"""
        self.dot_label.setStyleSheet(f"""
            QLabel {{
                font-size: 8px;
                color: {color};
                background-color: transparent;
                border: none;
            }}
        """)
        self.status_label.setStyleSheet(f"""
            QLabel {{
                font-size: 10px;
                color: {color};
                background-color: transparent;
                border: none;
            }}
        """)

    def update_dots(self):
        """Update dot animation for connecting status"""
        if self.current_status == "connecting":
            dots = "." * self.dot_count
            self.status_label.setText(f"Riot API: Connecting{dots}")
            self.dot_count = (self.dot_count % 3) + 1  # Cycle: 1 -> 2 -> 3 -> 1

    def set_status(self, status: str):
        """Set connection status

        Args:
            status: One of "connecting", "connected", "disconnected"
        """
        self.current_status = status

        if status == "connected":
            self.status_label.setText("Riot API: Connected")
            self._apply_status_color("#00d6a1")
        elif status == "disconnected":
            self.status_label.setText("Riot API: Disconnected")
            self._apply_status_color("#e0342c")
        elif status == "connecting":
            self.dot_count = 1
            self.status_label.setText("Riot API: Connecting.")
            self._apply_status_color("#6d7a8a")
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
        label.setStyleSheet("QLabel { color: #6d7a8a; padding: 10px; }")
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


class QrCodeOverlay(QWidget):
    """Floating QR-code overlay anchored to the bottom-right of a target widget."""

    _QR_SIZE = 120  # px (image), padded by layout margins

    def __init__(self, parent: QWidget, target: QWidget):
        """
        Args:
            parent: The container widget to parent this overlay to.
            target: The widget (e.g., web view) whose geometry determines positioning.
        """
        super().__init__(parent)
        self._target = target
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, False)

        self._collapsed = False

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # Container that holds the QR image (hidden when minimised)
        self._qr_container = QWidget()
        self._qr_container.setStyleSheet(
            "background-color: #e2e8f0; border-radius: 6px;"
        )
        qr_layout = QVBoxLayout(self._qr_container)
        qr_layout.setContentsMargins(6, 6, 6, 6)
        self._qr_label = QLabel()
        self._qr_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        qr_layout.addWidget(self._qr_label)
        outer.addWidget(self._qr_container)

        # Toggle (minimise / restore) button
        self._toggle_btn = QPushButton("QR")
        self._toggle_btn.setFixedSize(32, 32)
        self._toggle_btn.setToolTip("Hide QR code")
        self._toggle_btn.setStyleSheet(
            "QPushButton { background-color: rgba(13,17,23,200); color: #e2e8f0; "
            "border: 1px solid #222a35; border-radius: 4px; font-size: 9pt; font-weight: bold; }"
            "QPushButton:hover { background-color: rgba(28,35,48,220); }"
        )
        self._toggle_btn.clicked.connect(self._toggle)
        outer.addWidget(self._toggle_btn, alignment=Qt.AlignmentFlag.AlignRight)

        self._current_url: str = ""
        self.hide()  # hidden until a URL is set

        # Listen for resize/move events on the target widget
        self._target.installEventFilter(self)

    # -- public API --

    def set_url(self, url: str):
        """Generate and display a QR code for *url*."""
        if url == self._current_url:
            return
        self._current_url = url
        if not url:
            self.hide()
            return
        try:
            import segno
            qr = segno.make(url)
            buf = io.BytesIO()
            qr.save(buf, kind="png", scale=4, border=1)
            buf.seek(0)
            pixmap = QPixmap()
            pixmap.loadFromData(QByteArray(buf.getvalue()))
            pixmap = pixmap.scaled(
                self._QR_SIZE, self._QR_SIZE,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self._qr_label.setPixmap(pixmap)
        except Exception:
            logging.getLogger(__name__).debug("QR code generation failed for %s", url, exc_info=True)
            self.hide()
            return
        self.show()
        self._reposition()

    # -- internal --

    def _toggle(self):
        self._collapsed = not self._collapsed
        self._qr_container.setVisible(not self._collapsed)
        self._toggle_btn.setToolTip("Show QR code" if self._collapsed else "Hide QR code")
        self._reposition()

    def _reposition(self):
        """Pin to the bottom-right of the target widget."""
        if self._target is None:
            return
        self.adjustSize()
        margin = 10
        # Map target's bottom-right corner to parent's coordinate system
        target_rect = self._target.geometry()
        x = target_rect.right() - self.width() - margin + 1
        y = target_rect.bottom() - self.height() - margin + 1
        self.move(max(x, target_rect.x()), max(y, target_rect.y()))

    def eventFilter(self, obj, event):
        """Reposition overlay when target widget is resized or moved."""
        if obj is self._target:
            from PyQt6.QtCore import QEvent
            if event.type() in (QEvent.Type.Resize, QEvent.Type.Move):
                self._reposition()
        return super().eventFilter(obj, event)


def _install_qr_overlay(container: QWidget, web_view: QWidget) -> "QrCodeOverlay":
    """Create a QrCodeOverlay as a sibling to the web view (both children of container)."""
    overlay = QrCodeOverlay(container, web_view)
    return overlay


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
from champion_data import ChampionData, ChampionImageCache, setup_champion_input, setup_opponent_champion_input
from logger import log
from lcu_detector import ChampionDetectorService



class ViewerListItemWidget(QWidget):
    """Custom widget for viewer list items showing champion icon, name and page type"""

    CLOSE_GLYPH = "\u00d7"  # ×

    def __init__(self, display_name: str, viewer: 'ChampionViewerWidget', parent_window: 'MainWindow'):
        super().__init__()
        self.viewer = viewer
        self.parent_window = parent_window
        self.init_ui(display_name)

    def init_ui(self, display_name: str):
        """Initialize the UI components"""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 6, 8, 6)
        layout.setSpacing(8)

        # Champion icon
        self.icon_label = QLabel()
        self.icon_label.setFixedSize(30, 30)
        self.icon_label.setStyleSheet("""
            QLabel {
                background-color: #1c2330;
                border-radius: 6px;
            }
        """)
        layout.addWidget(self.icon_label)
        self._load_champion_icon()

        # Right side: name + page type stacked vertically
        text_widget = QWidget()
        text_widget.setStyleSheet("QWidget { background-color: transparent; }")
        text_layout = QVBoxLayout(text_widget)
        text_layout.setContentsMargins(0, 0, 0, 0)
        text_layout.setSpacing(1)

        # Champion name
        champ_name = (self.viewer.current_champion or "").strip().title() or "(Empty)"
        self.name_label = QLabel(champ_name)
        self.name_label.setStyleSheet("""
            QLabel {
                color: #e2e8f0;
                font-size: 12px;
                font-weight: bold;
                background-color: transparent;
            }
        """)
        text_layout.addWidget(self.name_label)

        # Page type label (e.g. "BUILD", "COUNTER", "ARAM")
        page_type = (self.viewer.current_page_type or "").upper() or "BUILD"
        self.type_label = QLabel(page_type)
        self.type_label.setStyleSheet("""
            QLabel {
                color: #6d7a8a;
                font-size: 9px;
                background-color: transparent;
            }
        """)
        text_layout.addWidget(self.type_label)

        layout.addWidget(text_widget, 1)

        # Close button (visible on hover only)
        self.close_button = QPushButton(self.CLOSE_GLYPH)
        self.close_button.setToolTip("Close viewer")
        self.close_button.setFixedSize(20, 20)
        self.close_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self.close_button.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                border: none;
                color: #6d7a8a;
                font-size: 14px;
            }
            QPushButton:hover {
                color: #e0342c;
            }
        """)
        self.close_button.clicked.connect(self._close_viewer)
        self.close_button.setVisible(False)
        layout.addWidget(self.close_button)

    def sizeHint(self):
        """Return size based on actual content height."""
        # 30px icon + 6px top margin + 6px bottom margin = 42px minimum
        hint = super().sizeHint()
        min_h = 30 + 12  # icon height + vertical margins
        if hint.height() < min_h:
            hint.setHeight(min_h)
        return hint

    def enterEvent(self, event):
        """Show close button on hover"""
        self.close_button.setVisible(True)
        super().enterEvent(event)

    def leaveEvent(self, event):
        """Hide close button when not hovering"""
        self.close_button.setVisible(False)
        super().leaveEvent(event)

    def _close_viewer(self):
        """Close the viewer"""
        self.parent_window.close_viewer(self.viewer)

    def _load_champion_icon(self):
        """Load champion icon from image cache"""
        champion_name = (self.viewer.current_champion or "").strip()
        if not champion_name:
            return
        champ = self.parent_window.champion_data.get_champion(champion_name)
        if not champ:
            return
        url = champ.get("image_url", "")
        if not url:
            return
        cache = self.parent_window._sidebar_image_cache
        pixmap = cache.get_image(
            url,
            callback=lambda pm, lbl=self.icon_label: lbl.setPixmap(
                pm.scaled(30, 30, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            ),
        )
        if pixmap:
            self.icon_label.setPixmap(
                pixmap.scaled(30, 30, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            )


class ChampionViewerWidget(QWidget):
    """Widget containing champion input, build/counter buttons, and web view"""

    close_requested = pyqtSignal(object)  # Signal to request closing this viewer
    hide_requested = pyqtSignal(object)   # Signal to request hiding this viewer
    champion_updated = pyqtSignal(object)  # Signal when champion name is updated

    def __init__(self, viewer_id: int, champion_data: ChampionData = None, is_picked: bool = False, main_window=None):
        super().__init__()
        self.viewer_id = viewer_id
        self.current_champion = ""
        self.current_opponent_champion = ""
        self.champion_data = champion_data
        self.current_page_type = ""  # "build" or "counter"
        # UI-selected mode (0=Build, 1=Counter, 2=ARAM). This is the "tab" the user selected,
        # and can be set even before a champion is entered.
        self.selected_mode_index = 0
        self.current_url = ""  # Store the current URL for refresh functionality
        self.is_picked = is_picked  # Whether this viewer was created from champion pick
        self.main_window = main_window  # Reference to MainWindow for URL settings
        self.opponent_champion_input = None
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
        """Initialize the UI components

        Layout based on issue #74 wireframe:
        ┌────────────────────────────────────────────────────┐
        │ [icon] Darius vs Garen                             │  Header
        ├────────────────────────────────────────────────────┤
        │ [Build][Counter][ARAM]   [Darius▾] vs [Garen▾] ×  │  Control bar
        ├────────────────────────────────────────────────────┤
        │ WebView  /  Champion Selector                      │  Content
        └────────────────────────────────────────────────────┘
        """
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Image cache (must init before UI elements that use it)
        self._champion_icon_cache = ChampionImageCache()

        # ── Header: [icon] "Champion vs Opponent" ──
        header_widget = QWidget()
        header_widget.setStyleSheet("QWidget { background-color: #141b24; }")
        header_layout = QHBoxLayout(header_widget)
        header_layout.setContentsMargins(10, 8, 10, 8)
        header_layout.setSpacing(8)

        self.champion_display_icon = QLabel()
        self.champion_display_icon.setFixedSize(28, 28)
        self.champion_display_icon.setStyleSheet(
            "QLabel { background-color: transparent; border-radius: 14px; }"
        )
        header_layout.addWidget(self.champion_display_icon)

        self.champion_display_name = QLabel("")
        self.champion_display_name.setStyleSheet("""
            QLabel {
                font-size: 11pt;
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }
        """)
        header_layout.addWidget(self.champion_display_name)
        header_layout.addStretch()

        layout.addWidget(header_widget)

        # ── Control bar: [Build][Counter][ARAM]  <stretch>  [Champ▾] vs [Opp▾] × ──
        control_bar = QWidget()
        control_bar.setStyleSheet("QWidget { background-color: #0d1117; }")
        control_bar.setFixedHeight(36)
        cb_layout = QHBoxLayout(control_bar)
        cb_layout.setContentsMargins(4, 0, 4, 0)
        cb_layout.setSpacing(0)

        # -- Mode tab style (compact / shrunk) --
        mode_tab_checked = """
            QPushButton {
                padding: 4px 10px;
                font-size: 9pt;
                font-weight: bold;
                background-color: #00d6a1;
                color: #0d1117;
                border: none;
                border-radius: 4px;
                margin: 3px 2px;
            }
            QPushButton:hover { background-color: #00efb3; }
        """
        mode_tab_unchecked = """
            QPushButton {
                padding: 4px 10px;
                font-size: 9pt;
                background-color: transparent;
                color: #6d7a8a;
                border: none;
                border-radius: 4px;
                margin: 3px 2px;
            }
            QPushButton:hover { background-color: #1c2330; color: #e2e8f0; }
            QPushButton:checked {
                font-weight: bold;
                background-color: #00d6a1;
                color: #0d1117;
            }
        """

        self.build_button = QPushButton("Build")
        self.build_button.setStyleSheet(mode_tab_unchecked)
        self.build_button.clicked.connect(lambda _=False: self._on_mode_button_clicked(0))
        cb_layout.addWidget(self.build_button)

        self.counter_button = QPushButton("Counter")
        self.counter_button.setStyleSheet(mode_tab_unchecked)
        self.counter_button.clicked.connect(lambda _=False: self._on_mode_button_clicked(1))
        cb_layout.addWidget(self.counter_button)

        self.aram_button = QPushButton("ARAM")
        self.aram_button.setStyleSheet(mode_tab_unchecked)
        self.aram_button.clicked.connect(lambda _=False: self._on_mode_button_clicked(2))
        cb_layout.addWidget(self.aram_button)

        self.mode_button_group = QButtonGroup(self)
        self.mode_button_group.setExclusive(True)
        for idx, btn in enumerate([self.build_button, self.counter_button, self.aram_button]):
            btn.setCheckable(True)
            self.mode_button_group.addButton(btn, idx)
        self._mode_tab_style_active = mode_tab_checked
        self._mode_tab_style_inactive = mode_tab_unchecked
        self._set_selected_mode_index(0)

        # -- Lane selector pill (left-aligned, right of ARAM) --
        selector_pill_style = """
            QPushButton {
                padding: 3px 8px 3px 4px;
                font-size: 9pt;
                background-color: #1c2330;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 4px;
                text-align: left;
            }
            QPushButton:hover {
                background-color: #222a35;
                border-color: #00d6a1;
            }
        """

        self._lane_selector_btn = QPushButton("Lane \u25BE")
        self._lane_selector_btn.setStyleSheet(selector_pill_style)
        self._lane_selector_btn.clicked.connect(lambda: self._open_champion_selector("lane"))
        cb_layout.addWidget(self._lane_selector_btn)

        cb_layout.addStretch()

        self._champion_selector_btn = QPushButton("Champion \u25BE")
        self._champion_selector_btn.setStyleSheet(selector_pill_style)
        self._champion_selector_btn.setIconSize(QSize(20, 20))
        self._champion_selector_btn.clicked.connect(lambda: self._open_champion_selector("champion"))
        cb_layout.addWidget(self._champion_selector_btn)

        vs_label = QLabel("vs")
        vs_label.setStyleSheet(
            "QLabel { font-size: 9pt; color: #6d7a8a; background-color: transparent; margin: 0 4px; }"
        )
        vs_label.setFixedWidth(20)
        vs_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cb_layout.addWidget(vs_label)

        self._opponent_selector_btn = QPushButton("Opponent \u25BE")
        self._opponent_selector_btn.setStyleSheet(selector_pill_style)
        self._opponent_selector_btn.setIconSize(QSize(20, 20))
        self._opponent_selector_btn.clicked.connect(lambda: self._open_champion_selector("opponent"))
        cb_layout.addWidget(self._opponent_selector_btn)

        # Close button (compact ×)
        self.close_button = QPushButton(CLOSE_BUTTON_GLYPH)
        self.close_button.setToolTip("Close this viewer")
        self.close_button.setStyleSheet("""
            QPushButton {
                padding: 0px;
                font-size: 12pt;
                background-color: transparent;
                color: #6d7a8a;
                border: none;
                min-width: 24px; max-width: 24px;
                min-height: 24px; max-height: 24px;
                margin-left: 4px;
            }
            QPushButton:hover { color: #e0342c; }
        """)
        self.close_button.clicked.connect(lambda: self.close_requested.emit(self))
        cb_layout.addWidget(self.close_button)

        # Hide button (kept for compatibility, not in wireframe)
        self.hide_button = QPushButton("−")
        self.hide_button.setToolTip("Hide this viewer")
        self.hide_button.setStyleSheet("""
            QPushButton {
                padding: 0px; font-size: 10pt;
                background-color: transparent; color: #6d7a8a;
                border: none;
                min-width: 0px; max-width: 0px;
                min-height: 0px; max-height: 0px;
            }
        """)
        self.hide_button.setVisible(False)
        self.hide_button.clicked.connect(lambda: self.hide_requested.emit(self))

        layout.addWidget(control_bar)

        # ── Hidden inputs for compatibility ──
        self.champion_input = QLineEdit()
        self.champion_input.setPlaceholderText("Champion name (e.g., ashe, swain, アッシュ)")
        self.champion_input.returnPressed.connect(self.open_selected_mode)
        self.champion_input.setVisible(False)
        layout.addWidget(self.champion_input)

        self.opponent_champion_input = QLineEdit()
        self.opponent_champion_input.setPlaceholderText(
            "Opponent champion (click to pick from Counter tab)"
        )
        self.opponent_champion_input.returnPressed.connect(self.open_selected_mode)
        self.opponent_champion_input.setVisible(False)
        layout.addWidget(self.opponent_champion_input)

        if self.champion_data:
            setup_champion_input(self.champion_input, self.champion_data)
            setup_opponent_champion_input(
                self.opponent_champion_input,
                self.champion_data,
                suggestion_provider=self._get_open_champion_suggestions,
            )

        # Lane selector (hidden, functional)
        self.lane_selector = QComboBox()
        self.lane_selector.addItem("Lane", "")
        self.lane_selector.addItem("Top", "top")
        self.lane_selector.addItem("JG", "jungle")
        self.lane_selector.addItem("Mid", "middle")
        self.lane_selector.addItem("Bot", "bottom")
        self.lane_selector.addItem("Sup", "support")
        self.lane_selector.setVisible(False)
        layout.addWidget(self.lane_selector)

        # Refresh button (hidden, functional)
        self.refresh_button = QPushButton("⟳")
        self.refresh_button.setToolTip("Refresh page")
        self.refresh_button.clicked.connect(self.refresh_page)
        self.refresh_button.setVisible(False)
        layout.addWidget(self.refresh_button)

        # ── Content area (stacked: web view / champion selector) ──
        self.viewer_content_stack = QStackedWidget()

        # Page 0: WebView
        self.web_view = NullWebView() if _webengine_disabled() else QWebEngineView()
        self.web_view.page().setBackgroundColor(QColor("#0d1117"))
        self.viewer_content_stack.addWidget(self.web_view)

        # Page 1: Champion selector panel
        self._champion_selector_panel = self._create_champion_selector_panel()
        self.viewer_content_stack.addWidget(self._champion_selector_panel)

        # Page 2: Lane selector panel
        self._lane_selector_panel = self._create_lane_selector_panel()
        self.viewer_content_stack.addWidget(self._lane_selector_panel)

        self.viewer_content_stack.setCurrentIndex(0)
        layout.addWidget(self.viewer_content_stack)

        # QR code overlay
        self._qr_overlay: Optional[QrCodeOverlay] = None
        if self.main_window and self.main_window.qr_overlay_enabled:
            self._qr_overlay = _install_qr_overlay(self, self.web_view)

        # Track which selector is being edited ("champion" or "opponent")
        self._active_selector_target = "champion"

        # Set minimum and preferred width
        self.setMinimumWidth(300)
        self.resize(500, self.height())

    def _create_champion_selector_panel(self) -> QWidget:
        """Create the champion selector panel: SELECT CHAMPION header + search + list."""
        panel = QWidget()
        panel.setStyleSheet("QWidget { background-color: #1c2330; }")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(12, 8, 12, 8)
        panel_layout.setSpacing(6)

        # "SELECT CHAMPION" header label
        select_label = QLabel("SELECT CHAMPION")
        select_label.setStyleSheet("""
            QLabel {
                font-size: 8pt;
                font-weight: bold;
                color: #6d7a8a;
                background-color: transparent;
                letter-spacing: 1px;
                padding: 2px 0;
            }
        """)
        select_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        panel_layout.addWidget(select_label)

        # Search field
        self._champion_search_input = QLineEdit()
        self._champion_search_input.setPlaceholderText("Search...")
        self._champion_search_input.setStyleSheet("""
            QLineEdit {
                padding: 6px 8px;
                font-size: 9pt;
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 4px;
            }
            QLineEdit:focus {
                border: 1px solid #00d6a1;
            }
        """)
        self._champion_search_input.textChanged.connect(self._filter_champion_list)
        panel_layout.addWidget(self._champion_search_input)

        # Champion list
        self._champion_list_widget = QListWidget()
        self._champion_list_widget.setStyleSheet("""
            QListWidget {
                background-color: #141b24;
                border: none;
                border-radius: 4px;
                color: #e2e8f0;
                outline: none;
            }
            QListWidget::item {
                padding: 5px 8px;
            }
            QListWidget::item:hover {
                background-color: #1c2330;
            }
            QListWidget::item:selected {
                background-color: #00d6a1;
                color: #0d1117;
            }
        """)
        self._champion_list_widget.setIconSize(QSize(28, 28))
        self._champion_list_widget.itemClicked.connect(self._on_champion_list_item_clicked)
        panel_layout.addWidget(self._champion_list_widget)

        self._populate_champion_list()
        return panel

    def _populate_champion_list(self):
        """Populate the champion list widget with all champions and icons."""
        self._champion_list_widget.clear()
        if not self.champion_data:
            return

        def _safe_set_icon(it, px):
            """Set icon on item, ignoring if the C++ object was already deleted."""
            try:
                it.setIcon(QIcon(px.scaled(
                    28, 28, Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation)))
            except RuntimeError:
                pass

        for champ_id, champ_info in sorted(self.champion_data.champions.items()):
            display_name = champ_info.get("english_name", champ_id)
            item = QListWidgetItem(display_name)
            item.setData(Qt.ItemDataRole.UserRole, champ_id)
            image_url = champ_info.get("image_url", "")
            if image_url:
                cached = self._champion_icon_cache.get_image(
                    image_url,
                    callback=lambda px, _it=item: _safe_set_icon(_it, px),
                )
                if cached:
                    _safe_set_icon(item, cached)
            self._champion_list_widget.addItem(item)

    def _filter_champion_list(self, text: str):
        """Filter the champion list based on search text."""
        search = text.strip().lower()
        for i in range(self._champion_list_widget.count()):
            item = self._champion_list_widget.item(i)
            champ_id = item.data(Qt.ItemDataRole.UserRole) or ""
            display_name = item.text().lower()
            visible = not search or search in display_name or search in champ_id.lower()
            if not visible and self.champion_data:
                champ_info = self.champion_data.champions.get(champ_id, {})
                jp_name = (champ_info.get("japanese_name") or "").lower()
                if search in jp_name:
                    visible = True
            item.setHidden(not visible)

    def _create_lane_selector_panel(self) -> QWidget:
        """Create the lane selector panel: SELECT LANE header + lane list."""
        panel = QWidget()
        panel.setStyleSheet("QWidget { background-color: #1c2330; }")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(12, 8, 12, 8)
        panel_layout.setSpacing(6)

        select_label = QLabel("SELECT LANE")
        select_label.setStyleSheet("""
            QLabel {
                font-size: 8pt;
                font-weight: bold;
                color: #6d7a8a;
                background-color: transparent;
                letter-spacing: 1px;
                padding: 2px 0;
            }
        """)
        select_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        panel_layout.addWidget(select_label)

        self._lane_list_widget = QListWidget()
        self._lane_list_widget.setStyleSheet("""
            QListWidget {
                background-color: #141b24;
                border: none;
                border-radius: 4px;
                color: #e2e8f0;
                outline: none;
            }
            QListWidget::item {
                padding: 8px 12px;
                font-size: 10pt;
            }
            QListWidget::item:hover {
                background-color: #1c2330;
            }
            QListWidget::item:selected {
                background-color: #00d6a1;
                color: #0d1117;
            }
        """)
        lanes = [("None", ""), ("Top", "top"), ("Jungle", "jungle"),
                 ("Mid", "middle"), ("Bot", "bottom"), ("Support", "support")]
        for display, value in lanes:
            item = QListWidgetItem(display)
            item.setData(Qt.ItemDataRole.UserRole, value)
            self._lane_list_widget.addItem(item)
        self._lane_list_widget.itemClicked.connect(self._on_lane_list_item_clicked)
        panel_layout.addWidget(self._lane_list_widget)
        panel_layout.addStretch()
        return panel

    def _on_lane_list_item_clicked(self, item: QListWidgetItem):
        """Handle lane selection from the list."""
        lane_value = item.data(Qt.ItemDataRole.UserRole)
        # Update the hidden QComboBox
        for i in range(self.lane_selector.count()):
            if self.lane_selector.itemData(i) == lane_value:
                self.lane_selector.setCurrentIndex(i)
                break
        # Update pill button text
        display = item.text() if lane_value else "Lane"
        self._lane_selector_btn.setText(f"{display} \u25BE")
        # Switch back to web view and re-navigate if champion is set
        self.viewer_content_stack.setCurrentIndex(0)
        champion_name = self.champion_input.text().strip().lower()
        if champion_name:
            self.open_selected_mode()

    def _open_champion_selector(self, target: str):
        """Open champion/lane selector panel for the given target."""
        if target == "lane":
            # Toggle lane selector (page 2)
            if self.viewer_content_stack.currentIndex() == 2:
                self.viewer_content_stack.setCurrentIndex(0)
            else:
                self.viewer_content_stack.setCurrentIndex(2)
            return

        self._active_selector_target = target
        # Rebuild "None" visibility: show only for opponent target
        self._refresh_none_item()
        if self.viewer_content_stack.currentIndex() == 1:
            self._champion_search_input.clear()
            self._champion_search_input.setFocus()
            self._filter_champion_list("")
            return
        self.viewer_content_stack.setCurrentIndex(1)
        self._champion_search_input.clear()
        self._champion_search_input.setFocus()
        self._filter_champion_list("")

    def _refresh_none_item(self):
        """Show/hide the 'None' item at the top of the champion list based on target."""
        if self._champion_list_widget.count() == 0:
            return
        first = self._champion_list_widget.item(0)
        is_none_item = first.data(Qt.ItemDataRole.UserRole) == ""
        if self._active_selector_target == "opponent":
            if not is_none_item:
                # Insert "None" at top
                none_item = QListWidgetItem("None")
                none_item.setData(Qt.ItemDataRole.UserRole, "")
                self._champion_list_widget.insertItem(0, none_item)
        else:
            if is_none_item:
                self._champion_list_widget.takeItem(0)

    def _on_champion_list_item_clicked(self, item: QListWidgetItem):
        """Handle champion selection from the list."""
        champ_id = item.data(Qt.ItemDataRole.UserRole)

        if self._active_selector_target == "opponent":
            if champ_id == "":
                # "None" selected — clear opponent
                self.opponent_champion_input.clear()
                self.current_opponent_champion = ""
                self._opponent_selector_btn.setText("Opponent \u25BE")
                self._opponent_selector_btn.setIcon(QIcon())
            else:
                self.opponent_champion_input.setText(champ_id)
                self._update_opponent_selector_btn(champ_id)
        else:
            self.champion_input.setText(champ_id)
            self._update_champion_selector_btn(champ_id)

        self._update_header_display()
        # Switch back to web view and navigate
        self.viewer_content_stack.setCurrentIndex(0)
        champion_name = self.champion_input.text().strip().lower()
        if champion_name:
            self.open_selected_mode()

    def _update_header_display(self):
        """Update the header 'Champion vs Opponent' display."""
        champ_name = self.champion_input.text().strip().lower()
        opp_name = self.opponent_champion_input.text().strip().lower()

        champ_display = self._get_display_name(champ_name)
        opp_display = self._get_display_name(opp_name)

        if champ_display and opp_display:
            self.champion_display_name.setText(f"{champ_display} vs {opp_display}")
        elif champ_display:
            self.champion_display_name.setText(champ_display)
        else:
            self.champion_display_name.setText("")

        # Update header icon from champion
        self._set_label_champion_icon(self.champion_display_icon, champ_name, 28)

    def _update_champion_selector_btn(self, champ_id: str):
        """Update the champion selector pill button text and icon."""
        display = self._get_display_name(champ_id) or "Champion"
        self._champion_selector_btn.setText(f"{display} \u25BE")
        self._set_btn_champion_icon(self._champion_selector_btn, champ_id, 20)

    def _update_opponent_selector_btn(self, champ_id: str):
        """Update the opponent selector pill button text and icon."""
        display = self._get_display_name(champ_id) or "Opponent"
        self._opponent_selector_btn.setText(f"{display} \u25BE")
        self._set_btn_champion_icon(self._opponent_selector_btn, champ_id, 20)

    def _get_display_name(self, champ_id: str) -> str:
        """Get the display name for a champion id."""
        if not champ_id:
            return ""
        if self.champion_data:
            info = self.champion_data.champions.get(champ_id, {})
            if info:
                return info.get("english_name", champ_id.capitalize())
        return champ_id.capitalize()

    @staticmethod
    def _safe_set_pixmap(widget, pixmap, size: int):
        """Set pixmap/icon on a widget, ignoring if the C++ object was deleted."""
        try:
            scaled = pixmap.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio,
                                   Qt.TransformationMode.SmoothTransformation)
            if isinstance(widget, QPushButton):
                widget.setIcon(QIcon(scaled))
            else:
                widget.setPixmap(scaled)
        except RuntimeError:
            pass

    def _set_label_champion_icon(self, label: QLabel, champ_id: str, size: int):
        """Set a QLabel's pixmap to the champion's icon."""
        if not champ_id or not self.champion_data:
            label.clear()
            return
        info = self.champion_data.champions.get(champ_id, {})
        url = info.get("image_url", "")
        if not url:
            label.clear()
            return
        cached = self._champion_icon_cache.get_image(
            url,
            callback=lambda px, _l=label, _s=size: self._safe_set_pixmap(_l, px, _s),
        )
        if cached:
            self._safe_set_pixmap(label, cached, size)

    def _set_btn_champion_icon(self, btn: QPushButton, champ_id: str, size: int):
        """Set a QPushButton's icon to the champion's icon."""
        if not champ_id or not self.champion_data:
            btn.setIcon(QIcon())
            return
        info = self.champion_data.champions.get(champ_id, {})
        url = info.get("image_url", "")
        if not url:
            btn.setIcon(QIcon())
            return
        cached = self._champion_icon_cache.get_image(
            url,
            callback=lambda px, _b=btn, _s=size: self._safe_set_pixmap(_b, px, _s),
        )
        if cached:
            self._safe_set_pixmap(btn, cached, size)

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
        # Switch back to web view from champion selector if needed
        if hasattr(self, "viewer_content_stack") and self.viewer_content_stack.currentIndex() != 0:
            self.viewer_content_stack.setCurrentIndex(0)
        champion_name = self.champion_input.text().strip().lower()
        if not champion_name:
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
        self._update_header_display()
        self._update_champion_selector_btn(champion_name)

        # Get selected lane
        lane = self.lane_selector.currentData()

        opponent_name = ""
        if getattr(self, "opponent_champion_input", None) is not None:
            opponent_name = self.opponent_champion_input.text().strip().lower()

        if opponent_name:
            self.current_opponent_champion = opponent_name
            url = self.get_matchup_url(champion_name, opponent_name, lane or "")
        else:
            self.current_opponent_champion = ""
            url = self.get_build_url(champion_name, lane)

        self.current_url = url  # Store URL for refresh functionality
        if self._qr_overlay is not None:
            self._qr_overlay.set_url(url)
        self.web_view.setUrl(QUrl(url))
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
        self._update_header_display()
        self._update_champion_selector_btn(champion_name)

        # Get selected lane
        lane = self.lane_selector.currentData()
        url = self.get_counter_url(champion_name, lane)
        self.current_url = url  # Store URL for refresh functionality
        if self._qr_overlay is not None:
            self._qr_overlay.set_url(url)
        self.web_view.setUrl(QUrl(url))
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
        self._update_header_display()
        self._update_champion_selector_btn(champion_name)

        url = self.get_aram_url(champion_name)
        logger.info(f"Opening ARAM page for {champion_name}: {url}")

        self.current_url = url  # Store URL for refresh functionality
        if self._qr_overlay is not None:
            self._qr_overlay.set_url(url)
        self.web_view.setUrl(QUrl(url))
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

    def get_matchup_url(self, champion_name1: str, champion_name2: str, lane_name: str = "") -> str:
        """Generate the matchup (vs) build URL using configured template (or default)."""
        template = DEFAULT_MATCHUP_URL
        if self.main_window and getattr(self.main_window, "matchup_url", None):
            template = self.main_window.matchup_url

        return (
            template
            .replace("{champion_name1}", champion_name1.lower())
            .replace("{champion_name2}", champion_name2.lower())
            .replace("{lane_name}", lane_name or "")
        )

    def _get_open_champion_suggestions(self) -> List[str]:
        """Provide suggestions for opponent champion input."""
        if not self.main_window:
            return []
        if not hasattr(self.main_window, "get_open_champion_suggestions"):
            return []
        return self.main_window.get_open_champion_suggestions(exclude_viewer=self)

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
        self.champion_detector.matchup_pairs_updated.connect(self.on_matchup_pairs_updated)
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

        # Matchup list (ally vs enemy, 5 rows) — controlled by feature flag
        self.matchup_list_widget = self._create_matchup_list_widget()
        self.matchup_list_widget.setVisible(self.feature_flags.get("matchup_list", False))
        viewers_layout.addWidget(self.matchup_list_widget)

        # Top toolbar with add and close all buttons
        self.create_toolbar()
        viewers_layout.addWidget(self.toolbar)

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
        title_label.setStyleSheet("""
            QLabel {
                font-size: 18pt;
                font-weight: bold;
                color: #e2e8f0;
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
                color: #e2e8f0;
                background-color: transparent;
            }
        """)
        url_layout.addWidget(url_title)

        url_description = QLabel(
            "Configure URLs for each analytics type. Use {name} as placeholder for champion name, {lane} for lane parameter. "
            "For matchup URLs, use {champion_name1}, {champion_name2}, {lane_name}."
        )
        url_description.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }
        """)
        url_description.setWordWrap(True)
        url_layout.addWidget(url_description)

        # Build URL
        build_url_label = QLabel("Build URL:")
        build_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #c1c9d4; background-color: transparent; }")
        url_layout.addWidget(build_url_label)

        self.build_url_input = QLineEdit()
        self.build_url_input.setPlaceholderText("e.g., https://lolalytics.com/lol/{name}/build/")
        self.build_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QLineEdit:focus {
                border: 1px solid #00d6a1;
            }
        """)
        url_layout.addWidget(self.build_url_input)

        # Matchup URL
        matchup_url_label = QLabel("Matchup URL:")
        matchup_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #c1c9d4; background-color: transparent; }")
        url_layout.addWidget(matchup_url_label)

        self.matchup_url_input = QLineEdit()
        self.matchup_url_input.setPlaceholderText(
            "e.g., https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}"
        )
        self.matchup_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QLineEdit:focus {
                border: 1px solid #00d6a1;
            }
        """)
        url_layout.addWidget(self.matchup_url_input)

        # Counter URL
        counter_url_label = QLabel("Counter URL:")
        counter_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #c1c9d4; background-color: transparent; }")
        url_layout.addWidget(counter_url_label)

        self.counter_url_input = QLineEdit()
        self.counter_url_input.setPlaceholderText("e.g., https://lolalytics.com/lol/{name}/counters/")
        self.counter_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QLineEdit:focus {
                border: 1px solid #00d6a1;
            }
        """)
        url_layout.addWidget(self.counter_url_input)

        # ARAM URL
        aram_url_label = QLabel("ARAM URL:")
        aram_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #c1c9d4; background-color: transparent; }")
        url_layout.addWidget(aram_url_label)

        self.aram_url_input = QLineEdit()
        self.aram_url_input.setPlaceholderText("e.g., https://u.gg/lol/champions/aram/{name}-aram")
        self.aram_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QLineEdit:focus {
                border: 1px solid #00d6a1;
            }
        """)
        url_layout.addWidget(self.aram_url_input)

        # Live Game URL
        live_game_url_label = QLabel("Live Game URL:")
        live_game_url_label.setStyleSheet("QLabel { font-size: 10pt; color: #c1c9d4; background-color: transparent; }")
        url_layout.addWidget(live_game_url_label)

        self.live_game_url_input = QLineEdit()
        self.live_game_url_input.setPlaceholderText("e.g., https://u.gg/lol/lg-splash")
        self.live_game_url_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                font-size: 10pt;
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QLineEdit:focus {
                border: 1px solid #00d6a1;
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
                background-color: #00d6a1;
                color: #0d1117;
                border: none;
                border-radius: 6px;
            }
            QPushButton:hover {
                background-color: #00efb3;
            }
            QPushButton:pressed {
                background-color: #00b888;
            }
        """)
        self.save_urls_button.clicked.connect(self.save_url_settings)
        url_buttons_layout.addWidget(self.save_urls_button)

        self.reset_urls_button = QPushButton("Reset to Defaults")
        self.reset_urls_button.setStyleSheet("""
            QPushButton {
                padding: 8px 16px;
                font-size: 10pt;
                background-color: #1c2330;
                color: #c1c9d4;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QPushButton:hover {
                background-color: #222a35;
                color: #e2e8f0;
            }
            QPushButton:pressed {
                background-color: #141b24;
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
                color: #6d7a8a;
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
                color: #e2e8f0;
                background-color: transparent;
            }
        """)
        connection_layout.addWidget(connection_title)

        connection_description = QLabel("LoLクライアントを後から起動した場合は、下のボタンを押すと即座に接続を再試行します。")
        connection_description.setWordWrap(True)
        connection_description.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #6d7a8a;
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
                background-color: #1c2330;
                color: #c1c9d4;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QPushButton:hover:enabled {
                background-color: #222a35;
                color: #e2e8f0;
            }
            QPushButton:pressed:enabled {
                background-color: #141b24;
            }
            QPushButton:disabled {
                background-color: #141b24;
                color: #6d7a8a;
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
                color: #e2e8f0;
                background-color: transparent;
            }
        """)
        version_layout.addWidget(version_title)

        # Current version
        self.current_version_label = QLabel(f"Current version: {__version__}")
        self.current_version_label.setStyleSheet("""
            QLabel {
                font-size: 11pt;
                color: #c1c9d4;
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
                color: #c1c9d4;
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
                color: #6d7a8a;
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
                background-color: #00d6a1;
                color: #0d1117;
                border: none;
                border-radius: 6px;
            }
            QPushButton:hover {
                background-color: #00efb3;
            }
            QPushButton:pressed {
                background-color: #00b888;
            }
            QPushButton:disabled {
                background-color: #1c2330;
                color: #6d7a8a;
            }
        """)
        self.update_button.clicked.connect(self.check_for_updates)
        settings_layout.addWidget(self.update_button)

        # Display Settings section
        display_group = QWidget()
        display_layout = QVBoxLayout(display_group)
        display_layout.setSpacing(10)

        display_title = QLabel("Display Settings")
        display_title.setStyleSheet("""
            QLabel {
                font-size: 12pt;
                font-weight: bold;
                color: #e2e8f0;
                background-color: transparent;
            }
        """)
        display_layout.addWidget(display_title)

        display_description = QLabel(
            "Configure display-related options."
        )
        display_description.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #6d7a8a;
                background-color: transparent;
                padding: 5px;
            }
        """)
        display_description.setWordWrap(True)
        display_layout.addWidget(display_description)

        self.qr_overlay_checkbox = QCheckBox("QR Code Overlay")
        self.qr_overlay_checkbox.setChecked(self.qr_overlay_enabled)
        self.qr_overlay_checkbox.setToolTip(
            "Show a QR code of the current page URL on the bottom-right of each web view"
        )
        self.qr_overlay_checkbox.setStyleSheet("""
            QCheckBox {
                font-size: 10pt;
                color: #c1c9d4;
                background-color: transparent;
                padding: 4px;
            }
            QCheckBox::indicator {
                width: 16px;
                height: 16px;
            }
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
            flags_title.setStyleSheet("""
                QLabel {
                    font-size: 12pt;
                    font-weight: bold;
                    color: #e2e8f0;
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
                    color: #6d7a8a;
                    background-color: transparent;
                    padding: 5px;
                }
            """)
            flags_description.setWordWrap(True)
            flags_layout.addWidget(flags_description)

            self.feature_flag_checkboxes = {}
            for key, meta in FEATURE_FLAG_DEFINITIONS.items():
                checkbox = QCheckBox(meta.get("label", key))
                checkbox.setChecked(bool(self.feature_flags.get(key, meta.get("default", False))))
                if meta.get("description"):
                    checkbox.setToolTip(meta["description"])
                checkbox.setStyleSheet("""
                    QCheckBox {
                        font-size: 10pt;
                        color: #c1c9d4;
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
                    background-color: #1c2330;
                    color: #c1c9d4;
                    border: 1px solid #222a35;
                    border-radius: 6px;
                }
                QPushButton:hover {
                    background-color: #222a35;
                    color: #e2e8f0;
                }
                QPushButton:pressed {
                    background-color: #141b24;
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
                    color: #6d7a8a;
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
        if FEATURE_FLAG_DEFINITIONS:
            self.load_feature_flag_settings()

    def create_sidebar(self):
        """Create the left sidebar with tabs for Live Game and Viewers"""
        self.sidebar = QTabWidget()
        self.sidebar.setStyleSheet("""
            QTabWidget {
                background-color: #090e14;
                border-right: 1px solid #1c2330;
            }
            QTabWidget::pane {
                border: none;
                background-color: #090e14;
            }
            QTabBar::tab {
                background-color: #141b24;
                color: #c1c9d4;
                padding: 8px 16px;
                border: none;
                border-bottom: 2px solid transparent;
            }
            QTabBar::tab:selected {
                background-color: #00d6a1;
                color: #0d1117;
                border-bottom: 2px solid #00efb3;
            }
            QTabBar::tab:hover {
                background-color: #171e28;
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
                color: #6d7a8a;
                padding: 10px;
            }
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
        windows_label = QLabel("WINDOWS")
        windows_label.setStyleSheet("""
            QLabel {
                color: #6d7a8a;
                font-size: 10px;
                font-weight: bold;
                letter-spacing: 1px;
                background-color: transparent;
            }
        """)
        header_layout.addWidget(windows_label)
        header_layout.addStretch()

        sidebar_add_button = QPushButton("+")
        sidebar_add_button.setToolTip("Add Viewer")
        sidebar_add_button.setStyleSheet("""
            QPushButton {
                padding: 0px;
                background-color: transparent;
                color: #6d7a8a;
                border: none;
                font-size: 16px;
                font-weight: bold;
                min-width: 20px;
                max-width: 20px;
                min-height: 20px;
                max-height: 20px;
            }
            QPushButton:hover {
                color: #e2e8f0;
            }
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
        settings_label.setStyleSheet("""
            QLabel {
                font-size: 10pt;
                color: #6d7a8a;
                padding: 10px;
            }
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
        container = QWidget()
        # Title (24) + 5 rows (33 each) + 5 separators (1 each) = 194px
        container.setFixedHeight(194)
        container.setStyleSheet("QWidget { background-color: #090e14; }")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(8, 0, 8, 0)
        layout.setSpacing(0)

        # Section title bar (#73): "CURRENT MATCHUP" left, "Ally vs Enemy" right
        title_row = QWidget()
        title_row.setFixedHeight(24)
        title_layout = QHBoxLayout(title_row)
        title_layout.setContentsMargins(4, 0, 4, 0)
        title_layout.setSpacing(0)

        title_left = QLabel("CURRENT MATCHUP")
        title_left.setStyleSheet(
            "QLabel { font-size: 8pt; font-weight: bold; color: #c1c9d4;"
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
            "QLabel { font-size: 8pt; background-color: transparent; }"
        )
        title_right.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        title_layout.addWidget(title_left, 1)
        title_layout.addWidget(title_right, 0)
        layout.addWidget(title_row)

        self._matchup_image_cache = ChampionImageCache()
        # Each row: (ally_icon, ally_name, enemy_name, enemy_icon)
        self._matchup_rows: list[tuple[QLabel, QLabel, QLabel, QLabel]] = []
        self._matchup_data: list[tuple[str, str]] = [("", "")] * 5  # (ally, enemy)
        self._matchup_user_dirty = False  # True when user has manually reordered

        icon_size = 24
        lane_label_style = "QLabel { font-size: 8pt; color: #6d7a8a; background-color: transparent; }"
        name_style = "QLabel { font-size: 9pt; font-weight: bold; color: #e2e8f0; background-color: transparent; }"
        vs_style = "QLabel { font-size: 8pt; color: #6d7a8a; background-color: transparent; }"
        icon_style = "QLabel { background-color: transparent; }"
        separator_style = "QFrame { background-color: rgba(34, 39, 47, 128); }"
        arrow_btn_style = """
            QPushButton {
                font-size: 6pt; padding: 0px; min-width: 12px; max-width: 12px;
                min-height: 10px; max-height: 10px; background-color: transparent;
                color: #6d7a8a; border: none;
            }
            QPushButton:hover { color: #c1c9d4; }
            QPushButton:pressed { color: #e2e8f0; }
        """
        open_btn_style = """
            QPushButton {
                font-size: 9pt; padding: 0px; min-width: 18px; max-width: 18px;
                min-height: 18px; max-height: 18px; background-color: transparent;
                color: #6d7a8a; border: none;
            }
            QPushButton:hover { color: #c1c9d4; }
            QPushButton:pressed { color: #e2e8f0; }
        """

        for i in range(5):
            # Separator line between rows (#73)
            sep = QFrame()
            sep.setFrameShape(QFrame.Shape.HLine)
            sep.setFixedHeight(1)
            sep.setStyleSheet(separator_style)
            layout.addWidget(sep)

            row = QWidget()
            row.setFixedHeight(33)
            row_layout = QHBoxLayout(row)
            row_layout.setContentsMargins(4, 0, 4, 0)
            row_layout.setSpacing(4)

            # Lane label (#73)
            lane_label = QLabel(self.MATCHUP_LANE_LABELS[i])
            lane_label.setFixedWidth(44)
            lane_label.setStyleSheet(lane_label_style)
            lane_label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

            # Vertically-stacked arrow buttons (#73)
            arrow_container = QWidget()
            arrow_container.setFixedWidth(14)
            arrow_container.setStyleSheet("QWidget { background-color: transparent; }")
            arrow_layout = QVBoxLayout(arrow_container)
            arrow_layout.setContentsMargins(0, 2, 0, 2)
            arrow_layout.setSpacing(0)

            up_btn = QPushButton("↑")
            up_btn.setToolTip("Move row up")
            up_btn.setStyleSheet(arrow_btn_style)
            up_btn.clicked.connect(lambda _, idx=i: self._matchup_move_row(idx, -1))

            down_btn = QPushButton("↓")
            down_btn.setToolTip("Move row down")
            down_btn.setStyleSheet(arrow_btn_style)
            down_btn.clicked.connect(lambda _, idx=i: self._matchup_move_row(idx, 1))

            arrow_layout.addWidget(up_btn)
            arrow_layout.addWidget(down_btn)

            ally_icon = QLabel()
            ally_icon.setFixedSize(icon_size, icon_size)
            ally_icon.setStyleSheet(icon_style)

            ally_name = QLabel("-")
            ally_name.setStyleSheet(name_style)
            ally_name.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

            # VS label (#73) — no swap button
            vs_label = QLabel("VS")
            vs_label.setStyleSheet(vs_style)
            vs_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

            enemy_name = QLabel("-")
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

            # Right-side vertically-stacked arrows (#73)
            arrow_container_r = QWidget()
            arrow_container_r.setFixedWidth(14)
            arrow_container_r.setStyleSheet("QWidget { background-color: transparent; }")
            arrow_layout_r = QVBoxLayout(arrow_container_r)
            arrow_layout_r.setContentsMargins(0, 2, 0, 2)
            arrow_layout_r.setSpacing(0)

            up_btn_r = QPushButton("↑")
            up_btn_r.setToolTip("Move row up")
            up_btn_r.setStyleSheet(arrow_btn_style)
            up_btn_r.clicked.connect(lambda _, idx=i: self._matchup_move_row(idx, -1))

            down_btn_r = QPushButton("↓")
            down_btn_r.setToolTip("Move row down")
            down_btn_r.setStyleSheet(arrow_btn_style)
            down_btn_r.clicked.connect(lambda _, idx=i: self._matchup_move_row(idx, 1))

            arrow_layout_r.addWidget(up_btn_r)
            arrow_layout_r.addWidget(down_btn_r)

            row_layout.addWidget(lane_label, 0)
            row_layout.addWidget(arrow_container, 0)
            row_layout.addWidget(ally_icon, 0)
            row_layout.addWidget(ally_name, 1)
            row_layout.addWidget(vs_label, 0)
            row_layout.addWidget(enemy_name, 1)
            row_layout.addWidget(enemy_icon, 0)
            row_layout.addWidget(arrow_container_r, 0)
            row_layout.addWidget(open_btn, 0)

            layout.addWidget(row)
            self._matchup_rows.append((ally_icon, ally_name, enemy_name, enemy_icon))

        return container

    def _set_matchup_icon(self, icon_label: QLabel, champion_name: str):
        """Set a matchup row icon from champion image URL."""
        size = icon_label.width() or 24
        if not champion_name:
            icon_label.clear()
            return
        champ = self.champion_data.get_champion(champion_name)
        if not champ:
            icon_label.clear()
            return
        url = champ.get("image_url", "")
        if not url:
            icon_label.clear()
            return
        pixmap = self._matchup_image_cache.get_image(
            url,
            callback=lambda pm, lbl=icon_label, s=size: lbl.setPixmap(
                pm.scaled(s, s, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            ),
        )
        if pixmap:
            icon_label.setPixmap(
                pixmap.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            )

    def update_matchup_list(self):
        """Refresh the matchup list widget from current matchup data."""
        if not self.feature_flags.get("matchup_list", False):
            return
        for i, (ally_icon, ally_name, enemy_name, enemy_icon) in enumerate(self._matchup_rows):
            ally, enemy = self._matchup_data[i] if i < len(self._matchup_data) else ("", "")
            ally_name.setText(ally if ally else "-")
            enemy_name.setText(enemy if enemy else "-")
            self._set_matchup_icon(ally_icon, ally)
            self._set_matchup_icon(enemy_icon, enemy)

    def set_matchup_entry(self, index: int, ally: str = "", enemy: str = ""):
        """Set a single matchup row (0-4)."""
        if 0 <= index < 5:
            self._matchup_data[index] = (ally, enemy)
            self.update_matchup_list()

    def clear_matchup_list(self):
        """Clear all matchup entries."""
        self._matchup_data = [("", "")] * 5
        self._matchup_user_dirty = False
        self.update_matchup_list()

    def on_matchup_pairs_updated(self, pairs: list):
        """Handle matchup pairs update from champion detector.

        When the user has manually reordered the list (_matchup_user_dirty),
        incoming data is *merged* instead of overwriting:
        - Allies already placed by the user stay in their positions.
        - Empty enemies are filled from incoming data.
        - New allies are placed in empty rows.
        - Allies no longer present in incoming data are removed.

        Fixes #77.
        """
        if not self.feature_flags.get("matchup_list", False):
            return
        # Pad to 5 entries
        padded = list(pairs[:5])
        while len(padded) < 5:
            padded.append(("", ""))

        if self._matchup_user_dirty:
            self._merge_matchup_data(padded)
        else:
            self._matchup_data = padded
        self.update_matchup_list()

    def _merge_matchup_data(self, incoming: list[tuple[str, str]]):
        """Merge incoming matchup pairs while preserving user-arranged positions.

        - Allies already in the list keep their current row and enemy assignment.
        - If a kept ally has no enemy yet, fill it from incoming data.
        - Allies no longer in incoming are removed (row cleared).
        - New allies are placed in the first available empty row.
        """
        # Build lookup: ally -> enemy from incoming data
        incoming_map: dict[str, str] = {}
        incoming_order: list[tuple[str, str]] = []
        for ally, enemy in incoming:
            if ally:
                incoming_map[ally] = enemy
                incoming_order.append((ally, enemy))

        accounted: set[str] = set()

        # Pass 1: keep or clear existing rows
        for i in range(5):
            ally, enemy = self._matchup_data[i]
            if not ally:
                continue
            if ally in incoming_map:
                # Ally still valid – keep position; fill enemy if empty
                if not enemy and incoming_map[ally]:
                    self._matchup_data[i] = (ally, incoming_map[ally])
                accounted.add(ally)
            else:
                # Ally no longer in incoming – clear row
                self._matchup_data[i] = ("", "")

        # Pass 2: place new allies in empty rows
        for ally, enemy in incoming_order:
            if ally in accounted:
                continue
            for i in range(5):
                if not self._matchup_data[i][0]:
                    self._matchup_data[i] = (ally, enemy)
                    accounted.add(ally)
                    break

    def _matchup_move_row(self, index: int, direction: int):
        """Move a matchup row up (-1) or down (+1). (#67)"""
        target = index + direction
        if target < 0 or target >= 5:
            return
        self._matchup_data[index], self._matchup_data[target] = (
            self._matchup_data[target],
            self._matchup_data[index],
        )
        self._matchup_user_dirty = True
        self.update_matchup_list()

    def _matchup_swap_enemies(self, index: int):
        """Swap the enemy champion between row *index* and the next row. (#67)

        Allies stay fixed; only enemies are swapped.
        """
        target = index + 1
        if target >= 5:
            return
        ally_a, enemy_a = self._matchup_data[index]
        ally_b, enemy_b = self._matchup_data[target]
        self._matchup_data[index] = (ally_a, enemy_b)
        self._matchup_data[target] = (ally_b, enemy_a)
        self._matchup_user_dirty = True
        self.update_matchup_list()

    def _open_matchup_viewer(self, index: int):
        """Open a viewer with the matchup from row *index*. (#68)

        Lane is determined by row position (0=top … 4=support).
        Reuses the same logic as the Build button.
        """
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
        viewer.open_build()

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
        if key == "matchup_list" and hasattr(self, "matchup_list_widget"):
            self.matchup_list_widget.setVisible(bool(enabled))
            if enabled:
                self.update_matchup_list()
        if hasattr(self, "flags_status_label"):
            self.flags_status_label.setText(f"✓ Flag '{key}' set to {'ON' if enabled else 'OFF'} (restart may be required)")
            self.flags_status_label.setStyleSheet("""
                QLabel {
                    font-size: 9pt;
                    color: #22c55e;
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
                    color: #22c55e;
                    background-color: transparent;
                    padding: 5px;
                }
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
            self.url_status_label.setText("✗ Error: All URLs must be filled")
            self.url_status_label.setStyleSheet("""
                QLabel {
                    font-size: 9pt;
                    color: #e0342c;
                    background-color: transparent;
                    padding: 5px;
                }
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

        self.url_status_label.setText("✓ URLs saved successfully")
        self.url_status_label.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #22c55e;
                background-color: transparent;
                padding: 5px;
            }
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

        self.url_status_label.setText("✓ URLs reset to defaults")
        self.url_status_label.setStyleSheet("""
            QLabel {
                font-size: 9pt;
                color: #22c55e;
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
                background-color: #090e14;
                border-bottom: 1px solid #222a35;
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
                background-color: #1c2330;
                color: #c1c9d4;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QPushButton:hover {
                background-color: #222a35;
                color: #e2e8f0;
            }
            QPushButton:pressed {
                background-color: #141b24;
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
                background-color: #1c2330;
                color: #c1c9d4;
                border: 1px solid #222a35;
                border-radius: 6px;
            }
            QPushButton:hover {
                background-color: #222a35;
                color: #e2e8f0;
            }
            QPushButton:pressed {
                background-color: #141b24;
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
            # Force layout calculation so sizeHint returns the real height
            item_widget.adjustSize()
            item.setSizeHint(item_widget.sizeHint())
            self.viewers_list.setItemWidget(item, item_widget)

    def get_open_champion_suggestions(self, exclude_viewer: Optional[ChampionViewerWidget] = None) -> List[str]:
        """Return unique champion names currently shown across all viewers."""
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
            open_aram = self._is_aram_like_mode()

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
                            color: #00d6a1;
                            background-color: transparent;
                            padding: 5px;
                        }
                    """)
                else:
                    self.status_label.setText("✓ You have the latest version")
                    self.status_label.setStyleSheet("""
                        QLabel {
                            font-size: 10pt;
                            color: #22c55e;
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
                        color: #e0342c;
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
                    color: #e0342c;
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
                    color: #e0342c;
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
