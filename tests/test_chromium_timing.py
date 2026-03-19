#!/usr/bin/env python3
"""Regression tests for Chromium timing constraints.

These tests guard against regressions of the QWebEngineView crash bugs fixed
in PR #103, #104, #105.  Two categories of tests are included:

1. AST static analysis — verify that signal handlers and deferred creators
   use the correct timing pattern at the source level.
2. Behavior tests — verify at runtime that viewer creation is correctly
   deferred and that hide is not called in the same tick as setUrl().
"""

import ast
import os
import pathlib
import sys
from unittest.mock import patch, MagicMock

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

# ---------------------------------------------------------------------------
# Helpers for AST analysis
# ---------------------------------------------------------------------------

_MAIN_PY = pathlib.Path(__file__).parent.parent / "main_window.py"


def _parse_main_py() -> ast.Module:
    """Parse main.py and return the AST module node."""
    source = _MAIN_PY.read_text(encoding="utf-8")
    return ast.parse(source)


def _find_method(tree: ast.Module, method_name: str) -> ast.FunctionDef:
    """Return the first FunctionDef node matching *method_name* in *tree*."""
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == method_name:
            return node
    raise AssertionError(f"Method {method_name!r} not found in main.py")


def _collect_call_names(func_node: ast.FunctionDef) -> set[str]:
    """Return the set of attribute call names (e.g. 'hide_viewer') found
    as direct ``self.<name>(...)`` calls within *func_node*.

    Only collects calls that are direct children of the function body (or
    immediate statement expressions), not calls nested inside lambdas, since
    lambdas are scheduled for later ticks.
    """
    names: set[str] = set()
    for node in ast.walk(func_node):
        # Skip lambdas — those are deferred (next tick) by design.
        if isinstance(node, ast.Lambda):
            continue
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Attribute):
                # Capture both self.method() and viewer.method() patterns
                names.add(func.attr)
    return names


def _collect_self_attr_calls(func_node: ast.FunctionDef) -> set[str]:
    """Return names of methods called as self.<name>() in *func_node*,
    excluding calls inside lambdas (those run in a different tick).
    """
    names: set[str] = set()

    class _Visitor(ast.NodeVisitor):
        def visit_Lambda(self, node):
            # Do NOT recurse into lambdas.
            pass

        def visit_Call(self, node):
            func = node.func
            if (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id == "self"
            ):
                names.add(func.attr)
            self.generic_visit(node)

    _Visitor().visit(func_node)
    return names


# ---------------------------------------------------------------------------
# AST tests
# ---------------------------------------------------------------------------


class TestASTPatterns:
    """Static analysis tests that verify the correct timing pattern is used."""

    @pytest.fixture(scope="class")
    def tree(self):
        return _parse_main_py()

    def test_signal_handlers_must_not_directly_call_viewer_methods(self, tree):
        """on_champion_detected must not directly call add_viewer, hide_viewer,
        open_counter, open_build, open_aram, or setUrl.

        These operations create or mutate QWebEngineView state and must only
        happen in a deferred callback, not synchronously in the signal handler.
        """
        forbidden = {"add_viewer", "hide_viewer", "open_counter", "open_build", "open_aram", "setUrl"}
        for method_name in ("on_champion_detected",):
            func_node = _find_method(tree, method_name)
            direct_calls = _collect_self_attr_calls(func_node)
            violations = forbidden & direct_calls
            assert not violations, (
                f"{method_name} directly calls {violations} — "
                "these must be deferred via _schedule_auto_viewer_creation."
            )

    def test_deferred_creators_must_not_directly_call_hide_viewer(self, tree):
        """_create_ally_viewer must NOT call self.hide_viewer() directly.
        The hide must be deferred to the next event-loop tick via
        _open_url_and_hide (which uses QTimer.singleShot).
        """
        for method_name in ("_create_ally_viewer",):
            func_node = _find_method(tree, method_name)
            direct_self_calls = _collect_self_attr_calls(func_node)
            assert "hide_viewer" not in direct_self_calls, (
                f"{method_name} calls self.hide_viewer() directly — "
                "use _open_url_and_hide instead so the hide is deferred."
            )

    def test_signal_handlers_use_schedule_auto_viewer_creation(self, tree):
        """on_champion_detected must call self._schedule_auto_viewer_creation
        to ensure viewer creation is deferred to the next event-loop tick.
        """
        for method_name in ("on_champion_detected",):
            func_node = _find_method(tree, method_name)
            direct_self_calls = _collect_self_attr_calls(func_node)
            assert "_schedule_auto_viewer_creation" in direct_self_calls, (
                f"{method_name} does not call self._schedule_auto_viewer_creation — "
                "all signal-triggered viewer creation must go through this helper."
            )


# ---------------------------------------------------------------------------
# Fixtures for behavior tests
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def qapp():
    """Return (or create) the QApplication instance."""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app


@pytest.fixture(scope="module")
def window(qapp):
    """Return a single MainWindow for behavior tests."""
    w = MainWindow()
    yield w


# ---------------------------------------------------------------------------
# Behavior tests
# ---------------------------------------------------------------------------


class TestDeferredCreationBehavior:
    """Runtime tests verifying that viewer creation and hiding are deferred.

    These tests mock QTimer.singleShot to avoid Qt event-loop timing issues
    and instead verify the correct deferral pattern is used at runtime.
    """

    def test_enemy_detection_does_not_immediately_create_viewer(self, window):
        """on_enemy_champion_detected must add the champion to pending_enemy_picks
        and must NOT create any viewer synchronously.
        """
        initial_count = len(window.viewers)
        initial_pending = list(window.pending_enemy_picks)
        window.on_enemy_champion_detected("Zed")
        # No viewer should be created synchronously.
        assert len(window.viewers) == initial_count, (
            "on_enemy_champion_detected created a viewer synchronously — "
            "enemy viewers must only be created when the user clicks '+'."
        )
        # "Zed" must have been added to pending_enemy_picks.
        assert "Zed" in window.pending_enemy_picks, (
            "on_enemy_champion_detected did not add 'Zed' to pending_enemy_picks."
        )
        # Cleanup: restore pending_enemy_picks to its original state.
        window.pending_enemy_picks[:] = initial_pending

    def test_ally_detection_does_not_immediately_create_viewer(self, window):
        """on_champion_detected must NOT create a viewer synchronously —
        creation must be deferred to the next event-loop tick via QTimer.
        """
        with patch("main_window.QTimer") as mock_timer:
            initial_count = len(window.viewers)
            window.on_champion_detected("Ahri", "middle")
            # No viewer should be created synchronously.
            assert len(window.viewers) == initial_count, (
                "on_champion_detected created a viewer synchronously — "
                "this violates the Chromium timing constraint (PR #103, #105)."
            )
            # QTimer.singleShot(0, ...) must have been called to defer creation.
            mock_timer.singleShot.assert_called_once()
            args = mock_timer.singleShot.call_args
            assert args[0][0] == 0, "Deferral must use delay=0"

    def test_create_enemy_viewer_adds_to_pending_picks(self, window):
        """_create_enemy_viewer must append the champion to pending_enemy_picks
        without creating any viewer.
        """
        initial_count = len(window.viewers)
        initial_pending = list(window.pending_enemy_picks)
        window._create_enemy_viewer("Zed")
        # No viewer should be created.
        assert len(window.viewers) == initial_count, (
            "_create_enemy_viewer created a viewer — it should only append to "
            "pending_enemy_picks and call update_viewers_list()."
        )
        # Champion must have been added to pending_enemy_picks.
        assert "Zed" in window.pending_enemy_picks, (
            "_create_enemy_viewer did not add 'Zed' to pending_enemy_picks."
        )
        # Cleanup: restore pending_enemy_picks to its original state.
        window.pending_enemy_picks[:] = initial_pending

    def test_materialize_enemy_viewer_creates_viewer(self, window):
        """materialize_enemy_viewer must remove the champion from
        pending_enemy_picks (and attempt to create a viewer).
        """
        # Seed pending_enemy_picks with "Zed".
        if "Zed" not in window.pending_enemy_picks:
            window.pending_enemy_picks.append("Zed")
        window.materialize_enemy_viewer("Zed")
        # "Zed" must have been removed from pending_enemy_picks.
        assert "Zed" not in window.pending_enemy_picks, (
            "materialize_enemy_viewer did not remove 'Zed' from pending_enemy_picks."
        )

    def test_pending_picks_cleared_on_new_session(self, window):
        """on_matchup_data_updated with is_new_session=True must clear
        pending_enemy_picks.
        """
        window.pending_enemy_picks.append("Jinx")
        window.pending_enemy_picks.append("Caitlyn")
        window.on_matchup_data_updated({"is_new_session": True})
        assert len(window.pending_enemy_picks) == 0, (
            "pending_enemy_picks was not cleared when a new session started."
        )
