# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for LoL Viewer (Release version)
Usage: pyinstaller lol-viewer.spec
"""
import os

# Get the directory containing this spec file
spec_root = os.path.abspath(SPECPATH)

block_cipher = None

a = Analysis(
    [os.path.join(spec_root, 'main.py')],
    pathex=[],
    binaries=[],
    datas=[
        (os.path.join(spec_root, 'champions.json'), '.'),  # Embed champions.json
        (os.path.join(spec_root, 'champion_thumbnails'), 'champion_thumbnails'),  # Embed champion thumbnails
        (os.path.join(spec_root, 'assets', 'icons', 'main-icon.png'), os.path.join('assets', 'icons')),  # Embed icon
    ],
    hiddenimports=[
        'lcu_detector',
        'psutil',
        'requests',
        'urllib3',
        'urllib3.util',
        'urllib3.util.retry',
        'urllib3.exceptions',
        'champion_data',
        'logger',
        'updater',
        'packaging',
        'packaging.version',
    ],
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
    [],
    exclude_binaries=True,  # Use onedir format to include all DLLs
    name='lol-viewer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # Windowed application
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(spec_root, 'assets', 'icons', 'app_icon.ico'),  # Application icon
    uac_admin=False,
    uac_uiaccess=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='lol-viewer'
)
