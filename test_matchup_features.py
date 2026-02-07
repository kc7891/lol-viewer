#!/usr/bin/env python3
"""Tests for matchup-specific functionality.

These tests validate helper methods/constants used by the matchup (vs) build flow.
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


# ---------------------------------------------------------------------------
# Matchup list reorder persistence tests (#77)
# ---------------------------------------------------------------------------


def _make_window_with_matchup_data():
    """Create a minimal MainWindow stub with matchup list state initialised."""
    window = MainWindow.__new__(MainWindow)
    window.feature_flags = {"matchup_list": True}
    window._matchup_data = [("", "")] * 5
    window._matchup_user_dirty = False
    # Stub out UI refresh (no real widgets)
    window._matchup_rows = []
    window.update_matchup_list = lambda: None
    return window


def test_on_matchup_pairs_updated_overwrites_when_not_dirty():
    """Without user edits, incoming data should overwrite matchup_data."""
    window = _make_window_with_matchup_data()
    pairs = [("Ahri", "Zed"), ("Lux", "Yasuo")]
    window.on_matchup_pairs_updated(pairs)

    assert window._matchup_data[0] == ("Ahri", "Zed")
    assert window._matchup_data[1] == ("Lux", "Yasuo")
    assert window._matchup_data[2] == ("", "")


def test_on_matchup_pairs_preserves_user_reorder():
    """After a user reorder, identical champion sets should not overwrite. (#77)"""
    window = _make_window_with_matchup_data()
    # Simulate initial data from detector
    window.on_matchup_pairs_updated([("Ahri", "Zed"), ("Lux", "Yasuo")])

    # User moves row 1 up (swap rows 0 and 1)
    window._matchup_move_row(1, -1)
    assert window._matchup_data[0] == ("Lux", "Yasuo")
    assert window._matchup_data[1] == ("Ahri", "Zed")
    assert window._matchup_user_dirty is True

    # Detector fires again with the same pairs in original order
    window.on_matchup_pairs_updated([("Ahri", "Zed"), ("Lux", "Yasuo")])

    # User ordering must be preserved
    assert window._matchup_data[0] == ("Lux", "Yasuo")
    assert window._matchup_data[1] == ("Ahri", "Zed")


def test_on_matchup_pairs_merges_new_champion_into_empty_row():
    """New allies should fill empty rows while existing allies keep positions. (#77)"""
    window = _make_window_with_matchup_data()
    # Ashe arrives at row 0
    window.on_matchup_pairs_updated([("Ashe", "")])
    assert window._matchup_data[0] == ("Ashe", "")

    # User moves Ashe to row 2
    window._matchup_move_row(0, 1)  # row 0 -> row 1
    window._matchup_move_row(1, 1)  # row 1 -> row 2
    assert window._matchup_data[2] == ("Ashe", "")
    assert window._matchup_data[0] == ("", "")

    # Detector fires with Ashe + new Lux
    window.on_matchup_pairs_updated([("Ashe", "Zed"), ("Lux", "Yasuo")])

    # Ashe stays at row 2 (enemy filled in), Lux goes to first empty row (0)
    assert window._matchup_data[2] == ("Ashe", "Zed")
    assert window._matchup_data[0] == ("Lux", "Yasuo")


def test_on_matchup_pairs_removes_departed_ally():
    """Allies that disappear from incoming data should be cleared. (#77)"""
    window = _make_window_with_matchup_data()
    window.on_matchup_pairs_updated([("Ahri", "Zed"), ("Lux", "Yasuo")])
    window._matchup_move_row(1, -1)  # Lux at 0, Ahri at 1

    # Ahri is no longer in incoming, Garen replaces her
    window.on_matchup_pairs_updated([("Garen", "Zed"), ("Lux", "Yasuo")])

    # Lux stays at row 0, Ahri's row cleared, Garen fills empty row 1
    assert window._matchup_data[0] == ("Lux", "Yasuo")
    assert window._matchup_data[1] == ("Garen", "Zed")


def test_on_matchup_pairs_preserves_user_swapped_enemies():
    """User-swapped enemies should not be overwritten by detector. (#77)"""
    window = _make_window_with_matchup_data()
    window.on_matchup_pairs_updated([("Ahri", "Zed"), ("Lux", "Yasuo")])

    # User swaps enemies: Ahri vs Yasuo, Lux vs Zed
    window._matchup_swap_enemies(0)
    assert window._matchup_data[0] == ("Ahri", "Yasuo")
    assert window._matchup_data[1] == ("Lux", "Zed")

    # Detector fires with original pairing
    window.on_matchup_pairs_updated([("Ahri", "Zed"), ("Lux", "Yasuo")])

    # User's enemy swap must be preserved
    assert window._matchup_data[0] == ("Ahri", "Yasuo")
    assert window._matchup_data[1] == ("Lux", "Zed")


def test_swap_enemies_sets_dirty_flag():
    """Swapping enemies should mark the list as user-dirty. (#77)"""
    window = _make_window_with_matchup_data()
    window.on_matchup_pairs_updated([("Ahri", "Zed"), ("Lux", "Yasuo")])
    assert window._matchup_user_dirty is False

    window._matchup_swap_enemies(0)

    assert window._matchup_user_dirty is True
    assert window._matchup_data[0] == ("Ahri", "Yasuo")
    assert window._matchup_data[1] == ("Lux", "Zed")


def test_clear_matchup_list_resets_dirty_flag():
    """Clearing the matchup list should reset the dirty flag."""
    window = _make_window_with_matchup_data()
    window.on_matchup_pairs_updated([("Ahri", "Zed")])
    window._matchup_move_row(0, 1)
    assert window._matchup_user_dirty is True

    window.clear_matchup_list()

    assert window._matchup_user_dirty is False
    assert all(pair == ("", "") for pair in window._matchup_data)
