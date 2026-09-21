#!/usr/bin/env python3
"""Tests for the Beta viewer header: Lane-first layout + enemy quick-pick buttons.

These tests validate the FLAG_VIEWER_HEADER_QUICK_OPPONENT feature flag
(default OFF). Flag OFF must keep the existing header order/behavior byte
for byte; flag ON adds up to 5 one-click opponent buttons sourced from
CURRENT MATCHUP enemy data.
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
from constants import FEATURE_FLAG_DEFINITIONS, FLAG_VIEWER_HEADER_QUICK_OPPONENT
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

    def test_refresh_is_noop_when_flag_off(self):
        """refresh_opponent_quick_picks() must no-op silently when buttons were never built.

        `_quick_opponent_buttons` is genuinely undefined here (never built on this bare
        instance) -- calling the method must not raise.
        """
        widget = _make_bare_widget(_DummyMainWindow([("", "Ahri")]))
        widget.refresh_opponent_quick_picks()  # Should not raise.


class TestFeatureFlagDefinition:
    """The flag itself must exist and default to OFF."""

    def test_flag_default_is_false(self):
        assert FEATURE_FLAG_DEFINITIONS[FLAG_VIEWER_HEADER_QUICK_OPPONENT]["default"] is False


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


class TestHeaderLayoutFlagOff:
    """Flag OFF must reproduce the exact pre-existing header order."""

    def test_header_order_unchanged_and_no_quick_pick_attrs(self, qapp):
        window = MainWindow()
        # Flaky-guard: explicitly assign right before viewer construction, never rely on default.
        window.feature_flags[FLAG_VIEWER_HEADER_QUICK_OPPONENT] = False
        viewer = window.add_viewer()

        widgets = _header_widgets(viewer)
        assert widgets == [
            viewer._header_close_btn,
            viewer._champion_selector_btn,
            viewer._header_vs_label,
            viewer._opponent_selector_btn,
            viewer._lane_selector_btn,
        ]
        # No buttons were built; the class-level empty default is still in effect.
        assert viewer._quick_opponent_buttons == ()
        assert viewer._quick_opponent_ids == ()


class TestHeaderLayoutFlagOn:
    """Flag ON reorders the header to Lane-first and appends 5 quick-pick buttons."""

    def test_header_order_is_lane_first_with_quick_picks(self, qapp):
        window = MainWindow()
        # Flaky-guard: explicitly assign right before viewer construction, never rely on default.
        window.feature_flags[FLAG_VIEWER_HEADER_QUICK_OPPONENT] = True
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
        window.feature_flags[FLAG_VIEWER_HEADER_QUICK_OPPONENT] = True
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
        window.feature_flags[FLAG_VIEWER_HEADER_QUICK_OPPONENT] = True
        viewer = window.add_viewer()

        window._matchup_data[0] = ("", "Ahri")
        window.update_matchup_list()

        viewer._on_quick_opponent_clicked(0)
        assert viewer.opponent_champion_input.text() == "ahri"


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
