#!/usr/bin/env python3
"""Tests for the viewer header: Lane-first layout + enemy quick-pick buttons.

The header always shows a Lane-first layout (close / Lane / Champion / vs /
Opponent / up to 5 quick-pick buttons). The quick-pick buttons are sourced
from CURRENT MATCHUP enemy data, and the button matching the currently
selected Opponent is hidden (the Opponent pill right next to them already
shows that champion).
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
from PyQt6.QtCore import QSize
from PyQt6.QtWidgets import QApplication, QHBoxLayout, QWidget

from widgets import ChampionViewerWidget, QuickPickButton
from champion_data import ChampionData
from main_window import MainWindow


@pytest.fixture(scope="session")
def qapp():
    """Create QApplication instance for tests"""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app
    # No need to quit, pytest-qt handles it


class _DummyMainWindow:
    """Minimal stand-in for MainWindow used by the pure-logic tests below."""

    def __init__(self, matchup_data=None):
        self._matchup_data = matchup_data


def _make_bare_widget(main_window):
    """Build a ChampionViewerWidget without running Qt construction (init_ui)."""
    widget = ChampionViewerWidget.__new__(ChampionViewerWidget)
    widget.main_window = main_window
    widget.champion_data = ChampionData()
    return widget


class TestGetMatchupEnemyChampionIds:
    """Pure-logic tests for _get_matchup_enemy_champion_ids() (no Qt widgets built)."""

    def test_preserves_row_order_and_skips_empty_rows(self):
        """Enemy ids come back in row order, and blank enemy rows are skipped."""
        matchup_data = [
            ("", "Ahri"),
            ("", ""),          # blank enemy row -> skipped
            ("", "Zed"),
            ("", "Yasuo"),
        ]
        widget = _make_bare_widget(_DummyMainWindow(matchup_data))
        ids = widget._get_matchup_enemy_champion_ids()
        assert ids == ["ahri", "zed", "yasuo"]

    def test_dedupes_repeated_enemy_ids(self):
        """The same enemy appearing in multiple rows is only returned once."""
        matchup_data = [
            ("", "Ahri"),
            ("", "Zed"),
            ("", "Ahri"),      # duplicate -> skipped
            ("", "Yasuo"),
        ]
        widget = _make_bare_widget(_DummyMainWindow(matchup_data))
        ids = widget._get_matchup_enemy_champion_ids()
        assert ids == ["ahri", "zed", "yasuo"]

    def test_caps_at_five_even_with_more_unique_enemies(self):
        """More than 5 unique enemy rows must be truncated to QUICK_OPPONENT_MAX (5)."""
        matchup_data = [
            ("", "Ahri"),
            ("", "Zed"),
            ("", "Yasuo"),
            ("", "Garen"),
            ("", "Lux"),
            ("", "Ashe"),      # 6th unique id -> excluded by the cap
        ]
        widget = _make_bare_widget(_DummyMainWindow(matchup_data))
        ids = widget._get_matchup_enemy_champion_ids()
        assert ids == ["ahri", "zed", "yasuo", "garen", "lux"]
        assert len(ids) == widget.QUICK_OPPONENT_MAX

    def test_wukong_resolves_to_monkeyking(self):
        """Riot's English name 'Wukong' must resolve to the champions.json id 'monkeyking'."""
        widget = _make_bare_widget(_DummyMainWindow([("", "Wukong")]))
        ids = widget._get_matchup_enemy_champion_ids()
        assert ids == ["monkeyking"]

    def test_returns_empty_list_when_main_window_is_none(self):
        """No main_window reference -> no matchup data source -> empty list."""
        widget = _make_bare_widget(None)
        assert widget._get_matchup_enemy_champion_ids() == []

    def test_refresh_is_noop_on_a_bare_instance(self):
        """refresh_opponent_quick_picks() must no-op silently when buttons were never built.

        `_quick_opponent_buttons` is genuinely undefined here (never built on this bare
        instance) -- calling the method must not raise.
        """
        widget = _make_bare_widget(_DummyMainWindow([("", "Ahri")]))
        widget.refresh_opponent_quick_picks()  # Should not raise.


class _StaleChampionDetector:
    """Stub whose stale champion names must NOT leak into opponent suggestions.

    Regression guard for the bug where `_get_opponent_suggestion_ids()` sourced
    candidates from `ChampionDetector.detected_enemy_champions`, an append-only set
    that `MainWindow._refresh_matchup_list()` never clears -- so pressing Refresh on
    CURRENT MATCHUP did not clear stale champions out of the opponent selector.
    """

    def get_detected_enemy_champion_names(self):
        return ["Yasuo"]


class TestGetOpponentSuggestionIds:
    """Pure-logic tests for _get_opponent_suggestion_ids() (no Qt widgets built)."""

    def test_sources_solely_from_matchup_data(self):
        """CURRENT MATCHUP enemies -> Ahri + Zed are suggested."""
        matchup_data = [("", "Ahri"), ("", "Zed")]
        widget = _make_bare_widget(_DummyMainWindow(matchup_data))
        assert widget._get_opponent_suggestion_ids() == {"ahri", "zed"}

    def test_stale_detector_names_do_not_leak_in(self):
        """A champion_detector stub with stale names must not contribute (regression)."""
        matchup_data = [("", "Ahri"), ("", "Zed")]
        main_window = _DummyMainWindow(matchup_data)
        main_window.champion_detector = _StaleChampionDetector()
        widget = _make_bare_widget(main_window)

        ids = widget._get_opponent_suggestion_ids()

        assert "yasuo" not in ids
        assert ids == {"ahri", "zed"}

    def test_refresh_just_pressed_falls_through_to_other_tabs_fallback(self):
        """Blank CURRENT MATCHUP rows (state right after Refresh) must not resurrect
        stale detector champions; the method falls through to the other-tabs fallback.
        """
        matchup_data = [("", "")] * 5
        main_window = _DummyMainWindow(matchup_data)
        main_window.champion_detector = _StaleChampionDetector()
        widget = _make_bare_widget(main_window)
        widget._get_open_champion_suggestions = lambda: []

        assert widget._get_opponent_suggestion_ids() == set()

    def test_shrinking_matchup_removes_departed_enemy(self):
        """Ahri+Zed shrinking to just Ahri -> the suggestion set shrinks with it."""
        widget = _make_bare_widget(_DummyMainWindow([("", "Ahri"), ("", "Zed")]))
        assert widget._get_opponent_suggestion_ids() == {"ahri", "zed"}

        widget.main_window._matchup_data = [("", "Ahri")]
        assert widget._get_opponent_suggestion_ids() == {"ahri"}


def _header_widgets(viewer):
    """Return the list of widgets (skipping the None entries left by addStretch())."""
    layout = viewer._header_widget.layout()
    widgets = []
    for i in range(layout.count()):
        item = layout.itemAt(i)
        widget = item.widget()
        if widget is not None:
            widgets.append(widget)
    return widgets


class TestHeaderLayout:
    """The header is always Lane-first and always appends up to 5 quick-pick buttons."""

    def test_header_order_is_lane_first_with_quick_picks(self, qapp):
        window = MainWindow()
        viewer = window.add_viewer()

        widgets = _header_widgets(viewer)
        expected_prefix = [
            viewer._header_close_btn,
            viewer._lane_selector_btn,
            viewer._champion_selector_btn,
            viewer._header_vs_label,
            viewer._opponent_selector_btn,
        ]
        assert widgets[:len(expected_prefix)] == expected_prefix
        quick_buttons = widgets[len(expected_prefix):]
        assert quick_buttons == viewer._quick_opponent_buttons
        assert len(quick_buttons) == ChampionViewerWidget.QUICK_OPPONENT_MAX

    def test_update_matchup_list_shows_only_matching_quick_buttons(self, qapp):
        window = MainWindow()
        viewer = window.add_viewer()

        window._matchup_data[0] = ("", "Ahri")
        window._matchup_data[1] = ("", "Zed")
        window.update_matchup_list()

        buttons = viewer._quick_opponent_buttons
        assert not buttons[0].isHidden()
        assert not buttons[1].isHidden()
        for btn in buttons[2:]:
            assert btn.isHidden()
        assert viewer._quick_opponent_ids == ["ahri", "zed"]

    def test_quick_pick_click_sets_opponent_champion(self, qapp):
        window = MainWindow()
        viewer = window.add_viewer()

        window._matchup_data[0] = ("", "Ahri")
        window.update_matchup_list()

        viewer._on_quick_opponent_clicked(0)
        assert viewer.opponent_champion_input.text() == "ahri"


def _visible_quick_pick_texts(viewer) -> set:
    """Return the `_full_text` of every currently visible quick-pick button."""
    return {btn._full_text for btn in viewer._quick_opponent_buttons if not btn.isHidden()}


class TestQuickPickHidesSelectedOpponent:
    """The quick-pick button matching the currently selected Opponent is hidden."""

    @staticmethod
    def _seed_five_enemies(window):
        """Fill all 5 CURRENT MATCHUP rows with distinct enemies and refresh."""
        names = ["Ahri", "Zed", "Yasuo", "Garen", "Lux"]
        for i, name in enumerate(names):
            window._matchup_data[i] = ("", name)
        window.update_matchup_list()
        return names

    def test_all_enemy_buttons_shown_when_no_opponent_selected(self, qapp):
        """1. No Opponent selected -> all 5 enemy buttons are visible."""
        window = MainWindow()
        viewer = window.add_viewer()
        self._seed_five_enemies(window)

        assert _visible_quick_pick_texts(viewer) == {"Ahri", "Zed", "Yasuo", "Garen", "Lux"}
        assert viewer._quick_opponent_ids == ["ahri", "zed", "yasuo", "garen", "lux"]

    def test_selecting_opponent_hides_its_button_and_others_pack_left(self, qapp):
        """2. Selecting an Opponent hides only its button; the rest pack to the front."""
        window = MainWindow()
        viewer = window.add_viewer()
        self._seed_five_enemies(window)

        viewer.opponent_champion_input.setText("zed")
        viewer.refresh_opponent_quick_picks()

        assert _visible_quick_pick_texts(viewer) == {"Ahri", "Yasuo", "Garen", "Lux"}
        visible_buttons = [b for b in viewer._quick_opponent_buttons if not b.isHidden()]
        # Visible buttons occupy the leading slots of the row (no gaps left behind).
        assert viewer._quick_opponent_buttons[:len(visible_buttons)] == visible_buttons

    def test_clearing_opponent_to_none_restores_hidden_button(self, qapp):
        """3. Clearing the Opponent (selecting "None") brings the hidden button back."""
        window = MainWindow()
        viewer = window.add_viewer()
        self._seed_five_enemies(window)

        viewer.opponent_champion_input.setText("zed")
        viewer.refresh_opponent_quick_picks()
        assert "Zed" not in _visible_quick_pick_texts(viewer)

        viewer.opponent_champion_input.clear()
        viewer.refresh_opponent_quick_picks()

        assert _visible_quick_pick_texts(viewer) == {"Ahri", "Zed", "Yasuo", "Garen", "Lux"}

    def test_clicking_a_quick_pick_button_hides_itself(self, qapp):
        """4. End-to-end via _on_quick_opponent_clicked(): the clicked button hides itself.

        Buttons are repopulated positionally after exclusion (the remaining ids pack
        into buttons[0:]), so clicking the *last* populated button is the case where the
        clicked widget itself ends up with nothing to display and is hidden -- a button
        in the middle would instead be repurposed to show the next champion.
        """
        window = MainWindow()
        viewer = window.add_viewer()
        self._seed_five_enemies(window)

        last_index = len(viewer._quick_opponent_ids) - 1
        clicked_btn = viewer._quick_opponent_buttons[last_index]
        assert clicked_btn._full_text == "Lux"

        viewer._on_quick_opponent_clicked(last_index)

        assert viewer.opponent_champion_input.text() == "lux"
        assert clicked_btn.isHidden()

    def test_wukong_opponent_hides_monkeyking_button(self, qapp):
        """5. Regression: "Wukong" (LCU name) must hide the "monkeyking" button.

        A naive `.lower()` comparison leaves "wukong", which never matches the
        champions.json id "monkeyking" -- this only passes via _resolve_champion_id().
        """
        window = MainWindow()
        viewer = window.add_viewer()
        window._matchup_data[0] = ("", "Wukong")
        window._matchup_data[1] = ("", "Ahri")
        window.update_matchup_list()

        viewer.opponent_champion_input.setText("Wukong")
        viewer.refresh_opponent_quick_picks()

        assert "monkeyking" not in viewer._quick_opponent_ids
        assert _visible_quick_pick_texts(viewer) == {"Ahri"}

    def test_button_index_still_matches_champion_after_exclusion(self, qapp):
        """6. `_quick_opponent_ids` stays index-aligned with the buttons after exclusion."""
        window = MainWindow()
        viewer = window.add_viewer()
        self._seed_five_enemies(window)

        viewer.opponent_champion_input.setText("zed")
        viewer.refresh_opponent_quick_picks()
        assert viewer._quick_opponent_ids == ["ahri", "yasuo", "garen", "lux"]

        viewer._on_quick_opponent_clicked(2)  # index 2 in the post-exclusion list -> "garen"
        assert viewer.opponent_champion_input.text() == "garen"


class TestQuickPickButtonSizing:
    """Properties a quick-pick label must hold, independent of font and platform.

    Regression guard: an earlier revision used QSizePolicy.Ignored, which made the
    layout collapse every button to its minimum width and elide the label away to an
    empty string even on a very wide header -- the buttons rendered as icons only.

    These assertions deliberately avoid comparing against exact strings at an exact
    pixel width: how many characters fit depends on the font the machine happens to
    have, so such a test passes on Windows and fails on a Linux CI runner. What
    matters is that a label survives when there is room and shrinks when there is not.
    """

    NAMES = ("Zed", "Ashe", "Leona", "Ornn")

    def _build_row(self, host_width):
        host = QWidget()
        layout = QHBoxLayout(host)
        layout.setContentsMargins(6, 6, 6, 4)
        layout.setSpacing(4)
        buttons = []
        for name in self.NAMES:
            btn = QuickPickButton()
            btn.setIconSize(QSize(24, 24))
            btn.setMinimumWidth(36)
            btn.set_full_text(name)
            layout.addWidget(btn)
            buttons.append(btn)
        layout.addStretch()
        host.resize(host_width, 52)
        host.show()
        for _ in range(3):
            QApplication.processEvents()
        return host, buttons

    def test_labels_survive_when_the_header_is_wide(self, qapp):
        """The original bug: plenty of room, yet every label elided away to ''."""
        host, buttons = self._build_row(1400)
        assert all(b.text() for b in buttons), [b.text() for b in buttons]
        host.close()

    def test_full_label_is_shown_once_the_button_has_its_natural_width(self, qapp):
        """The contract _apply_elided_text() implements, stated without pixel counts."""
        host, buttons = self._build_row(1400)
        for btn in buttons:
            if btn.width() >= btn._full_width:
                assert btn.text() == btn._full_text
        host.close()

    def test_buttons_do_not_stretch_past_their_natural_width(self, qapp):
        """Maximum policy: slack goes to the trailing stretch, not into the buttons."""
        host, buttons = self._build_row(1400)
        for btn in buttons:
            assert btn.width() <= btn.sizeHint().width()
        host.close()

    def test_long_label_is_strictly_truncated_and_stays_a_prefix(self, qapp):
        """A label far too long for the button must come back *shorter*, not just similar.

        The length check is the load-bearing half: a prefix assertion on its own is also
        satisfied by a button that wrongly renders the label in full. The label is made
        long enough that no font could fit it in the width given, so this stays true
        regardless of which fonts the machine running the suite happens to have.
        """
        full = "Nunu & Willump the Boy and His Yeti " * 8  # ~288 chars
        host = QWidget()
        layout = QHBoxLayout(host)
        layout.setContentsMargins(6, 6, 6, 4)
        btn = QuickPickButton()
        btn.setIconSize(QSize(24, 24))
        btn.setMinimumWidth(36)
        btn.set_full_text(full)
        layout.addWidget(btn)
        layout.addStretch()
        host.resize(400, 52)
        host.show()
        for _ in range(3):
            QApplication.processEvents()

        shown = btn.text()
        assert shown, "label collapsed away entirely despite having room for some of it"
        assert len(shown) < len(full), f"label was not truncated: {len(shown)} chars shown"
        assert shown.endswith("…"), f"truncated label should end with an ellipsis: {shown!r}"
        assert full.startswith(shown[:-1]), f"shown text is not a prefix of the name: {shown!r}"
        host.close()

    def test_each_label_shrinks_when_the_header_gets_narrow(self, qapp):
        """Per button, not in aggregate: every name here is too long for a 320px row."""
        wide_host, wide = self._build_row(1400)
        wide_text = {b._full_text: b.text() for b in wide}
        wide_host.close()

        narrow_host, narrow = self._build_row(320)
        for btn in narrow:
            shown = btn.text()
            assert len(shown) < len(wide_text[btn._full_text]), (
                f"{btn._full_text!r} did not shrink: {shown!r}"
            )
            stem = shown.rstrip("…")
            assert btn._full_text.startswith(stem), f"{shown!r} is not a prefix"
        narrow_host.close()
