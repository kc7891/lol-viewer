from PyQt6.QtCore import Qt, QTimer, QSettings
from PyQt6.QtWidgets import QWidget, QHBoxLayout, QLabel

from constants import get_ui_sizes


class LCUConnectionStatusWidget(QWidget):
    """Widget displaying LCU connection status with animated dots"""

    def __init__(self):
        super().__init__()
        self.current_status = "connecting"
        self.dot_count = 1  # For animating dots (1, 2, 3)
        self._sz = get_ui_sizes()
        self.init_ui()

        # Timer for dot animation (500ms interval)
        self.animation_timer = QTimer()
        self.animation_timer.timeout.connect(self.update_dots)
        self.animation_timer.start(500)

    def init_ui(self):
        """Initialize the UI"""
        sz = get_ui_sizes(QSettings("LoLViewer", "LoLViewer").value("display/ui_size", "medium"))
        self.setFixedHeight(sz["height_lcu_status"])
        self.setStyleSheet("""
            QWidget {
                background-color: #090e14;
                border-top: 1px solid #1c2330;
            }
        """)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 0, 10, 0)

        # Inner container for vertically centering content
        self.inner_container = QWidget()
        self.inner_container.setFixedHeight(sz["height_dot_container"])
        self.inner_container.setStyleSheet("QWidget { border: none; }")
        inner_layout = QHBoxLayout(self.inner_container)
        inner_layout.setContentsMargins(0, 0, 0, 0)
        inner_layout.setSpacing(6)

        # Green/yellow/red dot indicator
        self.dot_label = QLabel("\u25cf")
        self.dot_label.setFixedSize(sz["width_dot_indicator"], sz["height_dot_indicator"])
        self.dot_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.dot_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_sidebar_type']};
                color: #6d7a8a;
                background-color: transparent;
                border: none;
            }}
        """)
        inner_layout.addWidget(self.dot_label)

        # Status text
        self.status_label = QLabel("Riot API: Connecting")
        self.status_label.setStyleSheet(f"""
            QLabel {{
                font-size: {sz['font_sidebar_type']};
                color: #6d7a8a;
                background-color: transparent;
                border: none;
            }}
        """)
        inner_layout.addWidget(self.status_label, 1)

        layout.addWidget(self.inner_container)

    def _apply_status_color(self, color: str):
        """Apply color to all status indicator elements"""
        self.dot_label.setStyleSheet(f"""
            QLabel {{
                font-size: {self._sz['font_sidebar_type']};
                color: {color};
                background-color: transparent;
                border: none;
            }}
        """)
        self.status_label.setStyleSheet(f"""
            QLabel {{
                font-size: {self._sz['font_sidebar_type']};
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

    def update_sizes(self, sz):
        """Update sizes based on UI size preset."""
        self._sz = sz
        self.setFixedHeight(sz["height_lcu_status"])
        if hasattr(self, "inner_container"):
            self.inner_container.setFixedHeight(sz["height_dot_container"])
        if hasattr(self, "dot_label"):
            self.dot_label.setFixedSize(sz["width_dot_indicator"], sz["height_dot_indicator"])
        self._apply_status_color(
            "#00d6a1" if self.current_status == "connected"
            else "#e0342c" if self.current_status == "disconnected"
            else "#6d7a8a"
        )
