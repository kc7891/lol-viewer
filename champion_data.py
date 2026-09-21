#!/usr/bin/env python3
"""
Champion data management module for LoL Viewer
Handles loading champion data and providing autocomplete functionality
"""
import hashlib
import json
import re
import os
import sys
import tempfile
from typing import Dict, List, Optional
from PyQt6.QtCore import (
    Qt, QSize, QRect, QUrl, QObject, QEvent, QTimer, QStringListModel,
    QStandardPaths,
)
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


def get_icon_cache_dir() -> str:
    """Return (and create) the on-disk champion icon cache directory.

    We deliberately do NOT rely on QApplication.setApplicationName() +
    QStandardPaths.CacheLocation here: setting the org/app name also changes
    where QtWebEngine stores its profile, which would silently reset the
    user's existing cookies/login state. Nothing else in the app calls
    setOrganizationName()/setApplicationName(), so we build the path
    explicitly instead.

    LOL_VIEWER_ICON_CACHE_DIR is an override in the same spirit as the
    existing LOL_VIEWER_DISABLE_* env vars, and lets tests redirect the cache
    to a throwaway directory instead of the real user profile.
    """
    override = os.environ.get("LOL_VIEWER_ICON_CACHE_DIR")
    if override:
        directory = override
    else:
        base = os.environ.get("LOCALAPPDATA") or QStandardPaths.writableLocation(
            QStandardPaths.StandardLocation.GenericCacheLocation
        ) or tempfile.gettempdir()
        directory = os.path.join(base, "LoLViewer", "cache", "champion_icons")
    os.makedirs(directory, exist_ok=True)
    return directory


class ChampionImageCache:
    """Cache for champion images.

    Images are kept in an in-memory dict for the lifetime of the process, and
    also persisted to disk so a fresh process doesn't have to re-download
    every champion icon it has already fetched once. The image_url baked into
    champions.json includes the Data Dragon patch number, so cache entries
    naturally expire (and get swept up by prune_icon_cache()) whenever the
    app updates.
    """

    def __init__(self, cache_dir: Optional[str] = None):
        self.cache: Dict[str, QPixmap] = {}
        self.network_manager = QNetworkAccessManager()
        self.pending_requests: Dict[str, List] = {}
        # Test callers pass an explicit cache_dir (e.g. tmp_path); production
        # code falls back to the shared per-user cache directory.
        self.cache_dir = cache_dir or get_icon_cache_dir()
        os.makedirs(self.cache_dir, exist_ok=True)

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

        # Synchronous disk hit: this is the key trick that lets every
        # existing call site (which already does "use the return value if
        # any, otherwise wait for the callback") work unchanged. From the
        # second run onward this means no async download/callback happens at
        # all for already-cached icons.
        pixmap = self._load_from_disk(url)
        if pixmap is not None:
            self.cache[url] = pixmap
            return pixmap

        # If not in cache and callback provided, download it
        if callback:
            if url not in self.pending_requests:
                self.pending_requests[url] = [callback]
                self._download_image(url)
            else:
                self.pending_requests[url].append(callback)

        return None

    def _path_for_url(self, url: str) -> str:
        """Map an image URL to its on-disk cache file path."""
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        return os.path.join(self.cache_dir, f"{key}.png")

    def _load_from_disk(self, url: str) -> Optional[QPixmap]:
        """Return a QPixmap for `url` from the on-disk cache, or None on a miss.

        A corrupt cache file (e.g. left behind by a process killed mid-write)
        is deleted so the caller falls back to a fresh network download
        instead of getting stuck with a broken icon forever.
        """
        path = self._path_for_url(url)
        if not os.path.exists(path):
            return None

        pixmap = QPixmap()
        if not pixmap.load(path) or pixmap.isNull():
            log(f"[ChampionImageCache] Corrupt icon cache file, removing: {path}")
            try:
                os.remove(path)
            except OSError:
                pass
            return None

        return pixmap

    def _save_to_disk(self, url: str, data: bytes):
        """Atomically persist raw downloaded image bytes to disk.

        Writes to a ".tmp" file first and renames it into place with
        os.replace(), so a process killed mid-write never leaves a truncated
        PNG behind for a later run to trip over. The raw bytes are stored
        as-is (no re-encoding).
        """
        path = self._path_for_url(url)
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "wb") as f:
                f.write(data)
            os.replace(tmp_path, path)
        except OSError as e:
            log(f"[ChampionImageCache] Failed to write icon cache file for {url}: {e}")
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    def _download_image(self, url: str):
        """Download image from URL"""
        request = QNetworkRequest(QUrl(url))
        reply = self.network_manager.get(request)
        reply.finished.connect(lambda: self._on_image_downloaded(url, reply))

    def _on_image_downloaded(self, url: str, reply: QNetworkReply):
        """Handle image download completion.

        NOTE: pending_requests[url] is always cleared in the `finally` block
        below, not only on success. The original implementation only cleared
        it after a successful decode, so a network error or a malformed
        response left the entry in place for the rest of the process:
        get_image() would never retry that URL again (since
        "url not in self.pending_requests" was permanently False), and the
        queued callbacks -- which close over widgets -- would never fire and
        would never be released, which is a real leak.
        """
        try:
            if reply.error() != QNetworkReply.NetworkError.NoError:
                log(f"[ChampionImageCache] Download failed for {url}: {reply.errorString()}")
                return

            image_data = reply.readAll()
            image = QImage()
            image.loadFromData(image_data)

            if image.isNull():
                log(f"[ChampionImageCache] Downloaded data could not be decoded as an image: {url}")
                return

            pixmap = QPixmap.fromImage(image)
            self.cache[url] = pixmap
            self._save_to_disk(url, bytes(image_data))

            # Call all pending callbacks (success only).
            for callback in self.pending_requests.get(url, []):
                callback(pixmap)
        finally:
            # Always clear the in-flight entry: otherwise one failure wedges this URL for
            # the whole process lifetime and the queued callbacks are never released.
            self.pending_requests.pop(url, None)
            reply.deleteLater()


_shared_image_cache: Optional["ChampionImageCache"] = None


def get_shared_image_cache() -> "ChampionImageCache":
    """Return the process-wide champion icon cache.

    Every viewer shares one cache so a given icon is fetched and held in memory once.
    Created lazily because QNetworkAccessManager needs a live QApplication.
    """
    global _shared_image_cache
    if _shared_image_cache is None:
        _shared_image_cache = ChampionImageCache()
    return _shared_image_cache


# Files written by ChampionImageCache: "<sha256 hex>.png", plus the ".tmp"
# staging file _save_to_disk() renames into place.
_CACHE_FILE_RE = re.compile(r"^[0-9a-f]{64}\.png(\.tmp)?$")


def prune_icon_cache(champion_data: ChampionData, cache_dir: Optional[str] = None) -> int:
    """Delete cached icons no longer referenced by champions.json.

    The image_url for every champion is versioned by Data Dragon patch, so
    after an app update the entire previous patch's icon set becomes
    unreachable dead weight (~4MB for all 173 champions). This also sweeps up
    any stray ".tmp" file left behind by an interrupted write, since those
    never match a current URL's hash either.

    Only files that look like our own cache entries are ever deleted (see
    _CACHE_FILE_RE). This runs unconditionally at every startup, so if
    LOL_VIEWER_ICON_CACHE_DIR is ever pointed at a directory holding anything
    else, we must not take the user's files down with us.

    Returns:
        Number of files removed.
    """
    directory = cache_dir or get_icon_cache_dir()

    keep = set()
    for data in champion_data.champions.values():
        image_url = data.get('image_url', '')
        if image_url:
            key = hashlib.sha256(image_url.encode("utf-8")).hexdigest()
            keep.add(f"{key}.png")

    try:
        entries = os.listdir(directory)
    except OSError as e:
        log(f"[prune_icon_cache] Failed to list {directory}: {e}")
        return 0

    removed = 0
    for name in entries:
        if name in keep or not _CACHE_FILE_RE.match(name):
            continue
        path = os.path.join(directory, name)
        try:
            os.remove(path)
            removed += 1
        except OSError as e:
            log(f"[prune_icon_cache] Failed to remove {path}: {e}")

    if removed:
        log(f"[prune_icon_cache] Removed {removed} stale icon cache file(s) from {directory}")

    return removed


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
        # Shared cache: this completer is created per-viewer (setup_champion_input()
        # is called once per ChampionViewerWidget), and the delegate that would use
        # it is currently disabled below, but the QNetworkAccessManager it owned
        # was still being needlessly duplicated (2x per viewer).
        self.image_cache = get_shared_image_cache()

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

        # Disable custom delegate for now - using text-only display
        # delegate = ChampionItemDelegate(self.image_cache)
        # self.popup().setItemDelegate(delegate)

        # Ensure popup is visible and has proper size
        popup = self.popup()
        popup.setMinimumHeight(200)
        popup.setMinimumWidth(350)

        # Ensure popup appears on top
        popup.setWindowFlags(popup.windowFlags() | Qt.WindowType.Popup | Qt.WindowType.FramelessWindowHint)
        popup.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, False)

        # Style the popup
        popup.setStyleSheet("""
            QListView {
                background-color: #2b2b2b;
                color: #ffffff;
                border: 1px solid #0d7377;
                border-radius: 4px;
                outline: none;
                min-height: 200px;
            }
            QListView::item {
                padding: 8px;
                border-bottom: 1px solid #3a3a3a;
                height: 30px;
            }
            QListView::item:selected {
                background-color: #0d7377;
                color: #ffffff;
            }
            QListView::item:hover {
                background-color: #3a3a3a;
            }
        """)

    def pathFromIndex(self, index):
        """Return the champion ID instead of the display text"""
        if index.isValid():
            # IMPORTANT:
            # This completer may temporarily be used with a different model
            # (e.g., opponent context suggestions). Never call itemFromIndex()
            # on a foreign model index; it can lead to hard crashes.
            if index.model() is self.model_data:
                item = self.model_data.itemFromIndex(index)
                if item:
                    # Return champion ID instead of display text
                    champ_id = item.data(Qt.ItemDataRole.UserRole + 2)
                    if champ_id:
                        log(f"[ChampionCompleter] pathFromIndex returning: {champ_id}")
                        return champ_id
            else:
                # For non-champion models (e.g., QStringListModel), fall back to the displayed text.
                value = index.data(Qt.ItemDataRole.DisplayRole)
                if isinstance(value, str) and value:
                    return value
        # Fallback to default behavior
        return super().pathFromIndex(index)

    def _populate_model(self):
        """Populate model with all champions"""
        count = 0
        for champ_id, data in sorted(self.champion_data.champions.items(),
                                     key=lambda x: x[1].get('english_name', '')):
            english_name = data.get('english_name', '')
            japanese_name = data.get('japanese_name', '')
            image_url = data.get('image_url', '')

            # DisplayRole is used for both filtering and display
            # Format: "English - Japanese" (searchable and readable)
            display_text = f"{english_name} - {japanese_name}"
            item = QStandardItem(display_text)

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
            log(f"[ChampionCompleter] Sample item display: '{first_item.data(Qt.ItemDataRole.DisplayRole)}'")
            log(f"[ChampionCompleter] Sample item ID: '{first_item.data(Qt.ItemDataRole.UserRole + 2)}'")

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

    # pathFromIndex() now handles inserting the champion ID
    # No need for manual activated handler

    return completer


class _OpponentContextCompleterController(QObject):
    """Switch a QLineEdit's QCompleter model based on input state.

    - When the user clicks the line edit while empty: show 'context' suggestions.
    - When the user types (or after activation): restore the full champion completer model.
    """

    def __init__(self, line_edit: QLineEdit, completer: QCompleter, suggestion_provider, parent=None):
        super().__init__(parent or line_edit)
        self._line_edit = line_edit
        self._completer = completer
        self._suggestion_provider = suggestion_provider

        # Keep references to models so we can swap safely.
        self._champion_model = completer.model()
        self._context_model = QStringListModel(self)

        self._line_edit.installEventFilter(self)
        self._line_edit.textEdited.connect(self._on_text_edited)
        self._completer.activated.connect(self._on_activated)

    def eventFilter(self, obj, event):
        if obj is self._line_edit and event.type() == QEvent.Type.MouseButtonPress:
            if getattr(event, "button", None) and event.button() == Qt.MouseButton.LeftButton:
                if not self._line_edit.text().strip():
                    self._show_context_suggestions()
                else:
                    self._restore_champion_model()
        return super().eventFilter(obj, event)

    def _show_context_suggestions(self):
        provider = self._suggestion_provider
        if provider is None:
            return

        try:
            suggestions = provider() or []
        except Exception:
            suggestions = []

        # Avoid showing an empty popup.
        suggestions = [s for s in suggestions if isinstance(s, str) and s.strip()]
        if not suggestions:
            return

        # Deduplicate while preserving order.
        seen = set()
        unique: List[str] = []
        for s in suggestions:
            key = s.strip().lower()
            if key in seen:
                continue
            seen.add(key)
            unique.append(s.strip())

        self._context_model.setStringList(unique)
        self._completer.setModel(self._context_model)
        self._completer.setCompletionPrefix("")

        # Defer opening the popup until after the click event finishes.
        #
        # NOTE:
        # Qt's offscreen/minimal platform plugins used in CI/tests can be unstable
        # when showing Popup windows (QCompleter popup tries to grab keyboard).
        # In those environments we only swap the model; we do not open the popup.
        if os.environ.get("PYTEST_CURRENT_TEST"):
            return
        if os.environ.get("QT_QPA_PLATFORM") in {"offscreen", "minimal"}:
            return
        QTimer.singleShot(0, self._completer.complete)

    def _restore_champion_model(self):
        if self._completer.model() is not self._champion_model:
            self._completer.setModel(self._champion_model)

    def _on_text_edited(self, _text: str):
        # As soon as the user starts typing, revert to full champion suggestions.
        if self._completer.model() is not self._champion_model:
            try:
                popup = self._completer.popup()
                if popup is not None:
                    popup.hide()
            except Exception:
                pass
        self._restore_champion_model()

    def _on_activated(self, *_):
        # After choosing a context suggestion, ensure future suggestions use the champion model.
        QTimer.singleShot(0, self._restore_champion_model)


def setup_opponent_champion_input(
    line_edit: QLineEdit,
    champion_data: ChampionData,
    suggestion_provider,
):
    """Set up opponent champion input with Champion Name-equivalent autocomplete.

    Behavior:
    - If the user types: use the normal champion autocomplete (same as Champion Name).
    - If the user hasn't typed anything and clicks while empty: show context suggestions
      provided by suggestion_provider (e.g., champions currently open in other viewers).
    """
    completer = setup_champion_input(line_edit, champion_data)
    _OpponentContextCompleterController(
        line_edit=line_edit,
        completer=completer,
        suggestion_provider=suggestion_provider,
        parent=line_edit,
    )
    return completer
