from PyQt6.QtCore import Qt, QMimeData, QPoint
from PyQt6.QtGui import QDrag
from PyQt6.QtWidgets import QApplication, QLabel, QWidget


class DraggableMatchupLabel(QLabel):
    """QLabel subclass that supports drag-and-drop for matchup list reordering.

    When drag_enabled is False, behaves identically to a plain QLabel.
    """

    MIME_TYPE = "application/x-lol-matchup-dnd"

    def __init__(self, text: str = "", row_index: int = 0, side: str = "ally", parent=None):
        super().__init__(text, parent)
        self.row_index = row_index
        self.side = side
        self.drag_enabled = False
        self._drag_start_pos: QPoint | None = None

    def set_drag_enabled(self, enabled: bool):
        self.drag_enabled = enabled
        if enabled:
            self.setCursor(Qt.CursorShape.OpenHandCursor)
        else:
            self.unsetCursor()

    def mousePressEvent(self, event):
        if self.drag_enabled and event.button() == Qt.MouseButton.LeftButton:
            self._drag_start_pos = event.pos()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if (
            self.drag_enabled
            and self._drag_start_pos is not None
            and event.buttons() & Qt.MouseButton.LeftButton
        ):
            distance = (event.pos() - self._drag_start_pos).manhattanLength()
            if distance >= QApplication.startDragDistance():
                self._start_drag()
                return
        super().mouseMoveEvent(event)

    def _start_drag(self):
        drag = QDrag(self)
        mime_data = QMimeData()
        mime_data.setData(self.MIME_TYPE, f"{self.row_index}:{self.side}".encode("utf-8"))
        drag.setMimeData(mime_data)
        pixmap = self.grab()
        drag.setPixmap(pixmap)
        drag.setHotSpot(QPoint(pixmap.width() // 2, pixmap.height() // 2))
        drag.exec(Qt.DropAction.MoveAction)
        self._drag_start_pos = None


class MatchupRowWidget(QWidget):
    """QWidget subclass for matchup list rows that accepts champion drops."""

    _HIGHLIGHT_STYLE = (
        "QWidget { background-color: rgba(0, 214, 161, 0.12); "
        "border: 1px solid rgba(0, 214, 161, 0.35); border-radius: 2px; }"
    )

    def __init__(self, row_index: int = 0, main_window=None, parent=None):
        super().__init__(parent)
        self.row_index = row_index
        self._main_window = main_window
        self._original_stylesheet = ""

    def dragEnterEvent(self, event):
        mime = event.mimeData()
        if mime.hasFormat(DraggableMatchupLabel.MIME_TYPE):
            data = bytes(mime.data(DraggableMatchupLabel.MIME_TYPE)).decode("utf-8")
            source_index, _side = data.split(":")
            if int(source_index) != self.row_index:
                event.acceptProposedAction()
                self._original_stylesheet = self.styleSheet()
                self.setStyleSheet(self._HIGHLIGHT_STYLE)
                return
        event.ignore()

    def dragMoveEvent(self, event):
        if event.mimeData().hasFormat(DraggableMatchupLabel.MIME_TYPE):
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragLeaveEvent(self, event):
        self.setStyleSheet(self._original_stylesheet)
        super().dragLeaveEvent(event)

    def dropEvent(self, event):
        self.setStyleSheet(self._original_stylesheet)
        mime = event.mimeData()
        if not mime.hasFormat(DraggableMatchupLabel.MIME_TYPE):
            event.ignore()
            return
        data = bytes(mime.data(DraggableMatchupLabel.MIME_TYPE)).decode("utf-8")
        source_index_str, side = data.split(":")
        source_index = int(source_index_str)
        if source_index == self.row_index:
            event.ignore()
            return
        if self._main_window is not None:
            self._main_window._matchup_dnd_drop(source_index, self.row_index, side)
        event.acceptProposedAction()
