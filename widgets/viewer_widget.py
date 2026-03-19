import logging
import os

from PyQt6.QtCore import QUrl, pyqtSignal, Qt, QTimer, QSettings, QByteArray, QSize
from PyQt6.QtGui import QColor, QIcon, QPixmap
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout,
    QHBoxLayout, QLineEdit, QPushButton,
    QScrollArea, QLabel,
    QTabWidget, QStackedWidget, QComboBox, QCheckBox, QButtonGroup, QFrame,
    QListWidget, QListWidgetItem, QMessageBox,
)

from constants import (
    __version__, DEFAULT_BUILD_URL, DEFAULT_COUNTER_URL,
    DEFAULT_MATCHUP_URL, DEFAULT_ARAM_URL,
    CLOSE_BUTTON_GLYPH, FEATURE_FLAG_DEFINITIONS,
    ARAM_QUEUE_IDS, ARAM_MAYHEM_QUEUE_IDS,
    get_ui_sizes,
)
from widgets.webview_utils import NullWebView, QrCodeOverlay, _install_qr_overlay, _webengine_disabled
from champion_data import ChampionData, ChampionImageCache, setup_champion_input, setup_opponent_champion_input
from logger import log

logger = logging.getLogger(__name__)

from typing import List, Optional

from PyQt6.QtWebEngineWidgets import QWebEngineView


class ChampionViewerWidget(QWidget):
    """Widget containing champion input, build/counter buttons, and web view"""

    close_requested = pyqtSignal(object)  # Signal to request closing this viewer
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

    def _get_ui_sizes(self) -> dict:
        """Return the active UI size preset for this viewer."""
        size_name = "small"
        if self.main_window:
            size_name = QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium")
        return get_ui_sizes(size_name)

    def init_ui(self):
        """Initialize the UI components

        Layout:
        ┌────────────────────────────────────────────────────┐
        │ [icon] [Champion▾] vs [Opponent▾]    [Lane▾]       │  Header
        ├────────────────────────────────────────────────────┤
        │ [Build][Counter][ARAM]                              │  Control bar
        ├────────────────────────────────────────────────────┤
        │ WebView  /  Champion Selector                      │  Content
        └────────────────────────────────────────────────────┘
        """
        sz = self._get_ui_sizes()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Image cache (must init before UI elements that use it)
        self._champion_icon_cache = ChampionImageCache()

        # -- Shared pill style (used in header for champion/opponent/lane) --
        selector_pill_style = f"""
            QPushButton {{
                padding: {sz['padding_pill']};
                font-size: {sz['font_pill']};
                background-color: #1c2330;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: {sz['border_radius']};
                text-align: left;
            }}
            QPushButton:hover {{
                background-color: #222a35;
                border-color: #00d6a1;
            }}
        """
        self._selector_pill_style = selector_pill_style

        # ── Header: [icon] [Champion▾] vs [Opponent▾]  <stretch>  [Lane▾] ──
        header_widget = QWidget()
        header_widget.setStyleSheet("QWidget { background-color: #141b24; }")
        header_widget.setFixedHeight(sz["height_header"])
        header_layout = QHBoxLayout(header_widget)
        # 左寄せを保ちつつ、上下の余白とウィジェット間の詰まり具合を微調整
        header_layout.setContentsMargins(6, 6, 6, 4)
        header_layout.setSpacing(4)

        # Close button for this viewer
        self._header_close_btn = QPushButton(CLOSE_BUTTON_GLYPH)
        self._header_close_btn.setFixedSize(sz["icon_size_close_btn"], sz["icon_size_close_btn"])
        self._header_close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._header_close_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent;
                border: none;
                color: #888;
                font-size: {sz["font_close_btn"]};
                border-radius: {sz["border_radius"]};
            }}
            QPushButton:hover {{
                background: transparent;
                color: #e0342c;
            }}
        """)
        self._header_close_btn.setToolTip("Close this viewer")
        self._header_close_btn.clicked.connect(lambda: self.close_requested.emit(self))
        header_layout.addWidget(self._header_close_btn)

        pill_icon = sz["icon_size_pill"]
        self._champion_selector_btn = QPushButton("Champion \u25BE")
        self._champion_selector_btn.setStyleSheet(selector_pill_style)
        self._champion_selector_btn.setIconSize(QSize(pill_icon, pill_icon))
        self._champion_selector_btn.clicked.connect(lambda: self._open_champion_selector("champion"))
        header_layout.addWidget(self._champion_selector_btn)

        self._header_vs_label = QLabel("vs")
        self._header_vs_label.setStyleSheet(
            f"QLabel {{ font-size: {sz['font_pill']}; color: #6d7a8a; background-color: transparent; margin: 0 2px; }}"
        )
        self._header_vs_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        header_layout.addWidget(self._header_vs_label)

        self._opponent_selector_btn = QPushButton("Opponent \u25BE")
        self._opponent_selector_btn.setStyleSheet(selector_pill_style)
        self._opponent_selector_btn.setIconSize(QSize(pill_icon, pill_icon))
        self._opponent_selector_btn.clicked.connect(lambda: self._open_champion_selector("opponent"))
        header_layout.addWidget(self._opponent_selector_btn)

        self._lane_selector_btn = QPushButton("Lane \u25BE")
        self._lane_selector_btn.setStyleSheet(selector_pill_style)
        self._lane_selector_btn.clicked.connect(lambda: self._open_champion_selector("lane"))
        header_layout.addWidget(self._lane_selector_btn)
        # 右側にのみ余白を集めて、ボタン群をきれいに左寄せにする
        header_layout.addStretch()

        layout.addWidget(header_widget)
        self._header_widget = header_widget

        # ── Control bar: [Build][Counter][ARAM] ──
        control_bar = QWidget()
        control_bar.setStyleSheet("QWidget { background-color: #0d1117; }")
        control_bar.setFixedHeight(sz["height_control_bar"])
        cb_layout = QHBoxLayout(control_bar)
        cb_layout.setContentsMargins(4, 0, 4, 0)
        cb_layout.setSpacing(0)

        # -- Mode tab style --
        mode_tab_checked = f"""
            QPushButton {{
                padding: {sz['padding_btn']};
                font-size: {sz['font_mode_btn']};
                font-weight: bold;
                background-color: #00d6a1;
                color: #0d1117;
                border: none;
                border-radius: {sz['border_radius']};
                margin: {sz['margin_mode_btn']};
            }}
            QPushButton:hover {{ background-color: #00efb3; }}
        """
        mode_tab_unchecked = f"""
            QPushButton {{
                padding: {sz['padding_btn']};
                font-size: {sz['font_mode_btn']};
                background-color: transparent;
                color: #6d7a8a;
                border: none;
                border-radius: {sz['border_radius']};
                margin: {sz['margin_mode_btn']};
            }}
            QPushButton:hover {{ background-color: #1c2330; color: #e2e8f0; }}
            QPushButton:checked {{
                font-weight: bold;
                background-color: #00d6a1;
                color: #0d1117;
            }}
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

        cb_layout.addStretch()
        layout.addWidget(control_bar)
        self._control_bar = control_bar

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

        self._completer_initialized = False

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
        sz = self._get_ui_sizes()
        panel = QWidget()
        panel.setStyleSheet("QWidget { background-color: #1c2330; }")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(12, 8, 12, 8)
        panel_layout.setSpacing(6)

        # Header row: "SELECT CHAMPION" + close button
        header_row = QHBoxLayout()
        header_row.setContentsMargins(0, 0, 0, 0)
        select_label = QLabel("SELECT CHAMPION")
        select_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_small']};
                font-weight: bold;
                color: #6d7a8a;
                background-color: transparent;
                letter-spacing: 1px;
                padding: 2px 0;
            }}
        """)
        header_row.addStretch()
        header_row.addWidget(select_label)
        header_row.addStretch()

        close_btn = QPushButton(CLOSE_BUTTON_GLYPH)
        close_btn.setFixedSize(sz["icon_size_close_btn"], sz["icon_size_close_btn"])
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                border: none;
                color: #6d7a8a;
                font-size: {sz['font_close_btn']};
                font-weight: bold;
            }}
            QPushButton:hover {{ color: #e2e8f0; }}
        """)
        close_btn.clicked.connect(lambda: self.viewer_content_stack.setCurrentIndex(0))
        header_row.addWidget(close_btn)
        panel_layout.addLayout(header_row)

        # Search field
        self._champion_search_input = QLineEdit()
        self._champion_search_input.setPlaceholderText("Search...")
        self._champion_search_input.setStyleSheet(f"""
            QLineEdit {{
                padding: {sz['padding_search']};
                font-size: {sz['font_selector_item']};
                background-color: #141b24;
                color: #e2e8f0;
                border: 1px solid #222a35;
                border-radius: {sz['border_radius']};
            }}
            QLineEdit:focus {{
                border: 1px solid #00d6a1;
            }}
        """)
        self._champion_search_input.textChanged.connect(self._filter_champion_list)
        self._champion_search_input.installEventFilter(self)
        panel_layout.addWidget(self._champion_search_input)

        # Champion list
        icon_sz = sz["icon_size_selector"]
        self._champion_list_widget = QListWidget()
        self._champion_list_widget.setStyleSheet(f"""
            QListWidget {{
                background-color: #141b24;
                border: none;
                border-radius: {sz['border_radius']};
                color: #e2e8f0;
                outline: none;
            }}
            QListWidget::item {{
                padding: {sz['padding_selector_item']};
            }}
            QListWidget::item:hover {{
                background-color: #1c2330;
            }}
            QListWidget::item:selected {{
                background-color: #00d6a1;
                color: #0d1117;
            }}
        """)
        self._champion_list_widget.setIconSize(QSize(icon_sz, icon_sz))
        self._champion_list_widget.itemClicked.connect(self._on_champion_list_item_clicked)
        panel_layout.addWidget(self._champion_list_widget)

        self._populate_champion_list()
        return panel

    def _populate_champion_list(self):
        """Populate the champion list widget with all champions and icons."""
        self._champion_list_widget.clear()
        if not self.champion_data:
            return

        icon_sz = self._get_ui_sizes()["icon_size_selector"]

        def _safe_set_icon(it, px):
            """Set icon on item, ignoring if the C++ object was already deleted."""
            try:
                it.setIcon(QIcon(px.scaled(
                    icon_sz, icon_sz, Qt.AspectRatioMode.KeepAspectRatio,
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

    def _get_enemy_picked_champion_ids(self) -> set:
        """Return set of champion IDs (lowercase) picked by the enemy team."""
        if not self.main_window or not hasattr(self.main_window, "champion_detector"):
            return set()
        names = self.main_window.champion_detector.get_detected_enemy_champion_names()
        return {n.lower() for n in names}

    def _get_opponent_suggestion_ids(self) -> set:
        """Return champion IDs (lowercase) to suggest in the opponent selector.

        Sources (in priority order):
        1. Enemy-picked champions from the detector.
        2. Enemies from the matchup-list data.
        3. Fallback: champion names currently shown in other viewer tabs.
        """
        ids = self._get_enemy_picked_champion_ids()

        # Also include enemies from matchup data
        if self.main_window and hasattr(self.main_window, "_matchup_data"):
            for _ally, enemy in self.main_window._matchup_data:
                if enemy:
                    ids.add(enemy.lower())

        if ids:
            return ids

        # Fallback: champion names from other viewer tabs
        suggestions = self._get_open_champion_suggestions()
        return {s.lower() for s in suggestions if s}

    def _filter_champion_list(self, text: str):
        """Filter the champion list based on search text.

        When in opponent mode with no search text, show enemy-picked champions
        (or champions from other tabs as a fallback).
        When searching, show all champions matching the prefix.
        """
        search = text.strip().lower()
        is_opponent = self._active_selector_target == "opponent"
        enemy_ids = self._get_opponent_suggestion_ids() if is_opponent and not search else set()

        for i in range(self._champion_list_widget.count()):
            item = self._champion_list_widget.item(i)
            champ_id = item.data(Qt.ItemDataRole.UserRole) or ""

            # "None" item is always visible
            if champ_id == "":
                item.setHidden(False)
                continue

            if is_opponent and not search:
                # No search text in opponent mode: show only enemy-picked champions
                item.setHidden(champ_id.lower() not in enemy_ids)
            elif search:
                # Search mode: prefix match on display name, champ id, or jp name
                display_name = item.text().lower()
                visible = display_name.startswith(search) or champ_id.lower().startswith(search)
                if not visible and self.champion_data:
                    champ_info = self.champion_data.champions.get(champ_id, {})
                    jp_name = (champ_info.get("japanese_name") or "").lower()
                    if jp_name.startswith(search):
                        visible = True
                item.setHidden(not visible)
            else:
                # Ally mode, no search: show all
                item.setHidden(False)

    def _create_lane_selector_panel(self) -> QWidget:
        """Create the lane selector panel: SELECT LANE header + lane list."""
        sz = self._get_ui_sizes()
        panel = QWidget()
        panel.setStyleSheet("QWidget { background-color: #1c2330; }")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(12, 8, 12, 8)
        panel_layout.setSpacing(6)

        # Header row: "SELECT LANE" + close button
        header_row = QHBoxLayout()
        header_row.setContentsMargins(0, 0, 0, 0)
        select_label = QLabel("SELECT LANE")
        select_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_small']};
                font-weight: bold;
                color: #6d7a8a;
                background-color: transparent;
                letter-spacing: 1px;
                padding: 2px 0;
            }}
        """)
        header_row.addStretch()
        header_row.addWidget(select_label)
        header_row.addStretch()

        close_btn = QPushButton(CLOSE_BUTTON_GLYPH)
        close_btn.setFixedSize(sz["icon_size_close_btn"], sz["icon_size_close_btn"])
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                border: none;
                color: #6d7a8a;
                font-size: {sz['font_close_btn']};
                font-weight: bold;
            }}
            QPushButton:hover {{ color: #e2e8f0; }}
        """)
        close_btn.clicked.connect(lambda: self.viewer_content_stack.setCurrentIndex(0))
        header_row.addWidget(close_btn)
        panel_layout.addLayout(header_row)

        self._lane_list_widget = QListWidget()
        self._lane_list_widget.setStyleSheet(f"""
            QListWidget {{
                background-color: #141b24;
                border: none;
                border-radius: {sz['border_radius']};
                color: #e2e8f0;
                outline: none;
            }}
            QListWidget::item {{
                padding: {sz['padding_lane_item']};
                font-size: {sz['font_lane_item']};
            }}
            QListWidget::item:hover {{
                background-color: #1c2330;
            }}
            QListWidget::item:selected {{
                background-color: #00d6a1;
                color: #0d1117;
            }}
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

    def _ensure_completer_initialized(self):
        """Lazily initialize autocomplete on first use to avoid UI freeze."""
        if self._completer_initialized:
            return
        self._completer_initialized = True
        if self.champion_data:
            setup_champion_input(self.champion_input, self.champion_data)
            setup_opponent_champion_input(
                self.opponent_champion_input,
                self.champion_data,
                suggestion_provider=self._get_open_champion_suggestions,
            )

    def _open_champion_selector(self, target: str):
        """Open champion/lane selector panel for the given target."""
        self._ensure_completer_initialized()
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
        """Update the header icon (pill buttons are updated separately)."""
        pass

    def _update_champion_selector_btn(self, champ_id: str):
        """Update the champion selector pill button text and icon."""
        display = self._get_display_name(champ_id) or "Champion"
        self._champion_selector_btn.setText(f"{display} \u25BE")
        sz = self._get_ui_sizes()
        self._set_btn_champion_icon(self._champion_selector_btn, champ_id, sz["icon_size_pill"])

    def _update_opponent_selector_btn(self, champ_id: str):
        """Update the opponent selector pill button text and icon."""
        display = self._get_display_name(champ_id) or "Opponent"
        self._opponent_selector_btn.setText(f"{display} \u25BE")
        sz = self._get_ui_sizes()
        self._set_btn_champion_icon(self._opponent_selector_btn, champ_id, sz["icon_size_pill"])

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

    def _close_selector_if_open(self) -> bool:
        """Close any open selector panel. Returns True if a selector was closed."""
        if hasattr(self, "viewer_content_stack") and self.viewer_content_stack.currentIndex() != 0:
            self.viewer_content_stack.setCurrentIndex(0)
            return True
        return False

    def keyPressEvent(self, event):
        """Close selector panels on Escape key."""
        if event.key() == Qt.Key.Key_Escape:
            if self._close_selector_if_open():
                event.accept()
                return
        super().keyPressEvent(event)

    def mousePressEvent(self, event):
        """Close selector panels when clicking outside them."""
        if hasattr(self, "viewer_content_stack") and self.viewer_content_stack.currentIndex() != 0:
            # Check if click is outside the selector panel area
            current_panel = self.viewer_content_stack.currentWidget()
            if current_panel is not None:
                panel_rect = current_panel.geometry()
                stack_pos = self.viewer_content_stack.mapTo(self, self.viewer_content_stack.rect().topLeft())
                global_panel_rect = panel_rect.translated(stack_pos)
                if not global_panel_rect.contains(event.pos()):
                    self._close_selector_if_open()
                    event.accept()
                    return
        super().mousePressEvent(event)

    def eventFilter(self, obj, event):
        """Catch Escape key in child widgets (e.g. search input) to close selectors."""
        from PyQt6.QtCore import QEvent
        if event.type() == QEvent.Type.KeyPress and event.key() == Qt.Key.Key_Escape:
            if self._close_selector_if_open():
                return True
        return super().eventFilter(obj, event)

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
        # If an opponent/counter champion is associated with this viewer,
        # append a "vs <name>" suffix for clearer sidebar labels.
        opponent_raw = (self.current_opponent_champion or "").strip()
        if opponent_raw:
            opponent_id = opponent_raw.lower()
            opponent_display = self._get_display_name(opponent_id)
            if opponent_display:
                parts.append(f"vs {opponent_display}")
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
