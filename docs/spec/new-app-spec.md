# 新版の機能仕様（LoL Viewer / Electron 版）

新版（`next/`）が**実際にどう振る舞うか**を、実装とテストを読んで書いた文書。読み手は「旧版の機能がどこまで移ったか」を確かめたい人。

- 根拠はコード（`next/packages/core`、`next/apps/web`、`next/apps/desktop`、`next/packages/lcu`）とテスト（`*.test.ts`、`next/e2e/*.spec.ts`）。設計書（[new-app-design.md](./new-app-design.md)）と実装が食い違うときは実装を書き、§9.2 に差異として挙げた。
- 見た目（色、px、ボタンの文言、ツールチップ）は M-008 により仕様の対象外。ここに書く文言は、操作を説明するための目安。
- §8 の移植チェック表が、旧インベントリ（v0.34.0 時点の `legacy-inventory/01`〜`04` 末尾のチェックリスト。削除済みで git のタグ v0.34.0 にある）の全項目との対応表。
- 最終確認: 2026-11-23（試合中のゴールド差と対面表の補正、Feature Flag を反映。実機のゲームでは未確認、§9.1）。前回 2026-11-22（更新とリリースの実装を反映）。更新は Windows CI で確認済み（0.0.1 → 0.0.2、§7.3）。リリースの公開ジョブは main でしか動かないので未実行（§7.2）。

---

## 1. 概要

League of Legends の分析サイト（lolalytics.com / u.gg）を、アプリ内で複数並べて表示するデスクトップアプリ（Windows 向け）。League Client（LCU）を読み取り専用で監視し、チャンピオンセレクトの進行に合わせて、自分のピックのページを自動で開き、対面表（Matchup）を作り、敵のピックを Counter ページの候補として並べる。

- 技術: Electron + TypeScript + React。外部サイトは `WebContentsView`（ネイティブ。iframe は使わない）で表示する。
- LCU への操作は GET と WAMP の購読だけ。書き込み系は持たない（`packages/lcu` の許可パスは 4 つ。§3）。試合中は、Feature Flag `liveClientData` が ON のときだけ、ゲームの Live Client Data API（127.0.0.1:2999）の `/liveclientdata/playerlist` を 2 秒ごとに GET する（M-025。§3.6）。
- 起動直後のビューアは 0 枚。ビューア、対面表、保留中の敵ピックは保存しない（再起動で消える）。

### 1.1 画面構成

```
┌ Top bar ──────────────────────────────────────────────────────────────┐
│ LoL Viewer  [Viewers] [Live Game] [Settings ●]     Champ Select  ● Connected │
├ Sidebar ─────────────┬ Main（ペイン列。左から右へ） ───────────────────────┤
│ Matchup          ⟳   │ ┌ Viewer pane ┐┃┌ Viewer pane ┐┃┌ Viewer pane ┐     │
│ Cooldowns            │ │ ヘッダー 3 段 │┃│             │┃│             │     │
│ Viewers  n/20  + 🗑  │ │ 外部ページ    │┃│             │┃│             │     │
│ Enemy picks（任意）  │ └──────────────┘┃└─────────────┘┃└─────────────┘     │
│ 通知（トースト）     │   ┃ = 幅を変えるハンドル                              │
└──────────────────────┴──────────────────────────────────────────────────┘
```

- ページは 3 つ: **Viewers**（既定）、**Live Game**、**Settings**。Sidebar とペイン列があるのは Viewers だけ。
- Settings の `●` は「新しいバージョンあり（またはダウンロード済みで再起動待ち）」の印（§2.1、§7）。

### 1.2 状態の持ち方

| 状態 | 持ち主 | 内容 | 保存 |
|---|---|---|---|
| MatchState | main の hub | LCU が言っていることだけ（接続、フェーズ、`matchSeq`、キュー、ARAM か、自分のピック、味方と敵）。試合中のデータ（`live`: チャンピオン、味方/敵、レーン、レベル、推定ゴールド。名前なし。フラグ ON の試合中だけ） | しない |
| Workspace | renderer の純粋 reducer（`core/workspace.ts`） | ビューア一覧、対面表 5 行、保留中の敵ピック | しない |
| Settings | renderer の `localStorage` | URL テンプレート 5 つ、UI サイズ、QR ボタン、サイドバー幅、Feature Flag（`liveClientData`） | する（§5） |

---

## 2. 画面ごとの機能

### 2.1 Top bar

| 操作 / 状況 | 結果 |
|---|---|
| `Viewers` / `Live Game` / `Settings` を押す | そのページに切り替える。選択中のタブは強調される |
| 右端の接続表示 | `Connecting…`（点が脈動）/ `Connected` / `Disconnected` を出す。押すと Settings ページを開き、League Client カードまでスクロールする |
| フェーズ表示 | 接続中（`Connected`）のときだけ、接続表示の左に出す。`None`→Idle、`Lobby`→Lobby、`Matchmaking`、`ReadyCheck`→Ready check、`ChampSelect`→Champ Select、`GameStart`→Game starting、`InProgress`→In Game、`Reconnect`、`WaitingForStats`→Waiting for stats、`PreEndOfGame` と `EndOfGame`→Game over。それ以外は生の文字列 |
| Settings の赤い点 | 更新の状態が `available`（新しい版あり）か `downloaded`（再起動待ち）のとき出る。状態は main の更新処理から届く（§7）。デスクトップ版以外（ブラウザ、Storybook）では出ない |

### 2.2 Viewers ページ

#### Sidebar 全体
- 幅は 240〜480（既定 300）。右端のハンドルをドラッグすると変わり、**ドラッグを離したときに保存**する。ハンドルにフォーカスして ← → を押すと 16 ずつ変わり、すぐ保存する。
- ドラッグ中は外部ページ（ネイティブ）を一時的に隠す（ネイティブ表示が UI の上に描かれるため）。
- 内容は上から Matchup、Cooldowns、Viewers、Enemy picks（保留があるときだけ）。通知は下部。

#### Matchup（対面表）
5 行固定（TOP / JG / MID / BOT / SUP）。各行は `[レーン] [味方アイコン+名前] vs [敵アイコン+名前] [⧉]`。空は「—」。試合中のデータがある行（両側にいて、試合中のデータにも両方いる）は、`vs` の代わりに**味方 − 敵のアイテムゴールド差**（`+1.4k` / `-150` / `0`。50 未満は `0`。緑 = 味方が多い、赤 = 少ない、灰 = ほぼ同じ）を出し、レベル差があれば下に小さく `Lv+1`。ツールチップに両方のアイテム金額とレベル（`Item gold: Garen 4,500 vs Pantheon 4,350 · Level 11 vs 10`）。1 行でも出るときは中央の列を広げる。試合中のデータがあり両チームに 1 人以上いれば、5 行の下に `TEAM` 行を足し、**チーム合計のアイテムゴールド**（`21.1k` のように常に小数 1 桁）と、その差（味方 − 敵。行の差と同じ書式と色）を出す。合計は表に置けたかどうかに関係なく、試合中のデータの全員で数える。ツールチップに両チームの合計と人数（M-033）。

| 操作 | 結果 |
|---|---|
| チャンピオンをクリック | その子を Cooldowns の対象にする（押下状態になる） |
| 味方（または敵）をドラッグし、**同じ側の別の行**へ落とす | 2 行の中身を入れ替える。ドラッグ中、落とせる行を強調する。別の側へ落としても何も起きない（M-005。↑↓ ボタンは無い） |
| 行の ⧉ を押す | その行の味方（敵がいれば対面も）、その行のレーンで **Build ビューアを末尾に**作り、すぐ開く。重複は排除しない。味方が空の行では押せない。ビューアが 20 枚なら作らず、警告の通知を出す |
| 見出しの ⟳（Refresh）を押す | 対面表と保留中の敵ピックを空にし、最後に受け取った MatchState の味方・敵から置き直す。あわせて LCU の購読パスをすべて GET し直す（`lcu.resync()`）。ビューアは閉じない。`Matchup refreshed.` を通知する。置き直しでは保留リストへ積み直さない（この試合で積んだ敵は覚えている） |
| 自分の行 | 味方側で、自分のチャンピオンと同じ子に `YOU` を付ける |

自動配置と試合中の補正の規則は §3.4。

#### Cooldowns
- 対象は、Matchup でクリックした子。クリックしていなければ既定（M-028）: **`YOU` の行（自分のチャンピオンがいる行）の敵**、無ければ自分のレーンの行の敵、無ければ対面表の最初の敵。ブラインドや ARAM（自分のレーンが null）でも、自分の行の敵になる。新しい試合になると、クリックした選択は既定に戻る。
- Q / W / E / R の行に、スキル名（日本語）と**ランクごとの基本クールダウン**を `9 / 8 / 7 / 6 / 5` の形で出す。Data Dragon にクールダウンが無いスキル（パッシブなど）は「—」。末尾にパッチ番号（`champions.json` の `patch`）を出す。
- 見出しを押すと折りたたむ。対象が無いときは案内の文を出す。タイマーやスキルレベル連動、アビリティヘイストは無い（静的な参照用）。

#### Viewers（サイドバーの一覧）
- 見出しに件数 `n/20`、`+`（追加）、ゴミ箱（全部閉じる）。

| 操作 | 結果 |
|---|---|
| `+` を押す | 空のビューア（Build、レーンなし）を**末尾**に作る。ペインへスクロールして一瞬ハイライトし、チャンピオン選択パネルが最初から開く。20 枚なら作らず `Viewer limit reached (20). Close one first.` を通知 |
| ゴミ箱を押す | 全ビューアと保留中の敵ピックを、確認なしで消す。どちらも空のときは押せない |
| 行をクリック | そのペインまでスクロールして約 1.4 秒ハイライト（非表示のビューアは、ペインが無いので何も起きない） |
| 行をダブルクリック | 表示 / 非表示を切り替える |
| 行をホバー（またはフォーカス）して目のボタン | 表示 / 非表示を切り替える。非表示にするとペインが列から消え、外部ページは外れる（§6.1 のキャッシュ） |
| 行の × | ビューアを閉じる |
- 行は「アイコン、チャンピオン名、種別（Build / Counter / ARAM）」だけ。非表示や対面は表示しない（M-006）。チャンピオン未入力は `New viewer`。
- 並びは**picked（自分のピックで自動生成）を上、その下に通常**。ペイン列の並び（左から右）とは別（§3.3）。

#### Enemy picks（保留中の敵ピック）
保留が 1 件以上あるときだけ出る。見出しに件数。行は「アイコン、名前、Counter」。

| 操作 | 結果 |
|---|---|
| `+`、または行をダブルクリック | その敵の Counter ビューアを作ってすぐ開く。位置は picked のビューアが 1 つでもあれば**左から 2 番目**、なければ**左端**。保留から外れる。20 枚なら作らず警告 |
| × | 保留から外す（ビューアは作らない） |

#### 通知（トースト）
- Viewers ページでは Sidebar の下部、Settings ページでは右下に浮かせて出す（外部ページはネイティブで最前面に描かれるため、重ならない位置にする）。**Live Game ページでは出ない**（§9.2）。
- 種別は info / success / warn。5 秒で消える。× で閉じる。最大 20 件。

#### ペイン列
- 表示中（非表示でない）のビューアを左から右へ並べる。幅は**追加（または再表示）のたびに均等割り**（コンテナ幅 ÷ 枚数、最小 300px）。最後のペインは余りを埋める。入りきらなければ横スクロール。
- 隣り合う 2 枚の間のハンドルをドラッグすると、その 2 枚の幅を融通する（各 300px 未満にはならない）。ドラッグ中は外部ページを隠す。
- 外部ページは列の表示領域でクリップされる。スクロールで半分隠れたペインのページが、Sidebar や Top bar にはみ出さない。
- ビューアが 0 枚のとき「No viewers yet」と `Add viewer` を出す。全部非表示のときは「All viewers are hidden」。

#### Viewer pane（1 枚のビューア）
ヘッダーは 3 段、その下が本体（外部ページ）。

| 段 | 部品 |
|---|---|
| 1 | `[Champion ▾]`（アイコンと名前。未入力は `Select champion`）、`vs`、`[Opponent ▾]`（未入力は `Opponent`）、右端に `×`（Close viewer） |
| 2 | モード `Build` / `Counter` / `ARAM`、`[Lane ▾]`（未選択は `Any lane`） |
| 3 | クイックピック（敵のアイコンボタン）、右側に ◀ 戻る / ▶ 進む / ⟳ 開き直す / `QR`（設定でオンのとき）/ ↗ 既定のブラウザで開く |

ページを読み込んでいる間は、ヘッダーの下に細い進行バーを出す。

| 操作 | 結果 |
|---|---|
| `Champion` を押す | チャンピオン選択パネルを、外部ページと**入れ替えて**開く（ページは隠れるだけで、読み込み済みのまま）。もう一度押す、× を押す、Esc で閉じる |
| `Opponent` を押す | 同じく選択パネル（先頭に `None`、検索語が空のとき `Suggested`）。ARAM モードでは押せない |
| `Lane` を押す | レーン選択パネル（Any / Top / Jungle / Mid / Bot / Support）。選ぶと閉じる。ARAM モードでは押せない |
| モードを押す | モードを変える。チャンピオンがあればすぐ開き直す。チャンピオン未入力でも選べて、値は保持される。Counter でも Opponent は選べるが URL には使われない。ARAM にしてもレーンと対面の値は消えず、Build に戻すと有効になる |
| クイックピックのボタン（`Set X as opponent`） | X を Opponent にして、すぐ開き直す（Build なら Matchup ページになる）。出るのは**対面表の敵を行順に重複なく最大 5 体**。今の Opponent は出ない。ARAM では押せない |
| ◀ / ▶ | ページ内の履歴を戻る / 進む。履歴が無ければ押せない |
| ⟳ | ビューアの設定どおりの URL を**もう一度開く**（ページ内で移動していても、同じ URL なら強制的に読み込み直す）。チャンピオン未入力では押せない |
| `QR` | QR パネルを外部ページと入れ替えて開く（§2.2 の QR パネル）。もう一度押すと閉じる。現在のページの URL が無ければ押せない |
| ↗ | 現在のページ（ページ内で移動した先を含む）を、既定のブラウザで開く（`https://` のときだけ） |
| 外部ページの中を右クリック | Back / Forward / Reload、リンク上なら Copy link address、Open page in browser のメニュー（§6.1） |
| 外部ページの中で移動 | 現在の URL として扱う。QR、↗、◀ ▶ の有効状態が追従する（M-013） |

**チャンピオン選択パネル**
- 開くと検索欄にフォーカスが当たる（開き直すたびに空）。検索は大小無視。英語名、日本語名、URL 名（`wukong`）、Data Dragon の ID（`MonkeyKing`）のどれでも当たる。ひらがなはカタカナに寄せる。スペース、`'`、`.`、`・` などは無視する（`kaisa` で Kai'Sa）。**前方一致を先に、部分一致を後に**、各グループは名前順。
- 一覧はアイコン、英語名、日本語名のグリッド。↑↓←→ で移動、Enter で決定、Esc で閉じる。マウスでも選べる。検索欄の右に該当件数。該当なしは「No champion matches」。
- チャンピオンを選ぶと、ビューアのチャンピオンを変えて閉じる。チャンピオンがあるので、そのまま開き直す。
- Opponent 用: 先頭に `None`（対面を外す）。検索語が空のときは、続けて `Suggested`（対面表の敵を行順に重複なく。1 体もいなければ、**他のビューア**のチャンピオンと対面。自分のチャンピオンは除く）を出し、その下に全チャンピオン（`All champions`）。ハイライトの初期位置は `None` ではなく最初の実チャンピオン。

**チャンピオン未入力のペイン**: 本体に「Choose a champion to open its page.」を出し、チャンピオン選択パネルを最初から開く。

#### QR パネル
- 外部ページの代わりに、現在の URL の QR（SVG。オフラインで生成）、アドレス文字列、`Copy URL` を出す。
- `Copy URL` はクリップボードへコピーし `Copied to clipboard` を通知する。失敗したら警告を通知する。URL が長すぎて QR にならないときはその旨を出す。
- 常時重ねては出さない（M-009）。ペインを閉じたり開き直したりしても、QR パネルの開閉は保存しない。

### 2.3 Live Game ページ
- 上部に細いバー: 現在の URL、`Refresh`、`QR`（設定でオンのとき）、`Open in browser`。その下が全面の外部ページ。
- 起動時に Live Game の URL（既定 `https://u.gg/lol/lg-splash`）を読み込む。他のページを見ている間は隠すだけで、読み込み済みを保つ。
- `Refresh` は、**設定した Live Game の URL を開き直す**（ページ内で移動していても、設定の URL に戻る。旧版と同じ）。外部ページ内の右クリックの Reload は、今のページを再読み込みする。
- `QR` は外部ページの代わりに QR パネルを出す（Viewer pane と同じ）。
- `Open in browser` は現在のページを既定のブラウザで開く。
- Settings で URL を保存（またはリセット）すると、Live Game を新しい URL で開き直す。

### 2.4 Settings ページ
1 列のカード。上から順に次のとおり。

| カード | 内容と操作 |
|---|---|
| Analytics URLs | Build / Matchup / Counter / ARAM / Live Game の 5 つの入力欄。各欄に使えるプレースホルダーの説明。**Save**: 前後の空白を除いて保存。5 つとも、空でなく、プレースホルダーに例の値を入れたときに `https` かつ `lolalytics.com` / `u.gg`（サブドメイン含む）の URL になることが必要（M-023）。満たさない欄があると保存せず、その欄を赤く示し（`Required. Enter a URL.` または `Must be an https URL on lolalytics.com or u.gg.`）、`Not saved: N URL(s) are empty.` を通知する（保存済みの値は変わらない。通知の文言は「empty」のままで、ホストの誤りでも同じ）。成功すると Live Game を開き直し `URLs saved. Live Game reloaded.` を通知。変更が無く、エラーも無いとき Save は押せない。**Reset to defaults**: 確認なしで 5 つとも既定に戻して保存し、Live Game を開き直す |
| League Client | 接続状態と、`Reconnect`。押すと現在の接続を閉じ、再試行の待ち時間を戻して今すぐ試す。押してから 1.5 秒は `Connecting…` を出してボタンを無効にする。デスクトップ版以外では押せない |
| Display | UI size（Small / Medium / Large）。**押した瞬間に反映**（再起動不要。M-012）。`Show the QR button on viewers`（既定オン）。オフにすると Viewer pane と Live Game の QR ボタンが消える |
| Feature flags | 定義（`FEATURE_FLAGS`）ごとに 1 行: 名前、説明、switch。今は `Live game data`（`liveClientData`、既定オフ）と `In-game overlay (hold Tab)`（`inGameOverlay`、既定オフ、M-034）。オーバーレイは `Live game data` が OFF の間は switch が無効（OFF 表示）で「Requires Live game data」と注記し、Windows 以外（ブラウザを含む）では「Windows only」と注記する。**押した瞬間に保存して反映**（再起動不要）し、`Live game data: on.` / `off.` を通知する。`Reset flags to defaults`（既定のとき無効）で定義済みのフラグを既定に戻し、`Feature flags reset to defaults.` を通知（保存済みの未知のキーは残す）。デスクトップ版以外では「Live game data is read by the desktop app.」と注記する |
| Version | 現在のバージョンとプラットフォーム（例 `0.0.1 (win32)`）。ブラウザ（モック）では `dev` と「Updates are available in the desktop app.」。デスクトップ版では、`Latest version`（確認中は `Checking…`、未確認は `—`）、状態の文、ボタンを出す。状態の文: `Not checked yet.` / `Checking…` / `You have the latest version.` / `A new version is available.` / `Downloading… n%`（進行バー付き）/ `Ready to install. The app restarts.` / 失敗時は短い理由（下記）/ `Update checks are off in this build.`。ボタン: 未確認・最新・失敗のとき `Check for updates`（確認中は無効）、新しい版があるとき `Download`（ダウンロード中は無効）、ダウンロード済みのとき `Restart and update`、無効なビルドでは出さない。詳細は §7 |
| Debug | チャンピオンを検索して選び、`Add ally` / `Add enemy`。対面表の**その側の最初の空き行**に入れる（レーン適性も重複も見ない）。成功すると結果を表示して入力を消す。その側が埋まっていれば「full」と表示 |
| Record session | `Start recording` / `Stop` / `Open recordings folder`。LCU のイベントをファイルへ保存する（他のプレイヤーの名前と ID は伏せる）。記録中は経過時間とイベント数を表示。デスクトップ版だけ（PoC で追加した機能） |

- Feature Flag の定義（`FEATURE_FLAGS`）が 1 つ以上あるときカードを出す。今は `liveClientData` と `inGameOverlay`。保存と既定値は `core/settings.ts`。
- 保存先と既定値は §5。

---

## 3. 自動検知（League Client）

### 3.1 接続
1. 認証情報を探す。**Windows**: `LeagueClientUx.exe` のコマンドラインから `--app-port` と `--remoting-auth-token` を読む（PowerShell の `Get-CimInstance Win32_Process`、5 秒でタイムアウト、プロセス列挙の失敗は「見つからない」扱い）。取れなければ、コマンドラインの `--install-directory` の `lockfile`、次に既定の `C:\Riot Games\League of Legends\lockfile` と `D:\...`。Windows 以外ではコマンドラインを読まず lockfile だけ。環境変数 `LOL_LCU_LOCKFILE` があれば、それだけを使う（テスト用）。
2. 見つかったら `https://127.0.0.1:<port>` へ Basic 認証（`riot:<token>`）で WebSocket（WAMP）をつなぎ、次の 4 つを購読する。自己署名証明書は、この接続のソケットだけ検証を緩める（プロセス全体では緩めない）。
   - `/lol-gameflow/v1/gameflow-phase`
   - `/lol-gameflow/v1/session`
   - `/lol-champ-select/v1/session`
   - `/lol-summoner/v1/current-summoner`
3. つないだ直後に、4 つのパスを GET して、現在の値を 1 回ずつ流す（GET のタイムアウト 2 秒。200 以外は無視）。
4. 見つからない、またはつなげない: 状態を `disconnected` にして、**2 秒、4 秒、8 秒…と倍にして最大 60 秒**で再試行する。つながったら 2 秒に戻る。再試行のたびに認証情報を探し直すので、LCU が再起動してポートやトークンが変わっても追従する。
5. つながったあとにソケットが閉じたら `disconnected` にして、同じ再試行へ戻る。
6. Settings の `Reconnect`: 接続を閉じ、`connecting` を出し、待ち時間を戻して今すぐ試す。
7. LCU へ書き込む API は持たない。許可されたパス以外の GET も拒否する。
8. Live Client Data API（試合中のゲームが出している API）は LCU とは別。ホストは `127.0.0.1` だけ（それ以外は例外）、GET だけ、認証なし、`/liveclientdata/playerlist` だけ。200 以外（ロード画面の 404、接続失敗）は黙って次を待つ。詳細は §3.6。

### 3.2 MatchState の規則（`core.reduce`）
イベントを受けるたびに MatchState を作り直す。変わらなければ配信しない。

| 規則 | 内容 |
|---|---|
| 新しい試合 | ChampSelect 以外のフェーズから ChampSelect に入ったとき、または ChampSelect の間に champ-select の `gameId`（0 以外）が前回の 0 以外の値から変わったとき（ドッジして次の試合）。`matchSeq` を 1 増やし、`self`、`allies`、`enemies`、`gameId` を空にする。champ-select のセッションがフェーズより先に届いても、ChampSelect に入ったとみなす（二重には数えない） |
| 自分のピック | `myTeam` のうち `cellId == localPlayerCellId`。`championId > 0` なら `self = {championId, lane}`。**ホバーも含む**（ロックと区別しない）。`championPickIntent` は使わない。あとで `championId` が 0 に戻っても `self` は保持する |
| レーン | `assignedPosition` を小文字にして `utility`→support、`mid`→middle、`bot`→bottom に読み替える。それ以外や空は null（ブラインド、ARAM） |
| 味方 / 敵 | ピック済み（`championId > 0`）だけを、`myTeam` 順 / `theirTeam` 順（= ピック順）に並べる。データにない ID（新チャンピオンで `champions.json` が古いなど）は除く |
| champ-select の削除 | セッションが消えても、味方と敵の一覧は残す（試合中に使う） |
| `None` / `Lobby` | `self`、自分の summonerId / puuid、`gameId` を消す。`allies` と `enemies` は残す（旧版も前の試合の一覧を残す） |
| 試合中（`InProgress`） | gameflow の `gameData.teamOne` / `teamTwo` から味方と敵を作る（レーンは null）。自分のチームは summonerId または puuid で判定し、分からなければ teamOne を味方とみなす（自分の情報が後から届いたら作り直す）。結果が空なら前の一覧を保持。`self` は ChampSelect のものを保持。ブラインドや ARAM で ChampSelect 中に敵が見えなかった場合も、ここで補う |
| 自分の summonerId | champ-select の自分の行から。無ければ `current-summoner` から。MatchState には出さない |
| キューと ARAM | `gameData.queue` が数値、`{id}`、`{queueId}` のどれでも読む。gameMode は `queue.gameMode`、`queue.mode`、`gameData.gameMode` の順。`isAram` は、キュー ID が {450, 65, 100, 720, 2400, 2401, 2403, 2405, 3240, 3270} のどれか、または gameMode が `ARAM`。新しい試合になってもキュー情報は保つ（gameflow が先に届くため） |
| 試合中のデータ（`live`） | `InProgress` の間だけ受け取る（それ以外のフェーズで来たものは捨てる）。試合が終わっても最後の値のまま残し（作り直さない）、新しい試合（ChampSelect）、ChampSelect を経ない次のゲームの開始（`Reconnect` からの復帰は除く）、`live-players` が null（Feature Flag を OFF）で消える。切断では消さない（M-031）。自分のチームは名前を使わず、自分のチャンピオン、次に味方・敵との一致で決め、決まらなければ null（M-029）。2 チーム × 5 人以下の形でなければ null。アイテムの金額は Data Dragon `gold.total`（M-026）。同じ内容なら MatchState は同じ |
| 切断 | `connection = disconnected`、`phase = None`、自分の summonerId / puuid を消す。`self`、`allies`、`enemies` は残す（画面は直前の表示を保つ）。再接続して ChampSelect に入れば新しい試合 |

### 3.3 Workspace の反応（`core.workspaceReducer`）
MatchState が届くたびに、次の順に処理する。

1. **新しい試合**（`matchSeq` が変わった）: **全ビューア（手動で開いたものを含む）を閉じ**、対面表、保留、この試合で積んだ敵の記録、自分のピックの記録を空にする（M-001）。最初に受け取った MatchState は新しい試合として扱わない。
2. **対面表**: フェーズが `ChampSelect` か `InProgress` のときだけ、味方と敵を空き枠へ置く（§3.4）。
3. **自分のピック**: `self` があり、前回と champion か lane が違うとき、`picked` のビューアを**左端**に作る（古い picked は残す。重複を排除しない。M-002）。ARAM なら ARAM モードでレーンなし、そうでなければ Build でレーンは自分のレーン。すぐ開く。20 枚なら作らない（通知もログも出さず、ピックは覚える）。`self` が消えたら記録も消す（同じピックでもまた作れる）。
4. **敵のピック**（`ChampSelect` のときだけ）: まだ積んでいない敵を、ピック順に保留リストの末尾へ積む。ビューアは作らない。1 つの試合で同じ敵を 2 回積まない（試合中のデータからは積まない）。

試合の流れの例（Storybook / E2E のシナリオ）: ホバーで picked ビューアが左端に出る → 敵が決まるたびに Enemy picks に積まれる → 次の試合になると全部消えて新しい picked が出る。

### 3.4 対面表への自動配置
- 一度置いたチャンピオンは自動では消さない。置くのは空いている枠だけ。同じ側にすでにいるチャンピオンは飛ばす。ユーザーが入れ替えた並びは、次の MatchState でも保たれる。
- 味方 1 周目: レーンがある味方を、そのレーンの行が空ならそこへ、埋まっていれば最初の空き行へ。
- 味方 2 周目: レーンがない味方を、空き行のうち**レーン適性（`champions.json` の `lanes`、0〜5）が最も高い行**へ。同点は上の行（Top 優先）。
- 敵: 空き行のうちレーン適性が最も高い行へ。同点は上の行。適性データが無い（すべて 0）なら、最初の空き行。
- 味方と敵は独立に置く。片方の側が埋まっても、もう片方は置き続ける。空きが無くなったらその側はそこで止める。

**試合中の補正（M-027）**:
- 補正は、試合中（`InProgress`）に試合中のデータが届いたときだけ。その側の割り当て（チャンピオン → レーン）が、前回その側を直したときと違えば直す。位置は試合中に変わらないので、ふつうは試合ごとに 1 回。
- 割り当てに入るのは、その側で 1 人だけが名乗ったレーン。`position` が空なら Smite を持つ人がジャングルを名乗る。2 人が同じレーンを名乗ったら、そのレーンは誰も動かさない。
- 割り当てのある子はそのレーンの行へ。それ以外の子は、自分の行が空いていればそのまま。押し出された子は、空いた行のうちレーン適性が最も高い行へ（同点は上）。表に居ない子は無視する。消さない、足さない。
- 試合前（チャンピオンセレクト中）にユーザーが入れ替えた並びは、補正で上書きされることがある（位置の方が事実なので）。補正のあとの入れ替えは保たれる。
- Refresh（⟳）は補正もやり直す。
- Feature Flag が OFF なら `live` が来ないので、補正は起きない（今と同じ）。

### 3.5 ARAM、試合中、切断の挙動（まとめ）
- **ARAM**: キュー ID か gameMode で判定。自分のピックの picked ビューアは ARAM ページ（レーンなし）。レーンが無いので対面表は適性で置く。
- **試合中**: 味方と敵は gameflow から補う。敵ピックは保留に積まない。
- **切断**: `Disconnected` を表示し、一覧や picked ビューアは消さない。再接続して新しい ChampSelect に入ると、すべて閉じて始め直す。
- **LCU はポーリングしない**（M-010）: イベントが来たときだけ処理する。例外: 試合中の Live Client Data API（M-025、Feature Flag、既定 OFF。§3.6）。10 体そろった後の一時停止やウォッチモードも無い。

### 3.6 試合中のデータ（Live Client Data API）
```
ゲーム 127.0.0.1:2999 ──GET /liveclientdata/playerlist (2 秒ごと、packages/lcu の startLiveClientPoller)──▶ core.toLcuEvent
  ──live-players（チャンピオン、ORDER/CHAOS、レーン、レベル、アイテム金額だけ。名前は捨てる）──▶ hub / core.reduce
  ──MatchState.live（味方 / 敵に変換済み）──▶ renderer: フラグ OFF なら live を捨てる ──▶ workspaceReducer（補正、§3.4）／行の差（`rowLiveDiff`）
```
- **ゲート**（`apps/desktop/src/live-core.ts`）: ポーラーは「Feature Flag `liveClientData` が ON、かつフェーズが `InProgress`」の間だけ動く。main の既定は OFF で、renderer が IPC `live:set-enabled`（真偽のみ）で伝えるまで 1 回も問い合わせない。フラグを切ると止めて、`live` を消す。試合が終わってポーラーが止まっても `live` は残り、次の試合で reducer が消す（M-031）。再起動は要らない。
- **レーン**: `position`（`TOP` / `JUNGLE` / `MIDDLE` / `BOTTOM` / `UTILITY`）。空なら Smite（`rawDescription` / `rawDisplayName` に `SummonerSmite`）を持つ人がジャングル。それ以外は null。
- **推定ゴールド**（M-026）: アイテムの Data Dragon `gold.total` × 個数の合計（`packages/core/data/items.json`。`pnpm champion-data` で生成）。使うと無くなるもの（`consumed`）とトリンケットは 0。表に無い ID だけ Live Client の `price × count`（`consumable` なら 0）。所持金は含まない（敵のは取れない）。
- **自分のチーム**（M-029）: 名前は使わない。自分のチャンピオン（片方のチームだけにいるとき）、次に MatchState の味方・敵との一致。決まらなければ `live` は null。
- **記録機能との関係**: `recording.ts` は変えていない。記録中は記録用のポーラーが従来どおり 3 秒ごとに 2999 を読む（ユーザーが明示的に始める別の操作で、フラグと独立）。フラグ ON の試合中に記録すると 2 つのポーラーが別々に読む。
- **保存しない**: 試合中のデータはファイルにも `localStorage` にも保存しない。


### 3.7 ゲーム内オーバーレイ（M-034、Feature Flag `inGameOverlay`）

設計は [ingame-overlay-design.md](./ingame-overlay-design.md)。試合中、LoL のゲームのウィンドウが前面にあり **Tab を押している間だけ**、ゲームの上端中央（上から 8%）にレーンごとのアイテムゴールド差の表を重ねる。
- **前提**: `liveClientData` が ON、フラグ `inGameOverlay` が ON、Windows。LoL の Window Mode はボーダーレスかウィンドウ（フルスクリーンでは見えない）。位置は Tab を押した瞬間のゲームのウィンドウから決める（ウィンドウモードでも同じ）。表示したままゲームのウィンドウを動かしても追従せず、押し直すと新しい位置に出る。
- **表**: 5 レーンの行（味方アイコン、レベル、差、レベル、敵アイコン）と `TEAM` 行（両チームの合計と差）。値と色はサイドバーの Matchup と同じ（`rowLiveDiffOf` / `teamLiveDiffOf`）。並びはメインウィンドウの対面表（補正とユーザーの入れ替えの後）。試合中のデータが無ければ何も描かない。
- **ウィンドウ**: 透明、枠なし、フォーカスを取らない、タスクバーに出ない、最前面（`screen-saver`）、クリック透過。ゲームが始まって有効なとき隠したまま作り、終わるか無効になったら閉じる。`showInactive()` だけで出す。ナビゲーションと `window.open` は止める。専用の preload（`overlay-preload.ts`）は受信だけ（`onState`、`onRows`）。
- **Tab の検知**（`overlay-core.ts`、`win-keys.ts`）: 有効かつ `InProgress` の間だけ 50ms ごとに `GetAsyncKeyState(VK_TAB)` と前面のウィンドウのクラス名（`RiotWindowClass`）を読み、変わったときだけ表示 / 非表示にする。Tab 以外のキーは読まない。`globalShortcut` は使わない。読み取りが例外を投げたらログを 1 回出して、その試合では止める。`koffi` は Windows のときだけ遅延で読み込む。
- **IPC**: `overlay:set-enabled`（真偽）、`overlay:rows`（5 行の `{ally, enemy}`、zod で検証）。どちらも本体ウィンドウからだけ受ける。
- **テスト用**: 環境変数 `LOL_OVERLAY_FAKE_KEYS=<ファイル>`（中身 `tab` / `none`）で、Windows の代わりにそのファイルを読む（前面判定は常に真）。

---

## 4. URL の組み立て

### 4.1 テンプレート（既定値）

| 種別 | キー | 既定 |
|---|---|---|
| Build | `build` | `https://lolalytics.com/lol/{name}/build/` |
| Matchup | `matchup` | `https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}` |
| Counter | `counter` | `https://lolalytics.com/lol/{name}/counters/` |
| ARAM | `aram` | `https://u.gg/lol/champions/aram/{name}-aram` |
| Live Game | `liveGame` | `https://u.gg/lol/lg-splash` |

### 4.2 規則（`core.viewerUrl`）
名前はチャンピオンの **URL 名（slug）**: Data Dragon の ID を小文字にして記号を除いたもの。**Wukong だけは `wukong`**（Data Dragon の ID `MonkeyKing` は URL に使わない。M-004）。URL エンコードはしない。チャンピオンが空なら URL は無い（ページを開かない）。

| モード | 規則 |
|---|---|
| Build（対面なし） | `{name}` を置換。レーンがあれば `lane=<lane>` を付ける |
| Build（対面あり） | Matchup テンプレートを使う。`{champion_name1}`、`{champion_name2}`、`{lane_name}` を置換。レーンが空なら `{lane_name}` は空文字（`?lane=&vslane=` が残る）。対面の ID が不明なら Build に戻る |
| Counter | `{name}` を置換し、レーンがあれば `lane=<lane>` を付ける。対面は使わない |
| ARAM | `{name}` を置換するだけ。レーンと対面は使わない |

- `lane=<lane>` の付け方: テンプレートが `?` または `&` で終わっていればそのまま、すでに `?` を含めば `&`、含まなければ `?` で連結する。
- レーンの値は `top` / `jungle` / `middle` / `bottom` / `support`。
- `{lane}` というプレースホルダーは置換しない（旧版と同じ）。
- Live Game の URL は前後の空白だけを除いて使う。

### 4.3 例（Wukong）
| 状況 | URL |
|---|---|
| Wukong、Build、レーンなし | `https://lolalytics.com/lol/wukong/build/` |
| Wukong、Build、Top | `https://lolalytics.com/lol/wukong/build/?lane=top` |
| Ahri（Mid）、対面が Wukong | `https://lolalytics.com/lol/ahri/vs/wukong/build/?lane=middle&vslane=middle` |
| Wukong（Top）、対面が Zed | `https://lolalytics.com/lol/wukong/vs/zed/build/?lane=top&vslane=top` |
| Ahri、対面 Zed、レーンなし | `https://lolalytics.com/lol/ahri/vs/zed/build/?lane=&vslane=` |
| Wukong、Counter | `https://lolalytics.com/lol/wukong/counters/` |
| Ahri、Counter、Top | `https://lolalytics.com/lol/ahri/counters/?lane=top` |
| Wukong、ARAM | `https://u.gg/lol/champions/aram/wukong-aram` |

### 4.4 いつ URL が使われるか
- ビューアの URL は**テンプレートから毎回求める**。Settings で URL を保存すると、URL が変わる開いているビューアは、その場で新しい URL を開き直す（M-021。旧版は「開く時点」の値で、開いているものは変わらなかった）。
- チャンピオン、対面、レーン、モードを変えると、チャンピオンがあれば**すぐ開き直す**。同じ URL でも、`nav` を進めて強制的に読み込み直す。
- アプリが開ける URL は `https` のものだけで、ホストは制限しない（M-023）。Settings は、空欄と `https` 以外を保存させない。`https` 以外の値が（古い設定などで）残っていた場合は、main が読み込みを拒否してペインが空になる（§6.1）。

---

## 5. 設定項目と既定値・保存先

保存先は `localStorage` のキー `lol-viewer.settings`（JSON 1 つ。M-014）。読み込みは例外を出さず、壊れた項目はその項目だけ既定に戻す。保存に失敗しても、そのセッションでは設定が効く。

| 項目 | 型と範囲 | 既定 | メモ |
|---|---|---|---|
| `urls.build` | 文字列 | §4.1 | 空白だけの保存値は読み込み時に既定へ戻る |
| `urls.matchup` | 同上 | §4.1 | |
| `urls.counter` | 同上 | §4.1 | |
| `urls.aram` | 同上 | §4.1 | |
| `urls.liveGame` | 同上 | §4.1 | |
| `uiSize` | `small` / `medium` / `large` | `medium` | 文字と余白の倍率 0.9 / 1 / 1.15。未知の値は `medium` |
| `qrButton` | 真偽 | 真 | ペインと Live Game の QR ボタンの表示 |
| `sidebarWidth` | 240〜480 | 300 | 範囲外は丸める |
| `featureFlags` | 名前 → 真偽 | 空（既定は定義側が持つ） | 定義: `liveClientData`、`inGameOverlay`（どちらも既定 偽）。保存済みの未定義のキーは掃除しない（M-016） |

**保存しないもの**: ウィンドウの位置とサイズ、ビューア、対面表、保留、Cooldowns の対象と折りたたみ、各ペインの幅、パネルの開閉。

その他の保存先:
- ログ: §6.4。記録ファイル: 既定 `ドキュメント\LoL Viewer Next\recordings`。
- 外部サイトの Cookie など: Electron のパーティション `persist:external`（永続）。

---

## 6. デスクトップ（Electron）

### 6.1 外部ページ（`ExternalViewManager`）
- ビューアごとに 1 つ（`viewer-<id>`）、Live Game に 1 つ（`live-game`）のネイティブ表示（`WebContentsView`）を、renderer の「穴」（`ExternalViewSlot`）の矩形に重ねる。ウィンドウの大きさやペインの幅が変わると追従する。穴が隠れたり潰れたりしたら表示を隠す。
- 外部ページには preload も Node の権限も渡さない。サンドボックス、コンテキスト分離あり。
- 読み込める URL: `https` のみ（ホストは制限しない）。それ以外の読み込み命令は、検証で拒否して警告をログに出すだけ。
- ページからの移動: 既知の分析サイト（`lolalytics.com` / `u.gg` / `op.gg`）か、そのビューを開いたサイトと同じサイト（サブドメイン含む）ならアプリ内で続行。それ以外の `https` は**既定のブラウザへ回し**、アプリ内では移動しない。ポップアップ（`target=_blank`）は常に既定のブラウザへ（`https` のみ）。
- 右クリックのメニュー: `Back`、`Forward`（履歴があるときだけ有効）、`Reload`、（リンク上なら）`Copy link address`、`Open page in browser`。
- ページ内の移動、タイトル、読み込み状態（loading / ready / error。`did-start-loading` で loading、`did-stop-loading` で ready。メインフレームの読み込みに失敗したら、次のメインフレーム移動まで error）、戻る・進むの可否を renderer へ通知する（ペインの ◀ ▶、QR、↗ が使う）。ペイン上部にローディング表示は出さない（広告などで loading が長く続き、表示が残り続けるため廃止した）。
- 隠した（外した）ビューは、直近の 4 つまで読み込み済みで保持する。同じビューアを再表示すると、同じ URL ならページは読み込み直さない。4 つを超えて外されたビューは破棄する（再表示すると読み込み直しになり、ページ内の移動は失われる）。
- Cookie などは `persist:external` に保存する（ログインが残る）。
- アプリ本体のウィンドウは、UI のページ以外へ移動しない。ポップアップは既定のブラウザへ。

### 6.2 ウィンドウ、起動、終了
- タイトル「LoL Viewer」、1600×900、アイコンは旧版のものを流用（Windows は `app_icon.ico`）。位置とサイズは保存しない。
- **多重起動の防止**: 2 つ目を起動すると、すでにあるウィンドウを復元して前面に出し、2 つ目は終了する（E2E のときだけロックを使わない）。
- **メニューバーは無い**（旧版と同じ。既定メニューの Reload で UI が再読み込みされ、ビューアが消えるのを防ぐ）。入力欄の切り取りなどのショートカットは使える。
- ウィンドウを閉じるとアプリが終了する。終了時に LCU の接続を止める。記録中なら、記録ファイルを閉じてから終了する。
- renderer との通信は、検証済みの入力だけ・アプリ自身のウィンドウからだけを受け付ける。

### 6.3 開発・テスト用の入口
- `LOL_VIEWER_WEB_URL`: UI を開発サーバーから読む。
- `LOL_VIEWER_HUB_PORT`: MatchState を `127.0.0.1` の WebSocket で配信する（トークン必須、Host / Origin を検査）。ブラウザ（`?hub=`）や別画面から同じ MatchState を見られる。
- `LOL_LCU_LOCKFILE`: 偽の LCU（`tools/fake-lcu`）を指す lockfile。
- `LOL_LIVE_CLIENT_URL`: Live Client Data API のベース URL（テストでは偽の LCU。`127.0.0.1` だけ）。記録機能と、フラグ ON の試合中に使う。偽の LCU は `/liveclientdata/` への GET を `liveClientRequests` に記録する。
- `LOL_VIEWER_E2E=1` のとき `globalThis.__lolViewer.live`（`enabled`、`polling`）を公開する。
- `LOL_VIEWER_E2E=1`: 多重起動のロックを使わず、診断用のオブジェクトを公開する。
- ブラウザ単体（Vite / Storybook）では、`scenarios/*.jsonl` を本物の reducer で再生するモックで動く。外部ページは「External page」のプレースホルダー（URL と新しいタブで開くリンク）。

### 6.4 ログ
- 常にコンソールへ出す。**デバッグモード**のときだけ、ファイルにも書く。
- デバッグモード: `--debug`、環境変数 `LOL_VIEWER_DEBUG=1`、または実行ファイル名に `debug` を含む。
- ファイル: `app.getPath("logs")` の下の `lol-viewer-YYYYMMDD-HHMMSS.log`（起動ごとに 1 ファイル。最新 10 個を残し、古いものは起動時に消す。他のファイルには触れない）。1 行は `YYYY-MM-DD HH:mm:ss.SSS LEVEL [scope] message`。デバッグモードでは、renderer のコンソール出力も書く。
- 捕捉していない例外と reject は、`[main]` としてログに出す。LCU のトークンはログに出さない。

---

## 7. 更新とリリース

M-018〜M-020、M-022 に基づく実装。**Windows CI（`next-windows.yml`）で確認済み**: インストールした 0.0.1 が、手元のフィードから 0.0.2 を見つけ、ダウンロードし、サイレントで入れ替えて 0.0.2 で起動し直す（2026-11-22、`next-ci.yml` の run #40）。リリースの公開（`publish` ジョブ）は main への push でしか動かないため、まだ一度も実行していない。

### 7.1 アプリ内の更新（electron-updater、generic provider）
- **フィード**: `https://github.com/kc7891/lol-viewer/releases/download/app-latest/`（その下の `latest.yml`）。環境変数 `LOL_VIEWER_UPDATE_URL` で差し替えられる（末尾に `/` を足す。テストでは手元の HTTP サーバーを指す）。
- **起動時の確認**: 更新が有効なとき、起動の 5 秒後に 1 回だけ確認する。プロンプトもダイアログも出さない。自動ダウンロードも、終了時の自動インストールもしない。
- **無効になる条件**: パッケージされていない実行（開発時）、`LOL_VIEWER_E2E=1`、`LOL_VIEWER_DISABLE_UPDATES=1`。無効のときは状態が `unsupported` で、確認は一切せず、Settings にボタンを出さない（「Update checks are off in this build.」）。
- **状態**（`UpdateStatus.state`）: `unsupported`、`idle`（未確認）、`checking`、`not-available`、`available`、`downloading`（`percent` 0〜100）、`downloaded`、`error`。状態の遷移は純粋関数（`update-core.ts` の `reduceUpdate`）で、当てはまらない操作は無視する。
  - `Check for updates`: `idle` / `not-available` / `error` のときだけ有効。確認が終わると `available`（最新版の番号を持つ）か `not-available`。確認中の再押下は無視。
  - `Download`: `available` のときだけ。進捗を `downloading` で流し、終わると `downloaded`。
  - `Restart and update`: `downloaded` のときだけ。`quitAndInstall` でサイレントにインストールし、新しい版を起動する。ワンクリック・ユーザー単位のインストーラなので、ウィザードは出ない。League / Vanguard のプロセスは閉じない。
  - 失敗（確認、ダウンロード）: `error` になり、最新版の番号は保つ。再度 `Check for updates` で回復できる。理由は短い文にする: `Could not reach the update server.`（接続できない、タイムアウト）、`No update information was found.`（404 や `latest.yml` が無い）、`The downloaded update is corrupted. Try again.`（チェックサム）、`The update server refused the request.`（401 / 403 / 429）、それ以外は `Could not check for updates.`。詳しいエラーはログに出す。
  - electron-updater が「この環境では動かない」（`app-update.yml` が無いなど）と返したときも `error` にする。
- **表示**: Top bar の Settings の赤い点は、`available` と `downloaded` のときに出る。Settings > Version の表示は §2.4。
- **IPC**: `updates:status`（main → renderer の通知、および問い合わせ）、`updates:check` / `updates:download` / `updates:install`（renderer → main）。アプリ自身のウィンドウからの呼び出しだけ受け付ける。

### 7.2 リリース（`.github/workflows/next-release.yml`、`next/tools/release`）
- **タグ**: `app-vX.Y.Z`。旧版の `release.yml` は、最新タグの取得と差分の取得で `v[0-9]*` だけを見るので、新版のタグの影響を受けない。
- **バージョン**: 最新の `app-v*` タグ（版の大小で選ぶ。なければ `0.0.0`）から、**その後に `next/` を変えたコミット**のメッセージで bump を決める。`BREAKING CHANGE` / `!:` は major、`feat:`（scope 付きも）は minor、それ以外は patch（旧版と同じ規則）。手動実行では patch / minor / major を選ぶ（選んだものが優先）。git タグが唯一の正で、バージョンを書き換える bot コミットは作らない。ビルド時に `extraMetadata.version` で埋め込む。
- **起動条件**:
  - main への push のうち `next/**` を変更したもの。
  - 手動実行（`workflow_dispatch`、bump を選ぶ）。公開するのは main 上だけ。他のブランチでは、バージョンの計算で止まる。
  - プルリクエスト（`next/**` と、次の 2 つのワークフローの変更）: **dry-run**。バージョンの計算と要約だけで、ビルドも公開もしない。
  - 計算したタグが既にあれば、何もしない。リリースは 1 本ずつ順番に処理する（キューに積む。PR の古い実行だけは取り消してよい）。
- **ジョブ**: `version`（計算）→ `build`（`next-windows.yml` を呼ぶ。読み取り専用の権限）→ `publish`。`build` が全部通ったときだけ `publish` が走る。
- **公開するもの**（`publish`）:
  - ビルドの成果物から、インストーラ `lol-viewer-next-setup-<版>.exe`、`.blockmap`、`latest.yml` を取り出す。ファイルが無い、または `latest.yml` の `version` が計算した版と違えば失敗する。
  - Release `app-vX.Y.Z`（題名 `LoL Viewer Next X.Y.Z`）に 3 つを添付する。**prerelease で、`latest` にしない**（旧版の更新確認 `/releases/latest` に出さない。M-019）。リリースノートは「前の `app-v*` タグ以降の `next/` のコミット一覧（件名と短い SHA）」と、前のタグとの比較リンク。
  - 固定の Release `app-latest`（prerelease、`latest` にしない）を、毎回作り直さずに更新する（無ければ作る）: 新しいインストーラと blockmap を先に上げ、**最後に `latest.yml`**（フィードが、まだ無いインストーラを指さないように）。その後、他のアセットを消し、`app-latest` のタグを今のコミットへ動かす。アプリはここの `latest.yml` だけを見る。
- チャンピオンデータの更新（`next-champion-data.yml`、木曜 10:23 UTC）は、`next/` だけを変える PR で、旧版のリリースを起動しない。

### 7.3 Windows での検証（`next-windows.yml`。`next-ci.yml` とリリースが共通で使う）
無署名のインストーラをビルドし、次を順に確認する。1 つでも落ちれば、リリースは公開されない。
1. インストーラの生成（ファイル名、`latest.yml`、blockmap の存在。版を指定したときは名前も照合）。
2. サイレント・ユーザー単位でインストール。
3. インストールされたアプリに対する Electron の E2E（偽の LCU、ネイティブの外部ビュー）。
4. アプリの起動中に入れ直す。
5. アンインストールで、アプリが消える。
6. 同じソースを `0.0.1` と `0.0.2` でビルドし、古い版をインストールして、手元のフィード（`LOL_VIEWER_UPDATE_URL`）から Settings の `Check for updates` → `Download` → `Restart and update` を実行する。インストーラが新しい版（`0.0.2`）で、アプリを再起動したことを確認する（`e2e/windows/update-flow.ps1`、`e2e/electron-update.spec.ts`）。
7. 標準ユーザー（ASCII と日本語のユーザー名）で、インストール、起動、アンインストール。
8. インストーラ、`latest.yml`、blockmap（とスクリーンショット）を成果物として保存する。

関連する単体テスト: `update-core.test.ts`（状態遷移、フィード、エラー文）、`tools/release/src/version.test.ts`（タグの選択、bump、リリースノート）。Settings > Version の表示は Storybook の E2E（`storybook.spec.ts`）で確認する。

### 7.4 インストーラ（`electron-builder.yml`、M-022）
NSIS、ワンクリック、ユーザー単位（`%LOCALAPPDATA%\Programs\lol-viewer-next`）。言語の選択、全ユーザーへの昇格、インストール先の選択は出さない。インストール後に起動する。スタートメニューとデスクトップにショートカット（名前は `LoL Viewer`）。アンインストールでユーザーデータは残す。依存の更新は、`next/` の npm も Dependabot のセキュリティ更新だけが対象（通常の更新は手動）。

---

## 8. 移植チェック表

旧インベントリの各チェックリストの項目を、機能単位にまとめて対応づけた。

- 状態: ✅ 同等 / ✨ 改善・変更（挙動が変わった、または設計として置き換えた）/ ➖ 移植しない / ⏳ 未実装
- 「旧版の機能」の列の `（n 項目）` は、そのチェックリストの項目数。各見出し（01 起動・環境、など）は旧チェックリストの小見出しと同じ。
- 見た目の指定（色、px、文言、ツールチップ、角丸、ホバーの色）は M-008 により対象外。各節の末尾にまとめて 1 行にした。
- 根拠: 決定番号（M-xxx）、テスト名、E2E 名、ファイル名。

### 8.1 旧 01: メインウィンドウ（01-main-window.md）

#### 起動・環境

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `argv[0]` に debug でデバッグモード、ファイルログ（11 項目のうち 2 項目: モード切り替え、ログ形式） | ✨ | `apps/desktop/src/log.ts`、`log-core.ts`。`--debug` / `LOL_VIEWER_DEBUG=1` / 実行ファイル名。形式は `YYYY-MM-DD HH:mm:ss.SSS LEVEL [scope] message`、ファイル名 `lol-viewer-YYYYMMDD-HHMMSS.log` | `log-core.test.ts`（"detects debug mode"、"formats timestamps, lines and file names"） |
| 未捕捉例外をログして exit 1 | ✨ | `installProcessHandlers`。ログに出す。終了コード 1 では落とさない（Electron） | `log.ts` |
| ヘッドレス・テスト抑止の環境変数群（`LOL_VIEWER_DISABLE_*`、`PYTEST_CURRENT_TEST`、`QT_QPA_PLATFORM`） | ➖ | Qt / PyQt 固有。代わりに `LOL_VIEWER_E2E`、`LOL_LCU_LOCKFILE`、モックのブラウザ版（§6.3） | M-007（土台が別）。`main.ts` の冒頭コメント |
| 起動時に旧パッチのアイコンキャッシュを削除 | ➖ | キャッシュ自体が無い | M-017 |
| 起動時に未定義の `feature_flags/*` を削除 | ✨ | 削除しない（保存値を残す）。`parseSettings` | M-016（B19）、`settings.test.ts`（"repairs each broken item on its own"） |
| LCU 検出サービスを 2000ms 間隔で起動 | ➖ | 起動時に即接続し、WAMP の購読。失敗時は 2 秒から倍々 | M-010 |
| 起動時ビューア 0 個 | ✅ | `initialWorkspace` | `electron.spec.ts`（"No viewers yet"） |
| 既定タブ = Viewers | ✅ | `App` の `initialPage` | `storybook.spec.ts` |
| 初回表示後に一覧を再描画（`[Hidden]` 誤表示の回避） | ➖ | React が状態から描くので不要。`[Hidden]` 自体を出さない | M-006 |
| 起動 100ms 後に最新バージョンを確認 | ✨ | 起動の 5 秒後に 1 回（更新が有効なときだけ）。`apps/desktop/src/update-core.ts`、`updater.ts` | M-020、`update-core.test.ts`（"is supported only when packaged, not E2E and not disabled"） |

#### ウィンドウ / レイアウト

| 旧版の機能（6 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| タイトル「LoL Viewer」、1600×900、アイコン | ✅ | `main.ts` の `createWindow` | progress.md、`electron.spec.ts` |
| サイドバー + コンテンツ、スプリッタ。最小幅 150 | ✨ | 最小 240 / 最大 480、ドラッグと ← → | `core/settings.ts`（`SIDEBAR_WIDTH_MIN/MAX`）、`Sidebar.tsx` |
| サイドバー幅の保存（既定 200） | ✨ | `settings.sidebarWidth`（既定 300） | `settings.test.ts`（"defaults"） |
| サイドバー下部の LCU 状態 | ✨ | Top bar の右端（接続表示とフェーズ） | M-008、`TopBar.tsx`、`storybook.spec.ts`（"Top bar: clicking the connection status…"） |
| 3 タブとページの 1 対 1 切り替え | ✅ | Top bar の `Viewers` / `Live Game` / `Settings` | `electron.spec.ts`（Live Game で表示が切り替わる） |
| Live Game / Settings タブの説明テキスト | ➖ | Sidebar は Viewers ページだけ | M-008 |

#### Live Game

| 旧版の機能（4 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 起動時に Live Game URL を読み込む | ✅ | `LivePage`。非表示でも読み込み済みを保つ | `electron.spec.ts`（"Live Game page: its view shows…"） |
| タブの右クリック → Refresh | ✨ | ページ上部の `Refresh` ボタン。**設定した URL を開き直す**（旧版と同じ）。外部ページ内の右クリックの Reload は今のページの再読み込み | M-008、`LivePage.tsx` |
| Live Game にも QR | ✅ | `QR` ボタン（パネルで入れ替え） | M-009 |
| URL の保存 / リセットで即再読み込み | ✅ | `onUrlsSaved` で開き直す | M-016（B5） |

#### ビューア管理

| 旧版の機能（13 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `+`（末尾に追加）、`×`（確認なしで全部閉じる。保留も消す） | ✅ | Viewers の `+` とゴミ箱 | `workspace.test.ts`（"closeViewer / closeAll"）、`storybook.spec.ts`（"close one viewer, hide with double-click, close all"） |
| 上限 20、手動追加の超過で警告ダイアログ | ✨ | トースト `Viewer limit reached (20)…`（ネイティブのダイアログは使わない） | `storybook.spec.ts`（"viewer limit: the add button refuses with a notice"） |
| ID は単調増加 | ✅ | `nextId` | `workspace.test.ts`（"addViewer appends an empty build viewer, up to 20"） |
| 追加時に全幅を均等に再分配 | ✅ | `PaneStrip` | `electron.spec.ts`（幅の差 2px 以内）、`storybook.spec.ts`（"panes keep a 300px minimum…"） |
| ビューアを閉じる（後始末） | ✅ | `closeViewer`。ビューは detach | `electron.spec.ts` |
| 非表示 / 表示（ダブルクリック、ホバーの −/+） | ✅ | 行のダブルクリックと目のボタン | `storybook.spec.ts`（"…hide with double-click…"）、`electron.spec.ts` |
| 非表示であることの表示 | ➖ | 出さない | M-006 |
| 並び: picked → 通常 → 保留 | ✅ | `ViewersSection` | `storybook.spec.ts`（"sidebar lists picked viewers first, then the others"） |
| 行: アイコン・名前・種別・ホバーで操作 | ✅ | `ViewersSection` | M-006 |
| チャンピオン変更でサイドバー更新 | ✅ | 状態から描く | — |
| 対面候補（対面表の敵 → 他のビューア） | ✅ | `opponentSuggestions` | `workspace.test.ts`（"opponentSuggestions: …"） |
| 対面表の更新で全ビューアのクイックピックを更新 | ✅ | 派生値 `quickPicks` | `workspace.test.ts`（"quickPicks: …"） |

#### URL 合成

| 旧版の機能（7 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| Build / Counter / Matchup / ARAM の置換とレーン | ✅ | `core/urls.ts` の `viewerUrl`（§4） | `urls.test.ts`（"viewerUrl"） |
| Build で対面ありなら Matchup | ✅ | 同上 | `storybook.spec.ts`（"opponent: quick pick gives the Matchup URL, None goes back to Build"） |
| レーン値と表示名（Top / Jungle / Mid / Bot / Support） | ✅ | `LANE_LABEL`。未選択は `Any lane` | M-008（`▾` などの記号は対象外） |
| テンプレートは「開く時点」の設定値 | ✨ | URL は常にテンプレートから求める。保存すると、開いているビューアのうち URL が変わるものは開き直す | M-021、`ViewerPane.tsx` |

#### CURRENT MATCHUP

| 旧版の機能（13 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 5 行固定、味方アイコン・名前 vs 敵、⧉、空は「-」 | ✅ | `MatchupSection`（空は「—」） | `storybook.spec.ts`（"complete champ select: …"） |
| タイトル、Refresh、色付き「Ally vs Enemy」 | ✅ | `Matchup` 見出し + ⟳。色付きの凡例は M-008 により対象外 | M-008 |
| アイコンの共有キャッシュからの非同期表示 | ➖ | `<img>` + Chromium の HTTP キャッシュ。失敗時は頭文字 | M-017 |
| 新しい試合で全行と保留をクリア | ✅ | `applyMatch` 1 | `workspace.test.ts`（"closes every viewer… and clears rows, pending and seen enemies"） |
| 一度置いたら消さない、空きだけ埋める、既存はスキップ | ✅ | `placeMatchup` | `workspace.test.ts`（"stops when the side is full and never removes what was placed"、"skips a champion already in the side"） |
| 味方の配置（レーンあり → 該当行、なし → 適性最大） | ✅ | 同上 | `workspace.test.ts`（"puts allies with a lane into their lane's row" ほか） |
| 敵の配置（適性最大、同点は上、データ無しは最初の空き） | ✅ | 同上 | `workspace.test.ts`（"breaks ties toward Top…"） |
| Refresh（クリア → 再開 → 即時取得。ビューアは閉じない） | ✨ | 表と保留をクリア → 最後の MatchState から置き直し + 全パスを GET し直す | M-010、`workspace.test.ts`（"refreshMatchup rebuilds the table from the last state…"）、`lcu.test.ts`（"connects, resyncs on demand…"） |
| ドラッグ&ドロップで同じ側の入れ替え | ✅ | `swapRows` | `storybook.spec.ts`（"drag an enemy onto another enemy row swaps them…"）、`workspace.test.ts`（"a swapped table is kept…"） |
| ⧉: 行の味方（+ 敵）+ レーンで新規ビューア。味方が空なら無効。重複を排除しない | ✅ | `openRow` | `workspace.test.ts`（"openRow appends a build viewer…"） |
| 敵の隣接行スワップ（未配線） | ➖ | 作らない | M-005 |
| Debug: 入力 + Add Ally / Add Enemy。結果表示、成功で入力をクリア | ✅ | Settings の Debug。検索つき | `storybook.spec.ts`（"Settings: Debug adds an ally to the first empty row, and says when full"）、`workspace.test.ts`（"debugAdd…"） |
| 対面表の「⧉でレーンセレクターを同期」（PR #93）に相当する、行のレーンを持った新規ビューア | ✅ | `openRow` が `lane` を設定 | `workspace.test.ts`（"openRow without an enemy gives a lane build page"） |

#### 自動検出連携

| 旧版の機能（9 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| シグナル起点のビューア生成を次のループへ遅延 / `setUrl` と `hide` を同じ tick で行わない | ➖ | WebEngine のクラッシュ対策。新版は `WebContentsView` の attach / detach を renderer の状態から出す。E2E で全経路を確認 | `electron.spec.ts`（"native external views follow the viewer panes through a whole session"） |
| 自分のチャンピオン検出 → 左端に picked を新規作成（重複排除なし） | ✅ | `applyMatch` 3 | M-002、`workspace.test.ts`（"adds a picked viewer on the left each time champion or lane changes…"） |
| ARAM なら ARAM ページ、それ以外はレーンを設定して Build | ✅ | 同上、`ARAM_QUEUE_IDS` | `workspace.test.ts`（"is an ARAM viewer without a lane in ARAM"）、`reducer.test.ts`（"queue and ARAM"） |
| 自動作成時の上限超過はログだけ | ✅ | 作らない。ログも通知も出さない | `workspace.test.ts`（"does not create viewers beyond the limit but remembers the pick"） |
| 敵の検出 → 保留リスト（重複排除） | ✅ | `applyMatch` 4 | `workspace.test.ts`（"queues new enemies in pick order, once, in ChampSelect only"） |
| 保留の `+` / ダブルクリックで Counter（picked があれば位置 1、なければ 0） | ✅ | `openPending` | `workspace.test.ts`（"openPending makes a Counter viewer at index 1…"）、`storybook.spec.ts`（"an enemy pick becomes a Counter viewer"） |
| 保留の `×` で削除 | ✅ | `removePending` | `workspace.test.ts`（"closeViewer / closeAll"） |
| 新しい試合で全ビューア（手動含む）、対面表、保留を消す | ✅ | `applyMatch` 1 | M-001、`storybook.spec.ts`（"second match closes every viewer and pending pick (M-001)"）、`electron.spec.ts` |
| 手動の LCU 再接続（"Connecting..."、1.5 秒無効） | ✅ | Settings の `Reconnect` | `storybook.spec.ts`（"Settings: Reconnect shows Connecting… for a moment…"） |

#### Settings

| 旧版の機能（9 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 5 つの URL 入力欄と説明（placeholder の例つき） | ✅ | `UrlsCard`（欄ごとの説明） | M-008（文言は対象外） |
| Save: trim、全欄必須、エラー表示、成功表示 | ✨ | `UrlsCard`（赤表示、通知）。空欄と https 以外を保存させない（ホストは自由） | M-023、`settings.test.ts`（"validateUrlTemplates"、"urlTemplateProblem"）、`storybook.spec.ts`（"Settings: URL validation blocks saving, saving works…"） |
| Reset to Defaults（確認なし） | ✅ | 同上 | M-016 |
| Version Information のうち、現在のバージョン | ✅ | `VersionCard`（`app.getVersion()` とプラットフォーム） | `storybook.spec.ts`（"Version says dev in the browser"） |
| Version Information のうち、最新バージョン、ステータス | ✅ | Settings > Version の `Latest version` と状態の文（§2.4） | `storybook.spec.ts`（"Settings > Version: …states show the right text and button"） |
| Check for Updates（手動のフロー全体） | ✨ | `Check for updates` → `Download` → `Restart and update`（ダイアログや zip の取得ではなく、Settings 内で完結。§7.1） | M-020、`update-core.test.ts`（"runs the whole flow and pushes every status"）、`electron-update.spec.ts` |
| UI Size（Small / Medium / Large） | ✨ | Display カード。**すぐ反映**（再起動不要） | M-012、`storybook.spec.ts`（"…UI size applies at once"） |
| QR Code Overlay（既定オン、即時反映） | ✨ | `Show the QR button on viewers`。ボタンの表示 / 非表示 | M-009、`storybook.spec.ts`（"QR button can be switched off in Settings"） |
| Feature Flags の仕組み（定義、既定値、`featureFlags` への保存） | ✅ | `core/settings.ts`（`FEATURE_FLAGS`、`parseSettings`） | `settings.test.ts`（"repairs each broken item on its own"） |
| Feature Flags の画面（定義があるときだけ表示、トグル即保存、Reset Flags） | ✅ | Settings の `Feature flags` カード（定義があるときだけ。トグルは即保存・即反映、`Reset flags to defaults`）。旧版の「restart may be required」は出さない（再起動不要） | `storybook.spec.ts`（Settings: the live data flag…）、`SettingsCards.stories.tsx` |
| Debug セクションは常時表示 | ✅ | `DebugCard` | — |

#### 更新チェック

| 旧版の機能（5 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 起動時 1 回、重複防止。Settings タブ選択でも要求 | ✨ | 起動 5 秒後に 1 回。確認中の再押下は無視。Settings タブを開いても確認しない（旧版も実質 no-op） | `update-core.test.ts`（"ignores a second check while one is running"）、B6 |
| 新しい版があれば Settings に赤い `●`、ステータス | ✅ | Top bar の点（`available` と `downloaded` のとき）と、Version の状態の文 | `App.tsx`、`TopBar.tsx`、`storybook.spec.ts`（"Settings > Version…"） |
| 最新 / 接続不可 / 例外の文言 | ✨ | `You have the latest version.`、短い理由（`Could not reach the update server.` など。§7.1） | `update-core.test.ts`（"turns noisy errors into one short sentence"） |
| タグ名の先頭 `v` を除去して表示 | ✅ | 版は `latest.yml` の数値だけ（`v` が付かない） | `update-core.ts` |
| テスト / ヘッドレスでは確認しない | ✅ | `unsupported`（開発時、`LOL_VIEWER_E2E=1`、`LOL_VIEWER_DISABLE_UPDATES=1`） | `update-core.test.ts`（"does nothing when unsupported"） |

#### 永続化・終了、スタイル、既知の不整合

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| QSettings のキー 9 種（永続化・終了 2 項目のうち 1） | ✨ | `localStorage` の `lol-viewer.settings`（§5）。形式と保存先は自由 | M-003、M-014 |
| 終了時に LCU 検出サービスを停止 | ✅ | `before-quit` で `connector.stop()` | `main.ts` |
| ダークテーマの配色、ティールなどのアクセント色（スタイル 3 項目のうち 2: 配色、ホバー / 選択スタイル） | ➖ | 見た目は再現しない | M-008 |
| UI サイズプリセットによるトークン化 | ✨ | `--ui-scale`（0.9 / 1 / 1.15）でまとめて拡縮 | M-008、`core/settings.ts`（`UI_SCALE`） |
| 不整合: Save 失敗でメモリ上の URL が空のまま | ✨ | 保存に失敗したら値を変えない | M-016（B4） |
| 不整合: URL を保存しても Live Game の QR が古いまま | ✨ | 保存で Live Game を開き直し、QR は現在の URL を使う | M-016（B5） |
| 不整合: 説明文の `{lane}` が置換されない | ✅ | 同じく置換しない（説明文にも載せない） | `settings` の `URL_FIELDS` |
| 不整合: `_latest_version_check_force` は未使用 | ➖ | 該当する仕組みが無い（確認は起動時と手動だけ） | B6 |
| 不整合: 更新確認が GUI スレッドで同期実行 | ✨ | main の非同期処理（electron-updater） | M-020、B7 |

### 8.2 旧 02: ウィジェットと定数（02-widgets-constants.md）

#### constants

| 旧版の機能（15 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| バージョン文字列を単一の箇所で管理（設定画面の表示、アップデータ、リリース時の書き換え） | ✨ | git タグを正とし、ビルド時に `extraMetadata.version` で埋め込む。表示は `app.getVersion()`。コミットで書き換えない | M-018、`tools/release/src/version.test.ts`（"planRelease"） |
| 既定の Build / Counter / Matchup / ARAM / Live Game の URL（5 項目） | ✅ | `DEFAULT_URL_TEMPLATES` | `settings.test.ts`（"defaults match the schema defaults and the Python app"） |
| 5 つのテンプレートを上書き、既定に戻す（キー名は新しい） | ✅ | Settings の Analytics URLs | `storybook.spec.ts` |
| 閉じるグリフ `×` の統一 | ➖ | 見た目 | M-008 |
| 機能フラグの仕組み（定義辞書、既定値、保存、掃除しない）。画面は 01 の Feature Flags の画面の行（`liveClientData` を定義済み） | ✅ | `core/settings.ts` | M-016（B19）、`settings.test.ts` |
| ARAM のキュー ID {450, 65, 100, 720} | ✅ | `ARAM_QUEUE_IDS` | `reducer.test.ts`（"queue and ARAM"） |
| Mayhem のキュー ID {2400, 2401, 2403, 2405, 3240, 3270} | ✅ | 同上 | 同上 |
| ARAM 系のとき、自分のピックで ARAM ページを開く | ✅ | `applyMatch` 3 | `workspace.test.ts`（"is an ARAM viewer without a lane in ARAM"） |
| UI サイズプリセット 3 種と全トークンの値 | ✨ | 3 種の倍率に集約。個別トークンは対象外 | M-008、M-012 |
| `display/ui_size` の保存（既定 medium、未知は small、再起動後に反映） | ✨ | 保存は `uiSize`。未知は `medium`、**すぐ反映** | M-012、`settings.test.ts`（"repairs each broken item on its own"） |
| ビューアに main_window が無いときは small（テスト用） | ➖ | 該当する構造が無い | M-007 |

#### ChampionViewerWidget: 構造と状態

| 旧版の機能（6 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 3 段構成（ヘッダー / モードタブ行 / コンテンツ） | ✨ | ヘッダー 3 段 + 本体（パネルと外部ページを入れ替え） | M-008、`ViewerPane.tsx` |
| 最小幅 300px、初期幅 500px | ✨ | 最小 300px。初期幅は均等割り（500 固定ではない） | `PaneStrip.tsx`、`storybook.spec.ts`（"panes keep a 300px minimum…"） |
| ビューア状態（id、チャンピオン、対面、種別、モード、URL、picked） | ✅ | `Viewer` 型 | `workspace.ts` |
| モードはチャンピオン未入力でも選択・保持 | ✅ | `setMode` | `workspace.test.ts`（"set* keep values without a champion and reopen…"） |
| `close_requested` 相当（ヘッダーの × で閉じる） | ✅ | ヘッダーの × | `storybook.spec.ts` |
| `champion_updated` 相当（ページを開くたびにサイドバー更新） | ✅ | 状態から描く | — |

#### ヘッダー、クイックピック、モードタブ

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| ヘッダーの × | ✅ | 1 段目の右端 | `storybook.spec.ts` |
| ヘッダーの並び（× → Lane → Champion → vs → Opponent → クイックピック） | ✨ | 並びを変更（1 段目 Champion / vs / Opponent / ×、2 段目 モードと Lane、3 段目 クイックピックと操作） | M-008 |
| Lane / Champion / Opponent の pill（選択後の表示、None で元に戻る） | ✅ | 3 つのボタン | `storybook.spec.ts`（"opponent picker by hand…"） |
| pill の共通スタイル | ➖ | 見た目 | M-008 |
| 名前が解決できないときの capitalize 表示 | ➖ | 解決できない ID は一覧に入れない。`champions.json` にある ID だけ扱う | `reducer.test.ts`（"lists only picked champions in order and drops ids missing from the data"） |
| アイコンの非同期読み込み、共有キャッシュ | ➖ | `<img>` + HTTP キャッシュ。オフラインは頭文字 | M-017 |
| クイックピック: 対面表の敵を最大 5 件、1 クリックで設定 | ✅ | `quickPicks` | `workspace.test.ts`（"quickPicks: enemies in row order, current opponent excluded, at most 5"） |
| 敵名の正規化、重複除去、行順 | ✅ | チャンピオン ID で保持し、行順に重複を除く | 同上 |
| 今の対面はクイックピックから除く | ✅ | 同上 | 同上 |
| tooltip `Set {name} as opponent`、使わないボタンは隠す | ✅ | `quick-pick` ボタン（出す数だけ描く） | `storybook.spec.ts`（"opponent: quick pick gives the Matchup URL…"） |
| 更新のたびに再計算 | ✅ | 派生値 | — |
| 押したら WebView に戻り、再遷移 | ✅ | `pickOpponent` | 同上 |
| ラベルを `…` で省略（QuickPickButton） | ✨ | アイコンだけのボタン | M-008 |
| Build / Counter / ARAM の排他タブ | ✅ | モード切り替え | `storybook.spec.ts`（"…lane panel, mode switch"） |
| タブを押したらセレクターを閉じ、チャンピオンがあれば遷移 | ✅ | `setMode` | `workspace.test.ts` |
| 不正なモード index は Build | ➖ | 型で防ぐ | — |
| 見た目（pill / モードタブの色） | ➖（M-008） | — | M-008 |

#### チャンピオンセレクターとレーン

| 旧版の機能（チャンピオンセレクター 10、レーン 5） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 見出し、× ボタン、検索欄、アイコン付きリスト | ✅ | `ChampionPanel`（アイコン + 英語名 + 日本語名のグリッド） | `Panels.stories.tsx`、`storybook.spec.ts` |
| リストは champions のキー順に全件 | ✨ | 英語名順 | `tools/champion-data`（`transform` が名前順に並べる） |
| 対面モードのときだけ先頭に `None` | ✅ | `allowNone` | `storybook.spec.ts`（"opponent: …None goes back to Build"） |
| 対面で検索語が空 → 対面表の敵だけ（無ければ他ビューア） | ✨ | 先頭に `Suggested`（同じ候補）、続けて全チャンピオンも出す | `workspace.test.ts`（"opponentSuggestions…"） |
| 検索: 大小無視の前方一致（英語名、キー、日本語名） | ✨ | 前方一致を先、部分一致を後。ひらがな可、記号とスペースは無視、Data Dragon の ID にも当たる | `search.test.ts` |
| チャンピオンモードで検索語が空なら全件 | ✅ | `ChampionPanel` | `search.test.ts`（"returns the roster for an empty query…"） |
| 開くたびに検索欄をクリアしてフォーカス | ✅ | 開くたびに作り直す | `storybook.spec.ts`（"champion picker: arrow keys and Esc"） |
| 項目を選んだら pill を更新して WebView に戻り、再遷移 | ✅ | `pickChampion` / `pickOpponent` | `storybook.spec.ts`（"add a viewer, pick a champion by hiragana, check the URL"） |
| `None` で対面を解除 | ✅ | `setOpponent null` | `storybook.spec.ts` |
| セレクターのスタイル | ➖（M-008） | — | M-008 |
| レーン選択パネル（None / Top / Jungle / Mid / Bot / Support） | ✅ | `LanePanel`（`Any` / `Top` …） | `storybook.spec.ts`（"…lane panel…"） |
| Lane pill でパネルを開閉トグル | ✅ | 同じボタンで開閉 | — |
| レーン値を URL の `lane=` に使う | ✅ | `viewerUrl` | `urls.test.ts` |
| レーンを選んだら更新して WebView に戻り、再遷移 | ✅ | `pickLane` | — |
| 外部からレーンを設定（LCU 検出、⧉） | ✅ | `newViewer({lane})` | `workspace.test.ts` |

#### URL とナビゲーション

| 旧版の機能（9 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| Build / 対面ありの Matchup / Counter / ARAM の URL | ✅ | `viewerUrl`（§4） | `urls.test.ts` |
| チャンピオン未入力で開こうとすると警告 | ✨ | 未入力ではページを開けず、本体に「Choose a champion…」と選択パネル。警告ダイアログは出さない | M-008、`ViewerPane.tsx` |
| ページを開くたびに URL を保存し、QR とサイドバーを更新 | ✨ | ページ内の移動も現在の URL として扱う（QR、↗ が追従） | M-013、`ViewStatus` |
| リフレッシュは元の URL を開き直す（旧版は UI に出さない） | ✨ | ペインの ⟳（開き直し）、◀ ▶ も追加 | M-013、`workspace.test.ts`（"reopen…"） |
| URL エンコードをしない | ✅ | 単純な置換 | `urls.ts` |
| Wukong / MonkeyKing の正規化 | ✅ | 内部は `wukong`。Data Dragon の ID は別フィールド | M-004、`urls.test.ts`（"never contains MonkeyKing…"）、`champions.test.ts`（"Wukong: slug wukong…"）、`workspace.test.ts`（"openRow with Wukong as the enemy…"） |

#### 自動補完・キー操作・その他

| 旧版の機能（9 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| バイリンガルの自動補完（`EN - JP`、最大 10 件） | ✨ | 選択パネルの検索に置き換え（英語・日本語の併記）。Debug の検索は最大 6 件 | M-008、`search.ts` |
| 対面欄が空でクリック → 文脈の候補 | ✅ | `Suggested` | `workspace.test.ts`（"opponentSuggestions…"） |
| 補完の遅延初期化 | ➖ | 性能対策。不要 | — |
| 入力欄で Enter | ✨ | 選択パネルの検索で Enter が決定 | `storybook.spec.ts`（"champion picker: arrow keys and Esc"） |
| Esc でセレクターを閉じる | ✅ | `PanelFrame` | 同上 |
| パネルの外側のクリックで閉じる | ✨ | パネルはペイン本体を占めるので「外側」が無い。×、Esc、ヘッダーのボタンで閉じる | `PanelFrame.tsx` |
| サイドバー用の表示名 `Champion / type / picked / vs Opponent`、空は `(Empty)` | ➖ | 表示しない。空は `New viewer` | M-006 |
| WebView の背景色（読み込み中のちらつき防止） | ✅ | 外部ビューとウィンドウに背景色を設定 | `external-views.ts` |
| ヘッドレス環境での代替表示 | ✨ | ブラウザ / Storybook ではプレースホルダー | `ExternalViewSlot.tsx` |

#### QR オーバーレイ

| 旧版の機能（8 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 右下に QR（現在の URL）を重ねて常時表示 | ✨ | 常時は出さない。`QR` ボタンで外部ページと入れ替え | M-009、`storybook.spec.ts`（"QR button swaps the page for a QR code of its URL"） |
| `QR` トグルで折りたたむ | ✨ | 同じボタンで開閉 | M-009 |
| URL が無い、または生成失敗なら隠す | ✅ | URL が無ければボタンが押せない。長すぎる URL はその旨を表示 | `QrPanel.tsx` |
| 同じ URL なら再生成しない | ✅ | 値が同じなら使い回す | `QrPanel.tsx` |
| リサイズ / 移動への追従 | ➖ | 重ねないので不要 | M-009 |
| `display/qr_code_overlay` の即時反映（全ビューアと Live Game） | ✅ | `qrButton` | `storybook.spec.ts`（"QR button can be switched off in Settings"） |
| Live Game ページにも QR | ✅ | `LivePage` の `QR` | M-009 |
| 折りたたみ状態は保存しない | ✅ | 保存しない | — |

#### サイドバー項目、マッチアップ、LCU ステータス、WebEngine

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| ビューア行: アイコン + 名前 + 種別 | ✅ | `ViewersSection` | M-006 |
| ホバー時だけ −/+ と × | ✅ | 目のボタンと × | `electron.spec.ts` |
| −/+ で表示切り替え、× で閉じる | ✅ | 同上 | 同上 |
| ダブルクリックで表示切り替え | ✅ | 行のダブルクリック | `storybook.spec.ts` |
| picked を上に並べる | ✅ | 同上 | `storybook.spec.ts`（"sidebar lists picked viewers first…"） |
| 非表示のビューアの表示 | ➖ | 出さない | M-006 |
| 保留中の敵ピック行（Counter、ホバーで `+` と `×`） | ✅ | `Enemy picks`（`+` と × は常に表示） | `storybook.spec.ts`（"an enemy pick becomes a Counter viewer"） |
| 行の高さ、選択行の左ボーダー、ホバー背景 | ➖（M-008） | — | M-008 |
| 味方・敵の名前をドラッグして同じ側の 2 行を入れ替える | ✅ | `swapRows` | `storybook.spec.ts`（"drag an enemy onto another enemy row swaps them; across sides does nothing (M-005)"） |
| ドラッグ中は hover した行をハイライト（ドラッグ元には出さない） | ✅ | `data-droppable` / `data-over` | `MatchupSection.tsx` |
| ドラッグの開始距離、スナップショット、カーソル | ➖ | ブラウザ標準のドラッグ | M-008 |
| 行: レーン、味方、名前、VS、敵、⧉ | ✅ | `MatchupSection` | — |
| ↑↓ ボタン | ➖ | 作らない | M-005 |
| LCU ステータスの 3 種（Connecting… / Connected / Disconnected） | ✅ | Top bar の接続表示、Settings の League Client | `TopBar.tsx` |
| ステータスの色、●、位置、背景 | ➖（M-008） | — | M-008 |
| UI サイズが medium に固定される不具合 | ✨ | UI 全体が同じ倍率 | M-016（B13） |
| WebEngine: Cookie とストレージの永続性（旧版は既定のまま） | ✨ | `persist:external` に保存する | `external-views.ts` |
| WebEngine: 新しいウィンドウ / `target=_blank` / 外部リンク | ✨ | 許可ホスト外とポップアップは既定のブラウザへ | M-013、`external-views.ts` |
| WebEngine: 右クリックメニュー | ✨ | Back / Forward / Reload / Copy link address / Open page in browser | M-013 |
| WebEngine: ダウンロード（旧版も未対応） | ➖ | 専用の処理は作らない（Electron の既定動作。実機未確認） | §9.1 |
| WebEngine: ページ内の遷移を URL・QR に反映しない | ✨ | 反映する | M-013 |
| WebEngine: クラッシュ回避（遅延生成、`setUrl` と `hide` を同じ tick で行わない） | ➖ | 上の「自動検出連携」と同じ | `electron.spec.ts` |

### 8.3 旧 03: LCU、検知、データ（03-lcu-detection-data.md）

#### LCU 接続

| 旧版の機能（22 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `LeagueClientUx` のプロセスから `--app-port` と `--remoting-auth-token` を取る | ✅ | `readClientCommandLine`、`parseClientCommandLine`（Windows。PowerShell） | `lcu.test.ts`（"parseClientCommandLine"、"process command line gives https credentials"） |
| クライアント起動の判定（`LeagueClient.exe` / `LeagueClientUx.exe`、非 Windows 名） | ✨ | 起動判定を別に持たない。コマンドライン → lockfile の順で探す。Windows 以外は lockfile だけ | `findCredentials` |
| プロセス列挙の例外に耐える（旧版はスキャン全体が失敗） | ✨ | 失敗は「見つからない」扱いで、lockfile を試す | `lcu.test.ts`（"falls back to <install-directory>/lockfile…a throwing process read is a miss"）、B9 |
| Basic 認証 `riot:<token>` | ✅ | `LcuClient` | `lcu/src/index.ts` |
| `https://127.0.0.1:<port>`、自己署名を許可（LCU の呼び出しに限定） | ✅ | ソケットごとに `rejectUnauthorized: false`（プロセス全体では緩めない） | `lcu/src/index.ts` の冒頭の安全方針 |
| タイムアウト 2 秒 | ✅ | GET のタイムアウト | 同上 |
| 200 以外は None（切断しない）。例外は切断して認証情報をクリア | ✨ | GET の失敗は null（切断しない）。切断は WebSocket の close で検知 | 同上 |
| 未接続のときはリクエストを送らない | ✅ | `resync` は接続中だけ | `startLcuConnector` |
| 接続状態 3 種。初期値 connecting。変化したときだけ通知 | ✅ | `connection`。変化が無ければ配信しない | `integration.test.ts`（"does not notify twice for an event that changes nothing observable…"） |
| 状態の遷移規則（プロセスなし → disconnected、あり未接続 → connecting、…） | ✨ | 認証情報なし → disconnected。接続試行 → connecting → connected。つなげない → disconnected | `lcu.test.ts`、`integration.test.ts`（"reports disconnected when no lockfile exists"） |
| 基本ポーリング 2 秒 | ➖ | WAMP 購読 | M-010 |
| クライアントが無いとき指数バックオフ（×2、最大 60 秒）。見つけたら基本間隔に戻す | ✅ | 2 秒から倍々、最大 60 秒。接続成功で戻る | `lcu.test.ts`（"recovers when the client appears later, with capped doubling backoff"） |
| 切れたら次の再試行で再スキャン（ポートやトークンの変化に追従） | ✅ | 試行のたびに `findCredentials` | `lcu.test.ts` |
| ポーリングの再入防止 | ✅ | 試行の世代（`epoch`）で古い試行を捨てる | `lcu.test.ts`（"reconnect() reconnects without duplicate events"） |
| 手動接続（バックオフをリセット、connecting を通知、即時チェック） | ✅ | `reconnect()` | `lcu.test.ts`（"reconnect() reports connecting and reconnects"） |
| ボタンを「Connecting...」にして 1.5 秒無効化 | ✅ | `LcuCard` | `storybook.spec.ts` |
| `start(interval, max_interval)` / `stop()`、終了時に stop | ✅ | `startLcuConnector` / `stop()`、`before-quit` | `main.ts` |
| `LOL_VIEWER_DISABLE_LCU_SERVICE=1` で開始しない | ➖ | テストは偽の LCU（`LOL_LCU_LOCKFILE`）を使う | `integration.test.ts` |
| Qt イベントループが無いとき自前で作る | ➖ | Qt 固有 | M-007 |
| HTTP をメインスレッドから外す（旧版は GUI スレッドで同期） | ✨ | main の非同期処理 | M-010、B7 |

#### Data Dragon / 名前解決

| 旧版の機能（4 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 起動時に Data Dragon から ID と名前の対応表を作る | ✨ | ビルド時に生成して `champions.json`（数値 ID を含む）に同梱する。実行時の通信は無い | M-004、M-015、`tools/champion-data` |
| 名前のエイリアス `MonkeyKing → Wukong` | ✅ | `slugFor`（`SLUG_OVERRIDES`）。`ddragonId` は `MonkeyKing` のまま別フィールド | M-004、`champion-data/index.test.ts`（"slugFor"） |
| 取得に失敗するとリトライしない（B8） | ✨ | 実行時に取得しないので起きない | B8 |
| 内部名は ID の小文字、Wukong は `wukong` | ✅ | `slug` | `champions.test.ts`、`urls.test.ts` |

#### ゲームフェーズ

| 旧版の機能（7 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `/lol-gameflow/v1/session` の `phase`（なければ None）、レスポンスをキャッシュ | ✨ | `gameflow-phase` と `gameflow-session` を購読し、MatchState に持つ | M-010、`reducer.ts` |
| アクティブなフェーズでは取得失敗でもフェーズとキャッシュを保持 | ✨ | イベント駆動。GET の失敗は何も変えない | `lcu/src/index.ts`（`resync`） |
| それ以外のフェーズで取得失敗 → None、キャッシュ破棄 | ➖ | 購読なので不要 | M-010 |
| queueId の抽出（数値 / `{id}` / `{queueId}`） | ✅ | `readQueue` | `reducer.test.ts`（"queue and ARAM"） |
| gameMode の抽出（`queue.gameMode` → `queue.mode` → `gameData.gameMode`） | ✅ | 同上 | 同上 |
| `get_current_queue_id` / `game_mode`（未接続は None、無ければ 1 回取得） | ➖ | MatchState の `queueId` / `gameMode` を読むだけ | M-010 |
| ARAM の判定（ARAM / Mayhem の集合、または gameMode が ARAM） | ✅ | `withQueue` | `reducer.test.ts`、`reducer.test.ts`（"aram: queue 450, no lanes…"） |

#### チャンピオンセレクトでの検知

| 旧版の機能（11 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `/lol-champ-select/v1/session` を毎 tick 取得 | ➖ | 購読（変わったときだけ受け取る） | M-010 |
| 自分の特定（`cellId == localPlayerCellId`、`championId > 0`） | ✅ | `applyChampSelect` | `reducer.test.ts`（"follows hover changes and uses the assigned lane"） |
| 自分の `summonerId` をキャッシュ（試合中の判定用） | ✅ | `DetectorState.summonerId`（MatchState には出さない） | `reducer.test.ts`（"current-summoner"） |
| レーン: 小文字化、`utility → support`、なければ空 | ✅ | `normalizeLane`（`mid`、`bot` も読み替え） | `reducer.test.ts`（"normalizeLane"） |
| ホバーとロックを区別しない | ✅ | 同じ | M-002 |
| 一度検知した自分のチャンピオンは 0 になっても保持 | ✅ | `self` を保持 | `reducer.test.ts`（"keeps self when championId drops back to 0"） |
| 敵の新規ピック（`theirTeam` 順、ID 単位で重複排除して通知） | ✅ | `seenEnemies` で重複排除し、保留へ積む | `workspace.test.ts`（"queues new enemies in pick order, once, in ChampSelect only"） |
| 味方一覧 `(name, lane)`（ピック済みのみ、myTeam 順） | ✅ | `allies` | `reducer.test.ts`（"lists only picked champions in order…"） |
| 敵一覧（ピック済みのみ、theirTeam 順） | ✅ | `enemies` | 同上 |
| 名前を解決できない ID は除外 | ✅ | `known()` | 同上 |
| `matchup_data` の dict を毎 tick 全体で通知 | ✨ | 変わったときだけ MatchState のスナップショットを配信 | M-010、M-011 |

#### 試合中、その他のフェーズ

| 旧版の機能（試合中 7 項目、その他 3 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 自分のチャンピオンは ChampSelect のキャッシュを返す | ✅ | `self` を保持 | `reducer.test.ts`（"builds both teams from gameflow and keeps my champ-select pick"） |
| `gameData.teamOne/teamTwo` から味方と敵（lane は空） | ✅ | `applyTeams` | 同上 |
| 自分のチームを summonerId で判定。不明なら teamOne を味方 | ✨ | summonerId に加えて puuid も使う | `reducer.test.ts`（"decides my team by summonerId (teamTwo)"、"…by puuid"、"assumes teamOne when identity is unknown…"） |
| summonerId が未取得なら `current-summoner`（3 回連続失敗で停止） | ✨ | `current-summoner` を購読。失敗回数の管理は不要 | `reducer.test.ts`（"current-summoner"） |
| 一覧のマージ（新しい結果が空ならキャッシュを維持） | ✅ | 空なら前の一覧を保持 | `reducer.test.ts`（"keeps the previous lists when the gameflow teams are empty"） |
| `InProgress` では敵の新規通知を出さない | ✅ | 保留に積むのは ChampSelect だけ | `workspace.test.ts`（"only places in ChampSelect and InProgress"、"queues new enemies…"） |
| ARAM やブラインドの敵を試合中のデータで補う | ✅ | 同上 | `reducer.test.ts`（"blind-dodge-ingame…"） |
| `None` / `Lobby`: 自分、summonerId、gameId をリセット。matchup は通知せず前の一覧を残す | ✅ | `applyPhase` | `reducer.test.ts`（"None / Lobby"） |
| `None` / `Lobby` で自分をクリアしても通知しない | ✅ | `self` を消す。配信は MatchState の変化として 1 回 | 同上 |
| その他のフェーズは状態を保持し通知しない | ✅ | フェーズだけ更新 | `reducer.ts` |

#### 新規試合検知

| 旧版の機能（11 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| スイッチは既定で ON（OFF は内部のフォールバック） | ✅ | 常に ON の動作だけ持つ | `reducer.ts` |
| ON: 前回が ChampSelect 以外 → ChampSelect | ✅ | `applyPhase`、`applyChampSelect` | `reducer.test.ts`（"bumps matchSeq entering ChampSelect and clears picks and gameId"、"does not bump twice when the session arrives before the phase event"） |
| ON: ChampSelect 継続中に gameId が 0 でなく前回と異なる値に変わる | ✅ | `lastChampSelectGameId` | `reducer.test.ts`（"treats a gameId change inside ChampSelect as a new match (dodge)"、"ignores gameId 0 / missing…"） |
| OFF: `timer.internalNowInEpochMs` の巻き戻りで判定（gameId は無視） | ➖ | フォールバックは移植しない | `reducer.ts`（持たない） |
| 新セッションで対戦キャッシュとロックをリセット | ✅ | `startNewMatch` | 同上 |
| ON: last_champion / lane をリセットし、`new_match_started` を matchup より先に通知 | ✅ | `matchSeq` の増加。Workspace が最初に全消去し、次に配置 | `workspace.test.ts`（"applies the new match's data after clearing (order: new match, table, self, enemies)"） |
| OFF では `new_match_started` を出さない | ➖ | OFF が無い | — |
| UI: 新しい試合で全ビューア、対戦リスト、保留をクリア | ✅ | `applyMatch` 1 | M-001 |
| UI: `is_new_session` の matchup で行を初期化してから配置 | ✅ | 同上 | `workspace.test.ts` |
| gameId の変化による新セッションで、敵の既知集合と自分のチャンピオンをクリアするか（B10） | ✨ | クリアする（`self`、一覧、`seenEnemies`、ビューア） | `reducer.test.ts`、`workspace.test.ts`（"closes every viewer…"）、`reducer.test.ts`（"blind-dodge-ingame: dodge bumps matchSeq…"） |

#### シグナル、ウォッチモード、切断

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `champion_detected(name, lane)`（レーンだけの変化でも通知） | ✅ | `lastSelf` との比較 | `workspace.test.ts`（"adds a picked viewer on the left each time champion or lane changes…"） |
| `enemy_champion_detected(name)`（ピック順） | ✅ | `pending` | 同上 |
| `matchup_data_updated(dict)`（ChampSelect / InProgress の毎 tick。クリア通知は出さない） | ✨ | スナップショット。対面表は ChampSelect / InProgress のときだけ更新 | `workspace.test.ts`（"only places in ChampSelect and InProgress"） |
| `new_match_started()` | ✅ | `matchSeq` | M-001 |
| `connection_status_changed(str)` | ✅ | `connection` | `integration.test.ts` |
| 1 tick 内の発火順（status → new_match → matchup → champion → enemies → status） | ✅ | `applyMatch` の 1〜4 の順 | `workspace.test.ts`（"applies the new match's data after clearing…"） |
| シグナル後のビューア生成を次のループに遅延 | ➖ | 上と同じ | — |
| 旧 `matchup_pairs_updated` と位置ペア API（10 体揃ったらロック） | ➖ | 使われていなかったので移植しない | legacy README §6 |
| 10 体揃った後の一時停止、ウォッチモード（5 秒 / 15 秒、gameflow だけ、4 tick ごとの gameId 確認など 11 項目） | ➖ | イベント駆動なので目的ごと不要 | M-010 |
| Refresh: 一覧クリア → `resume_polling` → 即時チェック | ✨ | 一覧と保留をクリア → 置き直し + 全パスの GET し直し | M-010 |
| 切断時にチャンピオン、敵 set、各キャッシュ、ロック、前回フェーズ、gameId、ウォッチ、一時停止を全てリセット | ✨ | フェーズを `None` に戻し、summonerId / puuid を消す。`self` と一覧は残す（画面は直前の表示を保つ。旧版の「切断時に matchup をクリアする通知は出さない」と同じ） | `reducer.test.ts`（"disconnect resets the phase to None but keeps the lists; reconnect into ChampSelect is a new match"） |

#### champion_data

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `champions.json` の読み込み（無い / 壊れていれば空で続行） | ✨ | `core/data/champions.json` を zod で検証して同梱。壊れていればテストと起動が失敗する | `champions.test.ts`（"covers the full roster with unique ids and slugs"） |
| `get_champion`（キー → 英語名 / 日本語名） | ✨ | `getChampion(数値 ID)`。名前は `searchChampions` | `search.test.ts` |
| `search`（部分一致、英語名順。本体では未使用） | ✅ | `searchChampions`（実際に使う） | `search.test.ts` |
| 自動補完（`EN - JP`、部分一致、最大 10 件） | ✨ | 選択パネルの検索に置き換え | M-008 |
| 補完で確定したらキーを入力欄に入れる | ➖ | 入力欄に入れず、チャンピオン ID を直接設定する | — |
| 補完ポップアップの見た目 | ➖（M-008） | — | M-008 |
| 対面欄が空でクリック → 文脈候補（重複排除、空ならポップアップを出さない） | ✅ | `Suggested`（無ければ表示しない） | `workspace.test.ts` |
| 入力したら通常の候補に戻る | ✅ | 検索語があると `Suggested` を隠す | `ChampionPanel.tsx` |
| テストやヘッドレスではポップアップを開かない | ➖ | — | — |
| アイコン付きの補完項目（旧版は無効化中） | ✅ | 選択パネルはアイコン付き | `Panels.stories.tsx` |
| Debug の入力欄にも補完 | ✅ | 検索つきの Debug | `storybook.spec.ts` |

#### アイコンキャッシュ

| 旧版の機能（14 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| アイコンの URL は `image_url`（バージョン付き）をそのまま使う | ✨ | `championIconUrl`（パッチ番号と Data Dragon の ID から組み立てる） | `champions.ts`、M-004 |
| 保存先、メモリ / ディスクキャッシュ、壊れたファイルの扱い、アトミック書き込み、ダウンロードのまとめ、プロセス共有、起動時の prune、全部キャッシュ済みならダウンロード 0 回（13 項目） | ➖ | 独自のキャッシュは作らない | M-017 |
| アプリ名の設定で WebView のプロファイルの場所が変わらないようにする（取り消し線の項目） | ➖ | 旧データを引き継がない | M-003 |
| オフライン時の表示 | ✨ | 頭文字を出す（新規） | `ChampionIcon.tsx` |

#### データ生成・データファイル

| 旧版の機能（10 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| `champions.json` の構造（キー、英語名、日本語名、`image_url`、`id`、`lanes`） | ✨ | 新しい形（数値 `id`、`ddragonId`、`slug`、`name`、`nameJa`、`lanes`、`spells`）。`spells` は Cooldowns 用の追加 | `champions.test.ts`、`protocol` の `ChampionDataSchema` |
| 週 1 回の自動更新（PR を作成） | ✅ | `.github/workflows/next-champion-data.yml`（木曜 10:23 UTC）。PR 本文にクールダウンの変更表 | `champion-data/index.test.ts`（"diff"） |
| 日本語名がなければ英語名で代用 | ✨ | 代用しない。`ja_JP` に無ければ生成が失敗する（検証で止める） | `champion-data/index.test.ts`（"transform"） |
| `champion_lane.csv` を生成時にマージ。CSV に無ければ全部 0 | ✅ | `tools/champion-data/champion_lane.csv` | M-015、`champion-data/index.test.ts`（"lane scores (champion_lane.csv)"） |
| Wukong のキーを `wukong` に統一 | ✅ | `slugFor` | M-004、`champion-data/index.test.ts`（"merges by slug: Wukong…"） |
| 2 つの生成器の差異を解消 | ✅ | 生成処理は 1 つ（`pnpm champion-data`） | M-004 |
| レーン適性による対面行への配置 | ✅ | `placeMatchup` | `workspace.test.ts`（"places lane-less allies by lane suitability, ties to the upper row" ほか） |
| `champions.json` をパッケージに同梱し、ビルド前に存在を確認 | ✨ | `core` が import して同梱（無ければビルドが失敗する） | `champions.ts` |

#### 未実装（設計書のみ）として記録されていたもの

| 旧版の項目（4 項目） | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| lockfile による認証情報の取得 | ✨ | 実装した（コマンドラインで取れないときの代替） | `lcu.test.ts` |
| LCU WebSocket（WAMP）によるイベント駆動 | ✨ | 実装した（中心の仕組み） | M-010 |
| Live Client Data API（127.0.0.1:2999） | ✨ | 記録機能と、フラグ ON の試合中のゴールド差・補正（M-025）が使う（`startLiveClientPoller`）。検知（MatchState の自分のピックなど）には使わない | `lcu/src/index.ts`、`recording.ts` |
| Ban 情報の取得 | ➖ | 作らない（旧版も未実装） | legacy README §5.1 D7 |

### 8.4 旧 04: 更新、ログ、配布、CI（04-infra-release-ci.md の §8）

#### 自動更新（旧チェックリストの先頭 21 項目）

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 単一のバージョン値をアプリに埋め込み、Settings に「Current version」として表示 | ✅ | `app.getVersion()`（Settings > Version）。値の出所は git タグ | M-018、`storybook.spec.ts`（"Version says dev in the browser"） |
| git タグを正とするセマンティックバージョニング | ✅ | `app-vX.Y.Z`。`tools/release` が計算 | M-018、`version.test.ts`（"latestAppTag"、"planRelease"） |
| 起動 100ms 後に非同期で最新版を確認（プロンプトなし）。Settings タブを開いたときにも確認 | ✨ | 起動 5 秒後に 1 回（プロンプトなし）。Settings タブを開いても確認しない | M-020、`updater.ts` |
| 確認先は GitHub Releases の `/releases/latest`（5 秒タイムアウト） | ✨ | 固定 Release `app-latest` の `latest.yml`（electron-updater の generic provider） | M-019、M-020 |
| PEP 440 互換の比較、確認成功時は最新でも情報を返す | ✨ | electron-updater の比較 | M-020 |
| 失敗時の文言、最新 / 新しい版の色分け表示 | ✨ | Settings > Version の状態の文（短い理由。色分けは M-008 により対象外） | `update-core.test.ts`（"turns noisy errors into one short sentence"） |
| 新しい版があれば Settings タブに赤い `●` | ✅ | Top bar の点 | `App.tsx` |
| 手動の `Check for Updates`（実行中は無効化） | ✅ | `Check for updates`（確認中は無効） | `storybook.spec.ts`（"Settings > Version…"） |
| 更新プロンプト（バージョン、リリースノート先頭 200 文字、Yes/No）、拒否したら何もしない | ✨ | ダイアログは使わず、Settings 内の `Download` → `Restart and update`。拒否 = 押さない。リリースノートは出さない | M-020、M-008 |
| ダウンロード元は nightly.link（環境変数で Release アセットに切り替え）。ずれのリスク | ➖ | electron-updater の generic provider。nightly.link は使わない | M-020 |
| 進捗ダイアログ（キャンセル不可、MB と %）、ダウンロード失敗のダイアログ | ✨ | Settings の進行バー（`Downloading… n%`）と、失敗時の `error` | `update-core.test.ts` |
| zip から setup exe を展開、失敗時のダイアログ | ➖ | zip 経由ではない | M-020 |
| スクリプト実行時は自動適用せず、手動実行を案内 | ✨ | パッケージされていない実行では確認しない（`unsupported`） | `update-core.test.ts` |
| 「Update Ready」の案内 → `/NORESTART /DIR=` でインストーラ起動 → アプリ終了 → 再起動 | ✨ | `Ready to install. The app restarts.` → `Restart and update` → `quitAndInstall`（サイレント、起動し直す） | `electron-update.spec.ts`、`next-windows.yml`（"In-app update from 0.0.1 to 0.0.2"）。Windows CI で確認済み |
| `/CLOSEAPPLICATIONS` を付けない（Vanguard 対策）、League / Vanguard の実行中チェック（旧版も未実装） | ✅ | `quitAndInstall` で自アプリだけを閉じて入れ替える。League / Vanguard のプロセスは閉じない。実機（Vanguard 稼働中）の確認は §9.1 | `updater.ts`、M-020 |
| 前回のインストール言語を引き継ぐ（UsePreviousLanguage） | ➖ | ワンクリックのインストーラには言語選択が無い | `electron-builder.yml`（`oneClick`）、M-022 |
| 起動失敗時の「Update Failed」ダイアログ | ✨ | Settings の状態 `error`（短い理由） | `update-core.test.ts`（"a failed download goes to error with the version kept; a check recovers"） |
| テスト、ヘッドレス、ダイアログ無効の環境では確認しない | ✅ | `unsupported` | `update-core.test.ts` |

#### ログ、エントリポイント、環境変数

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 標準ロガー（INFO / debug で DEBUG、コンソール、debug は `logs/` に起動ごと新規） | ✨ | コンソールへ常に。ファイルはデバッグモードだけ（§6.4） | `log-core.test.ts` |
| 独自ロガー（`lol_viewer_debug.log` を exe の隣へ、起動ごとに上書き） | ➖ | ログは 1 系統に統一（旧版は 2 系統。B17） | B17、`log.ts` |
| 実行ファイル名に `debug` を含むかでデバッグモード | ✅ | 同じ規則（`--debug`、環境変数も追加） | `log-core.test.ts`（"detects debug mode"） |
| ログのローテーションなし（方針を決める） | ✨ | 最新 10 個を残す | `log-core.test.ts`（"selects only the oldest of our logs beyond keep"） |
| 環境変数: `LOL_VIEWER_DISABLE_*`、`USE_RELEASE_ASSETS`、`ICON_CACHE_DIR`、`PYTEST_CURRENT_TEST`、`QT_QPA_PLATFORM` | ➖ | 対応する仕組みが無い（Qt、nightly.link、アイコンキャッシュ）。代わりに §6.3 の環境変数 | M-017、M-020 |
| Web ビューを使わない代替表示（NullWebView） | ✨ | ブラウザ / Storybook のプレースホルダー | `ExternalViewSlot.tsx` |
| エントリポイント（ロガー → アプリ → ウィンドウ → ループ）、未処理例外のログ | ✅ | `main.ts` | — |
| 終了時に LCU 検出サービスを止める | ✅ | `connector.stop()` | `main.ts` |

#### 永続化とプロセス

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 設定は QSettings（Windows ではレジストリ）、アンインストール後も残す | ✨ | `localStorage`（ユーザーデータ内）。アンインストールでは消さない | M-014、`electron-builder.yml`（`deleteAppDataOnUninstall: false`） |
| アイコンのディスクキャッシュ（アンインストールで削除） | ➖ | キャッシュ自体が無い | M-017 |
| 旧版の保存パスとの互換 | ➖ | 引き継がない | M-003 |
| 多重起動の防止 | ✅ | `requestSingleInstanceLock`（2 つ目は既存ウィンドウを前面に出して終了） | progress.md |
| AppUserModelID、High-DPI の明示、WebEngine フラグ | ➖ | 明示設定はしない（Electron と electron-builder の既定）。要確認として §9.1 | — |

#### ビルドとインストーラ

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| リリースビルド（onedir、windowed、UPX なし、`app_icon.ico`、データとアイコン同梱、VC++ ランタイム不要） | ✨ | electron-builder（NSIS、asar、`app_icon.ico`）。データは `core` に同梱 | `electron-builder.yml` |
| デバッグビルド（onefile、コンソール付き、exe 名 `lol-viewer-debug`） | ✨ | 同じ実行ファイルを `--debug`、環境変数、または名前に `debug` を含めて起動 | `log-core.ts` |
| ビルド前チェック（必須ファイル、`champions.json` の妥当性）、ビルド成果物を消すスクリプト | ✨ | `champions.json` は zod で検証（テストと起動）。型検査とテストが CI で通る | `champions.test.ts`、`next-ci.yml` |
| 新しい AppId を使う（旧版からのアップグレードは考えない） | ✅ | `io.github.kc7891.lolviewer.next` | M-003 |
| インストーラ: 既定はユーザー単位。全ユーザーへの昇格、フォルダ選択、x64 のみ | ✨ | ユーザー単位のみ、昇格なし、フォルダ選択なし、x64 のみ | `electron-builder.yml` のコメント、M-022 |
| インストーラ: 英語と日本語の UI、スタートメニュー、アンインストールのショートカット、任意のデスクトップアイコン（既定オフ） | ✨ | ワンクリックなので言語選択なし。スタートメニューとデスクトップのショートカット（デスクトップは作る） | `electron-builder.yml`、M-022 |
| インストール後に起動（サイレント時も） | ✅ | `runAfterFinish: true` | `electron-builder.yml`、`next-ci.yml`（"Install with the setup exe"） |
| `CloseApplications=no`、`RestartApplications` は使わない（Vanguard 対策） | ✅ | 入れ替えは `quitAndInstall` の 1 つだけ。起動中に入れ直す確認は CI にある。Vanguard 稼働中の実機確認は §9.1 | `next-windows.yml`（"Reinstall while the app is running (update path)"） |
| アンインストール: `{app}` とキャッシュを削除し、設定は残す | ✅ | アプリを削除し、ユーザーデータは残す | `next-ci.yml`（"Uninstall (silent) removes the app"） |
| 出力名 `lol-viewer-setup.exe` を zip に包んで配布（Release アセット、nightly.link 用 artifact） | ➖ | 出力名 `lol-viewer-next-setup-<版>.exe`。zip と nightly.link は使わない | M-018、M-020 |
| インストーラのバージョンをビルド時に上書きし、不一致なら失敗 | ✅ | `extraMetadata.version`。インストーラ名と `latest.yml` の版を照合し、違えば失敗 | `next-windows.yml`（"Build installer"）、`next-release.yml`（"Collect release files"） |

#### 依存関係と CI

| 旧版の機能 | 状態 | 新版での場所 | 根拠 |
|---|---|---|---|
| 直接依存と、ハッシュ固定のロックの 2 層 | ✨ | `package.json` + `pnpm-lock.yaml`（`--frozen-lockfile`） | `next-ci.yml` |
| Qt と WebEngine のバージョンをそろえる | ➖ | Python / Qt 固有 | M-007 |
| セキュリティ上の下限バージョンの考え方（requests、urllib3、pytest） | ✨ | `next/` の npm も Dependabot のセキュリティ更新が対象（通常の更新は手動）。下限の個別指定は無い | `.github/dependabot.yml` |
| CI: PR と main の push でヘッドレスのテスト | ✅ | `next-ci.yml` の linux ジョブ（型検査、Vitest、Storybook の E2E、Electron の E2E） | `next-ci.yml` |
| CI: 依存の脆弱性監査（テストとは別ジョブ、毎週月曜） | ⏳ | `next/` 向けの定期的な監査ジョブは無い（Dependabot のセキュリティ更新だけ） | §9.2 |
| CI: PR ごとの Windows ビルド（スモーク、ビルド、インストーラ、artifact） | ✅ | `next-ci.yml` の windows ジョブ（インストール、E2E、入れ直し、標準ユーザーでの確認、artifact） | `next-ci.yml` |
| リリース: Conventional Commits で bump 種別、手動実行、PR で dry-run、タグがあればスキップ | ✅ | `next-release.yml` の `version` ジョブ、`tools/release`（§7.2） | M-018、`version.test.ts`（"bumpFromMessages"） |
| リリース: バージョンの書き換えと bot コミット → 注釈付きタグ → リリースノート → Release | ✨ | bot コミットは作らない。タグと Release（リリースノートは前の `app-v*` からのコミット一覧） | M-018 |
| リリース: Windows ビルド → 版の照合 → インストーラ zip を Release へ → nightly.link 用 artifact | ✨ | `build`（`next-windows.yml`）→ `publish`: インストーラ、`.blockmap`、`latest.yml` を Release `app-vX.Y.Z`（prerelease）と固定の `app-latest` へ。zip と nightly.link は使わない。ビルドと検証は Windows CI で確認済み、公開ジョブは main で初回実行するまで未確認 | M-018〜M-020 |
| リリース時にチャンピオンデータを取得し直してから同梱 | ➖ | 週次の PR で `champions.json` を更新し、それをリポジトリに置いて使う | `next-champion-data.yml` |
| 週次のチャンピオンデータ自動更新（Data Dragon + CSV → PR、ラベル） | ✅ | `next-champion-data.yml`（PR 本文に変更表） | `champion-data/index.test.ts`（"diff"） |
| `champions.json` の形式（キーは小文字の id など） | ✨ | 新しい形（上記） | `champions.test.ts` |
| Wukong と MonkeyKing の統一、生成処理は 1 つ | ✅ | 同上 | M-004 |
| 公式サイトのスクレイピング経路を残すか捨てるか | ➖ | 捨てた。Data Dragon だけ | M-004、M-015 |
| 週次のロック再生成（`automated/refresh-locks`） | ➖ | 作らない。通常の依存更新は手動（`next/` の全チェックを通して） | `.github/dependabot.yml` のコメント |
| Dependabot（pip は security だけ、actions は週次） | ✅ | `next/` の npm も、セキュリティ更新だけ対象（バージョン更新の PR は 0 件）。actions は共通 | `.github/dependabot.yml` |
| 全 GitHub Action を SHA で固定 | ✅ | `next-ci.yml`、`next-champion-data.yml` とも SHA 固定 | ワークフローのコメント |
| `GITHUB_TOKEN` で作った PR では checks が起動しない（案内） | ✅ | 週次の PR にも同じ制約がある。運用は同じ | `next-champion-data.yml` |
| commit-msg フック（Conventional Commits）とセットアップスクリプト | ✅ | リポジトリ共通のものを使う | progress.md、`.githooks/commit-msg` |
| Feature Flag の運用（定義を一か所に集める、設定に保存する、既定は OFF） | ✅ | `core/settings.ts` の `FEATURE_FLAGS`。運用ルールの文書は未整備 | — |
| README の配布案内（Fast Download、インストール手順） | ⏳ | 新版の配布案内は未整備（リリースと一緒に） | — |
| `.gitignore` の方針 | ✅ | `next/.gitignore`（成果物、テスト結果、記録、スクショ） | `next/.gitignore` |
| 更新確認用の手動スクリプト（quick_test_update 相当） | ✅ | `LOL_VIEWER_UPDATE_URL` で手元のフィードに差し替えられる（`e2e/windows/serve-feed.mjs`、`update-flow.ps1`） | `update-core.test.ts`（"defaults to the app-latest release and lets the environment override it"） |
| テストで利用者の実データに触れないよう分離（conftest 相当） | ➖ | アイコンキャッシュが無いので該当しない。E2E の設定の分離は §9.2 | M-017 |
| §7 のテスト仕様を新しいスタックで書き直す | ✅ | Vitest（core、lcu、hub、desktop のログ、champion-data）、Storybook の E2E、Electron の E2E（偽 LCU） | 本表の「根拠」の各テスト |
| ドキュメントと実装のずれを解消する | ✅ | `docs/spec/` を基準にした | docs/spec/README.md |

### 8.5 集計

§8.1〜§8.4 の表の行を数えた（1 行は旧チェックリストの 1 項目、または同じ扱いの複数項目）。旧チェックリストの項目数（約 400）より行数が少ないのは、見た目の指定やウォッチモードなどをまとめたため。

| 区分 | ✅ 同等 | ✨ 改善・変更 | ➖ 移植しない | ⏳ 未実装 | 計 |
|---|---|---|---|---|---|
| 8.1 旧 01 メインウィンドウ | 50 | 22 | 11 | 0 | 83 |
| 8.2 旧 02 ウィジェットと定数 | 52 | 24 | 18 | 0 | 94 |
| 8.3 旧 03 LCU、検知、データ | 56 | 27 | 17 | 0 | 100 |
| 8.4 旧 04 更新、ログ、配布、CI | 29 | 23 | 13 | 2 | 67 |
| **合計** | **187** | **96** | **59** | **2** | **344** |

### 8.6 ⏳（未実装）の一覧
- **依存の脆弱性監査**（旧: 毎週月曜の `pip-audit` 相当）。`next/` 向けの定期ジョブは無い。Dependabot のセキュリティ更新（npm）だけが代わりになっている。
- **新版の README の配布案内**（Releases からのインストール手順）。

なお、更新は Windows CI（`next-windows.yml` の 0.0.1 → 0.0.2）で確認済み。リリースの公開ジョブだけは main で初回実行するまで未確認（§7.2）。


---

## 9. 実機での確認と、設計との差異

### 9.1 実機でしか確認できないこと
CI（Linux の Xvfb と偽の LCU）では確かめられないもの。Windows 実機で人が確認する。

- **本物の League Client への接続**: プロセスのコマンドラインからのポートとトークンの取得（PowerShell）、https / wss、自己署名証明書、`--install-directory` の lockfile への退避。
- **実際の試合での自動検知**: ホバー、ロック、ドッジ（`gameId` の変化）、ARAM / Mayhem、試合中のチーム補完（自分のチームの判定）、ブラインドピック。
- **u.gg の表示**: 検証環境（データセンターの IP）では Cloudflare に弾かれる。Live Game と ARAM ページの見た目はまだ見ていない。lolalytics は Electron の E2E で実ページまで確認済み。
- **ダウンロード**: ページからのダウンロードには専用の処理が無い。Electron の既定の動作になるはず（旧版は未対応）。
- **Live Client Data API（試合中のゴールド差と補正。M-025〜M-029）**: 本物のゲームの 2999（自己署名の https、Vanguard 環境での接続）、`position` の中身（ランク / ドラフトでは割り当てられたロールのはず。ロールを交換した人は誤る。ブラインド、ARAM、カスタムで `""` になるか）、日本語クライアントの `championName`、ロード画面中の応答（404 か部分的な一覧か）、Smite の内部名、アプリを試合中に起動したときの自分のチームの判定、ミラーで決まらないとき。
- **インストーラと Vanguard**: 起動中にインストーラを実行したときの挙動、League や Vanguard が動いている状態での入れ替え。
- **更新の実機確認**: 本物の GitHub Release（`app-latest`）からの確認、ダウンロード、再起動後の動作。CI は手元のフィードで確認する（§7.3）。
- **AppUserModelID、High-DPI**: 明示的な設定はしていない。タスクバーや通知、高 DPI での表示は未確認。
- 表示、操作の確認は Storybook の全 story のスクリーンショットと E2E で済んでいる。

### 9.2 設計との差異、見つけた不具合・懸念
設計書（[new-app-design.md](./new-app-design.md)）と実装の食い違い、および実装を読んで気づいた点。コードは変えていない。

**対応済み（前の版で挙げ、直ったもの）**: 許可ホスト外の URL を無言で保存できた（M-023 で保存させない）、保存時に開いているビューアが開き直る（M-021 で仕様にした）、Live Game の Refresh が現在のページを再読み込みした（設定した URL を開き直す）、更新の赤い点が未接続だった、Settings > Version に更新の表示が無かった、Feature Flags の画面が無い（旧版も定義が空の間は出さないので同じ挙動）、`next/` の npm が Dependabot の対象外だった（セキュリティ更新だけ対象）、インストーラの変更に決定番号が無かった（M-022）、ホストの誤りでも通知が「empty」と言っていた（`needs fixing` に変更）、E2E が既定のユーザーデータを使っていた（`LOL_VIEWER_USER_DATA_DIR` で一時フォルダに分ける）。

**設計と実装の食い違い**
1. **ペインのヘッダー**: 設計は 2 段（1 段目 Champion / Opponent / クイックピック、2 段目 モード / Lane / 操作）。実装は 3 段（クイックピックと ◀ ▶ ⟳ QR ↗ を 3 段目に移した）。progress.md の「three-row pane header」と同じ。見た目なので M-008 の範囲。
2. **全ビューを隠す条件**: 設計は「アプリ全体のダイアログを開くときは全ビューを隠す」。実装は、ドラッグ中（Sidebar の幅、ペインの幅）と、ページ切り替え、パネルの表示だけで隠す。アプリ全体のダイアログ自体が無い。
3. **切断時の MatchState**: 設計は「`phase = None` にする」。実装はこれに加えて summonerId と puuid も消す。`self` は残るので、切断中も `YOU` と picked ビューアは消えない。
4. **`DetectorState`**: 設計は 4 つのフィールド。実装は `gameflowTeams`（試合中の一覧を作り直すための、直近の gameflow のチーム）を加えた 5 つ。
5. **右クリックメニュー**: 設計は 5 項目。実装の `Copy link address` は、リンクの上で右クリックしたときだけ出る。
6. **更新の確認のタイミング**: 設計は「起動の少しあとに 1 回」。実装は起動の 5 秒後。

**不具合・懸念（実装を読んで）**
7. **Live Game ページではトースト（通知）が出ない**: `Copy URL` の `Copied to clipboard` や、コピー失敗の警告が見えない。Viewers ページでは Sidebar の下部、Settings では右下に出るが、Live Game にはその置き場が無い。
8. **隠したビューアの外部ページは 4 つまで**: 外した（非表示などの）ビューは直近 4 つまで読み込み済みで保持する。5 つ目以降は破棄されるので、再表示するとページを読み込み直し、ページ内の移動は失われる。
9. **非表示のビューアの行をクリックしても何も起きない**: ペインが列に無いので、スクロール先が無い。目のボタンかダブルクリックで先に表示する必要がある。
10. **`uiSize` の未知の値は `medium`**: 旧版は `small`。変更だが、決定番号は無い（既定が `medium` なので自然）。
11. **接続を試みて失敗したときも `disconnected`**: 旧版は「プロセスはあるが未接続」を `connecting` と表示した。新版は、プロセスの有無に関わらず、つなげなければ `disconnected` → 再試行のたびに `connecting`。
12. **新しいチャンピオンの検知**: ID と名前の対応を `champions.json` に持つので、新チャンピオンが出てからデータ更新の PR（毎週木曜）を取り込んでアプリを更新するまでは、その子は一覧に入らない（`known()` で除かれる）。旧版は実行時に Data Dragon から ID を取っていたが、`champions.json` 自体にも同じ制約があった。
13. **依存の監査**: `next/` 向けの定期的な脆弱性監査（旧版の `pip-audit` 相当）が無い。Dependabot のセキュリティ更新だけが頼り。
