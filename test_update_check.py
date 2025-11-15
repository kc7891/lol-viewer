#!/usr/bin/env python3
"""
Standalone script to test the update checker without building exe
"""
import sys
from packaging import version


def test_update_check():
    """Test update check functionality"""

    # Test version (set to older version to trigger update)
    current_version = "0.1.0"

    print("=" * 60)
    print("Testing Update Checker")
    print("=" * 60)
    print(f"Current version: {current_version}")
    print(f"Repository: kc7891/lol-viewer")
    print()

    # Import updater
    try:
        from updater import Updater
    except ImportError as e:
        print(f"Error: Could not import updater module: {e}")
        print("Make sure you have installed all dependencies:")
        print("  pip install -r requirements.txt")
        return

    # Create updater instance (without parent widget for testing)
    updater = Updater(current_version, parent_widget=None)

    # Check for updates
    print("Checking for updates...")
    has_update, release_info = updater.check_for_updates()

    if has_update:
        latest_version = release_info.get('tag_name', 'Unknown').lstrip('v')
        print(f"✓ Update available!")
        print(f"  Latest version: {latest_version}")
        print(f"  Release name: {release_info.get('name', 'N/A')}")
        print(f"  Published: {release_info.get('published_at', 'N/A')}")
        print()

        # Show release notes
        release_notes = release_info.get('body', 'No release notes')
        print("Release notes:")
        print("-" * 60)
        print(release_notes[:500])
        if len(release_notes) > 500:
            print("...")
        print("-" * 60)
        print()

        # Check download URL
        download_url = updater.get_download_url(release_info)
        if download_url:
            print(f"✓ Download URL found: {download_url}")
        else:
            print("✗ No download URL found")
            print("  Available assets:")
            for asset in release_info.get('assets', []):
                print(f"    - {asset['name']}")

    elif release_info is None:
        print("✗ Could not check for updates")
        print("  Possible reasons:")
        print("    - No internet connection")
        print("    - GitHub API rate limit")
        print("    - No releases found in repository")
    else:
        print("✓ Application is up to date")

    print()
    print("=" * 60)
    print("Test completed")
    print("=" * 60)


if __name__ == "__main__":
    test_update_check()
