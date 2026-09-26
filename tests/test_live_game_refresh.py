#!/usr/bin/env python3
"""
Tests for the Live Game tab right-click "Refresh" context menu.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Headless-friendly defaults for CI environments (no display server).
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_OPENGL", "software")
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu")
os.environ.setdefault("LOL_VIEWER_DISABLE_WEBENGINE", "1")
os.environ.setdefault("LOL_VIEWER_DISABLE_LCU_SERVICE", "1")
os.environ.setdefault("LOL_VIEWER_DISABLE_DIALOGS", "1")

import pytest
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt, QUrl
from constants import DEFAULT_LIVE_GAME_URL
from main_window import MainWindow


@pytest.fixture(scope="session")
def qapp():
    """Create QApplication instance for tests"""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app
    # No need to quit, pytest-qt handles it


class TestLiveGameRefresh:
    """Tests for the Live Game tab's right-click Refresh menu"""

    def test_refresh_live_game_page_reopens_configured_url(self, qapp):
        """refresh_live_game_page() reloads the web view with the configured URL"""
        window = MainWindow()
        window.live_game_web_view._last_url = None
        window.refresh_live_game_page()
        expected = window.live_game_url or DEFAULT_LIVE_GAME_URL
        assert window.live_game_web_view._last_url == QUrl(expected)

    def test_create_menu_for_live_game_tab_has_refresh_action(self, qapp):
        """_create_sidebar_tab_menu returns a menu with only a Refresh action for Live Game"""
        window = MainWindow()
        menu = window._create_sidebar_tab_menu(window.live_game_tab_index)
        assert menu is not None
        assert [a.text() for a in menu.actions()] == ["Refresh"]

    def test_create_menu_returns_none_for_other_tabs(self, qapp):
        """_create_sidebar_tab_menu returns None for non-Live-Game tabs and invalid index"""
        window = MainWindow()
        viewers_tab_index = next(
            i for i in range(window.sidebar.count())
            if window.sidebar.tabText(i) == "Viewers"
        )
        assert window._create_sidebar_tab_menu(viewers_tab_index) is None
        assert window._create_sidebar_tab_menu(window.settings_tab_index) is None
        assert window._create_sidebar_tab_menu(-1) is None

    def test_menu_refresh_action_triggers_reload(self, qapp):
        """Triggering the Refresh action reloads the Live Game web view"""
        window = MainWindow()
        window.live_game_web_view._last_url = None
        menu = window._create_sidebar_tab_menu(window.live_game_tab_index)
        assert menu is not None
        refresh_action = menu.actions()[0]
        refresh_action.trigger()
        expected = window.live_game_url or DEFAULT_LIVE_GAME_URL
        assert window.live_game_web_view._last_url == QUrl(expected)

    def test_tab_bar_has_custom_context_menu_policy(self, qapp):
        """The sidebar tab bar is configured for a custom right-click context menu"""
        window = MainWindow()
        assert (
            window.sidebar.tabBar().contextMenuPolicy()
            == Qt.ContextMenuPolicy.CustomContextMenu
        )
