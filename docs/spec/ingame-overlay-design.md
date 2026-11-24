# ゲーム内オーバーレイ（Tab でゴールド差の表）設計書

試合中、**Tab キーを押している間だけ**、ゲームの画面の上にレーンごとのアイテムゴールド差の表を重ねて出す機能の調査と設計。Feature Flag `inGameOverlay`（既定オフ）で ON / OFF できる。

- 状態: **実装済み**（2026-11-23。§9 は持ち主が設計どおりに承認）。実機での確認は未了（§11）。設計との差異は末尾の「実装メモ」。
- 前提として読むもの: [live-matchup-design.md](./live-matchup-design.md)（ゴールド差のデータ、Feature Flag、main のゲート）、[decisions.md](./decisions.md) M-025〜M-029・M-031・M-033、[../design/next-architecture.md](../design/next-architecture.md) §8（オーバーレイの方式の比較）、`next/CLAUDE.md`（ゾーン）。
- 決定番号は M-034（[decisions.md](./decisions.md) に確定済み。§10 はその原案）。
- 作成: 2026-11-23。

---

## 1. 結論（先に要点）

| 論点 | 結論 |
|---|---|
| 描き方 | **Electron の透明・最前面・クリック透過・フォーカスを取らないウィンドウ**を 1 枚作り、ゲームの上に重ねる（next-architecture.md §8 の方式①）。ゲームのプロセスには一切触れない |
| 見える条件 | LoL の「ウィンドウモード」が **ボーダーレス** か **ウィンドウ** のとき。**フルスクリーン（排他的）では見えない**（Discord のオーバーレイと同じ制約）。Settings に注記を出す |
| Tab の検知 | Electron の `globalShortcut` は**使えない**（Tab を横取りしてゲームのスコアボードが開かなくなる。押している間・離したの区別も取れない）。**Win32 の `GetAsyncKeyState(VK_TAB)` を 50ms ごとに読む**（横取りしない、読むだけ）。呼び出しは FFI ライブラリ `koffi` で行う |
| データ | 既存の `MatchState.live`（Live Client Data API、M-025）をそのまま使う。新しい API は読まない。**`liveClientData` が ON であることが前提** |
| 表の並び | メインウィンドウの対面表（補正とユーザーの入れ替えの結果）と同じ並びを、renderer → main → オーバーレイへ送る |
| ルール面 | 表示するのは、ゲームの Tab スコアボードで誰でも見られるアイテムから計算した値だけ。Riot の開発者ポリシーの「ゲームクライアントに無い情報を使わない」「プレイヤーの判断を奪わない」に沿う。ただし Riot の公式ページは自動取得できず原文は未確認（§7） |
| 確かめられないこと | 実際の LoL の上での表示、ボーダーレス / フルスクリーンでの見え方、Vanguard との相性、DPI とマルチモニタ。**Windows 実機で人間が確認する必要がある**（§11） |

---

## 2. やること / やらないこと

### 2.1 やること
- Feature Flag `inGameOverlay`（既定オフ）。`liveClientData` が OFF のときは ON にできない（Settings で無効表示）。
- 試合中（`InProgress`）に、LoL のゲームのウィンドウが前面にあり Tab が押されている間だけ、オーバーレイを表示する。離したら消す。
- 表の中身: 5 レーンの行（味方アイコン・レベル・差・レベル・敵アイコン）と `TEAM` 行（チーム合計の差、M-033）。サイドバーの Matchup と同じ値・同じ色。
- Windows 専用。ほかの OS ではフラグを出すが「Windows only」と注記し、main は何もしない。

### 2.2 やらないこと（範囲外）
- 排他的フルスクリーンへの描き込み（DirectX フック、注入）。Vanguard と Riot のポリシー上、採用しない（next-architecture.md §8 の方式③）。
- Overwolf（ow-electron）への乗り換え（審査と収益化の条件があるため。§3.1）。
- オーバーレイのクリック・ドラッグ操作（完全にクリック透過）。
- 位置・大きさ・キーの設定（第 2 段階。§9 で持ち主が望めば足す）。
- 所持金や、ゲームに表示されない情報の表示。タイマー、通知、行動の指示。

---

## 3. 調査結果

### 3.1 オーバーレイの描き方

| 方式 | 中身 | フルスクリーン | 追加の依存・審査 | 評価 |
|---|---|---|---|---|
| ① 透明な最前面ウィンドウ | `BrowserWindow({ transparent, frame: false, focusable: false, skipTaskbar })` + `setAlwaysOnTop(true, "screen-saver")` + `setIgnoreMouseEvents(true)` + `showInactive()` | ボーダーレス / ウィンドウのみ | なし（Electron 標準） | **採用** |
| ② ow-electron の overlay | Overwolf の Electron 派生で、ゲームの描画に描き込む | 出る | Overwolf の審査、収益化の採用が条件、殻の入れ替え | 個人のツールには重すぎる |
| ③ 自前の DirectX フック / メモリ読み取り | — | 出る | — | **採用しない**（Vanguard、BAN の危険。2026-10 以降、未知のアプリのメモリアクセスは既定で遮断されるという報告もある） |

方式①の注意点（Electron の文書と既知の issue より）:
- `transparent: true` のウィンドウの透明な部分は、`setIgnoreMouseEvents(true)` を付けないとクリックを吸う。今回は全体をクリック透過にするので問題ない。
- `alwaysOnTop` のレベルは `"screen-saver"` にする（通常のレベルだとゲームの下に回ることがある）。
- `show()` はフォーカスを奪う。**必ず `showInactive()` を使い、`focusable: false` にする**。フォーカスを奪うとゲームが入力を受けなくなり、ボーダーレスでもゲームが最小化されることがある。
- Discord のオーバーレイも「ボーダーレス / ウィンドウでは出るが、本当のフルスクリーンでは出ない」と案内している。同じ制約を受け入れ、Settings に「LoL の Window Mode を Windowed か Borderless にしてください」と書く。

### 3.2 Tab の検知

| 方法 | 横取り | 押している間が分かるか | 依存 | 評価 |
|---|---|---|---|---|
| Electron `globalShortcut.register("Tab")` | **する**（Windows の `RegisterHotKey`。ゲームに Tab が届かずスコアボードが開かない） | 分からない（押した瞬間だけ。キーリピートも抑止） | なし | **不可** |
| 低レベルキーボードフック（`WH_KEYBOARD_LL`、uiohook-napi 等） | しない | 分かる | ネイティブモジュール（libuiohook）。全キー入力のフックを常駐させる | 重い。全キーを受け取る作りは避けたい |
| **`GetAsyncKeyState(VK_TAB)` を一定間隔で読む** | しない | 分かる（戻り値の最上位ビット = 今押されている） | `koffi`（FFI。Windows 用のビルド済みバイナリ同梱、コンパイル不要） | **採用** |

採用した方法の細部:
- 読むのは **Tab の 1 キーだけ**。他のキーの状態は読まない・記録しない。
- 間隔は 50ms（表示の遅れは最大 50ms。人には気にならない）。
- 読むのは「フラグ ON かつ `liveClientData` ON かつ `InProgress` かつ Windows」の間だけ。それ以外の時間はタイマー自体を止める。
- **LoL のゲームのウィンドウが前面のときだけ**表示する。`GetForegroundWindow` のウィンドウクラス名が `RiotWindowClass`（League of Legends (TM) Client のクラス名。実機で要確認、§11）のときだけ。チャットやブラウザで Tab を押しても出さない。
- ゲームのチャット入力中に Tab を押しても出る（ゲーム側でもスコアボードが開くので同じ動き）。

### 3.3 データ

追加の API は不要。既存の `MatchState.live`（`/liveclientdata/playerlist` を 2 秒ごと。チャンピオン、味方/敵、レーン、レベル、推定アイテムゴールド）から、`rowLiveDiff` / `teamLiveDiff` で計算する。

- 敵の所持金は Live Client Data API でも取れない（`activePlayer` の `currentGold` は自分だけ）。アイテムの合計で比べる M-026 の方針はそのまま。
- オーバーレイの値は最大 2 秒遅れる（ポーリング間隔）。

---

## 4. 構成

```
 main process                                         overlay window (透明・最前面・クリック透過)
 ┌───────────────────────────────────────────┐         ┌──────────────────────────────┐
 │ Hub ── hub:state ───────────────────────────────────▶│ overlay.html (apps/web)        │
 │ overlay-core (Electron なし、単体テスト)    │         │  OverlayTable                 │
 │   gate: flag && live && InProgress && win32│ rows ──▶│   rowLiveDiff / teamLiveDiff  │
 │   tab:  KeySource.isTabDown()  (50ms)       │         └──────────────────────────────┘
 │   fg:   KeySource.isGameForeground()        │
 │   → showInactive() / hide()                │◀── overlay:set-enabled, overlay:rows ── main window (App)
 └───────────────────────────────────────────┘
```

### 4.1 main: `apps/desktop/src/overlay-core.ts`（新規、🔴、Electron に依存しない）
`live-core.ts` と同じく、判断だけを純粋な関数とクラスにしてテストできるようにする。

```ts
export const OVERLAY_POLL_MS = 50;

export type KeySource = {
  /** Tab が今押されているか（GetAsyncKeyState の最上位ビット）。 */
  isTabDown(): boolean;
  /** 前面のウィンドウが LoL のゲームか。 */
  isGameForeground(): boolean;
};

export type OverlayGateDeps = {
  keys: KeySource | null;              // win32 以外では null（何もしない）
  show(): void;                        // win.showInactive()（ゲームのウィンドウに合わせて位置を決めてから）
  hide(): void;
  setInterval: typeof setInterval;     // テストで差し替える
  clearInterval: typeof clearInterval;
};

export type OverlayGate = {
  setEnabled(v: boolean): void;        // inGameOverlay && liveClientData（renderer が計算して送る）
  setPhase(p: string): void;           // Hub の phase
  readonly polling: boolean;
  readonly visible: boolean;
  dispose(): void;
};
```
- `enabled && phase === "InProgress" && keys != null` の間だけ 50ms のタイマーを回す。外れたらタイマーを止め、表示中なら `hide()`。
- 毎回 `want = keys.isTabDown() && keys.isGameForeground()`。前回と違うときだけ `show()` / `hide()` を呼ぶ。
- `isTabDown` が例外を投げたら（DLL が読めない等）、ログに 1 回だけ出してタイマーを止める（毎 50ms のログ洪水を防ぐ）。

### 4.2 main: `apps/desktop/src/win-keys.ts`（新規、🔴）
`koffi` で `user32.dll` の 3 関数を読み、`KeySource` を作る。`process.platform !== "win32"` なら `null` を返す。koffi の読み込みは win32 のときだけ動的に `require` する（Linux の E2E で読み込ませない）。

```ts
// win32 only
const user32 = koffi.load("user32.dll");
const GetAsyncKeyState = user32.func("short __stdcall GetAsyncKeyState(int vKey)");
const GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");
const GetClassNameW = user32.func("int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* buf, int max)");
const VK_TAB = 0x09;
isTabDown: () => (GetAsyncKeyState(VK_TAB) & 0x8000) !== 0,
isGameForeground: () => className(GetForegroundWindow()) === "RiotWindowClass",
```
- ゲームのウィンドウの位置（`GetWindowRect`）もここで取り、`show()` の前にオーバーレイをそのモニタに合わせる（§5.2）。取れなければ主モニタ。
- E2E 用に、環境変数 `LOL_OVERLAY_FAKE_KEYS=<ファイルのパス>` があるときは、そのファイルの中身（`tab` / `none`）を読む偽の `KeySource` を使う（前面判定は常に true）。**パッケージ版でも効くが、ユーザーが設定することはない**（既存の `LOL_LCU_LOCKFILE` と同じ扱い）。

### 4.3 main: `main.ts` の配線（🔴、最小限）
- オーバーレイのウィンドウは **試合が始まったとき（`InProgress` かつ有効）に隠したまま作り**、試合が終わるか無効になったら閉じる。押してから作ると表示が遅れるため。
  ```ts
  new BrowserWindow({
    show: false, transparent: true, frame: false, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, backgroundColor: "#00000000",
    webPreferences: { preload: join(__dirname, "overlay-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true);
  win.loadFile(join(__dirname, "web", "overlay.html"));
  ```
- メインウィンドウと同じく `will-navigate` を止め、`setWindowOpenHandler` で deny。
- IPC（送り元フレームの確認と zod の検証は既存の流儀に合わせる）:
  - `overlay:set-enabled`（renderer → main、boolean）: `gate.setEnabled(v)`。
  - `overlay:rows`（renderer → main、`{ ally: number|null, enemy: number|null }[5]`）: 最後の値を覚え、オーバーレイがあれば `overlay:rows` で転送。オーバーレイを作った直後にも送る。
  - オーバーレイには `hub:state` を既存と同じく流す。
- Hub の listener で `gate.setPhase(state.phase)`（`liveGate` と同じ場所）。

### 4.4 preload: `apps/desktop/src/overlay-preload.ts`（新規、🔴）
オーバーレイに渡すのは**受け取るだけ**の 2 つ。送る API は無い。
```ts
contextBridge.exposeInMainWorld("lolOverlay", {
  onState(cb), // hub:state（+ 初回は hub:get）
  onRows(cb),  // overlay:rows
});
```
メインの preload には `overlay: { setEnabled(v), setRows(rows) }` を足す（`LolViewerBridge` の型も、`live` と同じく省略可能で足す）。

### 4.5 renderer（`apps/web`、🟢）
- `overlay.html` と `src/overlay/main.tsx`（新しい Vite の入口。`vite.config.ts` の `build.rollupOptions.input` に足す。CSP は同じ）。
- `src/overlay/OverlayTable.tsx`: props は `{ rows, live }`（`MatchState` 全体ではなく必要なものだけ）。`rowLiveDiff` / `teamLiveDiff` に渡すため、`{ rows, last: { live } }` の形を作るか、core に `rows` と `live` を直接取る版（`rowLiveDiffOf(rows, live, i)`）を足して `Workspace` 版はそれを呼ぶようにする（後者を推奨）。
- App（メインウィンドウ）:
  - `const overlayOn = liveOn && isFeatureOn(settings, "inGameOverlay")` を `bridge.overlay?.setEnabled(overlayOn)` で送る（`live` と同じ `useEffect`）。
  - `ws.rows` が変わったら `bridge.overlay?.setRows(ws.rows)`。
- Settings > Feature flags: `inGameOverlay` を足す。`liveClientData` が OFF のときはスイッチを無効にし「Requires Live game data」と出す。Windows 以外（`bridge.kind !== "electron"` か、`app.info()` の platform が win32 でない）では「Windows only」と出す。

### 4.6 core（🟢）
`packages/core/src/settings.ts` の `FEATURE_FLAGS` に足す:
```ts
inGameOverlay: {
  label: "In-game overlay (hold Tab)",
  description:
    "While you hold Tab in a game, show the matchup's item gold differences over the game window. " +
    "Needs Live game data, Windows, and League's Window Mode set to Windowed or Borderless (not shown over Full Screen). " +
    "Off: the key is never read.",
  default: false,
},
```

---

## 5. 見た目

### 5.1 表
```
┌──────────────────────────────────┐
│ TOP  [Garen] 11   +150   10 [Pantheon] │
│ JG   [LeeSin] 9  +1.4k    8 [Gragas]   │
│ MID  [Ahri]  12   -150   11 [Jayce]    │
│ BOT  [Jinx]   9   -950   10 [Varus]    │
│ SUP  [Thresh] 8      0    8 [Karma]    │
│ ─────────────────────────────────────  │
│ TEAM  21.1k   +450   20.7k             │
└──────────────────────────────────┘
```
- 背景は `rgba(13,17,23,0.82)`（`--bg-1` の半透明）、角丸 `--radius-l`、文字と色はサイドバーの `.live-diff` と同じトークン。名前は出さない（幅を取るため。アイコンだけ）。
- アイコンは Data Dragon の画像（既存の `ChampionIcon`、CSP で許可済み）。試合前に一度メインウィンドウで読まれているのでキャッシュに乗る。
- 差が無い行は `vs`、試合中のデータが無ければオーバーレイは出さない（`live` が null）。

### 5.2 位置
- **改訂（M-035）: 持ち主の要望で、ゲームのウィンドウの左下、左端と下端から 20px に移した。** 以下は当初の案。
- 当初の既定: ゲームのウィンドウの**上端中央、上から 8%**（LoL の Tab スコアボードは画面中央にあり、上端中央は試合時間・キル数の表示のすぐ下）。**実機でスコアボードと重ならないか確認し、重なるなら左上（味方の顔の右）に移す**（§11）。
- 大きさ: 幅 360px 程度（CSS ピクセル。DPI は Electron に任せる）。高さは中身に合わせ、`win.setContentSize` で決める。

---

## 6. テスト

| 種類 | 中身 |
|---|---|
| 単体（Vitest） | `overlay-core.test.ts`: 有効/無効・フェーズ・Tab・前面の組み合わせで `show` / `hide` が正しく 1 回ずつ呼ばれる、条件が外れるとタイマーが止まり隠れる、`keys` が null なら何もしない、`isTabDown` の例外でタイマーが止まる。core: `rowLiveDiffOf`、フラグの既定値と `resetFeatureFlags` |
| Storybook | `Overlay/OverlayTable`: 試合中（`liveScenes.liveMid`）、序盤、補正後の入れ替え、透明な背景の上（チェック柄の背景で半透明を確かめる）。Settings の Feature flags: `liveClientData` OFF で無効表示、ON で切り替え可 |
| Storybook の E2E | オーバーレイの各行の差と `TEAM` 行の値（サイドバーと同じ値）。Settings で `inGameOverlay` が既定 OFF、`liveClientData` OFF のときは無効 |
| Electron の E2E（Linux, Xvfb） | `LOL_OVERLAY_FAKE_KEYS` を使い、偽 LCU の試合中に: ファイルを `tab` にするとオーバーレイのウィンドウが見える（`isVisible()`）・フォーカスがメインウィンドウから移らない（`isFocused()` が変わらない）・`isAlwaysOnTop()`・クリック透過、`none` にすると隠れる、フラグ OFF ではウィンドウ自体が無い。スクショを `e2e/screenshots/electron/overlay.png` に保存 |
| Windows CI | パッケージ版に `koffi` の Windows 用バイナリが入っていて、起動時に読み込めること（`win-keys.ts` の初期化が成功したことをログで確認）。既存のインストール → 起動 → E2E が通ること |

---

## 7. ルール面（Riot のポリシー、Vanguard）

調べた範囲（Riot の開発者ポリシーのページは自動取得で 403 になり、原文は読めなかった。検索結果の抜粋と二次資料による）:
- **ゲームクライアントに無い情報で有利にしてはいけない**（例: 敵のアルティメットのクールダウンの追跡。2025-03 に明示的に禁止）。→ 今回の値は、Tab スコアボードに出ているアイテムを Data Dragon の値段で足したもの。新しい情報は無い。
- **プレイヤーの判断を奪ってはいけない**（重要な判断を強調するのは可）。→ 数字を出すだけで、指示や通知はしない。
- **オーバーレイ・ロード画面への広告は禁止**（2025-05-29 から）。→ 広告は無い。
- Riot の UI を真似たオーバーレイ、ゲームを書き換えるものは不可という二次資料もある。→ 独自の見た目にする。
- Vanguard: 「LCU と in-game API（Live Client Data API）で作ったアプリは引き続き動く想定」（next-architecture.md §8）。2026-10 以降、未知のアプリのゲームのメモリへのアクセスは既定で遮断されるという報告がある。→ 本設計はゲームのプロセスに触れない（メモリも注入も無し）。`GetAsyncKeyState` はキーボードの状態を読む普通の Win32 API（ボイスチャットのプッシュトゥトークなどと同じ種類）。**ただし Vanguard が反応しないことは実機でしか確かめられない**。
- Riot は承認済みアプリの一覧を公開しておらず、配布するアプリは Riot の開発者ポータルへの登録が求められる場合がある（原文未確認）。**このアプリを他人に配る範囲が広がるなら、持ち主が Riot の開発者ポリシーの原文を確認する**（§9）。

---

## 8. 実装の順序（実装担当向け）

1. core: `inGameOverlay` フラグ、`rowLiveDiffOf`（`rowLiveDiff` をそれで書き直す）、テスト。
2. web: `OverlayTable` と stories → Storybook の E2E。スクショを開いて確認する。
3. web: `overlay.html` の入口、Settings のフラグ表示（依存と Windows only の注記）、App から `setEnabled` / `setRows`。
4. desktop（🔴）: `overlay-core.ts` とテスト → `win-keys.ts`（偽の KeySource 込み）→ `overlay-preload.ts` → `main.ts` の配線 → `build.mjs` に overlay-preload の出力と `koffi` の external を足す → `package.json` の `dependencies` に `koffi`（バージョン固定）→ `electron-builder.yml` で koffi を含め `asarUnpack` する。
5. Electron の E2E（`e2e/electron-overlay.spec.ts`）。
6. 完了の定義のコマンドを全部通す。spec（new-app-spec.md）、decisions.md（M-034 を確定）、progress.md を更新。
7. PR に: 🔴 の変更点（新しいウィンドウ、preload、ネイティブの依存）と理由、実機で未確認の項目（§11）を書く。Windows CI が通るまで配らない。

---

## 9. 持ち主に決めてほしいこと

1. **フルスクリーンで見えない制約を受け入れるか**（受け入れない場合は Overwolf への乗り換えになり、規模がまったく変わる）。
2. **表示のしかた**: Tab を押している間だけ（ゲームのスコアボードと同時に出る）／別のキーで表示・非表示を切り替える（例: Tab を押しながら別キー）。本設計は前者。
3. **位置**: 上端中央（既定案）／左上／右側。実機で見てから決めてもよい。
4. ネイティブの依存（`koffi`）を 1 つ足してよいか（Windows CI で確かめる。インストーラは数 MB 増える）。

---

## 10. 決定: M-034（decisions.md に確定済み。以下は原案）

## M-034 ゲーム内オーバーレイ（Tab で表示、Feature Flag、2026-11-23）
- 透明・最前面・クリック透過・フォーカスを取らない Electron のウィンドウをゲームの上に重ねる。ゲームのプロセスには触れない。ボーダーレス / ウィンドウモードでだけ見える。
- Tab の検知は `GetAsyncKeyState(VK_TAB)` を 50ms ごとに読む（`koffi`）。`globalShortcut` は Tab を横取りしてゲームのスコアボードを壊すので使わない。読むのは Tab だけで、試合中・フラグ ON・LoL のゲームが前面の間だけ。
- データは `MatchState.live` だけ（`liveClientData` が前提）。表の並びはメインウィンドウの対面表と同じ。
- Feature Flag `inGameOverlay`、既定オフ。Windows 以外では何もしない。

---

## 11. 実機でしか確かめられないこと（Windows + 本物の LoL）

- ボーダーレス / ウィンドウ / フルスクリーンそれぞれで、オーバーレイが見えるか。表示・非表示でゲームがカクつかないか、フォーカスが奪われないか。
- ゲームのウィンドウのクラス名が `RiotWindowClass` か（違えば `win-keys.ts` の 1 か所を直す）。
- Tab を押してから表示されるまでの遅れ、離したときに確実に消えるか（Alt+Tab で離した場合も）。
- スコアボードと重ならない位置。高 DPI（125% / 150%）とマルチモニタでの位置。
- Vanguard が起動中でも `koffi` と `GetAsyncKeyState` が問題なく動くか、警告やキックが無いか。

---

## 参考

- Electron: [globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)（他のアプリと競合すると黙って失敗する。Windows は RegisterHotKey）、[Window Customization](https://www.electronjs.org/docs/latest/tutorial/window-customization)（`setIgnoreMouseEvents`）、[electron/electron#1335](https://github.com/electron/electron/issues/1335)（透明ウィンドウのクリック透過）
- Win32: [GetAsyncKeyState](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getasynckeystate)（他のプロセスがフォーカスを持っていても今の状態を返す。最上位ビット = 押されている）
- Discord: [Game Overlay の既知の問題](https://support.discord.com/hc/en-us/articles/25289844838551--Known-Issue-Game-Overlay)（ボーダーレス / ウィンドウでは出る、フルスクリーンでは出ない）
- Riot: [Third Party Applications](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/225266848-Third-Party-Applications)、開発者ポリシー（[General Policies](https://support-developer.riotgames.com/hc/en-us/articles/22698591841939-General-Policies)、[League of Legends](https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends)。自動取得は 403 で、原文は未確認）
- 二次資料: [lolnow.gg: Riot Cracks Down on Overlays](https://lolnow.gg/riot-cracks-down-on-overlays-in-league-of-legends-a-long-overdue-clean-up/)、[buildzcrank: What's Allowed in 2026](https://buildzcrank.com/en/blog/riot-api-and-third-party-apps-what-is-allowed/)、[senseos.gg: after Riot's Memory Block](https://senseos.gg/guides/league-of-legends/third-party-apps-after-memory-block/)
- Overwolf: [ow-electron overlay](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/Overview)

---

## 実装メモ（設計からの差異）

- **`koffi` は 3.3.5**（2026-10-28 公開）に固定し、`apps/desktop` の `dependencies` に足した。3.x は OS ごとのバイナリを `@koromix/koffi-*`（optionalDependencies）で配る。electron-builder は pnpm でインストールした OS 用のバイナリだけを同梱するので、Windows 用は Windows 上でインストールしたとき（Windows CI）に入る。`electron-builder.yml` は `koffi` と `@koromix` を `asarUnpack` する。Linux では `electron-builder --linux dir` で同梱とアンパックを確認した。Windows のパッケージは未確認。
- **`OverlayGateDeps`**: `keys` を値ではなく `getKeys()`（最初に必要になったとき 1 回だけ呼ぶ）にした。フラグ OFF や Windows 以外で `koffi` を読まないため。ウィンドウの作成と破棄も同じゲートの `open()` / `close()` にして、単体テストで確かめられるようにした。`KeySource` には省略可能な `gameRect()` を足した（`GetWindowRect`、物理ピクセル。main が DIP に直す）。
- **高さ**: `win.setContentSize` で中身に合わせる代わりに、表を固定サイズ（360 × 204 CSS px）にして main と renderer で同じ数字を持つ。オーバーレイ側から main へ送る手段を持たせないため。
- **IPC の初回送信**: `hub:get` の invoke は使わず、main がオーバーレイの読み込み完了時と、以後の変化ごとに `hub:state` / `overlay:rows` を送る。preload が最後の値を覚えるので、ページが遅れて購読しても受け取れる。
- **Settings**: オーバーレイの switch は `liveClientData` が OFF の間は OFF 表示で無効にする（保存された値は残る）。「Windows only」の注記は `app.info().platform` が `win32` 以外、またはデスクトップ版でないときに出す。
- **プロトコル**: `OverlayControlApi`、`OverlayRowsSchema`、`LolOverlayBridge` を `packages/protocol` に足した。
- **Electron の E2E**: クリック透過は取得 API が無いので E2E では確かめていない（コードで `setIgnoreMouseEvents(true)`）。Xvfb にはコンポジタが無いので、画面全体のスクショでは透明部分が正しく透けるかは確かめられず、`capturePage` の画像（`overlay.png`）で見る。
- **未確認**: §11 の項目（実機の LoL、Vanguard、DPI、位置、クラス名）と、Windows CI のパッケージ版。
