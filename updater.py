"""
Auto-update functionality using GitHub Releases API
"""
import os
import sys
import logging
import requests
import tempfile
import subprocess
import zipfile
from pathlib import Path
from packaging import version
from PyQt6.QtWidgets import QMessageBox, QProgressDialog
from PyQt6.QtCore import Qt

logger = logging.getLogger(__name__)


class Updater:
    """Handles application updates from GitHub Releases"""

    GITHUB_REPO = "kc7891/lol-viewer"
    GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

    def __init__(self, current_version: str, parent_widget=None):
        """
        Initialize updater

        Args:
            current_version: Current application version (e.g., "1.0.0")
            parent_widget: Parent QWidget for dialogs
        """
        self.current_version = current_version
        self.parent_widget = parent_widget

    def check_for_updates(self) -> tuple[bool, dict]:
        """
        Check if a new version is available

        Returns:
            Tuple of (has_update, release_info)
            - has_update: True if new version available
            - release_info: Dict with release information or None
        """
        try:
            logger.info(f"Checking for updates (current version: {self.current_version})")
            response = requests.get(self.GITHUB_API_URL, timeout=5)
            response.raise_for_status()

            release_data = response.json()
            latest_version = release_data.get('tag_name', '').lstrip('v')

            if not latest_version:
                logger.warning("Could not determine latest version from GitHub")
                return False, None

            logger.info(f"Latest version on GitHub: {latest_version}")

            # Compare versions
            current_parsed = version.parse(self.current_version)
            latest_parsed = version.parse(latest_version)

            logger.info(f"Version comparison: {current_parsed} vs {latest_parsed}")

            if latest_parsed > current_parsed:
                logger.info(f"✓ Update available: {self.current_version} → {latest_version}")
                return True, release_data
            else:
                logger.info(f"✓ Application is up to date (current: {self.current_version}, latest: {latest_version})")
                return False, None

        except requests.exceptions.RequestException as e:
            logger.warning(f"Failed to check for updates: {e}")
            return False, None
        except Exception as e:
            logger.error(f"Unexpected error while checking updates: {e}")
            return False, None

    def prompt_update(self, release_info: dict) -> bool:
        """
        Show update dialog to user

        Args:
            release_info: Release information from GitHub API

        Returns:
            True if user wants to update, False otherwise
        """
        latest_version = release_info.get('tag_name', 'Unknown').lstrip('v')
        release_notes = release_info.get('body', 'No release notes available.')

        message = (
            f"A new version is available!\n\n"
            f"Current version: {self.current_version}\n"
            f"Latest version: {latest_version}\n\n"
            f"Release notes:\n{release_notes[:200]}...\n\n"
            f"Do you want to update to the latest version?"
        )

        reply = QMessageBox.question(
            self.parent_widget,
            "Update Available",
            message,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes
        )

        return reply == QMessageBox.StandardButton.Yes

    def get_download_url(self, release_info: dict) -> str:
        """
        Get the download URL for the appropriate executable

        Args:
            release_info: Release information from GitHub API

        Returns:
            Download URL or None if not found
        """
        assets = release_info.get('assets', [])

        logger.info(f"Found {len(assets)} assets in release")
        for asset in assets:
            logger.info(f"  - {asset['name']}")

        # Determine which executable to download based on current running exe
        current_exe = os.path.basename(sys.argv[0])
        is_debug = 'debug' in current_exe.lower()

        # Look for the appropriate asset
        target_name = 'lol-viewer-debug.exe' if is_debug else 'lol-viewer.exe'

        # Priority 1: Direct .exe file
        for asset in assets:
            if asset['name'] == target_name:
                logger.info(f"Found exact match: {asset['name']}")
                return asset['browser_download_url']

        # Priority 2: Any .exe file
        for asset in assets:
            if asset['name'].endswith('.exe'):
                logger.warning(f"Exact match not found, using: {asset['name']}")
                return asset['browser_download_url']

        # Priority 3: .zip file containing exe
        for asset in assets:
            if asset['name'].endswith('.zip'):
                logger.info(f"Found zip file: {asset['name']}, will extract exe from it")
                return asset['browser_download_url']

        logger.error("No suitable download asset found (.exe or .zip)")
        return None

    def download_update(self, download_url: str) -> str:
        """
        Download the update file

        Args:
            download_url: URL to download from

        Returns:
            Path to downloaded exe file or None if failed
        """
        try:
            logger.info(f"Downloading update from: {download_url}")

            # Determine if downloading zip or exe
            is_zip = download_url.endswith('.zip')
            suffix = '.zip' if is_zip else '.exe'

            # Create progress dialog
            progress = QProgressDialog(
                "Downloading update...",
                "Cancel",
                0, 100,
                self.parent_widget
            )
            progress.setWindowModality(Qt.WindowModality.WindowModal)
            progress.setWindowTitle("Updating")

            # Download with progress
            response = requests.get(download_url, stream=True, timeout=30)
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))

            # Create temp file
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            temp_path = temp_file.name

            downloaded = 0
            chunk_size = 8192

            for chunk in response.iter_content(chunk_size=chunk_size):
                if progress.wasCanceled():
                    temp_file.close()
                    os.unlink(temp_path)
                    return None

                temp_file.write(chunk)
                downloaded += len(chunk)

                if total_size > 0:
                    progress.setValue(int(downloaded * 100 / total_size))

            temp_file.close()
            progress.close()

            logger.info(f"Download completed: {temp_path}")

            # If zip file, extract exe
            if is_zip:
                logger.info("Extracting exe from zip file...")
                exe_path = self._extract_exe_from_zip(temp_path)

                # Clean up zip file
                try:
                    os.unlink(temp_path)
                except:
                    pass

                if not exe_path:
                    QMessageBox.critical(
                        self.parent_widget,
                        "Extraction Failed",
                        "Failed to extract executable from zip file"
                    )
                    return None

                logger.info(f"Exe extracted to: {exe_path}")
                return exe_path
            else:
                return temp_path

        except Exception as e:
            logger.error(f"Failed to download update: {e}")
            QMessageBox.critical(
                self.parent_widget,
                "Download Failed",
                f"Failed to download update:\n{str(e)}"
            )
            return None

    def _extract_exe_from_zip(self, zip_path: str) -> str:
        """
        Extract exe file from zip archive

        Args:
            zip_path: Path to zip file

        Returns:
            Path to extracted exe or None if not found
        """
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                # List all files in zip
                file_list = zip_ref.namelist()
                logger.info(f"Files in zip: {file_list}")

                # Find exe file
                exe_file = None
                for filename in file_list:
                    if filename.endswith('.exe') and not filename.startswith('__MACOSX'):
                        exe_file = filename
                        logger.info(f"Found exe in zip: {exe_file}")
                        break

                if not exe_file:
                    logger.error("No .exe file found in zip archive")
                    return None

                # Extract to temp directory
                temp_dir = tempfile.mkdtemp()
                zip_ref.extract(exe_file, temp_dir)

                extracted_path = os.path.join(temp_dir, exe_file)
                logger.info(f"Extracted to: {extracted_path}")

                return extracted_path

        except Exception as e:
            logger.error(f"Failed to extract exe from zip: {e}")
            return None

    def apply_update(self, new_exe_path: str):
        """
        Apply the update by replacing current executable

        Args:
            new_exe_path: Path to the new executable
        """
        try:
            current_exe = sys.argv[0]

            # Check if running as executable (not python script)
            if not current_exe.endswith('.exe'):
                logger.warning("Not running as .exe, cannot apply update")
                QMessageBox.information(
                    self.parent_widget,
                    "Update Downloaded",
                    "Update has been downloaded but cannot be applied automatically "
                    "when running from Python script.\n\n"
                    f"Please manually replace the executable with:\n{new_exe_path}"
                )
                return

            # Create batch script to replace exe
            batch_script = self._create_update_script(current_exe, new_exe_path)

            logger.info("Launching update script and exiting application")

            # Show info to user
            QMessageBox.information(
                self.parent_widget,
                "Update Ready",
                "The application will now close and update.\n"
                "Please wait a moment, then the updated version will start automatically."
            )

            # Launch batch script and exit
            subprocess.Popen([batch_script], shell=True)
            sys.exit(0)

        except Exception as e:
            logger.error(f"Failed to apply update: {e}")
            QMessageBox.critical(
                self.parent_widget,
                "Update Failed",
                f"Failed to apply update:\n{str(e)}\n\n"
                f"You can manually replace the executable with:\n{new_exe_path}"
            )

    def _create_update_script(self, current_exe: str, new_exe: str) -> str:
        """
        Create a batch script to replace the executable

        Args:
            current_exe: Path to current executable
            new_exe: Path to new executable

        Returns:
            Path to the batch script
        """
        batch_content = f"""@echo off
echo Updating LoL Viewer...
timeout /t 2 /nobreak >nul

:retry
del /f /q "{current_exe}" 2>nul
if exist "{current_exe}" (
    timeout /t 1 /nobreak >nul
    goto retry
)

move /y "{new_exe}" "{current_exe}"

if exist "{current_exe}" (
    echo Update completed. Starting application...
    start "" "{current_exe}"
) else (
    echo Update failed!
    pause
)

del "%~f0"
"""

        # Create temp batch file
        batch_file = tempfile.NamedTemporaryFile(
            mode='w',
            delete=False,
            suffix='.bat'
        )
        batch_file.write(batch_content)
        batch_file.close()

        return batch_file.name

    def check_and_update(self):
        """
        Complete update flow: check, prompt, download, and apply

        Returns:
            True if update was applied (app will exit), False otherwise
        """
        # Check for updates
        has_update, release_info = self.check_for_updates()

        if not has_update:
            return False

        # Prompt user
        if not self.prompt_update(release_info):
            logger.info("User declined update")
            return False

        # Get download URL
        download_url = self.get_download_url(release_info)
        if not download_url:
            QMessageBox.warning(
                self.parent_widget,
                "Update Failed",
                "Could not find download URL for the update."
            )
            return False

        # Download update
        new_exe_path = self.download_update(download_url)
        if not new_exe_path:
            return False

        # Apply update
        self.apply_update(new_exe_path)
        return True
