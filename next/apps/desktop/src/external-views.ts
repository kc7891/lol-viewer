/**
 * ExternalViewManager — owns every third-party page (lolalytics, u.gg).
 *
 * Third-party pages are native WebContentsViews layered over the window at the
 * rectangle the renderer reports for its <ExternalViewSlot>. No iframe: the
 * pages never enter our DOM and get no preload, no Node, and their own session.
 *
 * Lifecycle rules live here and only here:
 *  - attach   : reuse a cached view for the same viewId, else create one
 *  - detach   : remove from the window, keep up to MAX_CACHED for quick re-show
 *  - eviction : least recently detached views beyond the cache are destroyed
 */
import { clipboard, Menu, shell, WebContentsView, type BrowserWindow } from "electron";
import { isTrustedNavigation, type Rect, type ViewCommand, type ViewStatus } from "@lol-viewer/protocol";

const MAX_CACHED = 4;
const PARTITION = "persist:external";

type Entry = {
  view: WebContentsView;
  url: string;
  attached: boolean;
  visible: boolean;
  bounds: Rect;
};

export class ExternalViewManager {
  #win: BrowserWindow;
  #views = new Map<string, Entry>();
  /** Detached view ids, oldest first. */
  #cache: string[] = [];
  #onStatus: (s: ViewStatus) => void;

  constructor(win: BrowserWindow, onStatus: (s: ViewStatus) => void) {
    this.#win = win;
    this.#onStatus = onStatus;
  }

  handle(cmd: ViewCommand): void {
    switch (cmd.type) {
      case "attach":
        return this.#attach(cmd.viewId, cmd.url, cmd.bounds, cmd.force === true);
      case "navigate":
        return this.#navigate(cmd.viewId, cmd.action);
      case "setBounds": {
        const e = this.#views.get(cmd.viewId);
        if (!e) return;
        e.bounds = cmd.bounds;
        e.view.setBounds(cmd.bounds);
        return;
      }
      case "setVisible": {
        const e = this.#views.get(cmd.viewId);
        if (!e) return;
        e.visible = cmd.visible;
        e.view.setVisible(cmd.visible && e.attached);
        return;
      }
      case "detach":
        return this.#detach(cmd.viewId);
    }
  }

  /** Snapshot for tests / diagnostics. */
  describe(): { viewId: string; url: string; attached: boolean; visible: boolean; bounds: Rect }[] {
    return [...this.#views].map(([viewId, e]) => ({
      viewId,
      url: e.url,
      attached: e.attached,
      visible: e.visible,
      bounds: e.bounds,
    }));
  }

  #attach(viewId: string, url: string, bounds: Rect, force: boolean): void {
    let e = this.#views.get(viewId);
    if (!e) {
      e = { view: this.#create(viewId), url: "", attached: false, visible: true, bounds };
      this.#views.set(viewId, e);
    }
    this.#cache = this.#cache.filter((id) => id !== viewId);
    if (!e.attached) {
      this.#win.contentView.addChildView(e.view);
      e.attached = true;
    }
    e.bounds = bounds;
    e.view.setBounds(bounds);
    e.view.setVisible(e.visible);
    if (e.url !== url || force) {
      e.url = url;
      this.#onStatus({ ...this.#nav(e.view.webContents), viewId, status: "loading", url, title: "" });
      void e.view.webContents.loadURL(url).catch(() => {
        /* reported via did-fail-load */
      });
    }
  }

  #nav(wc: Electron.WebContents): { canGoBack: boolean; canGoForward: boolean } {
    const h = wc.navigationHistory;
    return { canGoBack: h.canGoBack(), canGoForward: h.canGoForward() };
  }

  #navigate(viewId: string, action: "back" | "forward" | "reload" | "openExternal"): void {
    const wc = this.#views.get(viewId)?.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    switch (action) {
      case "back":
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        return;
      case "forward":
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        return;
      case "reload":
        wc.reload();
        return;
      case "openExternal": {
        const url = wc.getURL();
        if (url.startsWith("https://")) void shell.openExternal(url);
        return;
      }
    }
  }

  #detach(viewId: string): void {
    const e = this.#views.get(viewId);
    if (!e || !e.attached) return;
    this.#win.contentView.removeChildView(e.view);
    e.attached = false;
    this.#cache.push(viewId);
    while (this.#cache.length > MAX_CACHED) {
      const old = this.#cache.shift()!;
      const victim = this.#views.get(old);
      this.#views.delete(old);
      victim?.view.webContents.close();
    }
  }

  #create(viewId: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // no preload: third-party pages get nothing from us
      },
    });
    view.setBackgroundColor("#0d1117");
    const wc = view.webContents;

    // Popups and off-allowlist navigation go to the user's browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (ev, url) => {
      if (isTrustedNavigation(this.#views.get(viewId)?.url ?? "", url)) return;
      ev.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    });

    const report = (status: ViewStatus["status"]) => {
      if (wc.isDestroyed()) return;
      this.#onStatus({ viewId, status, url: wc.getURL(), title: wc.getTitle(), ...this.#nav(wc) });
    };
    // "loading" is raised by any start (sub-frames, ads, SPA routes) but did-finish-load only
    // fires for the main frame, so heavy pages stayed "loading" forever. did-stop-loading is
    // the one event that always closes the cycle. A failed main-frame load stays "error"
    // until the next main-frame navigation starts.
    let failed = false;
    wc.on("did-start-navigation", (d) => {
      if (d.isMainFrame && !d.isSameDocument) failed = false;
    });
    wc.on("did-start-loading", () => report("loading"));
    wc.on("did-stop-loading", () => report(failed ? "error" : "ready"));
    wc.on("did-fail-load", (_e, code, _d, _u, isMainFrame) => {
      if (isMainFrame && code !== -3 /* ABORTED */) {
        failed = true;
        report("error");
      }
    });
    // Keep the last known status kind; only url / title / back-forward change.
    const current = (): ViewStatus["status"] => (failed ? "error" : wc.isLoading() ? "loading" : "ready");
    wc.on("did-navigate", () => report(current()));
    wc.on("did-navigate-in-page", () => report(current()));
    wc.on("page-title-updated", () => report(current()));

    wc.on("context-menu", (_e, params) => {
      const items: Electron.MenuItemConstructorOptions[] = [
        { label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: "Forward", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: "Reload", click: () => wc.reload() },
      ];
      if (params.linkURL) {
        items.push({ type: "separator" }, { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) });
      }
      items.push(
        { type: "separator" },
        { label: "Open page in browser", enabled: wc.getURL().startsWith("https://"), click: () => this.#navigate(viewId, "openExternal") },
      );
      Menu.buildFromTemplate(items).popup({ window: this.#win });
    });
    return view;
  }
}
