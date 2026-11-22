import { useEffect, useState } from "react";
import type { RecorderApi, RecorderStatus } from "@lol-viewer/protocol";

function elapsed(startedAt: number | null): string {
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Settings → 試合を記録. Records League Client events (personal data masked)
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
    <section className="settings-section" aria-label="Recording">
      <h4>試合を記録</h4>
      <p className="settings-desc">
        League Client から届くデータをファイルに保存します。開発やテストに使うためのもので、他のプレイヤーの名前や ID は保存前に伏せられます。
      </p>
      {!recorder ? (
        <p className="settings-desc">デスクトップアプリでのみ使えます。</p>
      ) : !status ? null : (
        <>
          <div className="recorder-row">
            {status.recording ? (
              <>
                <span className="rec-dot" aria-hidden />
                <span role="status">
                  記録中 {elapsed(status.startedAt)}・{status.lines} 件
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => run(recorder.stop)}>
                  記録を停止
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" disabled={busy} onClick={() => run(recorder.start)}>
                記録を開始
              </button>
            )}
          </div>
          {status.file && (
            <p className="settings-desc">
              {status.recording ? "保存先" : "保存しました"}: <code className="path">{status.file}</code>
            </p>
          )}
          <button type="button" className="link-btn" onClick={() => recorder.openFolder()}>
            記録フォルダを開く
          </button>
        </>
      )}
    </section>
  );
}
