# 新版の設計（LoL Viewer / Electron 版）

旧版（PyQt6 版）の機能を、`next/` の Electron + TypeScript + React 構成へ移植するための設計。
**機能（何ができるか・どう振る舞うか）は旧版を移植し、見た目と操作方法は新しく設計する**（M-008）。

- 読む順番: [README](./README.md) → [decisions.md](./decisions.md) → この文書 → 必要に応じて [legacy-inventory/](./legacy-inventory/README.md)
- 旧インベントリの「見た目の指定」（色コード、px、ボタンの文字、ツールチップの文言、レイアウト）は移植の対象ではない。この文書の §4 が新しい UI の基準になる。
- 「挙動の指定」（URL の組み立て、配置の規則、新しい試合での全消去、上限 20 など）は移植の対象。食い違ったら decisions.md → この文書 → インベントリの順に優先する。
- 進み具合は [progress.md](./progress.md) で管理する。

---

## 1. 全体構成

```
League Client (LCU) ──WAMP/GET──▶ packages/lcu ──RawLcuEvent──▶ core.toLcuEvent ──LcuEvent──▶ packages/hub
                                                                                     (core.reduce → MatchState)
                                                                                            │ IPC (snapshot)
                                                                                            ▼
                                                     apps/web (React)  ── useWorkspace(core.workspaceReducer)
                                                     │  Workspace = ビューア一覧 / 対面表 / 保留中の敵ピック
                                                     │  Settings  = URL テンプレート / UI サイズ / QR / サイドバー幅
                                                     └─ <ExternalViewSlot> ──ViewCommand──▶ apps/desktop ExternalViewManager (WebContentsView)
```

| 層 | 置き場所 | 責務 |
|---|---|---|
| protocol | `next/packages/protocol` | 層をまたぐ型と zod スキーマ（MatchState, LcuEvent, ViewCommand, Bridge, ChampionData） |
| core | `next/packages/core` | 純粋ロジック。`reduce`（LCU → MatchState）、`workspaceReducer`（MatchState の列 + ユーザー操作 → Workspace）、URL 組み立て、名前解決・検索、設定のスキーマと既定値 |
| lcu | `next/packages/lcu` | 読み取り専用の LCU 接続（GET と WAMP 購読だけ）。資格情報の発見（プロセスのコマンドライン → lockfile） |
| hub | `next/packages/hub` | MatchState の単一の保管場所と配信 |
| desktop | `next/apps/desktop` | Electron main / preload。外部ビュー（WebContentsView）の管理、IPC、LCU 接続の起動 |
| web | `next/apps/web` | UI。Electron・ブラウザ（モック）・Storybook で同じものが動く |

### 1.1 状態の分担（M-011）
- **MatchState**（hub が持つ）: League Client が言っていることだけ。接続状態、フェーズ、試合番号 `matchSeq`、キュー、ARAM かどうか、自分のピック、味方と敵のピック済みチャンピオン。
- **Workspace**（renderer が持つ。`core/src/workspace.ts` の純粋 reducer）: ユーザーの作業状態。ビューア一覧、CURRENT MATCHUP の 5 行、保留中の敵ピック。MatchState のスナップショットを順に受け取り、差分から「新しい試合」「自分のピックが変わった」「新しい敵ピック」を判断する。
- **Settings**（renderer が持つ。`localStorage`、zod で検証、壊れていたら既定値）: URL テンプレート 5 つ、UI サイズ、QR、サイドバー幅、Feature Flag。

---

## 2. MatchState（`core.reduce`）の規則

旧版 `lcu_detector.py`（インベントリ 03）の検知規則を、WAMP イベント駆動で再現する（M-010）。

| 規則 | 内容 |
|---|---|
| 新しい試合 | ChampSelect 以外のフェーズから ChampSelect に入ったとき、または ChampSelect 中に champ-select の `gameId`（0 以外）が前回の 0 以外の値から変わったとき。`matchSeq` を 1 増やし、`self`・`allies`・`enemies`・`gameId` を空にする。champ-select セッションがフェーズより先に届いた場合も ChampSelect に入ったとみなす |
| 自分のピック | `myTeam` のうち `cellId == localPlayerCellId`。`championId > 0` なら `self = {championId, lane}`（ホバー込み。`championPickIntent` は使わない）。その後 `championId` が 0 に戻っても `self` を保持する |
| レーン | `assignedPosition` を小文字化。`utility → support`、`mid → middle`、`bot → bottom`。それ以外や空は null |
| 味方 / 敵 | ピック済み（`championId > 0`）だけを myTeam 順 / theirTeam 順に並べる。データにない ID は除外する |
| None / Lobby | `self` と自分の summoner の情報、`gameId` を消す。`allies` と `enemies` は残す（旧版も前の試合の一覧を残す） |
| 試合中（InProgress） | gameflow session の `gameData.teamOne/teamTwo` から味方と敵を作る（lane は null）。自分のチームは summonerId（または puuid）で判定し、分からなければ teamOne を味方とみなす。結果が空なら前の一覧を保持する。`self` は ChampSelect のものを保持する |
| summonerId | champ-select の自分の行から取る。無ければ `/lol-summoner/v1/current-summoner`（`current-summoner` イベント）から取る。MatchState には出さない（reducer の内部状態） |
| キューと ARAM | queueId は `gameData.queue` が数値 / `{id}` / `{queueId}` のどれでも取り出す。gameMode は `queue.gameMode` → `queue.mode` → `gameData.gameMode`。`isAram` は queueId が {450, 65, 100, 720, 2400, 2401, 2403, 2405, 3240, 3270} に入るか、gameMode が `"ARAM"` |
| 切断 | `connection = disconnected` にし、`phase = "None"` に戻す（再接続して ChampSelect に入ったら新しい試合）。`allies` / `enemies` は残す（UI は表示を保持する） |

reducer は `DetectorState = { match: MatchState, summonerId, puuid, lastChampSelectGameId }` を内部で持ち、hub は `match` だけを配信する。

## 3. Workspace（`core.workspaceReducer`）の規則

```ts
type ViewerMode = "build" | "counter" | "aram";
type Viewer = {
  id: number;                 // 単調増加（1 から）。外部ビューの viewId は `viewer-<id>`
  championId: number | null;
  opponentId: number | null;
  lane: Lane | null;
  mode: ViewerMode;           // チャンピオン未入力でも選んで保持できる
  picked: boolean;            // 自分のピックから自動で作ったもの
  hidden: boolean;
  nav: number;                // ページを「開く」たびに +1（同じ URL でも開き直す）
};
type Workspace = {
  viewers: Viewer[];          // 画面の左から右の順
  nextId: number;
  rows: { ally: number | null; enemy: number | null }[];   // 常に 5 行。LANES の順
  pending: number[];          // 保留中の敵ピック（championId）
  last: MatchState | null;    // 最後に受け取った MatchState
  seenEnemies: number[];      // この試合で保留リストに積んだ敵（重複防止）
  lastSelf: SelfPick | null;
};
```

上限: `MAX_VIEWERS = 20`。自動生成で上限を超える分は作らない（何も通知しない）。手動の追加は UI 側が `canAddViewer` を見て、上限なら通知を出して dispatch しない。

### 3.1 MatchState を受け取ったとき（`{type: "match", state}`）
処理は次の順に行う（旧版の発火順 new_match → matchup → champion → enemies と同じ）。
1. **新しい試合**（`state.matchSeq` が `last.matchSeq` と違う）: 全ビューア（手動で開いたものも含む）を閉じ、`rows`・`pending`・`seenEnemies`・`lastSelf` を空にする（M-001）。
2. **対面表**: `state.phase` が ChampSelect か InProgress のときだけ、`state.allies` / `state.enemies` を空いている枠に配置する。
   - 一度置いたチャンピオンは自動では消さない。既にその側のどこかの行にいるチャンピオンは飛ばす。
   - 味方 1 周目: lane がある味方を、その lane の行が空いていればそこへ、埋まっていれば最初の空き行へ。
   - 味方 2 周目: lane がない味方を、空き行のうちレーン適性（`champion.lanes`）が最も高い行へ。同点は上の行（Top 優先）。
   - 敵: 空き行のうちレーン適性が最も高い行へ。同点は上の行。
   - 空きがなければそこで止める。味方と敵は独立に置く（同じ行の相方は動かさない）。
3. **自分のピック**: `state.self` が null でなく、`lastSelf` と championId か lane が違うとき、`picked: true` の新しいビューアを**左端**に作る（既存の picked ビューアは残す。M-002）。`state.isAram` なら `mode: "aram"`、lane は null。そうでなければ `mode: "build"`、lane は `self.lane`。`nav = 1`（すぐ開く）。`state.self` が null になったら `lastSelf` も null にする。
4. **敵ピック**: `state.phase === "ChampSelect"` のときだけ、`state.enemies` のうち `seenEnemies` にないものを pick 順に `pending` の末尾へ積む（ビューアは作らない）。試合中のデータからは積まない。

### 3.2 ユーザー操作
| action | 挙動 |
|---|---|
| `addViewer` | 空のビューアを末尾に作る（mode build、lane null）。UI は作った直後にチャンピオン選択パネルを開く |
| `closeViewer {id}` / `closeAll` | `closeAll` はビューアと `pending` を全部消す（確認なし） |
| `toggleHidden {id}` | 非表示のビューアはペイン列に出さない（外部ビューは外す） |
| `setChampion {id, championId}` / `setOpponent {id, opponentId\|null}` / `setLane {id, lane\|null}` / `setMode {id, mode}` | 値を変える。チャンピオンが入っていれば `nav + 1`（すぐ開き直す）。入っていなければ値だけ保持する |
| `reopen {id}` | チャンピオンが入っていれば `nav + 1` |
| `openPending {championId}` | `pending` から外し、Counter ビューアを作る。位置は picked ビューアが 1 つでもあれば index 1、なければ 0 |
| `removePending {championId}` | `pending` から外す |
| `swapRows {side, from, to}` | 同じ側（ally / enemy）の 2 行を入れ替える。同じ行、範囲外は無視 |
| `openRow {index}` | その行の味方が空なら何もしない。味方・敵（あれば opponent）・行の lane で mode build のビューアを**末尾**に作り、すぐ開く（重複は排除しない） |
| `refreshMatchup` | `rows` と `pending` を空にし、`last` の allies / enemies を置き直す（`seenEnemies` は保持するので保留リストには積み直さない）。UI はあわせて `bridge.lcu.resync()` を呼ぶ |
| `debugAdd {side, championId}` | その側の最初の空き行（上から）に置く。適性も重複も見ない。空きがなければ何もしない（UI は `firstEmptyRow` で事前にメッセージを決める） |

### 3.3 派生値（core の関数）
- `viewerUrl(viewer, templates)`: URL を返す。チャンピオンが空なら null。
  - build: opponent があれば Matchup テンプレート（`{champion_name1}` / `{champion_name2}` / `{lane_name}`。lane が空なら空文字）。なければ Build テンプレートの `{name}` を置換し、lane があれば `lane=<lane>` を付ける。
  - counter: Counter テンプレート + `lane=`（opponent は使わない）。
  - aram: ARAM テンプレート（lane・opponent は使わない）。
  - 名前は champion の `slug`（小文字・記号なし。Wukong は `wukong`。M-004）。`lane=` はテンプレートに `?` が無ければ `?`、あれば `&` で付ける。URL エンコードはしない。
- `quickPicks(ws, viewer)`: 対面表の敵を行順に重複なく最大 5 体。今の opponent は除く。
- `opponentSuggestions(ws, viewer)`: 対面表の敵（行順・重複なし）。1 体もいなければ、他のビューアのチャンピオンと opponent（自分のチャンピオンは除く）。
- `defaultCooldownChampion(ws)`: 自分の lane の行の敵 → 無ければ対面表の最初の敵。
- 検索 `searchChampions(query)`: 大小無視。英語名・slug・日本語名（ひらがなはカタカナに寄せる）の前方一致を先に、部分一致を後に並べる。

---

## 4. UI 設計（新規）

### 4.1 方針
- **外部ページ（lolalytics / u.gg）の上には HTML を重ねられない**（WebContentsView はネイティブで最前面）。そのため、ペインの中のパネル（チャンピオン選択、レーン選択、QR）は**外部ビューと入れ替えて**表示する。アプリ全体のダイアログを開くときは全ビューを隠す。通知（トースト）は外部ビューと重ならない位置（サイドバーの下部）に出す。
- ネイティブのダイアログ（alert / confirm）は使わない。
- キーボードで全操作ができる。Esc で開いているパネルを閉じる。
- 文言は英語を基本とし、チャンピオン名は英語名＋日本語名を併記する（検索も両方）。

### 4.2 画面構成
```
┌ Top bar ────────────────────────────────────────────────────────────────────┐
│ LoL Viewer   [Viewers] [Live Game] [Settings ●]          Champ Select · ● Connected │
├ Sidebar (可変幅・保存) ─┬ Main ────────────────────────────────────────────────┤
│ MATCHUP        ⟳       │ ┌ Pane ───────────┐┃┌ Pane ───────────┐┃┌ Pane ────── │
│ TOP  [Darius]⇄[Garen]⧉ │ │ header          │┃│                 │┃│            │
│ JG   …                 │ │ external view   │┃│                 │┃│            │
│ COOLDOWNS (Zed)        │ │                 │┃│                 │┃│            │
│ Q 6/6/6 …              │ └─────────────────┘┃└─────────────────┘┃└──────────  │
│ VIEWERS 3/20   + ⊗     │   ┃ = ドラッグで幅を変えるハンドル。追加のたびに均等割り   │
│ [icon] Ahri  BUILD 👁× │   最小幅 300px。入りきらなければ横スクロール            │
│ ENEMY PICKS            │                                                      │
│ [icon] Zed COUNTER +×  │                                                      │
└────────────────────────┴──────────────────────────────────────────────────────┘
```
- **Top bar**: ページ切り替え（Viewers が既定）。Settings には新しいバージョンがあるとき赤い点。右端にフェーズ（Champ Select / In Game など）と接続状態（Connecting… はアニメーション、Connected、Disconnected。クリックで Settings の LCU 欄へ）。
- **Sidebar**（Viewers ページだけ。幅 240〜480、既定 300、ドラッグで変更して保存）:
  1. **Matchup**: 見出しに Refresh（⟳）。5 行 `[レーン] [味方アイコン+名前] vs [敵名前+アイコン] [⧉]`。空は「—」。味方同士・敵同士をドラッグ&ドロップで入れ替え（ドラッグ中は落とし先の行を強調）。⧉ はホバー時に出す（味方が空なら無効）。チャンピオンをクリックすると Cooldowns の対象になる。自分の行には `YOU` を付ける。
  2. **Cooldowns**: 選んだチャンピオン（既定は `defaultCooldownChampion`）の Q/W/E/R の基本クールダウン（PoC の機能を維持）。折りたためる。
  3. **Viewers**: 見出しに件数 `n/20`、＋（追加）、全部閉じる。行は「アイコン、チャンピオン名、種別（BUILD / COUNTER / ARAM）」だけ（M-006）。picked → 通常の順に並べる。ホバーで「表示/非表示」と「×」。行のクリックでそのペインまでスクロールしてハイライト、ダブルクリックで表示/非表示。チャンピオン未入力の行は「New viewer」。
  4. **Enemy picks**（保留中の敵ピック。1 件以上あるときだけ）: 行は「アイコン、名前、COUNTER」。＋ かダブルクリックで Counter ビューアを開く、× で外す。
  5. 通知（トースト）はサイドバーの下部に出す。
- **Viewer pane**:
  - ヘッダー 1 段目: `[Champion ▾]`（アイコン＋名前。未入力なら「Select champion」）`vs` `[Opponent ▾]`（未入力なら「Opponent」）＋クイックピック（敵のアイコンボタン、最大 5、ツールチップ「Set X as opponent」）… 右端に `×`。
  - ヘッダー 2 段目: モード切り替え `Build | Counter | ARAM`、`[Lane ▾]`（未選択は「Any lane」）… 右側に `◀ ▶ ⟳`（ページ内の戻る/進む/開き直す）、`QR`（設定でオンのとき）、`↗`（既定のブラウザで開く）。ARAM のときは Lane と Opponent を無効表示にする。
  - 本体: 外部ビュー。パネルを開いている間はパネルに入れ替わる:
    - **チャンピオン選択**: 検索欄（自動でフォーカス、開くたびにクリア）、アイコン＋英語名＋日本語名のグリッド。↑↓←→ で移動、Enter で決定、Esc で閉じる。Opponent 用は先頭に「None」と、検索語が空のとき「Suggested」（`opponentSuggestions`）を全件の前に出す。
    - **レーン選択**: Any / Top / Jungle / Mid / Bot / Support の大きなボタン。
    - **QR**: 今のページの URL（ページ内で移動したらその URL）の QR とアドレス、「Copy URL」。
  - チャンピオン未入力のペインは、本体に「チャンピオンを選んでください」と選択パネルを最初から出す。
- **Live Game ページ**: 上部の細いバー（URL、⟳ Refresh、QR、↗）＋全面の外部ビュー。起動時に読み込む。
- **Settings ページ**（1 列のカード）:
  - Analytics URLs（Build / Matchup / Counter / ARAM / Live Game。プレースホルダーの説明つき。Save は全項目必須で、空欄は赤く示して保存しない。Reset to defaults。保存したら Live Game を開き直す）
  - League Client（接続状態と Reconnect。押したら 1.5 秒間「Connecting…」で無効化）
  - Display（UI size: Small / Medium / Large。**すぐに反映**（M-012）。QR ボタンの表示: 既定オン）
  - Version（現在のバージョン。更新確認は配布の仕組みと一緒に後で実装する → progress.md）
  - Feature flags（定義が空なので出さない。仕組みは core に置く）
  - Debug（チャンピオン入力（検索つき）＋ Add ally / Add enemy。結果を表示し、成功したら入力を消す）
  - Record session（PoC の記録機能を維持）

### 4.3 見た目
- ダークテーマ。デザイントークンを CSS 変数で定義する（背景 3 段階、文字 3 段階、アクセント（ティール）、味方（青）、敵（赤）、成功、警告）。旧版の配色の系統（#0d1117 系の背景、ティール #00d6a1、味方 #0078f5、敵 #e0342c）を引き継ぐが、ピクセル単位の再現はしない。
- UI サイズは `--ui-scale`（small 0.9 / medium 1 / large 1.15）でフォントと余白をまとめて拡縮する。

## 5. デスクトップ（Electron）
- 外部ビュー（`ExternalViewManager`）: ビューアごとに 1 つ（`viewer-<id>`）、Live Game に 1 つ（`live-game`）。`attach` で表示と読み込み（同じ URL は `force` のときだけ開き直す）、`navigate` で戻る/進む/再読み込み/既定ブラウザで開く。ページ内の移動（`did-navigate` / `did-navigate-in-page`）も `ViewStatus` で UI に知らせる（QR はその URL を使う。M-013）。右クリックで「Back / Forward / Reload / Copy link address / Open in browser」のメニュー。許可ホスト以外への遷移とポップアップは既定のブラウザに回す。
- LCU の資格情報: Windows では `LeagueClientUx.exe` のコマンドラインから `--app-port` と `--remoting-auth-token` を読む（PowerShell の `Get-CimInstance Win32_Process`）。取れなければ lockfile（既定のパスと、プロセスの `--install-directory`）。プロセス列挙の失敗はその回の失敗として扱い、次の試行に進む。
- 接続が切れたら指数バックオフ（2 秒から倍々、上限 60 秒）で再試行する。`lcu.reconnect()` は今の接続を閉じ、バックオフを戻してすぐ試す。`lcu.resync()` は購読中の全パスを GET し直して流す。
- 読む LCU のパス: `/lol-gameflow/v1/gameflow-phase`、`/lol-gameflow/v1/session`、`/lol-champ-select/v1/session`、`/lol-summoner/v1/current-summoner`（GET と購読だけ）。
- ウィンドウ: タイトル「LoL Viewer」、1600×900、アイコンは旧版の `assets/icons` を流用する。
