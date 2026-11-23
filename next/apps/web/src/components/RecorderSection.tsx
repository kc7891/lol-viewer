import { useEffect, useState } from "react";
import type { RecorderApi, RecorderStatus } from "@lol-viewer/protocol";

function elapsed(startedAt: number | null): string {
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Settings → Record session. Records League Client events (personal data masked)
 * so the session can be replayed in tests.
 */
export function RecorderSection({ recorder }: { recorder: RecorderApi | undefined }) {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!recorder) return;
    void recorder.status().then(setStatus);
    return recorder.onStatus(setStatus);
  }, [recorder]);

  useEffect(() => {
    if (!status?.recording) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status?.recording]);

  const run = async (fn: () => Promise<RecorderStatus>) => {
    setBusy(true);
    try {
      setStatus(await fn());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Record session">
      <h2>Record session</h2>
      <p className="desc">
        Saves the data the League Client sends to a file, for development and tests. Other players' names and IDs are masked before saving.
      </p>
      {!recorder ? (
        <p className="desc muted">Only available in the desktop app.</p>
      ) : !status ? null : (
        <>
          <div className="recorder-row">
            {status.recording ? (
              <>
                <span className="rec-dot" aria-hidden />
                <span role="status">
                  Recording {elapsed(status.startedAt)} · {status.lines} events
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => run(recorder.stop)}>
                  Stop
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" disabled={busy} onClick={() => run(recorder.start)}>
                Start recording
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => recorder.openFolder()}>
              Open recordings folder
            </button>
          </div>
          {status.file && (
            <p className="desc">
              {status.recording ? "Writing to" : "Saved"}: <code className="path">{status.file}</code>
            </p>
          )}
        </>
      )}
    </section>
  );
}
