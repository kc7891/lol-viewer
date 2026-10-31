#!/usr/bin/env python3
"""
Guard: the PyQt6 wheels in requirements.txt must share the same major.minor.

PyQt6-WebEngine's DLLs are linked against the Qt core DLLs of their own minor
release. A lock with e.g. PyQt6-Qt6 6.12 + PyQt6-WebEngine-Qt6 6.11 installs
fine and passes the Linux test suite (WebEngine is disabled there), but the
Windows build crashes at startup with "DLL load failed while importing
QtWebEngineWidgets". This test makes such a lock fail CI instead.
"""
import os
import re

REQUIREMENTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "requirements.txt")
PYQT6_PACKAGES = ("pyqt6", "pyqt6-qt6", "pyqt6-webengine", "pyqt6-webengine-qt6")


def _locked_versions(path: str = REQUIREMENTS) -> dict:
    versions = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^([A-Za-z0-9_.-]+)==([^\s\\;]+)", line)
            if m:
                versions[m.group(1).lower().replace("_", "-")] = m.group(2)
    return versions


def _minor(version: str) -> tuple:
    return tuple(int(p) for p in version.split(".")[:2])


def test_pyqt6_packages_are_locked():
    versions = _locked_versions()
    missing = [p for p in PYQT6_PACKAGES if p not in versions]
    assert not missing, f"PyQt6 packages missing from requirements.txt: {missing}"


def test_pyqt6_packages_share_major_minor():
    versions = _locked_versions()
    minors = {p: _minor(versions[p]) for p in PYQT6_PACKAGES}
    assert len(set(minors.values())) == 1, (
        "PyQt6 / PyQt6-Qt6 / PyQt6-WebEngine / PyQt6-WebEngine-Qt6 must share the same "
        f"major.minor in requirements.txt, got {[f'{p}=={versions[p]}' for p in PYQT6_PACKAGES]}. "
        "See the PyQt6 comment in pyproject.toml."
    )
