import { useState } from "react";
import { useBridge, useViewStatus } from "../bridge/context.tsx";
import type { ToastKind } from "../state/toasts.tsx";
import { IconExternal, IconQr, IconRefresh } from "../ui/icons.tsx";
import { ExternalViewSlot } from "./ExternalViewSlot.tsx";
import { QrPanel } from "./QrPanel.tsx";
import { copyText } from "./ViewerPane.tsx";

export const LIVE_VIEW_ID = "live-game";

export type LivePageProps = {
  url: string;
  /** Bumped when the Live Game URL is saved in Settings: opens the page again. */
  nav: number;
  /** This page is the one on screen (otherwise its native view is hidden, not unloaded). */
  active: boolean;
  qrEnabled: boolean;
  notify: (text: string, kind?: ToastKind) => void;
  initialQr?: boolean;
};

/** Live Game: a thin address bar and one full-size external page. Loaded at startup, hidden while on other pages. */
export function LivePage({ url, nav, active, qrEnabled, notify, initialQr = false }: LivePageProps) {
  const bridge = useBridge();
  const status = useViewStatus(LIVE_VIEW_ID);
  const [qr, setQr] = useState(initialQr);
  const [localNav, setLocalNav] = useState(0);
  const current = status?.url || url;

  // Refresh re-opens the configured Live Game URL (as the old app did), not the page the
  // user may have navigated to inside u.gg.
  const refresh = () => setLocalNav((n) => n + 1);
  const openExternal = () => {
    if (bridge.views) bridge.views.command({ type: "navigate", viewId: LIVE_VIEW_ID, action: "openExternal" });
    else window.open(current, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="live-page" hidden={!active}>
      <div className="live-bar">
        <code className="live-url" title={current}>
          {current}
        </code>
        <button type="button" className="btn" onClick={refresh}>
          <IconRefresh size={14} /> Refresh
        </button>
        {qrEnabled && (
          <button type="button" className="btn" aria-pressed={qr} onClick={() => setQr((v) => !v)}>
            <IconQr size={14} /> QR
          </button>
        )}
        <button type="button" className="btn" onClick={openExternal}>
          <IconExternal size={14} /> Open in browser
        </button>
      </div>
      <div className="live-body">
        <ExternalViewSlot viewId={LIVE_VIEW_ID} url={url} nav={nav + localNav} active={active && !qr} />
        {qr && <QrPanel url={current} onCopy={(u) => copyText(u, notify)} onClose={() => setQr(false)} />}
      </div>
    </div>
  );
}
