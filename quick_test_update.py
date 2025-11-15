#!/usr/bin/env python3
"""
Quick test for update checker without Qt dependencies
"""
import requests
from packaging import version


def quick_test():
    """Quick test of GitHub API update check"""

    CURRENT_VERSION = "0.1.0"  # Set to old version to test update detection
    GITHUB_REPO = "kc7891/lol-viewer"
    API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

    print("=" * 70)
    print("Quick Update Check Test")
    print("=" * 70)
    print(f"Current version: {CURRENT_VERSION}")
    print(f"Checking: {API_URL}")
    print()

    try:
        response = requests.get(API_URL, timeout=5)
        response.raise_for_status()

        release_data = response.json()
        latest_version = release_data.get('tag_name', '').lstrip('v')

        print(f"✓ API Response received")
        print(f"  Latest version: {latest_version}")
        print(f"  Release name: {release_data.get('name', 'N/A')}")
        print(f"  Published at: {release_data.get('published_at', 'N/A')}")
        print()

        # Compare versions
        if version.parse(latest_version) > version.parse(CURRENT_VERSION):
            print(f"✓ UPDATE AVAILABLE: {CURRENT_VERSION} → {latest_version}")
            print()

            # Show assets
            assets = release_data.get('assets', [])
            print(f"Release assets ({len(assets)} files):")
            for asset in assets:
                print(f"  - {asset['name']}")
                print(f"    Size: {asset['size']:,} bytes")
                print(f"    Downloads: {asset['download_count']}")
            print()

            # Show release notes (first 300 chars)
            body = release_data.get('body', 'No release notes')
            print("Release notes:")
            print("-" * 70)
            print(body[:300])
            if len(body) > 300:
                print("...")
            print("-" * 70)

        else:
            print(f"✓ Up to date (latest: {latest_version})")

    except requests.exceptions.RequestException as e:
        print(f"✗ Network error: {e}")
    except Exception as e:
        print(f"✗ Error: {e}")

    print()
    print("=" * 70)
    print("Test completed")
    print("=" * 70)


if __name__ == "__main__":
    quick_test()
