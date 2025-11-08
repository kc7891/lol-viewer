#!/usr/bin/env python3
"""
Auto-startup functionality for LoL Viewer
Supports Windows, macOS, and Linux
"""
import os
import sys
import platform
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class AutoStartManager:
    """Manages auto-startup settings across different operating systems"""

    def __init__(self, app_name="LoL Viewer"):
        self.app_name = app_name
        self.system = platform.system()

    def get_executable_path(self):
        """Get the path to the current executable"""
        if getattr(sys, 'frozen', False):
            # Running as compiled executable (PyInstaller)
            return sys.executable
        else:
            # Running as script
            return sys.executable + " " + os.path.abspath(sys.argv[0])

    def is_enabled(self):
        """Check if auto-startup is currently enabled"""
        try:
            if self.system == "Windows":
                return self._is_enabled_windows()
            elif self.system == "Darwin":
                return self._is_enabled_macos()
            elif self.system == "Linux":
                return self._is_enabled_linux()
            else:
                logger.warning(f"Unsupported platform: {self.system}")
                return False
        except Exception as e:
            logger.error(f"Error checking auto-startup status: {e}")
            return False

    def enable(self):
        """Enable auto-startup"""
        try:
            if self.system == "Windows":
                return self._enable_windows()
            elif self.system == "Darwin":
                return self._enable_macos()
            elif self.system == "Linux":
                return self._enable_linux()
            else:
                logger.warning(f"Unsupported platform: {self.system}")
                return False
        except Exception as e:
            logger.error(f"Error enabling auto-startup: {e}")
            return False

    def disable(self):
        """Disable auto-startup"""
        try:
            if self.system == "Windows":
                return self._disable_windows()
            elif self.system == "Darwin":
                return self._disable_macos()
            elif self.system == "Linux":
                return self._disable_linux()
            else:
                logger.warning(f"Unsupported platform: {self.system}")
                return False
        except Exception as e:
            logger.error(f"Error disabling auto-startup: {e}")
            return False

    # Windows implementation
    def _is_enabled_windows(self):
        """Check if auto-startup is enabled on Windows"""
        try:
            import winreg
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ) as key:
                try:
                    winreg.QueryValueEx(key, self.app_name)
                    return True
                except FileNotFoundError:
                    return False
        except ImportError:
            logger.error("winreg module not available")
            return False

    def _enable_windows(self):
        """Enable auto-startup on Windows"""
        try:
            import winreg
            exe_path = self.get_executable_path()
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
                winreg.SetValueEx(key, self.app_name, 0, winreg.REG_SZ, exe_path)

            logger.info(f"Auto-startup enabled on Windows: {exe_path}")
            return True
        except ImportError:
            logger.error("winreg module not available")
            return False

    def _disable_windows(self):
        """Disable auto-startup on Windows"""
        try:
            import winreg
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
                try:
                    winreg.DeleteValue(key, self.app_name)
                    logger.info("Auto-startup disabled on Windows")
                    return True
                except FileNotFoundError:
                    logger.info("Auto-startup was not enabled")
                    return True
        except ImportError:
            logger.error("winreg module not available")
            return False

    # macOS implementation
    def _is_enabled_macos(self):
        """Check if auto-startup is enabled on macOS"""
        plist_path = self._get_macos_plist_path()
        return plist_path.exists()

    def _enable_macos(self):
        """Enable auto-startup on macOS"""
        plist_path = self._get_macos_plist_path()
        exe_path = self.get_executable_path()

        # Create LaunchAgents directory if it doesn't exist
        plist_path.parent.mkdir(parents=True, exist_ok=True)

        # Create plist content
        plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lolviewer.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"""

        with open(plist_path, 'w') as f:
            f.write(plist_content)

        logger.info(f"Auto-startup enabled on macOS: {plist_path}")
        return True

    def _disable_macos(self):
        """Disable auto-startup on macOS"""
        plist_path = self._get_macos_plist_path()

        if plist_path.exists():
            plist_path.unlink()
            logger.info("Auto-startup disabled on macOS")

        return True

    def _get_macos_plist_path(self):
        """Get the path to the macOS plist file"""
        home = Path.home()
        return home / "Library" / "LaunchAgents" / "com.lolviewer.app.plist"

    # Linux implementation
    def _is_enabled_linux(self):
        """Check if auto-startup is enabled on Linux"""
        desktop_path = self._get_linux_desktop_path()
        return desktop_path.exists()

    def _enable_linux(self):
        """Enable auto-startup on Linux"""
        desktop_path = self._get_linux_desktop_path()
        exe_path = self.get_executable_path()

        # Create autostart directory if it doesn't exist
        desktop_path.parent.mkdir(parents=True, exist_ok=True)

        # Create desktop entry content
        desktop_content = f"""[Desktop Entry]
Type=Application
Name={self.app_name}
Exec={exe_path}
Terminal=false
X-GNOME-Autostart-enabled=true
"""

        with open(desktop_path, 'w') as f:
            f.write(desktop_content)

        # Make it executable
        desktop_path.chmod(0o755)

        logger.info(f"Auto-startup enabled on Linux: {desktop_path}")
        return True

    def _disable_linux(self):
        """Disable auto-startup on Linux"""
        desktop_path = self._get_linux_desktop_path()

        if desktop_path.exists():
            desktop_path.unlink()
            logger.info("Auto-startup disabled on Linux")

        return True

    def _get_linux_desktop_path(self):
        """Get the path to the Linux .desktop file"""
        home = Path.home()
        return home / ".config" / "autostart" / "lol-viewer.desktop"


if __name__ == "__main__":
    # Test code
    logging.basicConfig(level=logging.INFO)
    manager = AutoStartManager()

    print(f"Platform: {manager.system}")
    print(f"Executable: {manager.get_executable_path()}")
    print(f"Auto-startup enabled: {manager.is_enabled()}")
