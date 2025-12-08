#!/usr/bin/env python3
"""Tests for matchup-specific functionality."""

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


def test_get_counter_champion_suggestions_deduplicates_and_filters():
    """Counter suggestions should only include unique counter-tab champions."""

    class DummyViewer:
        def __init__(self, champion, page_type):
            self.current_champion = champion
            self.current_page_type = page_type

    window = MainWindow.__new__(MainWindow)
    window.viewers = [
        DummyViewer("ahri", "counter"),
        DummyViewer("ahri", "counter"),  # duplicate should be ignored
        DummyViewer("zed", "build"),     # not a counter tab
        DummyViewer("lux", "counter"),
    ]

    suggestions = MainWindow.get_counter_champion_suggestions(window)
    assert suggestions == ["ahri", "lux"]
