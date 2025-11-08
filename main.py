#!/usr/bin/env python3
"""
LoL Viewer - A simple application to view LoLAnalytics champion builds
"""
import sys
from PyQt6.QtCore import QUrl
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLineEdit, QPushButton, QMessageBox
)
from PyQt6.QtWebEngineWidgets import QWebEngineView


class ChampionViewerWidget(QWidget):
    """Widget containing champion input, build/counter buttons, and web view"""

    def __init__(self):
        super().__init__()
        self.init_ui()

    def init_ui(self):
        """Initialize the UI components"""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        # Control panel layout
        control_layout = QHBoxLayout()
        control_layout.setSpacing(8)

        # Champion name input
        self.champion_input = QLineEdit()
        self.champion_input.setPlaceholderText("Champion name (e.g., ashe, swain)")
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

        layout.addLayout(control_layout)

        # WebView
        self.web_view = QWebEngineView()
        layout.addWidget(self.web_view)

    def open_build(self):
        """Open the LoLAnalytics build page for the entered champion"""
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        url = self.get_lolalytics_build_url(champion_name)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()

    def open_counter(self):
        """Open the LoLAnalytics counter page for the entered champion"""
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        url = self.get_lolalytics_counter_url(champion_name)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()

    @staticmethod
    def get_lolalytics_build_url(champion_name: str) -> str:
        """Generate the LoLAnalytics build URL for a given champion"""
        return f"https://lolalytics.com/lol/{champion_name}/build/"

    @staticmethod
    def get_lolalytics_counter_url(champion_name: str) -> str:
        """Generate the LoLAnalytics counter URL for a given champion"""
        return f"https://lolalytics.com/lol/{champion_name}/counters/"


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.init_ui()

    def init_ui(self):
        """Initialize the user interface"""
        self.setWindowTitle("LoL Viewer")
        self.resize(1600, 900)

        # Apply dark theme to the main window
        self.setStyleSheet("""
            QMainWindow {
                background-color: #1e1e1e;
            }
            QWidget {
                background-color: #1e1e1e;
                color: #ffffff;
            }
        """)

        # Create central widget and layout
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)
        main_layout.setSpacing(10)
        main_layout.setContentsMargins(10, 10, 10, 10)

        # Left viewer
        self.left_viewer = ChampionViewerWidget()
        main_layout.addWidget(self.left_viewer)

        # Right viewer
        self.right_viewer = ChampionViewerWidget()
        main_layout.addWidget(self.right_viewer)


def main():
    """Main entry point of the application"""
    try:
        print("Starting LoL Viewer...")
        app = QApplication(sys.argv)
        print("QApplication created")

        window = MainWindow()
        print("MainWindow created")

        window.show()
        print("Window shown")

        sys.exit(app.exec())
    except Exception as e:
        print(f"Exception caught: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
