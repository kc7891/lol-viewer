"""
Tests for the updater module
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from updater import Updater


class TestUpdater:
    """Test cases for the Updater class"""

    def test_version_comparison_update_available(self):
        """Test that newer version is detected"""
        updater = Updater("1.0.0")

        mock_response = Mock()
        mock_response.json.return_value = {
            'tag_name': 'v1.1.0',
            'body': 'New features added'
        }

        with patch('requests.get', return_value=mock_response):
            has_update, release_info = updater.check_for_updates()

        assert has_update is True
        assert release_info is not None
        assert release_info['tag_name'] == 'v1.1.0'

    def test_version_comparison_up_to_date(self):
        """Test that same version is not treated as update"""
        updater = Updater("1.0.0")

        mock_response = Mock()
        mock_response.json.return_value = {
            'tag_name': 'v1.0.0',
            'body': 'Current version'
        }

        with patch('requests.get', return_value=mock_response):
            has_update, release_info = updater.check_for_updates()

        assert has_update is False
        # Successful check should still return release info (used by UI to show latest version)
        assert release_info is not None
        assert release_info['tag_name'] == 'v1.0.0'

    def test_version_comparison_older_remote(self):
        """Test that older remote version is not treated as update"""
        updater = Updater("2.0.0")

        mock_response = Mock()
        mock_response.json.return_value = {
            'tag_name': 'v1.5.0',
            'body': 'Older version'
        }

        with patch('requests.get', return_value=mock_response):
            has_update, release_info = updater.check_for_updates()

        assert has_update is False
        # Successful check should still return release info (used by UI to show latest version)
        assert release_info is not None
        assert release_info['tag_name'] == 'v1.5.0'

    def test_network_error_handling(self):
        """Test that network errors are handled gracefully"""
        updater = Updater("1.0.0")

        with patch('requests.get', side_effect=Exception("Network error")):
            has_update, release_info = updater.check_for_updates()

        assert has_update is False
        assert release_info is None

    def test_get_download_url_regular_version(self):
        """Test download URL extraction for regular version"""
        updater = Updater("1.0.0")

        release_info = {
            'assets': [
                {'name': 'lol-viewer.exe', 'browser_download_url': 'http://example.com/lol-viewer.exe'},
                {'name': 'lol-viewer-debug.exe', 'browser_download_url': 'http://example.com/debug.exe'},
            ]
        }

        with patch('sys.argv', ['lol-viewer.exe']):
            url = updater.get_download_url(release_info)

        assert url == 'http://example.com/lol-viewer.exe'

    def test_get_download_url_debug_version(self):
        """Test download URL extraction for debug version"""
        updater = Updater("1.0.0")

        release_info = {
            'assets': [
                {'name': 'lol-viewer.exe', 'browser_download_url': 'http://example.com/lol-viewer.exe'},
                {'name': 'lol-viewer-debug.exe', 'browser_download_url': 'http://example.com/debug.exe'},
            ]
        }

        with patch('sys.argv', ['lol-viewer-debug.exe']):
            url = updater.get_download_url(release_info)

        assert url == 'http://example.com/debug.exe'

    def test_get_download_url_not_found(self):
        """Test when download URL is not found"""
        updater = Updater("1.0.0")

        release_info = {
            'assets': []
        }

        url = updater.get_download_url(release_info)
        assert url is None

    def test_update_script_generation(self):
        """Test that update script is generated correctly"""
        updater = Updater("1.0.0")

        script_path = updater._create_update_script(
            "C:\\app\\lol-viewer.exe",
            "C:\\temp\\new.exe"
        )

        # Check that script file was created
        assert script_path is not None
        assert script_path.endswith('.bat')

        # Read and verify script content
        with open(script_path, 'r') as f:
            content = f.read()

        assert 'lol-viewer.exe' in content
        assert 'new.exe' in content
        assert 'timeout' in content.lower()
        assert 'move' in content.lower()

        # Clean up
        import os
        os.unlink(script_path)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
