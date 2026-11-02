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
    def test_no_feature_flag_defined(self, qapp):
        window = MainWindow()
        assert "auto_reset_on_new_match" not in window.feature_flags

    def test_new_match_resets_viewers_and_matchup(self, qapp):
        window = MainWindow()
        _populate(window)
        assert len(window.viewers) == 2

        window.on_new_match_started()

        assert len(window.viewers) == 0
        assert window._matchup_data == [("", "")] * 5
        assert len(window.pending_enemy_picks) == 0

    def test_detection_enabled_by_default(self, qapp):
        window = MainWindow()
        assert window.champion_detector.new_match_detection_enabled is True
        assert window.champion_detector.detector.new_match_detection_enabled is True
