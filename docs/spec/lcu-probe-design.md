# LCU の確認（Settings → LCU check）設計書

チーム分け（[team-balancer-design.md](./team-balancer-design.md)）で使う予定の LCU の API が、**本物の League Client で本当に読めるか、どんな形で返るか、どれくらい速いか**を、持ち主が Windows で 1 回押すだけで調べられる確認用の機能。結果は**個人情報を含まない文字列**で、そのまま開発者（AI）に貼って渡せる。

- 状態: **設計済み・実装待ち**（2026-11-27）。
- ゾーン: `packages/lcu`（🔴）と `apps/desktop`（🔴）に手を入れる。**人間のレビューが必要**。書き込み系（POST/PUT/PATCH/DELETE）は足さない。
- 決定番号: M-039（§10。decisions.md に追記する）。

---

## 1. 結論（先に要点）

| 論点 | 方針 |
|---|---|
| 置き場所 | Settings の Debug の下に新しいカード **LCU check**。デスクトップアプリだけ（ブラウザ版・Storybook ではモックの結果） |
| 何をするか | 「Run check」を押すと、§4 の手順で候補の API を**順番に 1 回ずつ GET** する。前の結果（自分の PUUID、フレンドの PUUID、試合の ID）を次の要求に使う |
| 何を出すか | 各要求の **HTTP ステータス、かかった時間、返ってきた JSON の形**（キーの名前と型、配列の長さ）。値は、許可リストにある**個人を特定しない項目**（`queueId`、`tier`、`lane` など）だけ出す |
| 個人情報 | 名前・PUUID・ID などの**文字列の値は一切出さない**（許可リスト方式。§5）。テストで、入力に入れた名前や PUUID が結果に出ないことを確かめる |
| 渡し方 | 結果をテキスト欄に出し、「Copy report」でクリップボードへ。持ち主がチャットに貼る |
| レート制限 | 既定では計 30 回程度の GET（1 秒 5 回まで）。**「Rate test」にチェックしたときだけ**、同じ軽い要求を 40 回（順番に 20 回、同時 4 本で 20 回）投げて、429 が出るか・応答時間を測る |
| 安全 | GET だけ。パスは**固定のテンプレートの一覧**からしか作れない（`packages/lcu` が強制）。パラメータは正規表現で検査してから URL エンコードする |

---

## 2. やること / やらないこと

### 2.1 やること
- `packages/lcu`: 確認用の GET（テンプレートの一覧、パラメータの検査、ステータスと時間を返す）。
- `packages/core`: 手順の実行（`runLcuProbe`）、JSON の形の要約（`shapeOf`）、レポートの文字列化（`formatProbeReport`）。純粋な関数にしてテストする。
- `packages/protocol`: 入力と結果のスキーマ、ブリッジの型。
- `apps/desktop`: IPC `lcu:probe`（自分のウィンドウからだけ、入力は zod で検査）、preload に `lcu.probe`。
- `apps/web`: Settings の LCU check のカード、story。
- `tools/fake-lcu`: クエリ文字列つきの GET に答えられるようにする（§7）。
- テスト: core の単体テスト、lcu の単体テスト、Electron の E2E（fake-lcu で実行してレポートが出る・個人情報が出ない）。

### 2.2 やらないこと
- チーム分けの本体（Teams タブ、キャッシュ、事前取得）。この確認の結果を見てから作る。
- 結果をファイルに保存すること、外部に送ること。
- 書き込み系の API。

---

## 3. packages/lcu の変更（🔴）

### 3.1 確認用のルート（テンプレート）の一覧
`READ_ONLY_PATHS`（購読と resync に使う固定のパス）は**変えない**。別に、確認用の GET だけに使う一覧を足す。

```ts
/** GET-only routes the Settings "LCU check" may read (M-039). Never subscribed, never resynced. */
export const PROBE_ROUTES = {
  currentSummoner:      { path: "/lol-summoner/v1/current-summoner" },
  lobby:                { path: "/lol-lobby/v2/lobby" },
  friendGroups:         { path: "/lol-chat/v1/friend-groups" },
  friendGroupFriends:   { path: "/lol-chat/v1/friend-groups/{id}/friends", params: { id: "int" } },
  friends:              { path: "/lol-chat/v1/friends" },
  rankedStats:          { path: "/lol-ranked/v1/ranked-stats/{puuid}", params: { puuid: "puuid" } },
  rankedStatsBatch:     { path: "/lol-ranked/v1/ranked-stats", query: { puuids: "puuidList" } },
  matches:              { path: "/lol-match-history/v1/products/lol/{puuid}/matches", params: { puuid: "puuid" }, query: { begIndex: "int", endIndex: "int" } },
  game:                 { path: "/lol-match-history/v1/games/{gameId}", params: { gameId: "int" } },
  recentlyPlayed:       { path: "/lol-match-history/v1/recently-played-summoners" },
  summonerByName:       { path: "/lol-summoner/v1/summoners", query: { name: "riotId" } },
  summonerByPuuid:      { path: "/lol-summoner/v2/summoners/puuid/{puuid}", params: { puuid: "puuid" } },
  summonerByPuuidCached:{ path: "/lol-summoner/v1/summoners-by-puuid-cached/{puuid}", params: { puuid: "puuid" } },
} as const;
export type ProbeRouteId = keyof typeof PROBE_ROUTES;
```

パラメータの検査（合わなければ例外。要求は投げない）:
| 種類 | 正規表現 / 規則 |
|---|---|
| `int` | `/^\d{1,19}$/`（文字列か、0 以上の安全な整数） |
| `puuid` | `/^[A-Za-z0-9_-]{1,100}$/`（PUUID は 78 文字の英数字と `-` `_`。fake の `player-self` も通る） |
| `puuidList` | `puuid` の配列、1〜50 件 |
| `riotId` | `名前#タグ`。名前 1〜32 文字、タグ 1〜8 文字、`#` はちょうど 1 つ、制御文字なし |

### 3.2 パスの組み立て
```ts
/** Build the request path for a probe route. Throws on an unknown route or an invalid parameter. */
export function buildProbePath(id: ProbeRouteId, args?: { params?: Record<string, string | number>; query?: Record<string, ProbeQueryValue> }): string
```
- `{name}` は `encodeURIComponent` で埋める。
- クエリは `URLSearchParams` で作る。`puuidList` の渡し方は LCU の仕様が不明なので、**3 通りを選べる**ようにする（§4 の手順で全部試す）:
  - `json`: `puuids=["a","b"]`（JSON の配列を 1 つの値として）
  - `comma`: `puuids=a,b`
  - `repeat`: `puuids=a&puuids=b`
  - 引数は `query: { puuids: { list: string[], style: "json" | "comma" | "repeat" } }`。
- `riotId` はそのまま 1 つの値（`name=名前#タグ` → エンコードされて `%23`）。

### 3.3 要求
`LcuClient` にメソッドを足す:
```ts
export type ProbeResponse = { status: number; ms: number; body: unknown | null; error?: "timeout" | "network" | "bad-json" };
/** GET a probe path (built by buildProbePath). Unlike get(), reports the status and time, and waits up to 10 s. */
probe(path: string): Promise<ProbeResponse>
```
- **`path` が `buildProbePath` で作れる形か、もう一度検査する**（テンプレートを正規表現にして照合。どれにも合わなければ reject）。
- メソッドは GET 固定。既存の `get()` と同じく TLS の緩和はこの要求だけ。
- タイムアウトは 10 秒（Riot のサーバーへの中継があるため。既存の `get()` の 2 秒は変えない）。
- `status` は HTTP ステータス（ネットワークエラーとタイムアウトは 0 と `error`）。`body` は JSON として読めたときだけ。応答の本文が 5 MB を超えたら読むのをやめて `error: "bad-json"`（試合の一覧が大きい場合の保険）。
- 認証トークンは結果にもログにも出さない（既存の規則どおり）。

`LcuConnector` に足す:
```ts
/** While connected: GET one probe path. Not connected → { status: 0, ms: 0, body: null, error: "network" }. */
probe: (path: string) => Promise<ProbeResponse>;
```

### 3.4 テスト（`lcu.test.ts`）
- `buildProbePath`: 各ルート、パラメータのエンコード、3 つのリストの形、不正な値（`../`、`#` が 2 つ、空、51 件）で例外。
- `probe` に `READ_ONLY_PATHS` にも `PROBE_ROUTES` にも無いパスを渡すと reject。
- 既存の「書き込みの API が無い」系のテストがあれば、それも通ること。

---

## 4. 手順（`packages/core/src/lcu-probe.ts`）

```ts
export type ProbeGet = (path: string) => Promise<ProbeResponse>;
export type ProbeOptions = { riotId?: string; rateTest?: boolean; now?: () => number; sleep?: (ms: number) => Promise<void> };
export async function runLcuProbe(get: ProbeGet, build: typeof buildProbePath, opts: ProbeOptions, onProgress?: (done: number, total: number) => void): Promise<ProbeReport>
```
（core は `@lol-viewer/lcu` に依存しないので、`buildProbePath` は引数で受け取る。型は protocol に置く。）

要求と要求の間は最低 200ms 空ける（1 秒 5 回まで）。どれかが失敗しても、続きの手順は進める（必要な値が無ければその手順は `skipped` と理由）。

| # | 名前 | 要求 | 結果から拾うもの・記録すること |
|---|---|---|---|
| 1 | current-summoner | `currentSummoner` | 自分の `puuid`、`gameName`、`tagLine`（**レポートには出さない**。後の手順の入力にだけ使う） |
| 2 | lobby | `lobby` | 404 なら「ロビーにいない」と書く。あれば `gameConfig.isCustom`、`customTeam100` / `customTeam200` / `customSpectators` の長さと、要素のキー。`members` の長さとキー |
| 3 | friend-groups | `friendGroups` | 件数、要素のキー。フレンドが 1 人以上いそうな最初のグループの `id` |
| 4 | friend-group-friends | `friendGroupFriends`（3 の id） | 件数、要素のキー |
| 5 | friends | `friends` | 件数、最初の要素のキー。`puuid` / `gameName` / `gameTag` / `groupId` / `groupName` / `displayGroupId` があるか（あり / なし で出す）。PUUID を持つフレンドを最大 19 人ぶん拾う |
| 6 | ranked-stats (self) | `rankedStats`（自分） | 形。`queueMap` のキーの一覧、`queueMap.RANKED_SOLO_5x5` の形（`tier` などは値を出してよい。§5） |
| 7 | ranked-stats (friend) | `rankedStats`（フレンド 1 人目） | 他人のランクが取れるか |
| 8 | ranked-stats batch ×3 | `rankedStatsBatch`、自分＋フレンド 1 人、`json` / `comma` / `repeat` の 3 通り | どの形で通るか。返ってきた件数 |
| 9 | ranked-stats batch size | 8 で通った形で、1 / 5 / 10 / 20 人 | 何人まで通るか（人数が足りなければ有るだけ）。8 が全部失敗なら skipped |
| 10 | matches (self, 0-20) | `matches`（自分、begIndex 0、endIndex 20） | `games.games` の長さ、`games.gameCount` などの数、1 試合目のキー、`participants[0]` のキー、`participants[0].timeline` の `lane` / `role` の値、`queueId` の値の分布（`queueId: 420 ×8, 430 ×3 …`）、`gameCreation` の最古と最新の差（日数） |
| 11 | matches (self, 0-100) | `matches`（自分、0〜100） | 何件返るか（上限の確認） |
| 12 | matches (self, 20-40) | `matches`（自分、20〜40） | 遡れるか |
| 13 | matches (friend) | `matches`（フレンド 1 人目、0〜20） | 他人の戦績が取れるか、件数 |
| 14 | game (detail) | `game`（10 の最初の試合。ノーマル（queueId 400 / 430 / 480 / 490）があればそれ） | `participants` と `participantIdentities` の長さ、`participantIdentities[0].player` のキー（`puuid` があるか）、`participants[0].timeline` の lane / role |
| 15 | game (friend's) | `game`（13 の最初の試合） | 他人の試合の詳細が取れるか |
| 16 | summoners?name (self) | `summonerByName`、自分の `名前#タグ` | Riot ID で引けるか。返ってきた `puuid` が自分のものと**一致するか**（一致 / 不一致 / なし だけを出す） |
| 17 | summoners?name (input) | `summonerByName`、入力欄の Riot ID（入力があるときだけ） | 引けるか、`puuid` があるか |
| 18 | summoner by puuid | `summonerByPuuid`（フレンド 1 人目） | 形 |
| 19 | summoner by puuid (cached) | `summonerByPuuidCached`（フレンド 1 人目） | 形 |
| 20 | recently-played | `recentlyPlayed` | 件数、要素のキー |
| 21 | rate test（任意） | `rankedStats`（自分）を順番に 20 回、続けて同時 4 本で 20 回。この間は 200ms の間隔を空けない | 各回のステータスの集計（`200 ×40`、`429 ×n`）、応答時間の最小・中央値・最大、429 の応答にあった `Retry-After` の有無 |

`ProbeReport`:
```ts
type ProbeStep = { n: number; name: string; route: ProbeRouteId; status: number | "skipped"; ms: number; note?: string; shape?: string; facts?: Record<string, string | number | boolean> };
type ProbeReport = { startedAt: string; appVersion: string; platform: string; steps: ProbeStep[]; rate?: { ... } };
```
- `note` は skipped の理由や「ロビーにいない」など、固定の文言だけ（値を混ぜない）。
- `facts` は手順の表の「記録すること」（件数、あり/なし、許可された値）。

---

## 5. 形の要約と個人情報（`shapeOf`）

```ts
/** Describe a JSON value's structure without its personal values. */
export function shapeOf(value: unknown, opts?: { depth?: number; maxKeys?: number }): string
```
- 出力の例: `{puuid:str(78), gameName:str, tagLine:str, summonerLevel:num, queueMap:{RANKED_SOLO_5x5:{tier:"GOLD", division:"II", leaguePoints:num, …}}, games:{games:[20]{gameId:num, queueId:420, …}}}`
- 規則:
  - オブジェクト: `{キー:形, …}`。キーの名前は出す（キーの名前は API の形であって個人情報ではない）。ただし **`queueMap` のようなマップのキーが PUUID になる場合**（`ranked-stats?puuids=` の結果）に備え、キーが `/^[A-Za-z0-9_-]{30,}$/` か UUID の形なら `<id>` に置き換える。
  - 配列: `[長さ]最初の要素の形`。
  - 文字列: `str(長さ)`。**値は出さない**。ただし下の許可リストのキーの値で、`/^[A-Z0-9_]{1,24}$/i` に合うものだけ `"値"` を出す。
  - 数値: `num`。許可リストのキーだけ値を出す。
  - 真偽値: 値を出す（`true` / `false`）。null は `null`。
  - 深さの既定 4、1 つのオブジェクトのキーは 40 まで（超えたら `…+n`）。1 手順の形は 4000 文字まで。
- 値を出してよいキー（完全一致、大文字小文字を区別しない）:
  `queueId, queueType, tier, division, lane, role, position, teamId, gameMode, gameType, mapId, isCustom, type, spell1Id, spell2Id, highestTier, previousSeasonEndTier, previousSeasonHighestTier, ratedTier, httpStatus, errorCode, gameVersion, platformId, isMetaGroup, priority, collapsed, availability`
  - `gameVersion`・`platformId` は地域とパッチの確認用。`message` は出さない（エラーの文言に名前が入ることがあるため）。
- `facts` に入れる値も同じ規則（件数・真偽・許可リストの値・日数だけ）。
- テスト: 入力の JSON の全ての文字列（例 `SecretName0`、`secret-puuid-0`、`JP1`、`Alice#JP1`）が `formatProbeReport` の出力に**現れない**ことを、fixture で確かめる。packages/recorder の `findUnmaskedPii` は使わない（形式が違う）。

---

## 6. レポートの文字列（`formatProbeReport`）

```
LoL Viewer LCU check · app 0.35.0 · win32 · 2026-11-27T12:34:56Z
 1 current-summoner        200   38ms  {accountId:num, gameName:str(6), puuid:str(78), …}
 2 lobby                   404   12ms  not in a lobby
 5 friends                 200  140ms  [42]{puuid:str(78), gameName:str(5), gameTag:str(3), groupId:num, …}
                                       puuid=yes gameName=yes gameTag=yes groupId=yes groupName=yes displayGroupId=no
 8 ranked-stats batch json 200  210ms  returned=2
 8 ranked-stats batch comma 400  20ms
 ...
21 rate test               200 ×40 · 429 ×0 · ms min 30 / median 85 / max 410 · retry-after: no
```
- 先頭に 1 行の見出し、手順ごとに 1〜2 行。全体は Discord やチャットに貼れるよう**コードブロック（```）で囲んで**コピーする。
- 全体の上限 30,000 文字（超えたら各手順の形を短くする）。

---

## 7. fake-lcu（`tools/fake-lcu`、🟡）
- 今は GET のパス（`?` より前）だけで `current` を引いている。これを「**パス＋クエリ**の完全一致 → パスだけの一致」の順に引くようにする（シナリオの `uri` にクエリを書けば、そのクエリのときだけ返る）。
- E2E 用の合成シナリオ `scenarios/lcu-probe.jsonl`（合成データだけ。`pnpm test` の個人情報の検査が通ること）: current-summoner、friend-groups、friend-group の friends、friends（2 人）、ranked-stats（自分・フレンド）、ranked-stats の batch（`json` の形だけ 200）、matches（自分、3 試合）、game の詳細 1 つ、recently-played。lobby は無し（404 になる）。
  - 合成の PUUID・名前は、個人情報の検査を通る形（既存のシナリオの `player-<n>` / `tag-<n>` などに合わせる）にする。

---

## 8. 画面（`apps/web`、🟢）
Settings の Debug カードの下に `LcuCheckCard`（`aria-label="LCU check"`）。

```
LCU check
 Reads the League Client APIs planned for the Teams feature, once each, and shows what came back.
 Names and IDs are never shown. Copy the report and paste it to the developer.
 Riot ID to look up (optional) [ name#tag        ]   ☐ Rate test (40 extra requests)
 [Run check]   12 / 20 …
 ┌──────────────────────────────────────────────┐
 │ (report, monospace, read-only, scrollable)   │
 └──────────────────────────────────────────────┘
 [Copy report]  Copied.
```
- `bridge.lcu?.probe` が無い（ブラウザ版）ときは「Only available in the desktop app.」
- 接続していないときは Run を無効にし、「Connect to the League Client first.」
- 実行中は Run を無効にし、進み具合 `n / total` を出す（main から `lcu:probe-progress` を送る）。
- Riot ID の入力は §3.1 の `riotId` の規則で検査し、合わなければ赤く示して Run を無効にする（空なら可）。
- Copy は `navigator.clipboard.writeText`。失敗したらテキスト欄を全選択して「Press Ctrl+C」。
- 文言は英語（既存の Settings に合わせる）。
- story: 未実行 / 実行中 / 結果あり / ブラウザ版。Storybook の E2E のスクショも更新する。

---

## 9. 配線（protocol / desktop / preload）
- protocol:
  - `LcuProbeOptionsSchema = z.object({ riotId: z.string().max(48).optional(), rateTest: z.boolean().default(false) })`
  - `LcuProbeReport` の型（§4）と、`ProbeResponse` の型（lcu と core の両方が使うので protocol に置く）。
  - `LcuControlApi` に `probe?(opts): Promise<{ text: string; report: LcuProbeReport }>` と `onProbeProgress?(cb): () => void` を足す（モックやハブでは省略可）。
- desktop（🔴、最小限）: `ipcMain.handle("lcu:probe", …)` — `fromApp` を確かめ、`LcuProbeOptionsSchema.safeParse`、同時に 1 つしか走らせない（走っている間の 2 回目は同じ Promise を返す）。`runLcuProbe(connector.probe, buildProbePath, { ...opts, appVersion })` の結果を `formatProbeReport` して返す。進み具合は `win.webContents.send("lcu:probe-progress", { done, total })`。ログには「LCU check started / finished (n steps)」だけ書く（結果の中身は書かない）。
- preload: `lcu.probe`、`lcu.onProbeProgress` を足す。
- mock bridge（`apps/web/src/bridge/mock.ts`）: 固定の合成レポートを 1 秒後に返す `probe` を足す（Storybook と web:dev 用）。

---

## 10. 決定: M-039（decisions.md に追記する）

## M-039 LCU の確認（Settings → LCU check、2026-11-27）
- チーム分けの実装の前に、使う予定の LCU の API が本物のクライアントで読めるかを調べる確認用のカードを Settings に置く。押したときだけ、決まった手順で GET を順番に投げ、ステータス・時間・JSON の形をレポートにする。
- `packages/lcu` に確認用の GET だけのルートの一覧（`PROBE_ROUTES`）を足す。購読と resync の `READ_ONLY_PATHS` は変えない。書き込み系は足さない。パスはテンプレートとパラメータの検査からしか作れない。
- レポートには個人を特定する値（名前、PUUID、ID）を出さない。値を出すのは許可リストのキー（キュー、ランク、レーンなど）だけ。
- レート制限の測定（40 回の追加の要求）は、ユーザーがチェックしたときだけ行う。

---

## 11. 完了の定義
`next/CLAUDE.md` のとおり:
```bash
cd next
pnpm typecheck && pnpm test && pnpm storybook:build && pnpm e2e:storybook
pnpm desktop:build && xvfb-run -a pnpm e2e:electron
```
- E2E（`e2e/electron-lcu-probe.spec.ts`、新規）: fake-lcu を `scenarios/lcu-probe.jsonl` で起動 → Settings → LCU check → Run → レポートに `current-summoner` の `200`、`lobby` の `404`、`friends` の件数が出る。レポートにシナリオの名前・PUUID の文字列が出ない。`fake.rejectedWrites` が空。
- 実機での確認は持ち主が行う（このカードの目的そのもの）。
