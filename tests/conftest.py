"""Shared pytest configuration for the whole test suite.

This file exists for a single reason: to guarantee that running the test
suite never touches the real user's on-disk champion icon cache
(``%LOCALAPPDATA%\\LoLViewer\\cache\\champion_icons``).

``ChampionImageCache`` now persists icons to disk and is shared process-wide
via ``champion_data.get_shared_image_cache()`` (see champion_data.py). Many
pre-existing tests construct a real ``MainWindow()`` (which creates that
shared cache) without knowing anything about icon caching, so we redirect
``LOL_VIEWER_ICON_CACHE_DIR`` to a throwaway directory for the whole pytest
session *before* any test module is imported. Individual tests (e.g.
tests/test_icon_cache.py) can still isolate further with their own
``monkeypatch.setenv("LOL_VIEWER_ICON_CACHE_DIR", ...)`` /
``monkeypatch.setattr(champion_data, "_shared_image_cache", None)`` as needed;
monkeypatch restores whatever this file set once each test finishes.
"""
import atexit
import os
import shutil
import tempfile

_TEST_ICON_CACHE_DIR = tempfile.mkdtemp(prefix="lol_viewer_icon_cache_test_")
os.environ.setdefault("LOL_VIEWER_ICON_CACHE_DIR", _TEST_ICON_CACHE_DIR)


def _cleanup_test_icon_cache_dir():
    shutil.rmtree(_TEST_ICON_CACHE_DIR, ignore_errors=True)


atexit.register(_cleanup_test_icon_cache_dir)
