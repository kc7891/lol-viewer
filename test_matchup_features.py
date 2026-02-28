#!/usr/bin/env python3
"""Tests for matchup-specific functionality.

These tests validate helper methods/constants used by the matchup (vs) build flow,
and the redesigned matchup list logic (incremental fill, no auto-clear).
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
# Helper: create a minimal MainWindow stub with matchup list state
# ---------------------------------------------------------------------------


def _make_window():
    """Create a minimal MainWindow stub with matchup list state initialised."""
    window = MainWindow.__new__(MainWindow)
    window.feature_flags = {"matchup_list": True}
    window._matchup_data = [("", "")] * 5
    # Stub out UI refresh (no real widgets)
    window._matchup_rows = []
    window.update_matchup_list = lambda: None
    return window


def _make_window_with_champion_data():
    """Create a MainWindow stub with champion data for lane aptitude testing."""
    from champion_data import ChampionData

    window = _make_window()
    window.champion_data = ChampionData()
    return window


def _emit(window, allies=None, enemies=None, phase="ChampSelect", is_new_session=False):
    """Simulate a matchup_data_updated signal."""
    data = {
        "allies": allies or [],
        "enemies": enemies or [],
        "phase": phase,
        "is_new_session": is_new_session,
    }
    window.on_matchup_data_updated(data)


# ---------------------------------------------------------------------------
# Ally placement tests
# ---------------------------------------------------------------------------


def test_ally_placed_by_lane():
    """Allies with lane info should be placed in the corresponding row."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle"), ("Garen", "top")])

    assert window._matchup_data[0] == ("Garen", "")  # top → row 0
    assert window._matchup_data[2] == ("Ahri", "")    # middle → row 2


def test_ally_placed_in_order_without_lane():
    """Allies without lane info should be placed in first empty slot."""
    window = _make_window()
    _emit(window, allies=[("Ahri", ""), ("Lux", ""), ("Garen", "")])

    assert window._matchup_data[0] == ("Ahri", "")
    assert window._matchup_data[1] == ("Lux", "")
    assert window._matchup_data[2] == ("Garen", "")


def test_ally_mixed_lane_and_no_lane():
    """Allies with and without lane info should coexist correctly."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle"), ("Lux", ""), ("Garen", "top")])

    assert window._matchup_data[0] == ("Garen", "")   # top → row 0
    assert window._matchup_data[1] == ("Lux", "")      # no lane → first empty (row 1)
    assert window._matchup_data[2] == ("Ahri", "")     # middle → row 2


def test_ally_not_duplicated_on_repeated_emit():
    """Same ally data emitted multiple times should not create duplicates."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle")])
    _emit(window, allies=[("Ahri", "middle")])
    _emit(window, allies=[("Ahri", "middle")])

    # Ahri should only appear once
    ally_names = [window._matchup_data[i][0] for i in range(5)]
    assert ally_names.count("Ahri") == 1
    assert window._matchup_data[2] == ("Ahri", "")


def test_ally_lane_occupied_falls_back_to_first_empty():
    """If lane row is already occupied, ally goes to first empty slot."""
    window = _make_window()
    # Manually place someone in middle (row 2)
    window._matchup_data[2] = ("Yasuo", "")

    _emit(window, allies=[("Ahri", "middle")])

    # Ahri can't go to row 2 (occupied by Yasuo), should go to row 0
    assert window._matchup_data[2] == ("Yasuo", "")
    assert window._matchup_data[0] == ("Ahri", "")


# ---------------------------------------------------------------------------
# Enemy placement tests
# ---------------------------------------------------------------------------


def test_enemy_placed_by_lane_aptitude():
    """Enemies should be placed by lane aptitude from champions.json."""
    window = _make_window_with_champion_data()
    # Aatrox (top:5), Thresh (sup:5), Yasuo (mid:5)
    _emit(window, enemies=["Yasuo", "Thresh", "Aatrox"])

    assert window._matchup_data[0] == ("", "Aatrox")  # top
    assert window._matchup_data[2] == ("", "Yasuo")   # mid
    assert window._matchup_data[4] == ("", "Thresh")  # sup


def test_enemy_fallback_without_champion_data():
    """Enemies should use first empty slot when champion_data unavailable."""
    window = _make_window()  # No champion_data
    _emit(window, enemies=["Zed", "Yasuo"])

    assert window._matchup_data[0] == ("", "Zed")
    assert window._matchup_data[1] == ("", "Yasuo")


def test_enemy_lane_occupied_uses_next_empty():
    """When best lane is occupied, enemy goes to next available empty slot."""
    window = _make_window_with_champion_data()
    # Pre-occupy support row
    window._matchup_data[4] = ("", "Leona")

    # Thresh has sup:5 but row 4 is occupied
    _emit(window, enemies=["Thresh"])

    # Thresh should go to first empty slot (row 0)
    assert window._matchup_data[0] == ("", "Thresh")
    assert window._matchup_data[4] == ("", "Leona")  # Leona stays


def test_enemy_not_duplicated_on_repeated_emit():
    """Same enemy data emitted multiple times should not create duplicates."""
    window = _make_window()
    _emit(window, enemies=["Zed"])
    _emit(window, enemies=["Zed"])

    enemy_names = [window._matchup_data[i][1] for i in range(5)]
    assert enemy_names.count("Zed") == 1


def test_enemy_fills_empty_slots_incrementally():
    """New enemies should fill next empty slot without affecting existing ones."""
    window = _make_window()
    _emit(window, enemies=["Zed"])
    _emit(window, enemies=["Zed", "Yasuo"])
    _emit(window, enemies=["Zed", "Yasuo", "Lux"])

    assert window._matchup_data[0][1] == "Zed"
    assert window._matchup_data[1][1] == "Yasuo"
    assert window._matchup_data[2][1] == "Lux"


# ---------------------------------------------------------------------------
# Combined ally + enemy tests
# ---------------------------------------------------------------------------


def test_ally_and_enemy_placed_together():
    """Allies and enemies should be placed independently in the same rows."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle"), ("Garen", "top")], enemies=["Zed", "Yasuo"])

    # Allies placed by lane
    assert window._matchup_data[0][0] == "Garen"  # top
    assert window._matchup_data[2][0] == "Ahri"   # middle
    # Enemies in pick order (first empty enemy slot)
    assert window._matchup_data[0][1] == "Zed"
    assert window._matchup_data[1][1] == "Yasuo"



# ---------------------------------------------------------------------------
# New session (auto-clear) tests
# ---------------------------------------------------------------------------


def test_new_session_clears_data():
    """New ChampSelect session should auto-clear all rows before applying new data."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle")], enemies=["Zed"])

    # New session with different data
    _emit(window, allies=[("Lux", "top")], enemies=["Yasuo"], is_new_session=True)

    # Old data should be gone
    ally_names = [window._matchup_data[i][0] for i in range(5)]
    enemy_names = [window._matchup_data[i][1] for i in range(5)]
    assert "Ahri" not in ally_names
    assert "Zed" not in enemy_names
    # New data should be placed
    assert window._matchup_data[0] == ("Lux", "Yasuo")


def test_new_session_without_data_clears_all():
    """New session with empty data should just clear everything."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle")], enemies=["Zed"])

    _emit(window, allies=[], enemies=[], is_new_session=True)

    assert all(pair == ("", "") for pair in window._matchup_data)


# ---------------------------------------------------------------------------
# No auto-clear on normal signals
# ---------------------------------------------------------------------------


def test_empty_signal_does_not_clear():
    """An emission with empty allies/enemies should NOT clear existing data."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle")], enemies=["Zed"])

    # Empty signal (e.g., detector polling with no new data)
    _emit(window, allies=[], enemies=[])

    # Data should be preserved
    assert window._matchup_data[2][0] == "Ahri"
    assert window._matchup_data[0][1] == "Zed"


def test_partial_signal_preserves_existing():
    """A signal with only some champions should not affect others."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle"), ("Garen", "top")], enemies=["Zed"])

    # Signal with only Ahri (Garen not mentioned)
    _emit(window, allies=[("Ahri", "middle")], enemies=[])

    # Garen should still be there
    assert window._matchup_data[0][0] == "Garen"
    assert window._matchup_data[2][0] == "Ahri"
    assert window._matchup_data[0][1] == "Zed"


# ---------------------------------------------------------------------------
# Refresh button tests
# ---------------------------------------------------------------------------


def test_refresh_clears_all():
    """Refresh should clear all matchup data."""
    window = _make_window()
    window.champion_detector = None  # No detector available in test
    _emit(window, allies=[("Ahri", "middle")], enemies=["Zed"])

    window._refresh_matchup_list()

    assert all(pair == ("", "") for pair in window._matchup_data)



# ---------------------------------------------------------------------------
# Blind pick / InProgress fill tests
# ---------------------------------------------------------------------------


def test_blind_pick_fill_empty_rows():
    """InProgress phase with empty rows should fill them incrementally."""
    window = _make_window()

    # Game starts — all 5 allies and 5 enemies arrive at once
    _emit(
        window,
        allies=[("Ahri", ""), ("Lux", ""), ("Garen", ""), ("Jinx", ""), ("Thresh", "")],
        enemies=["Zed", "Yasuo", "Fizz", "Caitlyn", "Leona"],
        phase="InProgress",
    )

    # All 5 rows should be filled
    for i in range(5):
        assert window._matchup_data[i][0] != ""
        assert window._matchup_data[i][1] != ""


def test_blind_pick_partial_fill_preserves_existing():
    """InProgress fill should only place in empty slots, not overwrite."""
    window = _make_window()

    # Pre-existing data (e.g., allies from champ select)
    _emit(window, allies=[("Ahri", ""), ("Lux", "")])

    # Game starts — enemies arrive; more allies detected too
    _emit(
        window,
        allies=[("Ahri", ""), ("Lux", ""), ("Garen", "")],
        enemies=["Zed", "Yasuo", "Fizz"],
        phase="InProgress",
    )

    # Ahri and Lux stay in their original rows (0, 1)
    assert window._matchup_data[0][0] == "Ahri"
    assert window._matchup_data[1][0] == "Lux"
    # Garen fills next empty ally slot (row 2)
    assert window._matchup_data[2][0] == "Garen"
    # Enemies fill first empty enemy slots
    assert window._matchup_data[0][1] == "Zed"
    assert window._matchup_data[1][1] == "Yasuo"
    assert window._matchup_data[2][1] == "Fizz"


def test_swap_enemies():
    """Swapping enemies should work correctly."""
    window = _make_window()
    _emit(window, allies=[("Ahri", ""), ("Lux", "")], enemies=["Zed", "Yasuo"])

    window._matchup_swap_enemies(0)

    assert window._matchup_data[0] == ("Ahri", "Yasuo")
    assert window._matchup_data[1] == ("Lux", "Zed")


def test_clear_matchup_list():
    """Clearing the matchup list should reset all entries."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "middle")], enemies=["Zed"])

    window.clear_matchup_list()

    assert all(pair == ("", "") for pair in window._matchup_data)


# ---------------------------------------------------------------------------
# Drag-and-drop swap tests
# ---------------------------------------------------------------------------


def test_dnd_drop_ally_swaps_only_allies():
    """DnD drop should swap only ally champions between rows."""
    window = _make_window()
    _emit(window, allies=[("Ahri", ""), ("Lux", ""), ("Garen", "")], enemies=["Zed", "Yasuo", "Fizz"])

    window._matchup_dnd_drop(source_index=0, target_index=2, side="ally")

    assert window._matchup_data[0] == ("Garen", "Zed")
    assert window._matchup_data[2] == ("Ahri", "Fizz")
    # Row 1 untouched
    assert window._matchup_data[1] == ("Lux", "Yasuo")


def test_dnd_drop_enemy_swaps_only_enemies():
    """DnD drop should swap only enemy champions between rows."""
    window = _make_window()
    _emit(window, allies=[("Ahri", ""), ("Lux", ""), ("Garen", "")], enemies=["Zed", "Yasuo", "Fizz"])

    window._matchup_dnd_drop(source_index=0, target_index=2, side="enemy")

    assert window._matchup_data[0] == ("Ahri", "Fizz")
    assert window._matchup_data[2] == ("Garen", "Zed")
    # Row 1 untouched
    assert window._matchup_data[1] == ("Lux", "Yasuo")


def test_dnd_drop_same_row_noop():
    """Dropping on the same row should be a no-op."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "")], enemies=["Zed"])

    original = list(window._matchup_data)
    window._matchup_dnd_drop(source_index=0, target_index=0, side="ally")

    assert window._matchup_data == original


def test_dnd_drop_out_of_bounds_noop():
    """Dropping with out-of-bounds indices should be a no-op."""
    window = _make_window()
    _emit(window, allies=[("Ahri", "")], enemies=["Zed"])

    original = list(window._matchup_data)
    window._matchup_dnd_drop(source_index=-1, target_index=0, side="ally")
    assert window._matchup_data == original

    window._matchup_dnd_drop(source_index=0, target_index=5, side="ally")
    assert window._matchup_data == original



def test_dnd_nonadjacent_swap():
    """DnD should support non-adjacent row swaps."""
    window = _make_window()
    _emit(
        window,
        allies=[("Ahri", ""), ("Lux", ""), ("Garen", ""), ("Jinx", ""), ("Thresh", "")],
        enemies=["Zed", "Yasuo", "Fizz", "Caitlyn", "Leona"],
    )

    window._matchup_dnd_drop(0, 4, "ally")

    assert window._matchup_data[0][0] == "Thresh"
    assert window._matchup_data[4][0] == "Ahri"
    assert window._matchup_data[0][1] == "Zed"
    assert window._matchup_data[4][1] == "Leona"


def test_dnd_unknown_side_noop():
    """An unknown side value should be a no-op."""
    window = _make_window()
    _emit(window, allies=[("Ahri", ""), ("Lux", "")], enemies=["Zed", "Yasuo"])

    original = list(window._matchup_data)
    window._matchup_dnd_drop(0, 1, "unknown")

    assert window._matchup_data == original


# ---------------------------------------------------------------------------
# Debug add-to-matchup tests
# ---------------------------------------------------------------------------


def test_debug_add_ally():
    """Debug add should place ally in first empty slot."""
    window = _make_window()
    window._debug_champion_input = type("FakeInput", (), {"text": lambda self: "Ahri", "clear": lambda self: None, "strip": lambda self: "Ahri"})()
    window._debug_status_label = type("FakeLabel", (), {"setText": lambda self, t: None})()

    window._debug_add_to_matchup("ally")

    assert window._matchup_data[0] == ("Ahri", "")


def test_debug_add_enemy():
    """Debug add should place enemy in first empty slot."""
    window = _make_window()
    window._debug_champion_input = type("FakeInput", (), {"text": lambda self: "Zed", "clear": lambda self: None})()
    window._debug_status_label = type("FakeLabel", (), {"setText": lambda self, t: None})()

    window._debug_add_to_matchup("enemy")

    assert window._matchup_data[0] == ("", "Zed")


def test_debug_add_no_empty_slot():
    """Debug add should be a no-op when no empty slot is available."""
    window = _make_window()
    _emit(
        window,
        allies=[("Ahri", ""), ("Lux", ""), ("Garen", ""), ("Jinx", ""), ("Thresh", "")],
    )
    window._debug_champion_input = type("FakeInput", (), {"text": lambda self: "Ashe", "clear": lambda self: None})()
    window._debug_status_label = type("FakeLabel", (), {"setText": lambda self, t: None})()

    window._debug_add_to_matchup("ally")

    # All ally slots should remain unchanged
    allies = [window._matchup_data[i][0] for i in range(5)]
    assert "Ashe" not in allies


def test_debug_add_then_refresh_clears():
    """Debug-added champions should be cleared by the refresh button."""
    window = _make_window()
    window._debug_champion_input = type("FakeInput", (), {"text": lambda self: "Ahri", "clear": lambda self: None})()
    window._debug_status_label = type("FakeLabel", (), {"setText": lambda self, t: None})()

    window._debug_add_to_matchup("ally")
    assert window._matchup_data[0] == ("Ahri", "")

    # Simulate refresh (same as _refresh_matchup_list without the detector part)
    window._matchup_data = [("", "")] * 5
    window.update_matchup_list()

    assert all(pair == ("", "") for pair in window._matchup_data)
