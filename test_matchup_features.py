#!/usr/bin/env python3
"""Tests for matchup-specific functionality (FeatureFlag-gated in UI).

These tests validate the helper methods/constants that are safe to keep even when
`matchup_build` is OFF.
"""

import os

# Headless-friendly defaults for CI environments (no display server).
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_OPENGL", "software")
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu")
os.environ.setdefault("LOL_VIEWER_DISABLE_WEBENGINE", "1")
os.environ.setdefault("LOL_VIEWER_DISABLE_LCU_SERVICE", "1")
os.environ.setdefault("LOL_VIEWER_DISABLE_DIALOGS", "1")

from main import (
    ChampionViewerWidget,
    DEFAULT_MATCHUP_URL,
    MainWindow,
)


def test_matchup_url_uses_default_template():
    """Matchup URLs should fall back to the default template."""
    widget = ChampionViewerWidget.__new__(ChampionViewerWidget)
    widget.main_window = None

    url = ChampionViewerWidget.get_matchup_url(widget, "Ahri", "Zed", "middle")
    expected = (
        DEFAULT_MATCHUP_URL
        .replace("{champion_name1}", "ahri")
        .replace("{champion_name2}", "zed")
        .replace("{lane_name}", "middle")
    )

    assert url == expected


def test_matchup_url_uses_custom_template():
    """Matchup URLs should use the configured template from the main window."""

    class DummyWindow:
        matchup_url = "https://example.com/{champion_name1}-{champion_name2}-{lane_name}"

    widget = ChampionViewerWidget.__new__(ChampionViewerWidget)
    widget.main_window = DummyWindow()

    url = ChampionViewerWidget.get_matchup_url(widget, "Ahri", "Zed", "middle")
    assert url == "https://example.com/ahri-zed-middle"


def test_get_open_champion_suggestions_deduplicates_and_excludes_self():
    """Suggestions should include all other open champions (and matchup opponents)."""

    class DummyViewer:
        def __init__(self, champion, opponent=""):
            self.current_champion = champion
            self.current_opponent_champion = opponent

    window = MainWindow.__new__(MainWindow)
    viewer_self = DummyViewer("self")
    window.viewers = [
        viewer_self,
        DummyViewer("ahri", "zed"),
        DummyViewer("ahri"),  # duplicate champion should be ignored
        DummyViewer("lux"),
    ]

    suggestions = MainWindow.get_open_champion_suggestions(window, exclude_viewer=viewer_self)
    assert suggestions == ["ahri", "zed", "lux"]
