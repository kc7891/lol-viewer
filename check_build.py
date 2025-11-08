#!/usr/bin/env python3
"""
Debug script to check if champions.json is embedded in the executable
Run this BEFORE building to verify champions.json exists
"""
import os
import sys


def check_build_prerequisites():
    """Check if all files needed for build are present"""
    print("=" * 60)
    print("PRE-BUILD CHECK")
    print("=" * 60)

    # Get the directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    print(f"Project directory: {script_dir}")

    # Check for required files
    required_files = [
        'main.py',
        'champion_data.py',
        'logger.py',
        'champions.json',
        'lol-viewer-debug.spec',
        'lol-viewer.spec'
    ]

    all_present = True
    for filename in required_files:
        filepath = os.path.join(script_dir, filename)
        exists = os.path.exists(filepath)
        status = "[OK]  " if exists else "[FAIL]"

        if exists:
            size = os.path.getsize(filepath)
            print(f"{status} {filename} ({size:,} bytes)")
        else:
            print(f"{status} {filename} - NOT FOUND!")
            all_present = False

    print()

    # Check champions.json specifically
    champions_json = os.path.join(script_dir, 'champions.json')
    if os.path.exists(champions_json):
        import json
        try:
            with open(champions_json, 'r', encoding='utf-8') as f:
                data = json.load(f)
            print(f"[OK]   champions.json is valid JSON with {len(data)} champions")
        except Exception as e:
            print(f"[FAIL] champions.json is invalid: {e}")
            all_present = False

    print()
    print("=" * 60)

    if all_present:
        print("[OK]   All required files are present!")
        print()
        print("You can now build with:")
        print("  pyinstaller lol-viewer-debug.spec")
        print("  or")
        print("  pyinstaller lol-viewer.spec")
    else:
        print("[FAIL] Some files are missing. Please fix before building.")
        return 1

    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(check_build_prerequisites())
