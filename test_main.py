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
        widget = ChampionViewerWidget()
        assert widget is not None
        assert widget.champion_input is not None
        assert widget.build_button is not None
        assert widget.counter_button is not None
        assert widget.web_view is not None

    def test_widget_button_text(self, qapp):
        """Test button text is correct"""
        widget = ChampionViewerWidget()
        assert widget.build_button.text() == "Build"
        assert widget.counter_button.text() == "Counter"

    def test_widget_placeholder_text(self, qapp):
        """Test input placeholder text"""
        widget = ChampionViewerWidget()
        assert "Champion name" in widget.champion_input.placeholderText()


class TestMainWindow:
    """Tests for MainWindow class"""

    def test_main_window_initialization(self, qapp):
        """Test main window can be initialized"""
        window = MainWindow()
        assert window is not None
        assert window.windowTitle() == "LoL Viewer"

    def test_main_window_has_two_viewers(self, qapp):
        """Test main window has left and right viewers"""
        window = MainWindow()
        assert window.left_viewer is not None
        assert window.right_viewer is not None
        assert isinstance(window.left_viewer, ChampionViewerWidget)
        assert isinstance(window.right_viewer, ChampionViewerWidget)

    def test_main_window_size(self, qapp):
        """Test main window has correct initial size"""
        window = MainWindow()
        assert window.width() == 1600
        assert window.height() == 900
