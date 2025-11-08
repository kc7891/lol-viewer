#!/usr/bin/env python3
"""
LoL Viewer - A simple application to view LoLAnalytics champion builds
"""
import sys
from PyQt6.QtCore import QUrl, pyqtSignal, Qt
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLineEdit, QPushButton, QMessageBox,
    QScrollArea, QSplitter, QListWidget, QListWidgetItem, QLabel
)
from PyQt6.QtWebEngineWidgets import QWebEngineView


class ChampionViewerWidget(QWidget):
    """Widget containing champion input, build/counter buttons, and web view"""

    close_requested = pyqtSignal(object)  # Signal to request closing this viewer
    hide_requested = pyqtSignal(object)   # Signal to request hiding this viewer

    def __init__(self, viewer_id: int):
        super().__init__()
        self.viewer_id = viewer_id
        self.current_champion = ""
        self.init_ui()

    def init_ui(self):
        """Initialize the UI components"""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        # Header layout with close and hide buttons
        header_layout = QHBoxLayout()
        header_layout.setSpacing(4)

        # Viewer ID label
        self.id_label = QPushButton(f"View #{self.viewer_id + 1}")
        self.id_label.setStyleSheet("""
            QPushButton {
                padding: 4px 8px;
                font-size: 10pt;
                background-color: #333333;
                color: #ffffff;
                border: none;
                border-radius: 4px;
            }
        """)
        self.id_label.setEnabled(False)
        header_layout.addWidget(self.id_label)

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
        url = self.get_lolalytics_build_url(champion_name)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()

    def open_counter(self):
        """Open the LoLAnalytics counter page for the entered champion"""
        champion_name = self.champion_input.text().strip().lower()

        if not champion_name:
            QMessageBox.warning(self, "Input Error", "Please enter a champion name.")
            return

        self.current_champion = champion_name
        url = self.get_lolalytics_counter_url(champion_name)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()

    def get_display_name(self) -> str:
        """Get display name for this viewer"""
        if self.current_champion:
            return f"View #{self.viewer_id + 1}: {self.current_champion.capitalize()}"
        return f"View #{self.viewer_id + 1}"

    @staticmethod
    def get_lolalytics_build_url(champion_name: str) -> str:
        """Generate the LoLAnalytics build URL for a given champion"""
        return f"https://lolalytics.com/lol/{champion_name}/build/"

    @staticmethod
    def get_lolalytics_counter_url(champion_name: str) -> str:
        """Generate the LoLAnalytics counter URL for a given champion"""
        return f"https://lolalytics.com/lol/{champion_name}/counters/"


class MainWindow(QMainWindow):
    MAX_VIEWERS = 20  # Maximum number of viewers allowed

    def __init__(self):
        super().__init__()
        self.viewers = []  # List of all viewer widgets
        self.hidden_viewers = []  # List of hidden viewer widgets
        self.next_viewer_id = 0  # Counter for assigning viewer IDs
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

        # Left sidebar for hidden viewers
        self.create_sidebar()
        main_layout.addWidget(self.sidebar)

        # Right side layout
        right_widget = QWidget()
        right_layout = QVBoxLayout(right_widget)
        right_layout.setSpacing(0)
        right_layout.setContentsMargins(0, 0, 0, 0)

        # Top toolbar with add and close all buttons
        self.create_toolbar()
        right_layout.addWidget(self.toolbar)

        # Scroll area for viewers
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(False)
        self.scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.scroll_area.setStyleSheet("""
            QScrollArea {
                border: none;
                background-color: #1e1e1e;
            }
        """)

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

        self.scroll_area.setWidget(self.viewers_splitter)
        right_layout.addWidget(self.scroll_area)

        main_layout.addWidget(right_widget)

        # Add initial 2 viewers
        self.add_viewer()
        self.add_viewer()

    def create_sidebar(self):
        """Create the left sidebar for all viewers"""
        self.sidebar = QWidget()
        self.sidebar.setFixedWidth(200)
        self.sidebar.setStyleSheet("""
            QWidget {
                background-color: #252525;
                border-right: 1px solid #444444;
            }
        """)

        sidebar_layout = QVBoxLayout(self.sidebar)
        sidebar_layout.setSpacing(10)
        sidebar_layout.setContentsMargins(10, 10, 10, 10)

        # Title
        title_label = QLabel("Viewers")
        title_label.setStyleSheet("""
            QLabel {
                font-size: 12pt;
                font-weight: bold;
                color: #ffffff;
                padding: 5px;
            }
        """)
        sidebar_layout.addWidget(title_label)

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
        sidebar_layout.addWidget(self.viewers_list)

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
                padding: 10px 20px;
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
        self.close_all_button.clicked.connect(self.close_all_viewers)
        toolbar_layout.addWidget(self.close_all_button)

        # Add viewer button
        self.add_button = QPushButton("＋ Add Viewer")
        self.add_button.setStyleSheet("""
            QPushButton {
                padding: 10px 20px;
                font-size: 11pt;
                font-weight: bold;
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
        self.add_button.clicked.connect(self.add_viewer)
        toolbar_layout.addWidget(self.add_button)

    def add_viewer(self):
        """Add a new viewer widget"""
        if len(self.viewers) >= self.MAX_VIEWERS:
            QMessageBox.warning(
                self,
                "Maximum Viewers Reached",
                f"You can only have up to {self.MAX_VIEWERS} viewers."
            )
            return

        # Create new viewer
        viewer = ChampionViewerWidget(self.next_viewer_id)
        self.next_viewer_id += 1

        # Connect signals
        viewer.close_requested.connect(self.close_viewer)
        viewer.hide_requested.connect(self.hide_viewer)

        # Add to splitter
        self.viewers_splitter.addWidget(viewer)
        self.viewers.append(viewer)

        # Set initial size for the new viewer
        sizes = self.viewers_splitter.sizes()
        if len(sizes) > 1:
            # Distribute space evenly among all viewers
            new_sizes = [500] * len(sizes)
            self.viewers_splitter.setSizes(new_sizes)

        # Update sidebar list
        self.update_viewers_list()

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
        if 0 <= index < len(self.viewers):
            viewer = self.viewers[index]
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

    def update_viewers_list(self):
        """Update the list of all viewers in the sidebar"""
        self.viewers_list.clear()
        for viewer in self.viewers:
            display_name = viewer.get_display_name()
            if not viewer.isVisible():
                display_name = f"[Hidden] {display_name}"
            item = QListWidgetItem(display_name)
            self.viewers_list.addItem(item)

    def close_all_viewers(self):
        """Close all viewer widgets"""
        # Create a copy of the list to avoid modification during iteration
        viewers_copy = self.viewers.copy()
        for viewer in viewers_copy:
            self.close_viewer(viewer)


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
