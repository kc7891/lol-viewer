import io
import logging
import os

from PyQt6.QtCore import Qt, QByteArray, QUrl
from PyQt6.QtGui import QColor, QPixmap
from PyQt6.QtWidgets import QWidget, QVBoxLayout, QLabel, QPushButton

from PyQt6.QtWebEngineWidgets import QWebEngineView


def _webengine_disabled() -> bool:
    """Whether QWebEngine should be disabled (e.g., headless test runs)."""
    if os.environ.get("LOL_VIEWER_DISABLE_WEBENGINE") == "1":
        return True
    # Common headless platforms for Qt tests.
    if os.environ.get("QT_QPA_PLATFORM") in {"offscreen", "minimal"}:
        return True
    # Pytest sets this env var for the current test item.
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    return False


class NullWebView(QWidget):
    """Fallback widget when QWebEngineView cannot be used (headless/CI).

    Provides a minimal subset of QWebEngineView's API used by the app.
    """

    def __init__(self):
        super().__init__()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        label = QLabel("Web view disabled (headless mode)")
        label.setStyleSheet("QLabel { color: #6d7a8a; padding: 10px; }")
        label.setWordWrap(True)
        layout.addWidget(label)
        self._last_url = None

    def page(self):
        return self

    def setBackgroundColor(self, _color: QColor):
        # No-op for compatibility
        return None

    def setUrl(self, url: QUrl):
        self._last_url = url

    def reload(self):
        return None


class QrCodeOverlay(QWidget):
    """Floating QR-code overlay anchored to the bottom-right of a target widget."""

    _QR_SIZE = 120  # px (image), padded by layout margins

    def __init__(self, parent: QWidget, target: QWidget):
        """
        Args:
            parent: The container widget to parent this overlay to.
            target: The widget (e.g., web view) whose geometry determines positioning.
        """
        super().__init__(parent)
        self._target = target
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, False)

        self._collapsed = False

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # Container that holds the QR image (hidden when minimised)
        self._qr_container = QWidget()
        self._qr_container.setStyleSheet(
            "background-color: #e2e8f0; border-radius: 6px;"
        )
        qr_layout = QVBoxLayout(self._qr_container)
        qr_layout.setContentsMargins(6, 6, 6, 6)
        self._qr_label = QLabel()
        self._qr_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        qr_layout.addWidget(self._qr_label)
        outer.addWidget(self._qr_container)

        # Toggle (minimise / restore) button
        self._toggle_btn = QPushButton("QR")
        self._toggle_btn.setFixedSize(32, 32)
        self._toggle_btn.setToolTip("Hide QR code")
        self._toggle_btn.setStyleSheet(
            "QPushButton { background-color: rgba(13,17,23,200); color: #e2e8f0; "
            "border: 1px solid #222a35; border-radius: 4px; font-size: 9pt; font-weight: bold; }"
            "QPushButton:hover { background-color: rgba(28,35,48,220); }"
        )
        self._toggle_btn.clicked.connect(self._toggle)
        outer.addWidget(self._toggle_btn, alignment=Qt.AlignmentFlag.AlignRight)

        self._current_url: str = ""
        self.hide()  # hidden until a URL is set

        # Listen for resize/move events on the target widget
        self._target.installEventFilter(self)

    # -- public API --

    def set_url(self, url: str):
        """Generate and display a QR code for *url*."""
        if url == self._current_url:
            return
        self._current_url = url
        if not url:
            self.hide()
            return
        try:
            import segno
            qr = segno.make(url)
            buf = io.BytesIO()
            qr.save(buf, kind="png", scale=4, border=1)
            buf.seek(0)
            pixmap = QPixmap()
            pixmap.loadFromData(QByteArray(buf.getvalue()))
            pixmap = pixmap.scaled(
                self._QR_SIZE, self._QR_SIZE,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self._qr_label.setPixmap(pixmap)
        except Exception:
            logging.getLogger(__name__).debug("QR code generation failed for %s", url, exc_info=True)
            self.hide()
            return
        self.show()
        self._reposition()

    # -- internal --

    def _toggle(self):
        self._collapsed = not self._collapsed
        self._qr_container.setVisible(not self._collapsed)
        self._toggle_btn.setToolTip("Show QR code" if self._collapsed else "Hide QR code")
        self._reposition()

    def _reposition(self):
        """Pin to the bottom-right of the target widget."""
        if self._target is None or self.parentWidget() is None:
            return
        self.adjustSize()
        margin = 10
        # Map target's bottom-right corner to the overlay's parent coordinate system
        parent = self.parentWidget()
        bottom_right = self._target.mapTo(parent, self._target.rect().bottomRight())
        top_left = self._target.mapTo(parent, self._target.rect().topLeft())
        x = bottom_right.x() - self.width() - margin + 1
        y = bottom_right.y() - self.height() - margin + 1
        self.move(max(x, top_left.x()), max(y, top_left.y()))

    def eventFilter(self, obj, event):
        """Reposition overlay when target widget is resized or moved."""
        if obj is self._target:
            from PyQt6.QtCore import QEvent
            if event.type() in (QEvent.Type.Resize, QEvent.Type.Move):
                self._reposition()
        return super().eventFilter(obj, event)


def _install_qr_overlay(container: QWidget, web_view: QWidget) -> "QrCodeOverlay":
    """Create a QrCodeOverlay as a sibling to the web view (both children of container)."""
    overlay = QrCodeOverlay(container, web_view)
    return overlay
