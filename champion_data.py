#!/usr/bin/env python3
"""
Champion data management module for LoL Viewer
Handles loading champion data and providing autocomplete functionality
"""
import json
import os
import sys
from typing import Dict, List, Optional
from PyQt6.QtCore import Qt, QSize, QRect, QUrl
from PyQt6.QtGui import QStandardItemModel, QStandardItem, QPixmap, QImage
from PyQt6.QtWidgets import (
    QCompleter, QStyledItemDelegate, QStyleOptionViewItem,
    QStyle, QLineEdit
)
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply

from logger import log


class ChampionData:
    """Class to manage champion data"""

    def __init__(self, data_file: str = "champions.json"):
        """
        Initialize champion data.

        Args:
            data_file: Path to the champions JSON file
        """
        # If running as PyInstaller bundle, look for data file in temp folder
        if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
            # Running as compiled executable
            self.data_file = os.path.join(sys._MEIPASS, data_file)
        else:
            # Running as script
            self.data_file = data_file

        self.champions: Dict[str, dict] = {}
        self.load_data()

    def load_data(self):
        """Load champion data from JSON file"""
        log(f"[ChampionData] Loading data from: {self.data_file}")
        log(f"[ChampionData] File exists: {os.path.exists(self.data_file)}")

        if not os.path.exists(self.data_file):
            log(f"[ChampionData] WARNING: Champion data file '{self.data_file}' not found")
            return

        try:
            with open(self.data_file, 'r', encoding='utf-8') as f:
                self.champions = json.load(f)
            log(f"[ChampionData] Loaded {len(self.champions)} champions from {self.data_file}")
            # Print first few champions for verification
            if self.champions:
                sample = list(self.champions.items())[:3]
                for champ_id, data in sample:
                    log(f"  - {champ_id}: {data.get('english_name')} / {data.get('japanese_name')}")
        except Exception as e:
            log(f"[ChampionData] ERROR loading champion data: {e}")
            import traceback
            traceback.print_exc()
            self.champions = {}

    def search(self, query: str) -> List[dict]:
        """
        Search for champions by name (English or Japanese).

        Args:
            query: Search query string

        Returns:
            List of matching champions
        """
        if not query:
            return []

        query_lower = query.lower()
        matches = []

        for champ_id, data in self.champions.items():
            english_name = data.get('english_name', '').lower()
            japanese_name = data.get('japanese_name', '').lower()

            # Check if query matches English name, Japanese name, or champion ID
            if (query_lower in english_name or
                query_lower in japanese_name or
                query_lower in champ_id):
                matches.append({
                    'id': champ_id,
                    'english_name': data.get('english_name', ''),
                    'japanese_name': data.get('japanese_name', ''),
                    'image_url': data.get('image_url', ''),
                    'display_name': f"{data.get('english_name', '')} ({data.get('japanese_name', '')})"
                })

        # Sort by English name
        matches.sort(key=lambda x: x['english_name'])
        return matches

    def get_champion(self, name_or_id: str) -> Optional[dict]:
        """
        Get champion data by name or ID.

        Args:
            name_or_id: Champion name (English/Japanese) or ID

        Returns:
            Champion data dictionary or None if not found
        """
        name_lower = name_or_id.lower()

        # Try direct ID match first
        if name_lower in self.champions:
            return self.champions[name_lower]

        # Try name match
        for champ_id, data in self.champions.items():
            if (data.get('english_name', '').lower() == name_lower or
                data.get('japanese_name', '').lower() == name_lower):
                return data

        return None


class ChampionImageCache:
    """Cache for champion images"""

    def __init__(self):
        self.cache: Dict[str, QPixmap] = {}
        self.network_manager = QNetworkAccessManager()
        self.pending_requests: Dict[str, List] = {}

    def get_image(self, url: str, callback=None) -> Optional[QPixmap]:
        """
        Get image from cache or download it.

        Args:
            url: Image URL
            callback: Optional callback function to call when image is loaded

        Returns:
            QPixmap if available in cache, None otherwise
        """
        if url in self.cache:
            return self.cache[url]

        # If not in cache and callback provided, download it
        if callback:
            if url not in self.pending_requests:
                self.pending_requests[url] = [callback]
                self._download_image(url)
            else:
                self.pending_requests[url].append(callback)

        return None

    def _download_image(self, url: str):
        """Download image from URL"""
        request = QNetworkRequest(QUrl(url))
        reply = self.network_manager.get(request)
        reply.finished.connect(lambda: self._on_image_downloaded(url, reply))

    def _on_image_downloaded(self, url: str, reply: QNetworkReply):
        """Handle image download completion"""
        if reply.error() == QNetworkReply.NetworkError.NoError:
            image_data = reply.readAll()
            image = QImage()
            image.loadFromData(image_data)

            if not image.isNull():
                pixmap = QPixmap.fromImage(image)
                self.cache[url] = pixmap

                # Call all pending callbacks
                if url in self.pending_requests:
                    for callback in self.pending_requests[url]:
                        callback(pixmap)
                    del self.pending_requests[url]

        reply.deleteLater()


class ChampionItemDelegate(QStyledItemDelegate):
    """Custom delegate to display champion items with thumbnail images"""

    def __init__(self, image_cache: ChampionImageCache, parent=None):
        super().__init__(parent)
        self.image_cache = image_cache

    def paint(self, painter, option, index):
        """Paint the item with image and text"""
        # Get data from model - now from UserRole instead of DisplayRole
        english_name = index.data(Qt.ItemDataRole.UserRole + 3)  # English name
        japanese_name = index.data(Qt.ItemDataRole.UserRole)
        image_url = index.data(Qt.ItemDataRole.UserRole + 1)

        # Fallback if data is missing
        if not english_name:
            english_name = index.data(Qt.ItemDataRole.DisplayRole).split()[0] if index.data(Qt.ItemDataRole.DisplayRole) else ""
        if not japanese_name:
            japanese_name = ""

        # Draw background
        if option.state & QStyle.StateFlag.State_Selected:
            painter.fillRect(option.rect, option.palette.highlight())
        elif option.state & QStyle.StateFlag.State_MouseOver:
            painter.fillRect(option.rect, option.palette.midlight())

        # Draw image
        image_size = 40
        margin = 5
        image_rect = QRect(
            option.rect.left() + margin,
            option.rect.top() + margin,
            image_size,
            image_size
        )

        pixmap = self.image_cache.get_image(image_url)
        if pixmap:
            scaled_pixmap = pixmap.scaled(
                image_size, image_size,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            painter.drawPixmap(image_rect, scaled_pixmap)

        # Draw text
        text_rect = QRect(
            option.rect.left() + image_size + margin * 2,
            option.rect.top(),
            option.rect.width() - image_size - margin * 3,
            option.rect.height()
        )

        # English name
        painter.setPen(option.palette.text().color())
        painter.drawText(
            text_rect.adjusted(0, 5, 0, -text_rect.height() // 2),
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            english_name
        )

        # Japanese name (smaller, below English name)
        painter.setOpacity(0.7)
        font = painter.font()
        font.setPointSize(font.pointSize() - 1)
        painter.setFont(font)
        painter.drawText(
            text_rect.adjusted(0, text_rect.height() // 2, 0, -5),
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            japanese_name
        )
        painter.setOpacity(1.0)

    def sizeHint(self, option, index):
        """Return the size hint for the item"""
        return QSize(300, 50)


class ChampionCompleter(QCompleter):
    """Custom completer for champion autocomplete"""

    def __init__(self, champion_data: ChampionData, parent=None):
        super().__init__(parent)
        self.champion_data = champion_data
        self.image_cache = ChampionImageCache()

        # Create model and populate with all champions
        self.model_data = QStandardItemModel()
        self.setModel(self.model_data)
        self._populate_model()

        # Set completion mode
        self.setCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        self.setCompletionMode(QCompleter.CompletionMode.PopupCompletion)
        self.setFilterMode(Qt.MatchFlag.MatchContains)
        # Use default DisplayRole for filtering (contains "English Japanese")
        self.setMaxVisibleItems(10)

        # Set custom delegate
        delegate = ChampionItemDelegate(self.image_cache)
        self.popup().setItemDelegate(delegate)

        # Style the popup
        self.popup().setStyleSheet("""
            QListView {
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #0d7377;
                border-radius: 4px;
                outline: none;
            }
            QListView::item {
                padding: 5px;
                border-bottom: 1px solid #3a3a3a;
            }
            QListView::item:selected {
                background-color: #0d7377;
                color: #ffffff;
            }
            QListView::item:hover {
                background-color: #3a3a3a;
            }
        """)

    def _populate_model(self):
        """Populate model with all champions"""
        count = 0
        for champ_id, data in sorted(self.champion_data.champions.items(),
                                     key=lambda x: x[1].get('english_name', '')):
            english_name = data.get('english_name', '')
            japanese_name = data.get('japanese_name', '')
            image_url = data.get('image_url', '')

            # IMPORTANT: DisplayRole must contain searchable text for QCompleter to work
            # DisplayRole is what QCompleter filters against
            searchable_text = f"{english_name} {japanese_name}"
            item = QStandardItem(searchable_text)

            # Store individual components in UserRoles for delegate to display
            item.setData(japanese_name, Qt.ItemDataRole.UserRole)      # Japanese name
            item.setData(image_url, Qt.ItemDataRole.UserRole + 1)       # Image URL
            item.setData(champ_id, Qt.ItemDataRole.UserRole + 2)        # Champion ID
            item.setData(english_name, Qt.ItemDataRole.UserRole + 3)    # English name

            self.model_data.appendRow(item)
            count += 1

        log(f"[ChampionCompleter] Populated model with {count} champions")
        log(f"[ChampionCompleter] Model row count: {self.model_data.rowCount()}")

        # Log first few items for debugging
        if count > 0:
            first_item = self.model_data.item(0, 0)
            log(f"[ChampionCompleter] Sample item DisplayRole: '{first_item.data(Qt.ItemDataRole.DisplayRole)}'")
            log(f"[ChampionCompleter] Sample item EnglishName: '{first_item.data(Qt.ItemDataRole.UserRole + 3)}'")

def setup_champion_input(line_edit: QLineEdit, champion_data: ChampionData):
    """
    Set up champion autocomplete for a QLineEdit.

    Args:
        line_edit: The QLineEdit to set up
        champion_data: The champion data instance

    Returns:
        The ChampionCompleter instance
    """
    log(f"[setup_champion_input] Setting up autocomplete...")
    log(f"[setup_champion_input] Champion data has {len(champion_data.champions)} champions")

    completer = ChampionCompleter(champion_data, line_edit)
    line_edit.setCompleter(completer)

    log(f"[setup_champion_input] Completer set on line edit")
    log(f"[setup_champion_input] Completion mode: {completer.completionMode()}")
    log(f"[setup_champion_input] Filter mode: {completer.filterMode()}")

    # Add debug logging for text changes
    def on_text_changed(text):
        if text:
            log(f"[Autocomplete] Text changed: '{text}' (length: {len(text)})")
            log(f"[Autocomplete] Completion prefix: '{completer.completionPrefix()}'")
            log(f"[Autocomplete] Completion count: {completer.completionCount()}")

    line_edit.textChanged.connect(on_text_changed)

    # Handle completion activation to ensure English ID is used
    def on_completion_activated(text):
        log(f"[Autocomplete] Activated: {text}")
        # Get the selected item
        index = completer.popup().currentIndex()
        if index.isValid():
            item = completer.model_data.itemFromIndex(index)
            if item:
                # Get the champion ID (lowercase) for the URL
                champ_id = item.data(Qt.ItemDataRole.UserRole + 2)
                log(f"[Autocomplete] Selected champion ID: {champ_id}")
                # Temporarily disconnect to avoid triggering completion again
                line_edit.blockSignals(True)
                line_edit.setText(champ_id)
                line_edit.blockSignals(False)

    completer.activated.connect(on_completion_activated)

    return completer
