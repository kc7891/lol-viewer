#!/usr/bin/env python3
"""
Test suite for LoL Viewer application
"""
import os

# Headless-friendly defaults for CI environments (no display server).
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_OPENGL", "software")
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu")
os.environ.setdefault("LOL_VIEWER_DISABLE_WEBENGINE", "1")

import pytest
from PyQt6.QtWidgets import QApplication
from main import ChampionViewerWidget, MainWindow
from champion_data import ChampionData


@pytest.fixture(scope="session")
def qapp():
    """Create QApplication instance for tests"""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app
    # No need to quit, pytest-qt handles it


@pytest.fixture
def champion_data():
    """Create ChampionData instance for tests"""
    return ChampionData()


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

    def test_widget_initialization(self, qapp, champion_data):
        """Test widget can be initialized"""
        widget = ChampionViewerWidget(0, champion_data)
        assert widget is not None
        assert widget.champion_input is not None
        assert widget.build_button is not None
        assert widget.counter_button is not None
        assert widget.web_view is not None
        assert widget.close_button is not None
        assert widget.hide_button is not None

    def test_widget_button_text(self, qapp, champion_data):
        """Test button text is correct"""
        widget = ChampionViewerWidget(0, champion_data)
        assert widget.build_button.text() == "Build"
        assert widget.counter_button.text() == "Counter"

    def test_widget_placeholder_text(self, qapp, champion_data):
        """Test input placeholder text"""
        widget = ChampionViewerWidget(0, champion_data)
        assert "Champion name" in widget.champion_input.placeholderText()

    def test_widget_display_name(self, qapp, champion_data):
        """Test widget display name"""
        widget = ChampionViewerWidget(0, champion_data)
        assert widget.get_display_name() == "View #1"
        widget.current_champion = "ashe"
        assert widget.get_display_name() == "View #1: Ashe"


class TestChampionData:
    """Tests for ChampionData class"""

    def test_champion_data_loads(self, champion_data):
        """Test champion data loads successfully"""
        assert champion_data is not None
        assert len(champion_data.champions) > 0

    def test_search_english_name(self, champion_data):
        """Test searching by English name"""
        results = champion_data.search("ashe")
        assert len(results) > 0
        assert any(r['id'] == 'ashe' for r in results)

    def test_search_japanese_name(self, champion_data):
        """Test searching by Japanese name"""
        results = champion_data.search("アッシュ")
        assert len(results) > 0
        # Ashe should be in the results
        assert any('アッシュ' in r['japanese_name'] for r in results)

    def test_search_partial_match(self, champion_data):
        """Test partial name matching"""
        results = champion_data.search("ash")
        assert len(results) > 0

    def test_search_case_insensitive(self, champion_data):
        """Test search is case insensitive"""
        results_lower = champion_data.search("ashe")
        results_upper = champion_data.search("ASHE")
        # Both should find the same champion
        assert len(results_lower) == len(results_upper)

    def test_get_champion_by_id(self, champion_data):
        """Test getting champion by ID"""
        champ = champion_data.get_champion("ashe")
        assert champ is not None
        assert champ.get('english_name') == "Ashe"

    def test_get_champion_by_english_name(self, champion_data):
        """Test getting champion by English name"""
        champ = champion_data.get_champion("Ashe")
        assert champ is not None
        assert 'english_name' in champ

    def test_champion_has_required_fields(self, champion_data):
        """Test champion data has all required fields"""
        champ = champion_data.get_champion("ashe")
        assert champ is not None
        assert 'english_name' in champ
        assert 'japanese_name' in champ
        assert 'image_url' in champ
        assert 'id' in champ


class TestMainWindow:
    """Tests for MainWindow class"""

    def test_main_window_initialization(self, qapp):
        """Test main window can be initialized"""
        window = MainWindow()
        assert window is not None
        assert window.windowTitle() == "LoL Viewer"
        assert window.champion_data is not None

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

    def test_update_viewers_list(self, qapp):
        """Test updating viewers list in sidebar"""
        window = MainWindow()
        assert window.viewers_list.count() == 2
        window.add_viewer()
        assert window.viewers_list.count() == 3

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
