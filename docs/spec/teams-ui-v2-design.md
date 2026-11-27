# Teams タブ UI 見直し（v2）と人ごとの好みのファイル保存 設計書

M-038 で入れた Teams タブ（[teams-implementation.md](./teams-implementation.md)）を、持ち主が実際に触った感想をもとに作り直す。

- 状態: 設計（2026-11-27）。実装待ち。
- 決定番号: M-040（§9。decisions.md に追記する）。
- 持ち主の声（2026-11-27）:
  - 手動の設定が「開いて入れて閉じて」の繰り返しで、かなり面倒。
  - 人ごとの好みをファイルに書き出して保存しておきたい。
  - 細かく設定できるのはよいが、全体の使い心地がつらいので UI を見直してほしい。

---

## 1. 今の UI のつらい点（スクショからの分析）

| # | 場所 | つらい点 |
|---|---|---|
| 1 | 人ごとの手動の設定 | 1 人ずつ ⚙ で開き、4 つの欄（固定・得意・NG・ランク上書き）を入れて閉じる。10 人で 10 回。開いている間は一覧が縦に伸びて、他の人が見えなくなる |
| 2 | 行のレーンの表示 | `MID TOP` が「メインとサブ」なのか「得意 2 つ」なのか分からない。自動の推定と手動の設定の区別も付かない |
| 3 | Prefetch | 5 つのタブ（Friends / Recent / Riot IDs / Lobby / Saved）と、4 つのボタン（Fetch stale & new / Fetch all again / Cancel / Clear）が 1 枚に詰まっている。Lobby タブは、ロビーでは自動で取るので要らない。Saved（人の一覧と中身）が Prefetch の中に埋もれている |
| 4 | 提案の切り替え | 見方の切り替え（Rank first / Lanes first）、`Proposal 1 / 3`、◀ ▶、More が並び、何を押すと何が変わるか分かりにくい |
| 5 | 画面の縦の長さ | Discord の文字列の欄が常に出ていて、提案の下で場所を取る |
| 6 | 参加と控え | ↓↑ で 2 つの箱の間を移す。行が動くので、押した後に人を見失う |

---

## 2. 方針
- **1 画面で、全員の好みを一気に入れられる**ようにする。開いて閉じる操作をやめ、行の中で直接変える。
- **「今日の試合」と「人の管理」を分ける**。Teams タブの中を 2 つに分ける: **Match**（チーム分け）と **People**（人の一覧・好み・事前取得・ファイル）。
- **好みはファイルに書き出せて、読み込める**（JSON。人が読んで直せる形）。
- 機能は減らさない（取得・推定・提案の中身は M-038 のまま）。表示と操作だけを変える。

---

## 3. レーンの好みを行の中で直接入れる（つらい点 1・2）

### 3.1 レーンのチップ
各人の行に、5 つのレーンのチップ `TOP JG MID BOT SUP` を常に並べる。**クリックするたびに状態が変わる**:

```
（なし）→ ★ 得意 → 🔒 固定 → ✕ NG → （なし）
```

| 状態 | 見た目 | 意味（M-038 の手動の設定との対応） |
|---|---|---|
| なし | 枠だけ。自動の推定がこのレーンなら、下に細い線と割合（例 `MID 67%`）をツールチップで | 自動の推定に任せる |
| ★ 得意 | 塗り（アクセント色）+ ★ | `mains`。2 つまで。3 つ目を ★ にすると、一番前に ★ にしたものが「なし」に戻る |
| 🔒 固定 | 塗り（金）+ 🔒 | `lock`。1 人 1 つ。別のレーンを 🔒 にすると前の 🔒 は「なし」に戻る |
| ✕ NG | 赤の枠 + ✕ | `ng` |

- 右クリック（とキーボードの Delete / Backspace）で、そのチップを「なし」に戻す。チップはボタンなので Tab で移動、Enter / Space で次の状態。
- ツールチップ: `Click: ★ prefer → 🔒 lock → ✕ avoid → clear. Right-click to clear.`
- 自動の推定（戦績）のメインとサブは、チップの下の細い線で示す（メインは太め）。手動の ★ があればそちらが優先されることは、行の表示で分かる（★ の付いたチップが目立つ）。
- ページの上に小さな凡例を 1 行: `★ prefer · 🔒 lock · ✕ avoid · underline = from match history`。

### 3.2 ランクの上書き
- 行のランクの札（`G2`、`~G3`、`—`）を**クリックすると小さなポップオーバー**が開く: `Auto`（取得した値）、tier のボタン 10 個（I B S G P E D M GM C）、division の I〜IV。選んだらすぐ閉じる。Esc で閉じる。
- 上書き中の札は枠を金色にし、ツールチップに `Manual (fetched: G4)`。
- 未ランクで推定もない人（`—`）の札は、点線の枠で「クリックで入れられる」と分かるようにする。

### 3.3 ⚙ のパネルはやめる
- `PlayerPrefs` の展開パネルは削除する（上の 2 つで全部入る）。
- 「この一覧から外す」（手で足した人）は行の `⋯` メニューに置く。

---

## 4. Teams タブの構成（つらい点 3〜6）

```
┌ Teams ─────────────────────────────────────────────────────────────────┐
│ [Match] [People 23]                     ★ prefer · 🔒 lock · ✕ avoid · _ history │
├────────────────────────────────────────────────────────────────────────┤
```

### 4.1 Match（既定で開く）
```
Custom lobby · 12 people                       Fetching 3 / 10 …
┌ Players 10 ───────────────────────────────┐ ┌ Proposal ─────────────────────────┐
│ ☑ Player1 #tag1   G2   [TOP][JG][MID][BOT][SUP] ⋯│ │ Priority [Rank] [Lanes]    ◀ 1 / 126 ▶ │
│ ☑ Player2 #tag2  ~G3   [TOP][JG][MID][BOT][SUP] ⋯│ │  Blue avg G2        Red avg G2      │
│ ...                                        │ │ TOP Player1 G2   Player8 G1        │
│ ☐ Player11 Spectator D4 [ ...           ] ⋯│ │ ...                                 │
│ ☐ Player12 Spectator S4 [ ...           ] ⋯│ │ Rank diff 5 · lane gap 673 · ⚠ 1 unknown │
│ [+ Add people]                             │ │ [Copy for Discord] [▾ options]       │
└────────────────────────────────────────────┘ └───────────────────────────────────┘
```
- **参加と控えは 1 つの一覧**にし、行頭の**チェックボックス**で切り替える（☑ = 参加）。行は動かない。並びは「チームの枠 → 観戦 → 手で足した人」、その中は名前順。見出しに `Players 10 of 12`。人数が 6・8・10 でないときは見出しの横に `Pick 6, 8 or 10` を黄色で。
- 一覧の下に `+ Add people` → People に保存されている人から選ぶ小さなリスト（検索つき）。ロビーにいないときもこれで人を足す。
- **提案**:
  - `Priority` の切り替え（`Rank` / `Lanes`）。M-038 の 2 つの見方そのもの。名前を「何を優先するか」に変える。
  - `◀ 1 / 126 ▶` で 1 案ずつ。`1` は最良。`More` と「3 件ずつ」はやめる。両方の見方で最良が同じなら `Same as Lanes priority` などと小さく出す（今の「Same top pick in both views」）。
  - 提案の中の 2 人の入れ替え（クリック → クリック）は残す。入れ替えた後は番号の代わりに `Edited` を出し、`Reset` で戻せる。
- **Discord**: `Copy for Discord` ボタンと、横の `▾` で開くメニュー（`Show ranks`、`Show #tag`、`Preview`）。文字列の欄は `Preview` を開いたときだけ出す。コピーに失敗したときは自動で Preview を開いて全選択し「Press Ctrl+C」。

### 4.2 People
人の管理をまとめた 1 枚。今の Prefetch（Friends / Recent / Riot IDs / Saved）を作り直したもの。
```
┌ People ──────────────────────────────────────────────────────────────────────┐
│ [+ Add ▾]  [Fetch missing & old (5)]  [Cancel]   12 / 30 · ~3 min        [⋯]  │
│ Search [        ]   Show: (All) (In lobby) (Old/missing)                       │
│ Name            Rank   Est.   Lanes                       Fetched   │          │
│ Player1 #tag1   G2     —      [TOP][JG][MID][BOT][SUP]    7 h ago   ▸ ⋯      │
│ Player4 #tag4   —      ~G3    [TOP][JG][MID][BOT][SUP]    7 h ago   ▸ ⋯      │
│ ...                                                                            │
└────────────────────────────────────────────────────────────────────────────────┘
```
- **保存されている全員の表**。列: 名前、ランク（ソロ / フレックス。クリックで上書き＝§3.2）、推定、レーンのチップ（§3.1。Match と同じ部品）、取得した日（古い / 使わないは色）、`▸`（詳細を開く）、`⋯`（Refresh / Forget）。並べ替え（名前・ランク・取得日）、検索、絞り込み（全員 / ロビーにいる人 / 古い・未取得）。
- **ここで全員の好みを一気に入れられる**（行を開かずにチップとランクの札を順にクリックするだけ）。
- `▸` で開く詳細は、今の Saved の中身（ランク 3 種、推定の根拠の試合、レーンの割合）。手動の設定の欄は詳細から外す（行で入れるため）。
- `+ Add ▾`: `From a friend group…` / `From recent players…` / `By Riot ID…` の 3 つ。どれも小さなパネル（ページの上に重ねる。外部ビューは Teams に無いので重ねてよい）で選んで `Add & fetch`。足した人は表に入り、取得が始まる。
  - Friend group: グループのドロップダウン + チェックの一覧（今のもの）。`Include me`。
  - Recent: 検索 + チェックの一覧。
  - Riot ID: 複数行の入力 → `Add & fetch`。結果は行ごとに ✓ / エラー。
  - フレンド一覧・最近の人は、このパネルを開いたときだけ読む（M-038 の「操作したときだけ」を守る）。
- `Fetch missing & old (n)`: 表に今出ている人（絞り込み後）のうち、未取得・古い人だけ取る。`⋯` に `Fetch all again`、`Export preferences…`、`Import preferences…`、`Clear all cached data`（2 回押し）。
- ロビーのタブは無くす（ロビーの人は自動で取るため。M-038 §10.1）。

---

## 5. 好みのファイル（書き出し / 読み込み）

### 5.1 形式（`lol-viewer-team-preferences.json`、UTF-8、人が読んで直せる）
```json
{
  "kind": "lol-viewer/team-preferences",
  "version": 1,
  "exportedAt": "2026-11-27T15:30:00Z",
  "players": [
    { "riotId": "Player1#tag1", "puuid": "…", "lock": "jungle", "prefer": ["middle"], "avoid": ["support"], "rank": "GOLD II" },
    { "riotId": "Player4#tag4", "puuid": "…", "prefer": ["middle", "support"] }
  ]
}
```
- レーンは `top` `jungle` `middle` `bottom` `support`。`rank` は `"GOLD II"` / `"MASTER 120"`（LP）/ 省略（自動）。
- 好みが 1 つも無い人は書かない。
- `riotId` は人が見て分かるため。`puuid` は読み込みのときの照合用（無くてもよい）。

### 5.2 書き出し
- People の `⋯` → `Export preferences…` → **保存ダイアログ**（既定の名前 `lol-viewer-team-preferences-YYYYMMDD.json`、場所は前回の場所、無ければ「ドキュメント」）。
- 実装: main の IPC `teams:export-prefs`（中身の文字列は 1MB まで、zod で検査）→ `dialog.showSaveDialog` → `fs.writeFile`。E2E では `LOL_VIEWER_E2E=1` かつ環境変数 `LOL_VIEWER_E2E_SAVE_PATH` があるときだけ、ダイアログを出さずにそのパスに書く。
- 書いたら toast `Saved preferences for 12 people.`

### 5.3 読み込み
- People の `⋯` → `Import preferences…` → ファイル選択（renderer の `<input type="file" accept=".json">`。main の変更は不要）。1MB を超えるファイルは断る。
- 照合: `puuid` が保存されている人と一致 → その人。無ければ `riotId` が保存されている人の名前と一致（大文字小文字は区別しない）→ その人。どちらも無ければ、LCU につながっていれば Riot ID で引いて（M-038 の Riot ID の検索）足す。つながっていなければ「見つからない」に数える。
- 反映: **ファイルにいる人の好みは、ファイルの内容で置き換える**（ファイルにいない人の好みは触らない）。
- 読み込む前に確認を出す（ネイティブの confirm は使わない。People の上に帯で `Import 12 people? 3 will replace current preferences, 1 not found.` `[Import] [Cancel]`）。
- 結果を toast: `Imported preferences for 11 people. 1 not found: Player99#tag9`。
- 壊れたファイル（JSON でない、`kind` が違う、`version` が 1 でない）は読み込まず、理由を出す。個々の人の壊れた項目は、その項目だけ捨てる。

### 5.4 core の関数（`packages/core/src/teams/prefsFile.ts`）
- `exportPrefs(prefs, players, now): string`（整形した JSON。2 スペース）
- `parsePrefsFile(text): { ok: true; entries: PrefsFileEntry[] } | { ok: false; error: "json" | "kind" | "version" | "size" }`
- `matchPrefsEntries(entries, players): { matched: {puuid, pref}[]; unresolved: string[] /* riotId */ }`
- `rankFromLabel("GOLD II") / rankToLabel(points)`（`rankOverride` の点数と相互に変換）

---

## 6. レーンのチップの状態の関数（core、テスト用）
`packages/core/src/teams/lanePrefs.ts`:
- `laneState(pref, lane): "none" | "prefer" | "lock" | "avoid"`
- `cycleLane(pref, lane): TeamPlayerPref`（§3.1 の順。★ は 2 つまで（古い方を外す）、🔒 は 1 つ。同じレーンが ★ と ✕ に同時にならない）
- `clearLane(pref, lane): TeamPlayerPref`
- 好みの中の順番（★ の古い順）を保つため、`mains` は配列の順で古い→新しい。

---

## 7. 変えるファイル（目安）
- `apps/web/src/components/teams/`: `TeamsPage`（Match / People の切り替え）、`MatchView`（新）、`PeopleView`（新。今の `PrefetchPanel` と `SavedList` を置き換える）、`LaneChips`（新）、`RankBadge`（新。ポップオーバーつき）、`AddPeoplePanel`（新）、`ProposalPanel`（§4.1 に合わせて簡単に）、`PlayerRow`（チェックボックス、チップ、札、⋯）。`PlayerPrefs` と、使わなくなった部品は消す。
- `apps/web/src/components/teams/model.ts` とテスト。
- `packages/core/src/teams/lanePrefs.ts`、`prefsFile.ts` とテスト。
- `packages/protocol`: `TeamsApi.exportPrefs(json: string): Promise<{ saved: boolean; path?: string }>`（ブリッジに足す）。
- `apps/desktop`（🔴、最小限）: `teams.ts` に `teams:export-prefs` の IPC（`fromApp`、zod、1MB）。`preload.ts` に 1 行。
- stories（Match / People / Add の各パネル / ランクのポップオーバー / 読み込みの確認の帯 / チップの各状態）と Storybook E2E、Electron E2E（チップで好みを入れる → 提案が変わる → 書き出し → 好みを消す → 読み込み → 元に戻る）。
- スクショは自分で開いて確かめる。

---

## 8. やらないこと
- 取得・推定・提案の計算の中身は変えない（M-038 のまま）。
- 好みの保存場所（renderer の settings）は変えない。ファイルは書き出し / 読み込みのための手段。
- ドラッグ & ドロップ。

---

## 9. 決定: M-040（decisions.md に追記する）

## M-040 Teams の UI の見直しと、好みのファイル（2026-11-27）
- Teams タブを `Match`（チーム分け）と `People`（人の管理）に分ける。Prefetch のパネルと Saved は People に作り直す。ロビーのタブは無くす。
- 手動の設定は ⚙ のパネルをやめ、行の中のレーンのチップ（クリックで ★ 得意 → 🔒 固定 → ✕ NG → なし）とランクの札のポップオーバーで直接入れる。
- 参加 / 控えは 1 つの一覧のチェックボックスにする。提案は `Priority: Rank / Lanes` と `◀ n / N ▶` の 1 案ずつにする。Discord の文字列はプレビューを開いたときだけ出す。
- 人ごとの好みを JSON ファイルに書き出し / 読み込みできる（puuid → Riot ID の順で照合。ファイルにいる人だけ置き換える）。
