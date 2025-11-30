#!/usr/bin/env python3
"""
Settings Manager - Persistent settings storage using JSON file

This module provides settings persistence that survives application updates
by storing settings in a JSON file in the application directory.
"""
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Settings file name
SETTINGS_FILE_NAME = "settings.json"


def get_app_directory() -> Path:
    """
    Get the application directory where settings should be stored.

    For frozen applications (PyInstaller), this returns the directory
    containing the executable. For development, it returns the script directory.
    """
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        return Path(sys.executable).parent
    else:
        # Running as script
        return Path(__file__).parent


class SettingsManager:
    """
    Manages application settings using a JSON file in the app directory.

    This ensures settings persist across application updates since the
    settings file is stored alongside the application executable.
    """

    def __init__(self, defaults: Optional[dict] = None):
        """
        Initialize the settings manager.

        Args:
            defaults: Default values for settings
        """
        self._defaults = defaults or {}
        self._settings: dict = {}
        self._settings_file = get_app_directory() / SETTINGS_FILE_NAME
        self._load()

    def _load(self) -> None:
        """Load settings from JSON file."""
        if self._settings_file.exists():
            try:
                with open(self._settings_file, 'r', encoding='utf-8') as f:
                    self._settings = json.load(f)
                logger.info(f"Settings loaded from {self._settings_file}")
            except (json.JSONDecodeError, IOError) as e:
                logger.warning(f"Failed to load settings: {e}. Using defaults.")
                self._settings = {}
        else:
            logger.info(f"Settings file not found at {self._settings_file}. Using defaults.")
            self._settings = {}

    def _save(self) -> bool:
        """
        Save settings to JSON file.

        Returns:
            True if save was successful, False otherwise
        """
        try:
            with open(self._settings_file, 'w', encoding='utf-8') as f:
                json.dump(self._settings, f, indent=2, ensure_ascii=False)
            logger.info(f"Settings saved to {self._settings_file}")
            return True
        except IOError as e:
            logger.error(f"Failed to save settings: {e}")
            return False

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a setting value.

        Args:
            key: Setting key
            default: Default value if key doesn't exist

        Returns:
            The setting value or default
        """
        # Check in-memory settings first
        if key in self._settings:
            return self._settings[key]
        # Then check constructor defaults
        if key in self._defaults:
            return self._defaults[key]
        # Finally use provided default
        return default

    def set(self, key: str, value: Any) -> bool:
        """
        Set a setting value and save to file.

        Args:
            key: Setting key
            value: Setting value

        Returns:
            True if save was successful, False otherwise
        """
        self._settings[key] = value
        return self._save()

    def set_multiple(self, settings: dict) -> bool:
        """
        Set multiple settings at once and save to file.

        Args:
            settings: Dictionary of key-value pairs to set

        Returns:
            True if save was successful, False otherwise
        """
        self._settings.update(settings)
        return self._save()

    def remove(self, key: str) -> bool:
        """
        Remove a setting.

        Args:
            key: Setting key to remove

        Returns:
            True if save was successful, False otherwise
        """
        if key in self._settings:
            del self._settings[key]
            return self._save()
        return True

    def has(self, key: str) -> bool:
        """
        Check if a setting exists.

        Args:
            key: Setting key

        Returns:
            True if the setting exists
        """
        return key in self._settings

    def get_all(self) -> dict:
        """
        Get all settings.

        Returns:
            Dictionary of all settings
        """
        # Merge defaults with current settings
        result = self._defaults.copy()
        result.update(self._settings)
        return result

    def reset_to_defaults(self) -> bool:
        """
        Reset all settings to defaults.

        Returns:
            True if save was successful, False otherwise
        """
        self._settings = {}
        return self._save()

    @property
    def settings_file_path(self) -> Path:
        """Get the path to the settings file."""
        return self._settings_file


def migrate_from_qsettings(settings_manager: SettingsManager, qsettings) -> bool:
    """
    Migrate settings from QSettings to SettingsManager.

    This function checks if there are settings in QSettings that haven't
    been migrated yet, and copies them to the JSON-based settings.

    Args:
        settings_manager: The SettingsManager instance
        qsettings: QSettings instance to migrate from

    Returns:
        True if migration was performed, False if not needed
    """
    # Check if migration is needed (settings file doesn't exist or is empty)
    if settings_manager.has("_migrated"):
        logger.info("Settings already migrated from QSettings")
        return False

    # Keys to migrate
    keys_to_migrate = [
        "build_url",
        "counter_url",
        "aram_url",
        "live_game_url",
        "sidebar_width"
    ]

    migrated_settings = {}
    has_qsettings_data = False

    for key in keys_to_migrate:
        value = qsettings.value(key)
        if value is not None:
            # Convert sidebar_width to int if it exists
            if key == "sidebar_width":
                try:
                    value = int(value)
                except (ValueError, TypeError):
                    continue
            migrated_settings[key] = value
            has_qsettings_data = True
            logger.info(f"Migrating setting '{key}' from QSettings")

    if has_qsettings_data:
        # Mark as migrated
        migrated_settings["_migrated"] = True
        settings_manager.set_multiple(migrated_settings)
        logger.info("Settings migration from QSettings completed")
        return True
    else:
        # No QSettings data, just mark as migrated
        settings_manager.set("_migrated", True)
        logger.info("No QSettings data to migrate")
        return False
