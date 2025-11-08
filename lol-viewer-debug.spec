# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for LoL Viewer (Debug version)
Usage: pyinstaller lol-viewer-debug.spec
"""
import os

# Get the directory containing this spec file
spec_root = os.path.abspath(SPECPATH)

block_cipher = None

a = Analysis(
    [os.path.join(spec_root, 'main.py')],
    pathex=[],
    binaries=[],
    datas=[(os.path.join(spec_root, 'champions.json'), '.')],  # Embed champions.json
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='lol-viewer-debug',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Windowed application
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
