#!/usr/bin/env python3
"""
Tests for the auto reset on new match (Beta feature flag).
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
from main_window import MainWindow


@pytest.fixture(scope="session")
def qapp():
    """Create QApplication instance for tests"""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app


def _populate(window):
    window.add_viewer()
    window.add_viewer()
    window._matchup_data = [("Ashe", "Jinx")] + [("", "")] * 4
    window.pending_enemy_picks.append("Jinx")


class TestNewMatchReset:
    def test_flag_defined_and_default_off(self, qapp):
        window = MainWindow()
        assert window.feature_flags.get("auto_reset_on_new_match") is False

    def test_flag_on_resets_viewers_and_matchup(self, qapp):
        window = MainWindow()
        window.feature_flags["auto_reset_on_new_match"] = True
        _populate(window)
        assert len(window.viewers) == 2

        window.on_new_match_started()

        assert len(window.viewers) == 0
        assert window._matchup_data == [("", "")] * 5
        assert len(window.pending_enemy_picks) == 0

    def test_flag_off_changes_nothing(self, qapp):
        window = MainWindow()
        window.feature_flags["auto_reset_on_new_match"] = False
        _populate(window)

        window.on_new_match_started()

        assert len(window.viewers) == 2
        assert window._matchup_data[0] == ("Ashe", "Jinx")
        assert len(window.pending_enemy_picks) == 1
