import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { IconCopy } from "../ui/icons.tsx";
import { PanelFrame } from "./PanelFrame.tsx";

/** Offline QR as one SVG path (white quiet zone included). Null when the text does not fit. */
export function qrPath(text: string): { path: string; size: number } | null {
  try {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { path, size: n };
  } catch {
    return null;
  }
}

export function QrCode({ text, label = "QR code" }: { text: string; label?: string }) {
  const qr = useMemo(() => qrPath(text), [text]);
  if (!qr) return <div className="panel-empty">This address is too long for a QR code.</div>;
  const q = 4;
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      viewBox={`${-q} ${-q} ${qr.size + q * 2} ${qr.size + q * 2}`}
      shapeRendering="crispEdges"
    >
      <rect x={-q} y={-q} width={qr.size + q * 2} height={qr.size + q * 2} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

/** The page's current address as a QR code, so a phone can open the same page. */
export function QrPanel({ url, onCopy, onClose }: { url: string; onCopy: (url: string) => void; onClose: () => void }) {
  return (
    <PanelFrame title="Open on your phone" onClose={onClose} className="qr-panel">
      <div className="qr-body">
        <QrCode text={url} />
        <code className="qr-url" data-testid="qr-url">
          {url}
        </code>
        <button type="button" className="btn" onClick={() => onCopy(url)}>
          <IconCopy size={14} /> Copy URL
        </button>
      </div>
    </PanelFrame>
  );
}
