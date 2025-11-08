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


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.init_ui()

    def init_ui(self):
        """Initialize the user interface"""
        self.setWindowTitle("LoL Viewer")
        self.resize(1200, 800)

        # Create central widget and layout
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)

        # Input layout
        input_layout = QHBoxLayout()

        # Champion name input
        self.champion_input = QLineEdit()
        self.champion_input.setPlaceholderText("e.g., ashe, swain")
        self.champion_input.setStyleSheet("padding: 8px; font-size: 12pt;")
        self.champion_input.returnPressed.connect(self.open_build)
        input_layout.addWidget(self.champion_input)

        # Open button
        open_button = QPushButton("Open Build")
        open_button.setStyleSheet("padding: 8px 16px; font-size: 12pt;")
        open_button.clicked.connect(self.open_build)
        input_layout.addWidget(open_button)

        main_layout.addLayout(input_layout)

        # WebView
        self.web_view = QWebEngineView()
        main_layout.addWidget(self.web_view)

    def open_build(self):
        """Open the LoLAnalytics build page for the entered champion"""
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        url = self.get_lolalytics_url(champion_name)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.clear()
        self.champion_input.setFocus()

    @staticmethod
    def get_lolalytics_url(champion_name: str) -> str:
        """Generate the LoLAnalytics URL for a given champion"""
        return f"https://lolalytics.com/lol/{champion_name}/build/"


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
