#!/usr/bin/env python3
"""
Clean build script - removes build artifacts before building
"""
import os
import shutil
import sys


def clean_build():
    """Remove build artifacts"""
    script_dir = os.path.dirname(os.path.abspath(__file__))

    folders_to_remove = ['build', 'dist']
    files_to_remove = ['*.spec~']  # Backup spec files

    print("Cleaning build artifacts...")

    for folder in folders_to_remove:
        folder_path = os.path.join(script_dir, folder)
        if os.path.exists(folder_path):
            print(f"  Removing {folder}/")
            shutil.rmtree(folder_path)

    print("[OK] Clean complete!")
    print()
    print("You can now build with:")
    print("  pyinstaller lol-viewer-debug.spec")
    print("  or")
    print("  pyinstaller lol-viewer.spec")


if __name__ == "__main__":
    clean_build()
