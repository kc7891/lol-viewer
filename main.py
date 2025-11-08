#!/usr/bin/env python3
"""
LoL Viewer - A simple application to view LoLAnalytics champion builds
"""
import sys
from PyQt6.QtCore import QUrl, pyqtSignal, Qt, QTimer
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLineEdit, QPushButton, QMessageBox,
    QScrollArea, QSplitter, QListWidget, QListWidgetItem, QLabel,
    QTabWidget, QStackedWidget
)
from PyQt6.QtWebEngineWidgets import QWebEngineView


class ChampionViewerWidget(QWidget):
    """Widget containing champion input, build/counter buttons, and web view"""

    close_requested = pyqtSignal(object)  # Signal to request closing this viewer
    hide_requested = pyqtSignal(object)   # Signal to request hiding this viewer
    champion_updated = pyqtSignal(object)  # Signal when champion name is updated

    def __init__(self, viewer_id: int):
        super().__init__()
        self.viewer_id = viewer_id
        self.current_champion = ""
        self.current_page_type = ""  # "build" or "counter"
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
        url = self.get_lolalytics_build_url(champion_name)
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
        url = self.get_lolalytics_counter_url(champion_name)
        self.web_view.setUrl(QUrl(url))
        self.champion_input.setFocus()
        # Notify parent window that champion name has been updated
        self.champion_updated.emit(self)

    def get_display_name(self) -> str:
        """Get display name for this viewer"""
        if self.current_champion and self.current_page_type:
            return f"{self.current_champion} | {self.current_page_type}"
        return "(Empty)"

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

        # Left sidebar with tabs
        self.create_sidebar()
        main_layout.addWidget(self.sidebar)

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
        viewer.champion_updated.connect(self.update_champion_name)

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

    def update_champion_name(self, viewer: ChampionViewerWidget):
        """Update sidebar when a viewer's champion name is changed"""
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
