from PyQt6.QtCore import Qt, QEvent, QMimeData, QPoint, QSize
from PyQt6.QtGui import QDrag
from PyQt6.QtWidgets import QApplication, QLabel, QPushButton, QSizePolicy, QWidget


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


class QuickPickButton(QPushButton):
    """Pill button that elides its label to fit the available width.

    QPushButton clips rather than elides an over-long label, so the visible text is
    re-elided whenever the width, the icon or the label changes.

    The width needed for the full label is obtained by briefly setting that label and
    asking the style (``_measure``), rather than by adding up font metrics and padding.
    Mixing the two measurements is not safe: a style's button hint is subject to a
    minimum-width floor and is computed with ``QFontMetrics.size()``, which on some
    platforms disagrees with ``horizontalAdvance()`` by a pixel or two -- and a pixel
    or two is the difference between "Zed" and "Z...". Comparing width against that
    measured value keeps the "does it fit?" decision exact on every platform.

    Measuring the full label (never the displayed one) also stops eliding from feeding
    back into the layout, which would otherwise ratchet the label away to nothing.
    The Maximum size policy lets the layout shrink the button when the header runs out
    of room, but never stretch it past its natural width.
    """

    _ELLIPSIS = "…"

    def __init__(self, parent=None):
        super().__init__(parent)
        self._full_text = ""
        self._full_width = 0
        self.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)
        self._measure()

    def set_full_text(self, text: str):
        self._full_text = text
        self._measure()
        self._apply_elided_text()
        self.updateGeometry()

    def setIcon(self, icon):
        # The icon is loaded asynchronously and changes how much room the text gets.
        super().setIcon(icon)
        self._measure()
        self._apply_elided_text()
        self.updateGeometry()

    def sizeHint(self):
        return QSize(self._full_width, super().sizeHint().height())

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._apply_elided_text()

    def changeEvent(self, event):
        super().changeEvent(event)
        # setStyleSheet() and font changes both move the padding/border geometry.
        if event.type() in (QEvent.Type.FontChange, QEvent.Type.StyleChange):
            self._measure()
            self._apply_elided_text()

    def _measure(self):
        """Record the width this button needs to show its full label.

        Only ever called on a label/icon/style change -- never from sizeHint() -- so the
        temporary setText() cannot re-enter an in-progress layout pass.
        """
        current = super().text()
        super().setText(self._full_text)
        self._full_width = super().sizeHint().width()
        super().setText(current)

    def _apply_elided_text(self):
        if self.width() >= self._full_width:
            # Enough room for the whole label, measured the same way the layout sized us.
            super().setText(self._full_text)
            return

        metrics = self.fontMetrics()
        # Approximate the non-text width; only used while the label is already being cut.
        chrome = max(0, self._full_width - metrics.horizontalAdvance(self._full_text))
        avail = max(0, self.width() - chrome)
        elided = metrics.elidedText(self._full_text, Qt.TextElideMode.ElideRight, avail)
        # Too narrow for even one character: show the icon alone, not a bare ellipsis.
        if self._full_text and elided.strip(self._ELLIPSIS) == "":
            elided = ""
        super().setText(elided)
