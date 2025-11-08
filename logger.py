#!/usr/bin/env python3
"""
Logging utility for LoL Viewer
Writes logs to both console and file
"""
import os
import sys
from datetime import datetime


class Logger:
    """Simple logger that writes to both console and file"""

    def __init__(self, log_file=None):
        if log_file is None:
            # Get the directory where the executable/script is located
            if getattr(sys, 'frozen', False):
                # Running as compiled executable
                app_dir = os.path.dirname(sys.executable)
            else:
                # Running as script
                app_dir = os.path.dirname(os.path.abspath(__file__))

            log_file = os.path.join(app_dir, 'lol_viewer_debug.log')

        self.log_file = log_file
        self.enabled = True

        # Create new log file
        try:
            with open(self.log_file, 'w', encoding='utf-8') as f:
                f.write(f"=== LoL Viewer Debug Log ===\n")
                f.write(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"Log file: {self.log_file}\n")
                f.write("=" * 60 + "\n\n")
            print(f"[Logger] Logging to: {self.log_file}")
        except Exception as e:
            print(f"[Logger] WARNING: Could not create log file: {e}")
            self.enabled = False

    def log(self, message):
        """Write a log message to both console and file"""
        if not self.enabled:
            print(message)
            return

        # Print to console
        print(message)

        # Write to file
        try:
            with open(self.log_file, 'a', encoding='utf-8') as f:
                timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
                f.write(f"[{timestamp}] {message}\n")
        except Exception as e:
            print(f"[Logger] Error writing to log: {e}")


# Global logger instance
_logger = None


def get_logger():
    """Get the global logger instance"""
    global _logger
    if _logger is None:
        _logger = Logger()
    return _logger


def log(message):
    """Convenience function to log a message"""
    get_logger().log(message)
