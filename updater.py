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
    # Use nightly.link for faster downloads (especially from Asia)
    # References the release workflow which runs on every release
    NIGHTLY_LINK_URL = "https://nightly.link/kc7891/lol-viewer/workflows/release/main/lol-viewer-setup.zip"

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
        Get the download URL for the installer zip

        Args:
            release_info: Release information from GitHub API

        Returns:
            Download URL or None if not found
        """
        # Use nightly.link for faster downloads (especially from Japan/Asia)
        # nightly.link provides unauthenticated access to GitHub Actions artifacts
        # and is significantly faster than GitHub Releases (3+ hours -> minutes)
        logger.info(f"Using nightly.link for faster downloads: {self.NIGHTLY_LINK_URL}")
        return self.NIGHTLY_LINK_URL

    def download_update(self, download_url: str) -> str:
        """
        Download the installer

        Args:
            download_url: URL to download from

        Returns:
            Path to downloaded installer or None if failed
        """
        try:
            logger.info(f"Downloading installer from: {download_url}")

            # Determine file extension
            suffix = '.exe' if download_url.endswith('.exe') else '.zip'

            # Create progress dialog (non-cancelable for reliability)
            progress = QProgressDialog(
                "Downloading installer...\nThis may take a few minutes.",
                None,  # No cancel button
                0, 100,
                self.parent_widget
            )
            progress.setWindowModality(Qt.WindowModality.WindowModal)
            progress.setWindowTitle("Downloading Installer")
            progress.setMinimumDuration(0)  # Show immediately
            progress.setCancelButton(None)  # Remove cancel button

            # Download with progress (long timeout for large files)
            response = requests.get(download_url, stream=True, timeout=300)
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))
            total_mb = total_size / (1024 * 1024) if total_size > 0 else 0
            logger.info(f"Download size: {total_mb:.1f} MB")

            # Create temp file
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            temp_path = temp_file.name

            downloaded = 0
            chunk_size = 8192

            for chunk in response.iter_content(chunk_size=chunk_size):
                temp_file.write(chunk)
                downloaded += len(chunk)

                if total_size > 0:
                    percent = int(downloaded * 100 / total_size)
                    downloaded_mb = downloaded / (1024 * 1024)
                    progress.setValue(percent)
                    progress.setLabelText(
                        f"Downloading installer...\n"
                        f"{downloaded_mb:.1f} MB / {total_mb:.1f} MB ({percent}%)"
                    )

            temp_file.close()
            progress.close()

            logger.info(f"Download completed: {temp_path}")
            return temp_path

        except Exception as e:
            logger.error(f"Failed to download installer: {e}")
            QMessageBox.critical(
                self.parent_widget,
                "Download Failed",
                f"Failed to download installer:\n{str(e)}"
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

    def apply_update(self, installer_path: str):
        """
        Apply the update by extracting zip and running the installer

        Args:
            installer_path: Path to the downloaded installer zip
        """
        try:
            current_exe = sys.argv[0]

            # Check if running as executable (not python script)
            if not current_exe.endswith('.exe'):
                logger.warning("Not running as .exe, cannot apply update automatically")
                QMessageBox.information(
                    self.parent_widget,
                    "Update Downloaded",
                    "Update has been downloaded but cannot be applied automatically "
                    "when running from Python script.\n\n"
                    f"Downloaded file: {installer_path}\n\n"
                    "Please extract and run the installer manually."
                )
                return

            # Extract setup.exe from zip
            logger.info(f"Extracting installer from: {installer_path}")
            setup_exe_path = self._extract_exe_from_zip(installer_path)

            if not setup_exe_path:
                QMessageBox.critical(
                    self.parent_widget,
                    "Update Failed",
                    "Failed to extract installer from zip file."
                )
                return

            logger.info(f"Running installer: {setup_exe_path}")

            # Show info to user
            QMessageBox.information(
                self.parent_widget,
                "Update Ready",
                "The installer will now run to update the application.\n"
                "Please follow the installer prompts.\n\n"
                "The application will close now."
            )

            # Launch installer with UI visible
            # /CLOSEAPPLICATIONS = automatically close running instances
            # /RESTARTAPPLICATIONS = restart app after installation
            # Note: No /SILENT flag - shows normal installer UI for better UX
            subprocess.Popen([setup_exe_path, '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'])

            logger.info("Installer launched, exiting application")
            sys.exit(0)

        except Exception as e:
            logger.error(f"Failed to run installer: {e}")
            QMessageBox.critical(
                self.parent_widget,
                "Update Failed",
                f"Failed to run installer:\n{str(e)}\n\n"
                f"Downloaded file: {installer_path}\n\n"
                "Please extract and run the installer manually."
            )

    def check_and_update(self):
        """
        Complete update flow: check, prompt, download, and apply immediately

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

        # Download installer
        installer_path = self.download_update(download_url)
        if not installer_path:
            return False

        # Run installer (will exit app)
        self.apply_update(installer_path)
        return True  # If we reach here, something went wrong (app should have exited)
