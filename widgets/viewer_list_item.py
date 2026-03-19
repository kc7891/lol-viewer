from PyQt6.QtCore import Qt, QSettings, QSize
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import QWidget, QHBoxLayout, QVBoxLayout, QLabel, QPushButton

from constants import get_ui_sizes


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
        sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 6, 8, 6)
        layout.setSpacing(8)

        # Champion icon
        self.icon_label = QLabel()
        self.icon_label.setFixedSize(sz["icon_size_sidebar"], sz["icon_size_sidebar"])
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
        self.name_label.setStyleSheet(f"""
            QLabel {{
                color: #e2e8f0;
                font-size: {sz['font_sidebar_item']};
                font-weight: bold;
                background-color: transparent;
            }}
        """)
        text_layout.addWidget(self.name_label)

        # Page type label (e.g. "BUILD", "COUNTER", "ARAM")
        page_type = (self.viewer.current_page_type or "").upper() or "BUILD"
        self.type_label = QLabel(page_type)
        self.type_label.setStyleSheet(f"""
            QLabel {{
                color: #6d7a8a;
                font-size: {sz['font_sidebar_type']};
                background-color: transparent;
            }}
        """)
        text_layout.addWidget(self.type_label)

        layout.addWidget(text_widget, 1)

        # Toggle visibility button (visible on hover only)
        toggle_glyph = "\u2212" if self.viewer.isVisible() else "+"  # − or +
        toggle_tip = "Hide viewer" if self.viewer.isVisible() else "Show viewer"
        self.toggle_button = QPushButton(toggle_glyph)
        self.toggle_button.setToolTip(toggle_tip)
        self.toggle_button.setFixedSize(sz["icon_size_sidebar_btn"], sz["icon_size_sidebar_btn"])
        self.toggle_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self.toggle_button.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                border: none;
                color: #6d7a8a;
                font-size: {sz['font_sidebar_btn']};
                font-weight: bold;
            }}
            QPushButton:hover {{
                color: #00d6a1;
            }}
        """)
        self.toggle_button.clicked.connect(self._toggle_visibility)
        self.toggle_button.setVisible(False)
        layout.addWidget(self.toggle_button)

        # Close button (visible on hover only)
        self.close_button = QPushButton(self.CLOSE_GLYPH)
        self.close_button.setToolTip("Close viewer")
        self.close_button.setFixedSize(sz["icon_size_sidebar_btn"], sz["icon_size_sidebar_btn"])
        self.close_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self.close_button.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                border: none;
                color: #6d7a8a;
                font-size: {sz['font_sidebar_btn']};
            }}
            QPushButton:hover {{
                color: #e0342c;
            }}
        """)
        self.close_button.clicked.connect(self._close_viewer)
        self.close_button.setVisible(False)
        layout.addWidget(self.close_button)

    def sizeHint(self):
        """Return size based on actual content height."""
        sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        icon_h = sz["icon_size_sidebar"]
        hint = super().sizeHint()
        min_h = icon_h + 12  # icon height + vertical margins
        if hint.height() < min_h:
            hint.setHeight(min_h)
        return hint

    def enterEvent(self, event):
        """Show toggle and close buttons on hover"""
        self.toggle_button.setVisible(True)
        self.close_button.setVisible(True)
        super().enterEvent(event)

    def leaveEvent(self, event):
        """Hide toggle and close buttons when not hovering"""
        self.toggle_button.setVisible(False)
        self.close_button.setVisible(False)
        super().leaveEvent(event)

    def _toggle_visibility(self):
        """Toggle the viewer's visibility"""
        if self.viewer.isVisible():
            self.parent_window.hide_viewer(self.viewer)
        else:
            self.viewer.show()
            if self.viewer in self.parent_window.hidden_viewers:
                self.parent_window.hidden_viewers.remove(self.viewer)
            self.parent_window.update_viewers_list()

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
        sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        icon_s = sz["icon_size_sidebar"]
        cache = self.parent_window._sidebar_image_cache
        pixmap = cache.get_image(
            url,
            callback=lambda pm, lbl=self.icon_label: lbl.setPixmap(
                pm.scaled(icon_s, icon_s, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            ),
        )
        if pixmap:
            self.icon_label.setPixmap(
                pixmap.scaled(icon_s, icon_s, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            )
