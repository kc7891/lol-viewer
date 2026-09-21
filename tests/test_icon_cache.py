#!/usr/bin/env python3
"""Tests for the champion icon on-disk cache and shared cache instance.

Covers:
- ChampionImageCache's disk layer (round-trip, corruption recovery, atomic write)
- The pending_requests leak/wedge bug in _on_image_downloaded() (and its fix)
- prune_icon_cache()
- get_shared_image_cache() / get_icon_cache_dir()
- End-to-end: a pre-filled cache means zero downloads across viewers/instances

IMPORTANT: no test here may touch the real user's on-disk cache
(%LOCALAPPDATA%\\LoLViewer\\cache\\champion_icons). Every test either passes an
explicit cache_dir=tmp_path to ChampionImageCache, or monkeypatches
LOL_VIEWER_ICON_CACHE_DIR (tests/conftest.py also sets a session-wide fallback
override as a safety net, but tests that touch the *shared* singleton reset it
explicitly here too, per the isolation note in the implementation plan).

No real network I/O happens anywhere in this file: _on_image_downloaded() only
ever calls error() / errorString() / readAll() / deleteLater() on its `reply`
argument, so a plain Python stub object stands in for QNetworkReply.
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
from PyQt6.QtCore import QBuffer, QIODevice, Qt
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtNetwork import QNetworkReply
from PyQt6.QtWidgets import QApplication

import champion_data
from champion_data import (
    ChampionData,
    ChampionImageCache,
    get_icon_cache_dir,
    get_shared_image_cache,
    prune_icon_cache,
)
from main_window import MainWindow


@pytest.fixture(scope="session")
def qapp():
    """Create QApplication instance for tests"""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app
    # No need to quit, pytest-qt handles it


class _StubReply:
    """Bare-bones stand-in for QNetworkReply.

    _on_image_downloaded() only calls error() / errorString() / readAll() /
    deleteLater() on its reply argument, so this plain object is enough --
    no real QNetworkAccessManager traffic is involved in these tests.
    """

    def __init__(self, error=QNetworkReply.NetworkError.NoError, error_string="", data=b""):
        self._error = error
        self._error_string = error_string
        self._data = data
        self.delete_later_called = False

    def error(self):
        return self._error

    def errorString(self):
        return self._error_string

    def readAll(self):
        return self._data

    def deleteLater(self):
        self.delete_later_called = True


def _make_valid_png_bytes(qapp) -> bytes:
    """Return the raw bytes of a tiny, decodable PNG (no network needed)."""
    image = QImage(2, 2, QImage.Format.Format_RGB32)
    image.fill(Qt.GlobalColor.red)
    buffer = QBuffer()
    buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    assert image.save(buffer, "PNG")
    return bytes(buffer.data())


def _make_champion_data(urls) -> ChampionData:
    """Build a ChampionData instance without touching champions.json on disk."""
    data = ChampionData.__new__(ChampionData)
    data.champions = {
        f"champ{i}": {"image_url": url, "english_name": f"Champ{i}"}
        for i, url in enumerate(urls)
    }
    return data


# --- 1. Disk round trip -----------------------------------------------------

def test_disk_round_trip_is_synchronous_across_instances(qapp, tmp_path):
    """After a successful download, a *different* cache instance sharing the
    same cache_dir should return the QPixmap synchronously (no callback)."""
    url = "https://ddragon.leagueoflegends.com/cdn/1.0.0/img/champion/Test.png"
    png_bytes = _make_valid_png_bytes(qapp)

    writer = ChampionImageCache(cache_dir=str(tmp_path))
    writer.pending_requests[url] = [lambda px: None]
    writer._on_image_downloaded(url, _StubReply(data=png_bytes))

    # Fresh instance, same cache_dir: no callback provided, must still return
    # a QPixmap synchronously (this is the whole point of the disk layer).
    reader = ChampionImageCache(cache_dir=str(tmp_path))
    result = reader.get_image(url)

    assert isinstance(result, QPixmap)
    assert not result.isNull()


# --- 2. Corrupted file -------------------------------------------------------

def test_corrupt_cache_file_is_deleted_and_returns_none(qapp, tmp_path):
    """A malformed cache file (e.g. left by a killed process) should be
    removed on read, and get_image() should report a miss (None)."""
    url = "https://ddragon.leagueoflegends.com/cdn/1.0.0/img/champion/Corrupt.png"
    cache = ChampionImageCache(cache_dir=str(tmp_path))

    path = cache._path_for_url(url)
    with open(path, "wb") as f:
        f.write(b"not a real png")
    assert os.path.exists(path)

    result = cache.get_image(url)

    assert result is None
    assert not os.path.exists(path)


# --- 3. Atomic write ----------------------------------------------------------

def test_save_to_disk_leaves_no_tmp_file_behind(qapp, tmp_path):
    """Writes go through a .tmp file + os.replace(); nothing should remain
    named *.tmp in the cache dir after a successful save."""
    url = "https://ddragon.leagueoflegends.com/cdn/1.0.0/img/champion/Atomic.png"
    png_bytes = _make_valid_png_bytes(qapp)
    cache = ChampionImageCache(cache_dir=str(tmp_path))

    cache._save_to_disk(url, png_bytes)

    names = os.listdir(tmp_path)
    assert any(name.endswith(".png") for name in names)
    assert not any(name.endswith(".tmp") for name in names)


# --- 4. Regression: network error must not wedge pending_requests -----------

def test_network_error_clears_pending_requests_and_allows_retry(qapp, tmp_path, monkeypatch):
    """Historical bug: pending_requests[url] was only cleared on success, so
    a single network failure wedged that URL for the rest of the process.
    _on_image_downloaded() must clear it unconditionally (finally block)."""
    url = "https://ddragon.leagueoflegends.com/cdn/1.0.0/img/champion/Broken.png"
    cache = ChampionImageCache(cache_dir=str(tmp_path))

    received = []
    cache.pending_requests[url] = [lambda px: received.append(px)]
    stub = _StubReply(
        error=QNetworkReply.NetworkError.HostNotFoundError,
        error_string="Host not found",
    )

    cache._on_image_downloaded(url, stub)

    assert url not in cache.pending_requests
    assert received == []  # callback must not fire on failure
    assert stub.delete_later_called

    download_calls = []
    monkeypatch.setattr(
        ChampionImageCache, "_download_image",
        lambda self, u: download_calls.append(u),
    )

    result = cache.get_image(url, callback=lambda px: None)

    assert result is None
    assert download_calls == [url]  # a fresh download was started, not wedged


# --- 5. Regression: decode failure must not wedge pending_requests ----------

def test_decode_failure_clears_pending_requests_and_allows_retry(qapp, tmp_path, monkeypatch):
    """Same as above, but for a response that reports success yet contains
    data that cannot be decoded as an image."""
    url = "https://ddragon.leagueoflegends.com/cdn/1.0.0/img/champion/Garbage.png"
    cache = ChampionImageCache(cache_dir=str(tmp_path))

    received = []
    cache.pending_requests[url] = [lambda px: received.append(px)]
    stub = _StubReply(data=b"this is not image data")

    cache._on_image_downloaded(url, stub)

    assert url not in cache.pending_requests
    assert received == []

    download_calls = []
    monkeypatch.setattr(
        ChampionImageCache, "_download_image",
        lambda self, u: download_calls.append(u),
    )

    cache.get_image(url, callback=lambda px: None)

    assert download_calls == [url]


# --- 6. prune_icon_cache ------------------------------------------------------

def test_prune_icon_cache_keeps_current_and_removes_stale(qapp, tmp_path):
    current_url = "https://ddragon.leagueoflegends.com/cdn/2.0.0/img/champion/Current.png"
    champion_data = _make_champion_data([current_url])

    cache = ChampionImageCache(cache_dir=str(tmp_path))
    current_path = cache._path_for_url(current_url)
    with open(current_path, "wb") as f:
        f.write(b"current icon bytes")

    stale_path = cache._path_for_url(
        "https://ddragon.leagueoflegends.com/cdn/1.0.0/img/champion/Stale.png"
    )
    with open(stale_path, "wb") as f:
        f.write(b"stale icon bytes")

    # Named the way _save_to_disk() actually stages a write, not an arbitrary name.
    tmp_leftover = cache._path_for_url(
        "https://ddragon.leagueoflegends.com/cdn/1.0.0/img/champion/Partial.png"
    ) + ".tmp"
    with open(tmp_leftover, "wb") as f:
        f.write(b"partial")

    removed = prune_icon_cache(champion_data, cache_dir=str(tmp_path))

    assert removed == 2
    assert os.path.exists(current_path)
    assert not os.path.exists(stale_path)
    assert not os.path.exists(tmp_leftover)


def test_prune_icon_cache_never_touches_unrelated_files(qapp, tmp_path):
    """Safety guard: prune runs at every startup, and LOL_VIEWER_ICON_CACHE_DIR
    could be misconfigured to point at a directory holding real user files.
    Only files matching our own "<sha256>.png[.tmp]" naming may be deleted."""
    champion_data = _make_champion_data([])

    bystanders = ["notes.txt", "holiday.png", "README.md", "0123.png"]
    for name in bystanders:
        with open(os.path.join(str(tmp_path), name), "wb") as f:
            f.write(b"precious user data")

    removed = prune_icon_cache(champion_data, cache_dir=str(tmp_path))

    assert removed == 0
    for name in bystanders:
        assert os.path.exists(os.path.join(str(tmp_path), name))


# --- 7. get_shared_image_cache singleton ------------------------------------

def test_get_shared_image_cache_returns_same_instance(qapp, tmp_path, monkeypatch):
    monkeypatch.setenv("LOL_VIEWER_ICON_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(champion_data, "_shared_image_cache", None)

    first = get_shared_image_cache()
    second = get_shared_image_cache()

    assert first is second


# --- 8. get_icon_cache_dir respects the env override ------------------------

def test_get_icon_cache_dir_respects_env_override(tmp_path, monkeypatch):
    custom_dir = tmp_path / "custom_icon_cache"
    monkeypatch.setenv("LOL_VIEWER_ICON_CACHE_DIR", str(custom_dir))

    result = get_icon_cache_dir()

    assert result == str(custom_dir)
    assert os.path.isdir(result)


# --- 9. Fully pre-filled cache -> zero downloads across two viewers ---------

def test_prefilled_cache_triggers_zero_downloads_across_viewers(qapp, tmp_path, monkeypatch):
    """This is the headline scenario from the plan: with every champion icon
    already on disk, opening viewers must not download anything at all --
    proving both the shared instance and the disk layer are working together.
    """
    monkeypatch.setenv("LOL_VIEWER_ICON_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(champion_data, "_shared_image_cache", None)

    # Seed the disk cache with every URL from the real champions.json.
    real_champion_data = ChampionData()
    png_bytes = _make_valid_png_bytes(qapp)
    seeder = ChampionImageCache(cache_dir=str(tmp_path))
    for info in real_champion_data.champions.values():
        image_url = info.get("image_url", "")
        if image_url:
            seeder._save_to_disk(image_url, png_bytes)

    download_calls = []
    monkeypatch.setattr(
        ChampionImageCache, "_download_image",
        lambda self, u: download_calls.append(u),
    )

    window = MainWindow()
    window.add_viewer()
    window.add_viewer()

    assert download_calls == []


# --- 10. Multiple viewers share the same cache instance ---------------------

def test_multiple_viewers_share_the_same_cache_instance(qapp, tmp_path, monkeypatch):
    monkeypatch.setenv("LOL_VIEWER_ICON_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(champion_data, "_shared_image_cache", None)

    window = MainWindow()
    viewer_a = window.add_viewer()
    viewer_b = window.add_viewer()

    assert viewer_a is not None and viewer_b is not None
    assert viewer_a._champion_icon_cache is viewer_b._champion_icon_cache
    assert viewer_a._champion_icon_cache is window._sidebar_image_cache
