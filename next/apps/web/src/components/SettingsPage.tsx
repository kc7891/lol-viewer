import { Fragment, useEffect, useRef, useState, type Dispatch } from "react";
import {
  DEFAULT_URL_TEMPLATES,
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  firstEmptyRow,
  flagsAtDefaults,
  isFeatureOn,
  resetFeatureFlags,
  getChampion,
  searchChampions,
  trimUrlTemplates,
  urlTemplateProblem,
  validateUrlTemplates,
  type Side,
  type UiSize,
  type UrlTemplateKey,
  type UrlTemplates,
  type Workspace,
  type WorkspaceAction,
} from "@lol-viewer/core";
import { isValidRiotId, LANES, type ConnectionStatus, type OverlayPosition, type UpdateStatus } from "@lol-viewer/protocol";
import { useBridge, useUpdateStatus } from "../bridge/context.tsx";
import { useSettings } from "../state/settings.tsx";
import type { ToastKind } from "../state/toasts.tsx";
import { LANE_SHORT } from "../ui/labels.ts";
import { ChampionIcon } from "./ChampionIcon.tsx";
import { RecorderSection } from "./RecorderSection.tsx";

type FieldDef = { key: UrlTemplateKey; label: string; hint: string };
const URL_FIELDS: FieldDef[] = [
  { key: "build", label: "Build", hint: "{name} = champion" },
  { key: "matchup", label: "Matchup", hint: "{champion_name1}, {champion_name2} = champions, {lane_name} = lane" },
  { key: "counter", label: "Counter", hint: "{name} = champion" },
  { key: "aram", label: "ARAM", hint: "{name} = champion" },
  { key: "liveGame", label: "Live Game", hint: "Opened in the Live Game page" },
];

export type UrlsCardProps = {
  /** Bumps the Live Game page (it reopens with the new URL). */
  onSaved: () => void;
  notify: (text: string, kind?: ToastKind) => void;
  /** Stories / tests: start with an edited draft and these fields already flagged. */
  initialDraft?: UrlTemplates;
  initialErrors?: UrlTemplateKey[];
};

export function UrlsCard({ onSaved, notify, initialDraft, initialErrors = [] }: UrlsCardProps) {
  const { settings, setUrls, resetUrls } = useSettings();
  const [draft, setDraft] = useState<UrlTemplates>(initialDraft ?? settings.urls);
  const [errors, setErrors] = useState<UrlTemplateKey[]>(initialErrors);
  const dirty = URL_FIELDS.some((f) => draft[f.key] !== settings.urls[f.key]);

  const save = () => {
    const bad = validateUrlTemplates(draft);
    setErrors(bad);
    if (bad.length) {
      notify(`Not saved: ${bad.length} URL${bad.length > 1 ? "s need" : " needs"} fixing.`, "warn");
      return;
    }
    const clean = trimUrlTemplates(draft);
    setDraft(clean);
    setUrls(clean);
    onSaved();
    notify("URLs saved. Live Game reloaded.", "success");
  };
  const reset = () => {
    setDraft({ ...DEFAULT_URL_TEMPLATES });
    setErrors([]);
    resetUrls();
    onSaved();
    notify("URLs reset to defaults.", "success");
  };

  return (
    <section className="card" aria-label="Analytics URLs">
      <h2>Analytics URLs</h2>
      <p className="desc">Any https site can be used (lolalytics.com, u.gg, op.gg, ...). All five are required.</p>
      <div className="fields">
        {URL_FIELDS.map((f) => {
          const bad = errors.includes(f.key);
          return (
            <div className="field" key={f.key} data-invalid={bad || undefined}>
              <label htmlFor={`url-${f.key}`}>{f.label}</label>
              <input
                id={`url-${f.key}`}
                type="text"
                spellCheck={false}
                value={draft[f.key]}
                aria-invalid={bad}
                aria-describedby={`url-${f.key}-hint`}
                onChange={(e) => {
                  setDraft({ ...draft, [f.key]: e.target.value });
                  if (bad) setErrors(errors.filter((k) => k !== f.key));
                }}
              />
              <span id={`url-${f.key}-hint`} className={bad ? "hint error" : "hint"}>
                {bad
                  ? urlTemplateProblem(draft[f.key]) === "empty"
                    ? "Required. Enter a URL."
                    : "Must be an https URL."
                  : f.hint}
              </span>
            </div>
          );
        })}
      </div>
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={save} disabled={!dirty && errors.length === 0}>
          Save
        </button>
        <button type="button" className="btn ghost" onClick={reset}>
          Reset to defaults
        </button>
      </div>
    </section>
  );
}

const CONN_TEXT: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Connected to the League Client",
  disconnected: "Not connected. Start the League Client; the app keeps trying.",
};

export function LcuCard({ connection }: { connection: ConnectionStatus }) {
  const lcu = useBridge().lcu;
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const reconnect = () => {
    lcu?.reconnect();
    setBusy(true);
    timer.current = setTimeout(() => setBusy(false), 1500);
  };
  const shown: ConnectionStatus = busy ? "connecting" : connection;
  return (
    <section className="card" id="lcu" aria-label="League Client">
      <h2>League Client</h2>
      <div className="lcu-row">
        <span className="conn-pill" data-status={shown} role="status">
          <span className="dot" />
          {CONN_TEXT[shown]}
        </span>
        <button type="button" className="btn" disabled={!lcu || busy} onClick={reconnect}>
          {busy ? "Connecting…" : "Reconnect"}
        </button>
      </div>
      {!lcu && <p className="desc muted">Reconnect is available in the desktop app.</p>}
    </section>
  );
}

const SIZES: { size: UiSize; label: string }[] = [
  { size: "small", label: "Small" },
  { size: "medium", label: "Medium" },
  { size: "large", label: "Large" },
];

export function DisplayCard() {
  const { settings, update } = useSettings();
  return (
    <section className="card" aria-label="Display">
      <h2>Display</h2>
      <div className="setting-row">
        <span className="setting-label" id="ui-size-label">
          UI size
        </span>
        <div className="seg" role="group" aria-labelledby="ui-size-label">
          {SIZES.map((s) => (
            <button key={s.size} type="button" aria-pressed={settings.uiSize === s.size} onClick={() => update({ uiSize: s.size })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <label className="setting-label" htmlFor="qr-switch">
          Show the QR button on viewers
        </label>
        <input id="qr-switch" type="checkbox" role="switch" className="switch" checked={settings.qrButton} onChange={(e) => update({ qrButton: e.target.checked })} />
      </div>
    </section>
  );
}

/** The OS the desktop app runs on; null in a browser (no desktop bridge), undefined while the first answer is pending. */
function usePlatform(): string | null | undefined {
  const app = useBridge().app;
  const [platform, setPlatform] = useState<string | null | undefined>(app ? undefined : null);
  useEffect(() => {
    if (!app) return setPlatform(null);
    let live = true;
    app.info().then(
      (i) => live && setPlatform(i.platform),
      () => live && setPlatform(null),
    );
    return () => {
      live = false;
    };
  }, [app]);
  return platform;
}

const OVERLAY_HORIZONTAL = ["left", "center", "right"] as const;
const OVERLAY_VERTICAL = ["top", "bottom"] as const;

/** M-036: a small 16:9 screen with a 3x2 grid of radio buttons, one per overlay position. */
function OverlayPositionPicker({ value, disabled, onChange }: { value: OverlayPosition; disabled: boolean; onChange: (p: OverlayPosition) => void }) {
  return (
    <div className="setting-row flag-row overlay-pos-row">
      <div className="flag-text">
        <span className="setting-label">Overlay position</span>
        <span className="hint">Where the table appears over the game window. Top center covers the game's timer and score; bottom left covers the chat.</span>
      </div>
      <div className="overlay-pos" role="radiogroup" aria-label="Overlay position" data-disabled={disabled || undefined}>
        {OVERLAY_VERTICAL.flatMap((vertical) =>
          OVERLAY_HORIZONTAL.map((horizontal) => {
            const checked = value.horizontal === horizontal && value.vertical === vertical;
            return (
              <label key={`${vertical}-${horizontal}`} className={`overlay-pos-cell${checked ? " on" : ""}`}>
                <input
                  type="radio"
                  name="overlay-position"
                  aria-label={`${vertical === "top" ? "Top" : "Bottom"} ${horizontal}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange({ horizontal, vertical })}
                />
              </label>
            );
          }),
        )}
      </div>
    </div>
  );
}

export function FeatureFlagsCard({ notify }: { notify: (text: string, kind?: ToastKind) => void }) {
  const { settings, update } = useSettings();
  const desktop = useBridge().live != null;
  const platform = usePlatform();
  if (FEATURE_FLAG_KEYS.length === 0) return null;
  const liveOn = isFeatureOn(settings, "liveClientData");
  return (
    <section className="card" aria-label="Feature flags">
      <h2>Feature flags</h2>
      <p className="desc">Optional features. Changes apply at once.</p>
      {FEATURE_FLAG_KEYS.map((k) => {
        const def = FEATURE_FLAGS[k];
        // M-034: the overlay needs Live game data; it shows as off while that is off.
        const needsLive = k === "inGameOverlay";
        const blocked = needsLive && !liveOn;
        const on = isFeatureOn(settings, k) && !blocked;
        const windowsOnly = needsLive && platform !== undefined && platform !== "win32";
        return (
          <Fragment key={k}>
            <div className="setting-row flag-row">
              <div className="flag-text">
                <label className="setting-label" htmlFor={`flag-${k}`}>
                  {def.label}
                </label>
                <span className="hint" id={`flag-${k}-desc`}>
                  {def.description}
                </span>
                {blocked && (
                  <span className="hint flag-note" data-testid={`flag-${k}-requires`}>
                    Requires Live game data
                  </span>
                )}
                {windowsOnly && (
                  <span className="hint flag-note" data-testid={`flag-${k}-windows-only`}>
                    Windows only
                  </span>
                )}
              </div>
              <input
                id={`flag-${k}`}
                type="checkbox"
                role="switch"
                className="switch"
                checked={on}
                disabled={blocked}
                aria-describedby={`flag-${k}-desc`}
                onChange={(e) => {
                  update({ featureFlags: { ...settings.featureFlags, [k]: e.target.checked } });
                  notify(`${def.label}: ${e.target.checked ? "on" : "off"}.`, "success");
                }}
              />
            </div>
            {needsLive && <OverlayPositionPicker disabled={!on} value={settings.overlayPosition} onChange={(overlayPosition) => update({ overlayPosition })} />}
          </Fragment>
        );
      })}
      {!desktop && <p className="desc muted">Live game data is read by the desktop app.</p>}
      <div className="card-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={flagsAtDefaults(settings)}
          onClick={() => {
            update({ featureFlags: resetFeatureFlags(settings.featureFlags) });
            notify("Feature flags reset to defaults.", "success");
          }}
        >
          Reset flags to defaults
        </button>
      </div>
    </section>
  );
}

const UPDATE_TEXT: Record<UpdateStatus["state"], string> = {
  unsupported: "Update checks are off in this build.",
  idle: "Not checked yet.",
  checking: "Checking…",
  "not-available": "You have the latest version.",
  available: "A new version is available.",
  downloading: "Downloading…",
  downloaded: "Ready to install. The app restarts.",
  error: "Could not check for updates.",
};

function UpdateRows({ status }: { status: UpdateStatus }) {
  const updates = useBridge().updates!;
  const { state } = status;
  const latest = state === "checking" ? "Checking…" : (status.latestVersion ?? "—");
  const text = state === "downloading" ? `Downloading… ${status.percent ?? 0}%` : state === "error" ? (status.error ?? UPDATE_TEXT.error) : UPDATE_TEXT[state];
  return (
    <>
      <div className="setting-row">
        <span className="setting-label">Latest version</span>
        <code data-testid="latest-version">{latest}</code>
      </div>
      <div className="setting-row update-row">
        <div className="update-info">
          <span className="update-text" role="status" data-state={state} data-testid="update-status">
            {text}
          </span>
          {state === "downloading" && <progress className="update-progress" max={100} value={status.percent ?? 0} aria-label="Download progress" />}
        </div>
        {state === "available" || state === "downloading" ? (
          <button type="button" className="btn primary" disabled={state === "downloading"} onClick={() => updates.download()}>
            Download
          </button>
        ) : state === "downloaded" ? (
          <button type="button" className="btn primary" onClick={() => updates.install()}>
            Restart and update
          </button>
        ) : state !== "unsupported" ? (
          <button type="button" className="btn" disabled={state === "checking"} onClick={() => updates.check()}>
            Check for updates
          </button>
        ) : null}
      </div>
    </>
  );
}

export function VersionCard() {
  const { app, updates } = useBridge();
  const status = useUpdateStatus();
  const [text, setText] = useState<string>(app ? "…" : "dev");
  useEffect(() => {
    if (!app) return setText("dev");
    let live = true;
    app.info().then(
      (i) => live && setText(`${i.version} (${i.platform})`),
      () => live && setText("unknown"),
    );
    return () => {
      live = false;
    };
  }, [app]);
  return (
    <section className="card" aria-label="Version">
      <h2>Version</h2>
      <div className="setting-row">
        <span className="setting-label">LoL Viewer</span>
        <code data-testid="version">{text}</code>
      </div>
      {status && <UpdateRows status={status} />}
      {!updates && <p className="desc muted">Updates are available in the desktop app.</p>}
    </section>
  );
}

export function DebugCard({
  ws,
  dispatch,
}: {
  ws: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const results = query.trim() && picked == null ? searchChampions(query, 6) : [];

  const choose = (id: number) => {
    setPicked(id);
    setQuery(getChampion(id)?.name ?? "");
  };
  const add = (side: Side) => {
    const champ = getChampion(picked);
    if (!champ) return;
    const row = firstEmptyRow(ws, side);
    if (row == null) {
      setResult({ text: `The ${side} side of the matchup is full.`, ok: false });
      return;
    }
    dispatch({ type: "debugAdd", side, championId: champ.id });
    setResult({ text: `Added ${champ.name} to ${side} · ${LANE_SHORT[LANES[row]!]}.`, ok: true });
    setPicked(null);
    setQuery("");
  };

  return (
    <section className="card" aria-label="Debug">
      <h2>Debug</h2>
      <p className="desc">Put a champion into the first empty matchup row, as if the League Client had sent it.</p>
      <div className="debug-row">
        <div className="combo">
          <input
            type="text"
            aria-label="Debug champion"
            placeholder="Champion (ahri / アーリ)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
              setResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                choose(results[0].id);
              }
            }}
          />
          {results.length > 0 && (
            <ul className="combo-list" role="listbox" aria-label="Debug champion results">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => choose(c.id)}>
                    <ChampionIcon id={c.id} size={20} />
                    <span>{c.name}</span>
                    <span className="ja">{c.nameJa}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="btn" disabled={picked == null} onClick={() => add("ally")}>
          Add ally
        </button>
        <button type="button" className="btn" disabled={picked == null} onClick={() => add("enemy")}>
          Add enemy
        </button>
      </div>
      {result && (
        <p className={result.ok ? "debug-result ok" : "debug-result bad"} role="status">
          {result.text}
        </p>
      )}
    </section>
  );
}

export type LcuCheckCardProps = {
  connection: ConnectionStatus;
  /** Stories: start mid-run or with a finished report. */
  initial?: { running?: { done: number; total: number }; text?: string };
};

/** Settings > LCU check (M-039): GET the planned League Client routes once each and show a report with no names or IDs. */
export function LcuCheckCard({ connection, initial }: LcuCheckCardProps) {
  const lcu = useBridge().lcu;
  const probe = lcu?.probe;
  const [riotId, setRiotId] = useState("");
  const [rateTest, setRateTest] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(initial?.running ?? null);
  const [text, setText] = useState<string | null>(initial?.text ?? null);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<"copied" | "manual" | null>(null);
  const reportRef = useRef<HTMLTextAreaElement>(null);
  const riotIdBad = riotId.trim() !== "" && !isValidRiotId(riotId.trim());
  const connected = connection === "connected";

  useEffect(() => {
    if (!running || !lcu?.onProbeProgress) return;
    return lcu.onProbeProgress(setRunning);
  }, [lcu, running !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!probe) return;
    setRunning({ done: 0, total: rateTest ? 21 : 20 });
    setError(null);
    setCopy(null);
    try {
      const r = await probe({ riotId: riotId.trim() || undefined, rateTest });
      setText(r.text);
    } catch {
      setError("The check failed. Try again.");
    } finally {
      setRunning(null);
    }
  };
  const copyReport = async () => {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      reportRef.current?.select();
      setCopy("manual");
    }
  };

  return (
    <section className="card" aria-label="LCU check">
      <h2>LCU check</h2>
      <p className="desc">
        Reads the League Client APIs planned for the Teams feature, once each, and shows what came back. Names and IDs are never shown. Copy the report and paste it to the developer.
      </p>
      {!probe ? (
        <p className="desc muted">Only available in the desktop app.</p>
      ) : (
        <>
          <div className="probe-row">
            <div className="field" data-invalid={riotIdBad || undefined}>
              <label htmlFor="probe-riot-id">Riot ID to look up (optional)</label>
              <input
                id="probe-riot-id"
                type="text"
                placeholder="name#tag"
                value={riotId}
                disabled={running !== null}
                aria-invalid={riotIdBad}
                onChange={(e) => setRiotId(e.target.value)}
              />
            </div>
            <label className="probe-check">
              <input type="checkbox" checked={rateTest} disabled={running !== null} onChange={(e) => setRateTest(e.target.checked)} />
              Rate test (40 extra requests)
            </label>
          </div>
          <div className="probe-row">
            <button type="button" className="btn primary" disabled={running !== null || riotIdBad || !connected} onClick={() => void run()}>
              Run check
            </button>
            {running && (
              <span role="status">
                {running.done} / {running.total} …
              </span>
            )}
            {!connected && !running && <span className="hint">Connect to the League Client first.</span>}
            {riotIdBad && <span className="hint error">Use name#tag.</span>}
            {error && <span className="hint error">{error}</span>}
          </div>
          {text != null && (
            <>
              <textarea ref={reportRef} className="probe-report" aria-label="LCU check report" readOnly spellCheck={false} value={text} />
              <div className="probe-row">
                <button type="button" className="btn" onClick={() => void copyReport()}>
                  Copy report
                </button>
                {copy === "copied" && <span role="status">Copied.</span>}
                {copy === "manual" && <span role="status">Press Ctrl+C to copy.</span>}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export type SettingsPageProps = {
  connection: ConnectionStatus;
  ws: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  notify: (text: string, kind?: ToastKind) => void;
  onUrlsSaved: () => void;
  /** Bumped when the top-bar connection status is clicked: scroll to League Client. */
  focusLcu?: number;
  urlsInitialDraft?: UrlTemplates;
  urlsInitialErrors?: UrlTemplateKey[];
};

export function SettingsPage({ connection, ws, dispatch, notify, onUrlsSaved, focusLcu = 0, urlsInitialDraft, urlsInitialErrors }: SettingsPageProps) {
  const bridge = useBridge();
  useEffect(() => {
    if (focusLcu > 0) document.getElementById("lcu")?.scrollIntoView({ block: "start" });
  }, [focusLcu]);
  return (
    <div className="settings-page">
      <div className="settings-inner">
        <h1>Settings</h1>
        <UrlsCard onSaved={onUrlsSaved} notify={notify} initialDraft={urlsInitialDraft} initialErrors={urlsInitialErrors} />
        <LcuCard connection={connection} />
        <DisplayCard />
        <FeatureFlagsCard notify={notify} />
        <VersionCard />
        <DebugCard ws={ws} dispatch={dispatch} />
        <LcuCheckCard connection={connection} />
        <RecorderSection recorder={bridge.recorder} />
      </div>
    </div>
  );
}
