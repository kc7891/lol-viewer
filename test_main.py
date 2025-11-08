#!/usr/bin/env python3
"""
Test suite for LoL Viewer application
"""
import pytest
from PyQt6.QtWidgets import QApplication
from main import ChampionViewerWidget, MainWindow


@pytest.fixture(scope="session")
def qapp():
    """Create QApplication instance for tests"""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app
    # No need to quit, pytest-qt handles it


class TestChampionViewerWidget:
    """Tests for ChampionViewerWidget class"""

    def test_get_lolalytics_build_url(self):
        """Test build URL generation"""
        url = ChampionViewerWidget.get_lolalytics_build_url("ashe")
        assert url == "https://lolalytics.com/lol/ashe/build/"

    def test_get_lolalytics_build_url_uppercase(self):
        """Test build URL generation with uppercase input"""
        url = ChampionViewerWidget.get_lolalytics_build_url("ASHE")
        assert url == "https://lolalytics.com/lol/ASHE/build/"

    def test_get_lolalytics_counter_url(self):
        """Test counter URL generation"""
        url = ChampionViewerWidget.get_lolalytics_counter_url("swain")
        assert url == "https://lolalytics.com/lol/swain/counters/"

    def test_get_lolalytics_counter_url_uppercase(self):
        """Test counter URL generation with uppercase input"""
        url = ChampionViewerWidget.get_lolalytics_counter_url("SWAIN")
        assert url == "https://lolalytics.com/lol/SWAIN/counters/"

    def test_widget_initialization(self, qapp):
        """Test widget can be initialized"""
        widget = ChampionViewerWidget(0)
        assert widget is not None
        assert widget.champion_input is not None
        assert widget.build_button is not None
        assert widget.counter_button is not None
        assert widget.web_view is not None
        assert widget.close_button is not None
        assert widget.hide_button is not None

    def test_widget_button_text(self, qapp):
        """Test button text is correct"""
        widget = ChampionViewerWidget(0)
        assert widget.build_button.text() == "Build"
        assert widget.counter_button.text() == "Counter"

    def test_widget_placeholder_text(self, qapp):
        """Test input placeholder text"""
        widget = ChampionViewerWidget(0)
        assert "Champion name" in widget.champion_input.placeholderText()

    def test_widget_display_name(self, qapp):
        """Test widget display name"""
        widget = ChampionViewerWidget(0)
        assert widget.get_display_name() == "View #1"
        widget.current_champion = "ashe"
        assert widget.get_display_name() == "View #1: Ashe"


class TestMainWindow:
    """Tests for MainWindow class"""

    def test_main_window_initialization(self, qapp):
        """Test main window can be initialized"""
        window = MainWindow()
        assert window is not None
        assert window.windowTitle() == "LoL Viewer"

    def test_main_window_has_initial_viewers(self, qapp):
        """Test main window has initial 2 viewers"""
        window = MainWindow()
        assert len(window.viewers) == 2
        assert all(isinstance(v, ChampionViewerWidget) for v in window.viewers)

    def test_main_window_size(self, qapp):
        """Test main window has correct initial size"""
        window = MainWindow()
        assert window.width() == 1600
        assert window.height() == 900

    def test_add_viewer(self, qapp):
        """Test adding a new viewer"""
        window = MainWindow()
        initial_count = len(window.viewers)
        window.add_viewer()
        assert len(window.viewers) == initial_count + 1

    def test_close_viewer(self, qapp):
        """Test closing a viewer"""
        window = MainWindow()
        initial_count = len(window.viewers)
        viewer_to_close = window.viewers[0]
        window.close_viewer(viewer_to_close)
        assert len(window.viewers) == initial_count - 1

    def test_hide_viewer(self, qapp):
        """Test hiding a viewer"""
        window = MainWindow()
        viewer_to_hide = window.viewers[0]
        window.hide_viewer(viewer_to_hide)
        assert viewer_to_hide in window.hidden_viewers
        assert not viewer_to_hide.isVisible()

    def test_close_all_viewers(self, qapp):
        """Test closing all viewers"""
        window = MainWindow()
        window.close_all_viewers()
        assert len(window.viewers) == 0

    def test_max_viewers_limit(self, qapp):
        """Test maximum viewers limit"""
        window = MainWindow()
        # Add viewers up to the limit
        while len(window.viewers) < MainWindow.MAX_VIEWERS:
            window.add_viewer()
        assert len(window.viewers) == MainWindow.MAX_VIEWERS

        # Try to add one more (should be rejected)
        initial_count = len(window.viewers)
        window.add_viewer()
        assert len(window.viewers) == initial_count
