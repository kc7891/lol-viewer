# Teams タブ 実装設計（第 1 段階）

[team-balancer-design.md](./team-balancer-design.md)（企画と持ち主の判断。以下「企画書」）を実装するための設計。**何を作るか・なぜかは企画書、どう作るかはこの文書**。実機の LCU の形は企画書 §3.12 と [lcu-probe-design.md](./lcu-probe-design.md) の結果に基づく。

- 状態: **実装済み**（2026-11-27。実装 A: ロジック層、実装 B: つなぎと画面。§10）。実機の League Client では未確認（[new-app-spec.md](./new-app-spec.md) §9.1）。
- 決定: M-038（企画書 §11 の原案を decisions.md に確定させる。実装 A で追記）。

---

## 1. 全体の流れ

```
LCU ──(WAMP: /lol-lobby/v2/lobby)──▶ main: TeamsController ──IPC "teams:state"──▶ renderer: Teams ページ
     ◀─(GET: connector.probe(buildProbePath(...)))── TeamFetcher(core)        ◀─IPC "teams:*" 操作──
                                         │
                                         └─ team-cache.json（userData。読み書きは main だけ）
renderer: 手動の設定（レーン固定など）は settings（localStorage）の teamPlayers
renderer: 参加 / 控えの振り分け・提案の計算（core.balanceTeams）・Discord 文字列（core.formatForDiscord）
```

- **ロビーは MatchState に入れない**（MatchState は Hub の WebSocket で外にも出るため、PUUID を載せない）。main が LCU の生イベントからロビーだけ拾い、Teams 用の IPC で renderer に送る。
- 取得の手順・速さの調整・キャッシュの形と古さの判定は **core の純粋な関数とクラス**（I/O は注入）。main はファイルと LCU と IPC をつなぐだけ。
- 機能は Feature Flag **`teamBalancer`**（既定オフ）。オフのとき: Teams タブを出さない、main は取得もファイルの読み書きもしない（ロビーの購読イベントは捨てる）。

---

## 2. LCU（`packages/lcu`、🔴、最小限）

- `READ_ONLY_PATHS` に `"/lol-lobby/v2/lobby"` を足す（購読と resync / snapshot に入る。GET だけ）。`toLcuEvent` は未知の uri に null を返すので Hub には影響しない。録画（recorder）にも入るが、`puuid` などは既存の伏せ方で伏せられる。録画のテストで確かめる。
- 取得は**既存の `connector.probe(path)` と `buildProbePath` をそのまま使う**（GET だけ・テンプレートの検査つき。M-039）。使うルート: `rankedStats`、`matches`、`game`、`friends`、`friendGroups`、`summonerByName`、`summonerByPuuid`、`recentlyPlayed`。新しいルートは足さない。`probe` の doc コメントに「Teams（M-038）も使う」と書き足す。
- `probe` のタイムアウト 10 秒、応答 5MB 上限はそのまま。

---

## 3. protocol（`packages/protocol`、🟡）

```ts
// レーンは既存の LaneSchema（"top" | "jungle" | "middle" | "bottom" | "support"）をそのまま使う。以下の TeamLaneSchema は LaneSchema のこと
export const RankEntrySchema = z.object({ tier: z.string(), division: z.string(), lp: z.number().int(), points: z.number() });
export const PlayerRankSchema = z.object({
  solo: RankEntrySchema.nullable(), flex: RankEntrySchema.nullable(), prevSeason: RankEntrySchema.nullable(), fetchedAt: z.number(),
});
export const LaneProfileSchema = z.object({
  counts: z.record(LaneSchema, z.number().int().nonnegative()), // 数えた試合のレーン別回数
  games: z.number().int().nonnegative(), fetchedAt: z.number(),
});
export const RankEstimateSchema = z.object({
  points: z.number().nullable(),          // null = データ少
  samples: z.number().int(), games: z.number().int(),
  min: z.number().nullable(), max: z.number().nullable(),
  perGame: z.array(z.object({ at: z.number(), queueId: z.number().int(), median: z.number().nullable(), samples: z.number().int() })),
  fetchedAt: z.number(),
});
export const TeamPlayerSchema = z.object({
  puuid: z.string(), gameName: z.string(), tagLine: z.string(), nameSeenAt: z.number(),
  previousNames: z.array(z.string()).default([]),     // "名前#タグ"、最大 3
  addedBy: z.enum(["lobby", "friend", "riotId", "recent"]).optional(),
  rank: PlayerRankSchema.nullable(), lanes: LaneProfileSchema.nullable(), estimate: RankEstimateSchema.nullable(),
  error: z.string().nullable().default(null),         // 直近の失敗（固定の文言）
});
export const CustomLobbySchema = z.object({
  team100: z.array(z.string()), team200: z.array(z.string()), spectators: z.array(z.string()), // PUUID（ボットは除外済み）
});
export const PrefetchStatusSchema = z.object({
  running: z.boolean(), done: z.number().int(), total: z.number().int(), current: z.string().nullable(), // current は PUUID
  failed: z.number().int(), pausedUntil: z.number().nullable(),
  rate: z.object({ requests: z.number().int(), throttled: z.number().int(), avgMs: z.number(), perSec: z.number() }),
});
export const TeamsStateSchema = z.object({
  enabled: z.boolean(),
  lobby: CustomLobbySchema.nullable(),           // カスタムロビーにいないとき null
  players: z.record(z.string(), TeamPlayerSchema), // キャッシュにいる全員（試合・共演者のランクは含めない）
  fetching: z.array(z.string()),                 // 取得中の PUUID
  prefetch: PrefetchStatusSchema,
});
export const FriendEntrySchema = z.object({ puuid: z.string(), gameName: z.string(), tagLine: z.string(), groupId: z.number().int(), groupName: z.string() });
export const FriendGroupSchema = z.object({ id: z.number().int(), name: z.string() });
export const RecentPlayerSchema = z.object({ puuid: z.string(), gameName: z.string(), tagLine: z.string(), lastPlayedAt: z.number() });
export const RiotIdResultSchema = z.object({ input: z.string(), puuid: z.string().nullable(), error: z.enum(["format", "not-found", "failed"]).nullable() });

export interface TeamsApi {
  getState(): Promise<TeamsState>;
  onState(cb: (s: TeamsState) => void): () => void;
  setEnabled(enabled: boolean): void;                       // フラグ（renderer の settings から）
  friends(): Promise<{ groups: FriendGroup[]; friends: FriendEntry[]; self: { puuid: string; gameName: string; tagLine: string } | null }>;
  recentPlayers(): Promise<RecentPlayer[]>;                 // 重複を除き新しい順
  resolveRiotIds(lines: string[]): Promise<RiotIdResult[]>; // 最大 30 行。引けた人は players に addedBy "riotId" で入る
  prefetch(req: { puuids: string[]; mode: "stale" | "all"; addedBy?: "friend" | "recent" | "lobby" }): void; // 最大 60 人
  cancelPrefetch(): void;
  refresh(puuid: string): void;                             // この人を取り直す（推定も）
  forget(puuid: string): void;
  clearCache(): void;
}
```
- `LolViewerBridge` に `readonly teams?: TeamsApi`（デスクトップのみ）。
- main は IPC の入力を zod で検査する（PUUID は `PROBE_PUUID_RE`、配列の長さの上限）。

---

## 4. core（`packages/core/src/teams/`、🟢）

### 4.1 `rank.ts`
- `TIER_BASE = { IRON:0, BRONZE:400, SILVER:800, GOLD:1200, PLATINUM:1600, EMERALD:2000, DIAMOND:2400 }`、`MASTER/GRANDMASTER/CHALLENGER` は `2800 + LP`。division `IV`=0、`III`=100、`II`=200、`I`=300。`points = base + div + min(LP, 100)`（Master 以上は LP そのまま）。
- `parseRankedStats(body): Omit<PlayerRank,"fetchedAt">`: `queueMap.RANKED_SOLO_5x5` / `RANKED_FLEX_SR`。`tier` が空・`"NONE"`・`division` が `"NA"`・`isProvisional` は「なし」。前シーズンは solo の `previousSeasonEndTier` / `previousSeasonEndDivision`（空・`NONE` ならなし）。
- `effectiveRank(player, prefs, now)`: 優先順は 手動の上書き → solo → flex → 推定（`points` が null でなく、古さが「使う」範囲）→ 前シーズン → null。戻り値に `source: "manual"|"solo"|"flex"|"estimate"|"prev"`。
- `rankLabel(points, source)`: `G2` / `G2 (Flex)` / `~G3`（推定）/ `G1 (prev)`、Master 以上は `M 120LP`。tier の頭文字: I B S G P E D M GM C。

### 4.2 `lanes.ts`
- `COUNTED_QUEUES = [400, 420, 430, 440, 480, 490]`、`NORMAL_QUEUES = [400, 430, 480, 490]`。
- `laneOf({ lane, role, spell1Id, spell2Id })`: `role` が `SUPPORT`/`DUO_SUPPORT` → support。`lane` `TOP`→top、`JUNGLE`→jungle、`MIDDLE`/`MID`→middle、`BOTTOM`→bottom。どれでもなく spell に `11`（スマイト）→ jungle。それ以外 null（数えない）。
- `laneProfileFromGames(games, now)`: `COUNTED_QUEUES` かつ 60 日以内の試合のレーンを数える。
- `mainLanes(profile)`: 割合の高い順。1 位を main、2 位が 20% 以上なら sub。試合 5 未満は `thin: true`。

### 4.3 `cache.ts`（ファイルの形と古さ）
```ts
type TeamCacheFile = {
  version: 1;
  players: Record<string, TeamPlayer>;
  playerGames: Record<string, { gameId: number; at: number; queueId: number; lane: Lane | null }[]>; // 戦績の一覧から（本人分）。gameId で重複除去、最大 100
  games: Record<string, { at: number; queueId: number; participants: { puuid: string; teamId: number }[] }>; // 試合の詳細から
  coRanks: Record<string, { points: number | null; fetchedAt: number }>; // 一緒にいた人のランク（null = 未ランク）
};
```
- `parseCacheFile(unknown)`: 壊れた項目だけ捨てる。全体が読めなければ空。
- 定数 `FRESH_MS = 3d`、`STALE_MS = 14d`、`EXPIRE_MS = 30d`、`GAME_WINDOW_MS = 60d`。
- `freshness(fetchedAt, now)`: `"fresh" | "stale" | "unused" | "expired"`（3 / 14 / 30 日）。
- `pruneCache(file, now)`: 30 日を超えた players（の各データ）、coRanks、60 日を超えた games / playerGames を消す。起動時と保存前に呼ぶ。

### 4.4 `estimate.ts`
- `estimateRank(targetPuuid, file, now)`（純粋）: playerGames から `NORMAL_QUEUES`・60 日以内を新しい順に最大 10 試合。各試合の `games[gameId].participants` から本人以外 9 人の `coRanks.points`（null は飛ばす）。**40 人で打ち切り**。中央値。15 人未満なら `points: null`。`perGame` に試合ごとの中央値と人数。
- 取得の手順（§4.6 の fetcher が使う）: 「どの試合の詳細が足りないか」「どの PUUID のランクが足りない（または 3 日より古い）か」を返す `missingForEstimate(target, file, now)`。

### 4.5 `rateLimiter.ts`
- トークンバケット。`perSec` 初期 5、最小 1、最大 20。同時実行 2（`concurrency` 引数）。
- 成功 20 回ごとに平均応答 < 500ms なら `perSec += 1`。応答 > 1000ms か 429 / 503 で `perSec = max(1, perSec/2)`。
- 429 / 503: `retryAfter` があれば 5 秒、無ければ 2 秒から倍々（上限 60 秒）待って同じ要求を最大 3 回。**3 回続けて 429 なら 60 秒止める**（`pausedUntil`）。
- 統計: requests、throttled、平均 ms、今の perSec。`now` と `sleep` は注入。

### 4.6 `fetcher.ts`（`TeamFetcher`）
```ts
new TeamFetcher({ get: (path) => Promise<ProbeResponse>, build: typeof buildProbePath, now, sleep, file: TeamCacheFile,
                  onChange: (file, status) => void /* 保存と通知。main が 1 秒間隔でまとめて保存 */ })
fetcher.ensure(puuids, { priority: "lobby" | "prefetch", mode: "stale" | "all" })
fetcher.cancelPrefetch(); fetcher.refresh(puuid); fetcher.status()
```
- 優先度つきのキュー: `lobby-light`（ランク + 戦績の一覧 + 名前）> `lobby-estimate` > `prefetch`（1 人ずつ light → estimate）。同じ PUUID はキューで 1 つにまとめる。
- light: `summonerByPuuid`（名前。`gameName`/`tagLine` が変わっていたら `previousNames` に古い方）→ `rankedStats` → `matches`（`playerGames` に追記、`lanes` を作り直す）。
- estimate: 本人の `rank.solo` も `rank.flex` も無い人だけ（`mode: "all"` か `refresh` なら全員）。`missingForEstimate` の試合の詳細 → 共演者のランク → `estimateRank`。40 人に達したら残りを取らない。
- 失敗は人ごとに `error` に固定の文言（`"League Client did not answer"` など）を入れて次へ。LCU 未接続なら止めて待つ（`status().running` は true のまま、接続で再開）。
- `mode: "stale"`: `freshness` が fresh のデータは取らない。

### 4.7 `balance.ts`
```ts
type BalancePlayer = { puuid: string; points: number | null; lock: Lane | null; mains: Lane[]; subs: Lane[]; ng: Lane[] };
balanceTeams(players: BalancePlayer[]): { rankFirst: Proposal[]; laneFirst: Proposal[]; error: null | "count" | "locks" }
type Proposal = { blue: Slot[]; red: Slot[]; score: number; rankDiff: number; maxMatchupDiff: number | null; brokenNg: number; unknownRanks: number };
type Slot = { puuid: string; lane: Lane | null };
```
- 人数は 6・8・10 だけ（それ以外 `error: "count"`）。points が null の人は**参加者の既知の平均**で計算し、`unknownRanks` に数える。
- 10 人: 126 の組み × 各チーム 120 の割り当て（チームごとに最良）。レーンのペナルティ: lock と違う割り当ては**不可**、main 0、sub 30、その他 80（`thin` の人はその他 40）、NG 400（`brokenNg` に数える）。同じレーンの lock が 3 人以上なら `error: "locks"`。
- 6・8 人: レーンは割り当てない（`lane: null`）。チーム内で main が同じ人の組ごとに 60。
- 点数: ランク重視 `1.0×rankDiff + 0.3×lane + 0.3×matchup`、レーン重視 `0.3×rankDiff + 1.0×lane + 0.2×matchup`（matchup = 各レーンの対面の差の平均。10 人のみ）。各見方で点数の良い順に全件を返す（UI が 3 件ずつ見せ、「別の案」で次の 3 件）。同点は PUUID の辞書順で安定させる。

### 4.8 `discord.ts`
- `formatForDiscord(p: Proposal, names, ranks, { title, withRank = true, withTag = false })`: 企画書 §6 のコードブロック形式（青と赤を横に並べる）。名前は表示幅 12 で切る（全角・CJK・絵文字は幅 2。`…` を付ける）。6・8 人はレーンの列の代わりに `(MID)` のようにメインのレーン。2000 文字以内（超えたらランクを外し、それでも超えたら名前を幅 8 に）。
- `displayWidth(str)`: East Asian Width の F/W と絵文字を 2。

### 4.9 `riotId.ts`
- `parseRiotIdLines(text)`: 改行・カンマで分け、前後の空白を除き、空行を捨て、重複を除く。各行 `isValidRiotId` で検査（不正は `error: "format"`）。最大 30 行。

### 4.10 settings（`packages/core/src/settings.ts`）
- `FEATURE_FLAGS.teamBalancer`（label `Teams (custom match balancer)`、default false、説明は「カスタムロビーのメンバーをランクと得意レーンでチーム分けする。オン: League Client からランクと戦績を読み、端末内にキャッシュする」の英語）。
- `teamPlayers: Record<puuid, { lock?: Lane; mains?: Lane[]; ng?: Lane[]; rankOverride?: number }>`（tolerant parse。壊れた人だけ捨てる。最大 500 人）。
- `teams: { discordWithRank: boolean; discordWithTag: boolean; lastGroupId: number | null }`。

### 4.11 その他
- `lcu-probe.ts` の `ID_LIKE_KEY` の誤検出を直す: 30 文字以上の英字だけのキー（`highestCurrentSeasonReachedTierSR` など）は ID ではない。数字か `-` を含む場合だけ ID とみなす（UUID・数字だけの規則はそのまま）。テストを足す。

---

## 5. main（`apps/desktop`、🔴、最小限）

新しいファイル `apps/desktop/src/teams.ts`（`TeamsController`）。main.ts には配線だけ。
- `connector` の `onEvent` で `uri === "/lol-lobby/v2/lobby"` を `teams.onLobby(data)` に渡す（フラグがオフなら捨てる）。ロビーの解釈は core の `parseCustomLobby(data)`（`gameConfig.isCustom` が true のときだけ。`isBot` か `puuid` 空を除く）。
- ロビーが変わったら、参加者全員を `fetcher.ensure(puuids, { priority: "lobby", mode: "stale" })`。
- キャッシュ: `app.getPath("userData")/team-cache.json`。起動時（フラグがオンになった時）に読む。保存は変化から 1 秒後にまとめて、一時ファイル → `rename`。`clearCache` はファイルを消す。
- IPC（すべて `fromApp` を確かめ、zod で検査）: `teams:get-state`、`teams:set-enabled`、`teams:friends`、`teams:recent`、`teams:resolve-riot-ids`、`teams:prefetch`、`teams:cancel-prefetch`、`teams:refresh`、`teams:forget`、`teams:clear-cache`。push は `teams:state`（変化から 200ms 以内にまとめて）。
- `friends`: `friendGroups` と `friends` を GET（`self` は `current-summoner`）。`recent`: `recentlyPlayed` を PUUID で重複除去、`gameCreationDate` の新しい順、最大 200。`resolveRiotIds`: `summonerByName` を 1 件ずつ（レートリミッター経由）。
- ログ: 件数と状態の変化だけ（PUUID・名前・ランクは書かない）。
- E2E 用の `globalThis.__lolViewer` に `teams` を足す。

---

## 6. renderer（`apps/web`、🟢）

### 6.1 状態
- `useTeams()`: `bridge.teams` の state を購読。無ければ（ブラウザ・Storybook）モックの state。
- 参加 / 控え: Teams ページのローカル状態 `Map<puuid, "in" | "out">`。ロビーの人は既定で チームの枠 = in、観戦 = out。ロビーにいない人（保存済みから足した人）は in。ロビーが null になったらロビー由来の振り分けを消す。
- 提案: `balanceTeams` を `useMemo`（参加者・手動の設定・取得データが変わったら計算し直す）。見方（ランク重視 / レーン重視）と何件目かはローカル状態。提案の中の 2 人の入れ替えは、その案のコピーを変えて点数を出し直す（`scoreProposal` を core に用意）。

### 6.2 画面（企画書 §5・§5.1・§3.10）
- TopBar に `Teams`（フラグがオンのときだけ。`Viewers / Live Game / Teams / Settings`）。
- 左: 「Players (n)」（参加）と「Bench (n)」（控え）。行: 名前、ランクの表示（`effectiveRank` のラベル。ホバーで根拠）、メインのレーン、🔒、取得中のスピナー、古い印。↓↑ で移動、⚙ で手動の設定のパネル（レーン固定・得意（main を最大 2）・NG・ランクの上書き（tier と division の選択）・「Remove from this list」）。
- 右: 見方の切り替え `[Rank first] [Lanes first]`、`Proposal 1 / 3`、`◀ ▶`、`More`、青と赤の表（レーン・名前・ランク）、差の行（`Rank diff 10 · max lane gap 320 · ⚠ 1 NG lane · 2 unknown ranks`）、`Copy for Discord`（オプションのチェック 2 つ）。人数が合わないときは「Pick 6, 8 or 10 players (now 9).」、lock の衝突は「Too many players are locked to Jungle.」。
- 上: 「Prefetch」の折りたためる欄（ロビーにいないときは開いた状態）。タブ: `Friends`（グループのドロップダウン + 一覧のチェック + 「Include me」）/ `Recent`（名前で検索）/ `Riot IDs`（複数行の入力 → Resolve → 結果の行ごとの ✓ / エラー）/ `Lobby` / `Saved (n)`。操作: `Fetch stale & new`（既定）、`Fetch all again`、`Cancel`、進み具合 `12 / 30 · ~3 min`、`pausedUntil` 中は「The League Client is limiting requests. Resuming in 45 s.」。`Saved` の行を開くと §3.10 の中身（ランク 3 種、推定の根拠と試合ごとの行、レーンの横棒、手動の設定、`Refresh` / `Forget`）。`Clear all cached data`（確認つき。ネイティブの confirm は使わず、ボタンが「Click again to clear」に変わる）。
- 文言は英語。Discord の文字列だけ日本語（企画書 §6）。

### 6.3 stories と fixture
- `apps/web/src/fixtures/teams.ts`: 合成の 12 人（Riot ID は `Player1#tag1` 形式の合成、ランク混在、未ランク 2・推定あり 1・データ少 1・lock あり）。
- stories: ロビーなし / 10 人 / 8 人 / 9 人（人数エラー）/ lock の衝突 / 取得中 / Prefetch の各タブ / Saved の中身 / ブラウザ（teams なし）。

---

## 7. fake-lcu とシナリオ
- `scenarios/teams-custom-lobby.jsonl`（合成だけ。個人情報の検査を通す）: current-summoner、カスタムロビー（team100 5・team200 5（うちボット 1）・観戦 2）、friends と friend-groups、各人の summoner by puuid、ranked-stats（混在、未ランク 2）、matches（各 5〜8 試合、キュー混在）、それらの game の詳細（共演者の PUUID は合成の 30 人から）、共演者の ranked-stats、`summoners?name=` 2 件、recently-played。
- 生成は `tools/fake-lcu/src/make-teams-scenario.ts`（決まった乱数の種で作る。コミットするのは生成結果）。

---

## 8. テスト
- core 単体: rank（点数・ラベル・parse の各ケース）、lanes（変換表・キューの絞り込み・60 日）、cache（古さの境目・prune・壊れたファイル）、estimate（中央値・40 人で打ち切り・15 人未満は null・未ランクを飛ばす）、rateLimiter（上げ下げ・429 の待ち・3 回で 60 秒停止）、fetcher（優先順・重複のまとめ・light → estimate・ランクのある人は推定しない・取得済みの試合を取り直さない・キャンセル・未接続で待つ）、balance（6/8/10、lock 必須、lock 衝突、NG を破るときだけ破る、unknown の扱い、見方で結果が変わる例、同点の安定）、discord（スナップショット、全角の幅、2000 文字）、riotId、settings（teamPlayers の tolerant parse）。
- desktop: `teams.ts` のうち Electron に依存しない部分（ロビーの扱い、保存のまとめ）を `teams-core.ts` に分けてテスト（既存の `overlay-core.ts` と同じ形）。
- Electron E2E `e2e/electron-teams.spec.ts`: fake-lcu + 上のシナリオ。フラグをオン → Teams にロビーの 9 人（ボット除外）が参加 8・控え 2 で並ぶ → 取得が終わってランクが出る → 控えの 1 人を参加に → 10 人で提案が出る → Copy for Discord の文字列にコードブロックと 10 人の名前 → `team-cache.json` ができている → `fake.rejectedWrites` が空。フラグがオフのときはファイルを作らず、LCU にランク・戦績の GET を投げないこと。
- Storybook E2E: Teams の主な操作（振り分け、見方の切り替え、別の案、手動の lock で提案が変わる、Prefetch の Riot ID の検査）。スクショを目で確認する。

---

## 9. ドキュメント
- decisions.md に M-038（企画書 §11 を、実機の結果（§3.12）と持ち主の判断（9 人で推定）を反映して確定）。
- new-app-spec.md に Teams の仕様、progress.md を更新。企画書の状態を「実装済み」に。

---

## 10. 実装の分け方
- **実装 A（ロジック層）**: §2・§3・§4（core の teams 一式、settings、lcu-probe の修正）と §8 の core 単体テスト、decisions.md の M-038。UI と main は触らない。
- **実装 B（つなぎと画面）**: §5・§6・§7 と §8 の残り（desktop、E2E、stories）、§9 の残り。A の API をそのまま使う。A の API を変える必要が出たら、変えた理由をこの文書の末尾の「実装メモ」に書く。

---

## 実装メモ（実装 A）

実装 A（ロジック層）で設計から変えた点・足した点。実装 B はこれを前提にする。コードは `next/packages/core/src/teams/`（`index.ts` が全部を出し、`core/src/index.ts` から再エクスポート）。

### 設計からの変更・補足
- **`TeamFetcher` に足した API**: `file`（getter）、`setConnected(boolean)`、`idle()`、`fetching(): string[]`、`forget(puuid)`、`clearCache()`（ファイルのオブジェクトはそのまま、中身を空にする）、`upsertPlayer({puuid,gameName,tagLine}, addedBy?)`、`request(route, args?)`（レートリミッターと接続待ちを通る GET。friends / recentlyPlayed / `summonerByName` に main が使う）。コンストラクタに `limiter?`、`workers?`（既定 2）、`pollMs?`（未設定なら `setConnected(true)` まで待つ。main は安全のため 30000 などを渡してよい）を足した。`ensure` のオプションに `addedBy?` を足した（§3 の `prefetch` の `addedBy` に対応）。
- **接続の扱い**: `get` が `{ status: 0, error: "network" }`（コネクタが未接続のときの応答）を返すと、その要求は止まって待つ。main は LCU の接続状態の変化で `setConnected(true/false)` を呼ぶこと。`PrefetchStatus.running` は「事前取得の人が残っている」間 true（未接続で待っている間も true）。ロビーの取得中は `fetching()`（TeamsState の `fetching`）で見る。
- **進み具合**: `done` / `total` は事前取得の 1 回のまとまりの人数。取得が要らない（新しい）人もすぐ done に数える。`cancelPrefetch()` は数を 0 に戻す。
- **`BalancePlayer` に `thin?: boolean` を足した**（その他のレーンのペナルティを 40 にする。`mainLanes(profile).thin` を渡す）。proposal はどちらの見方でも全件（10 人で 126 件）を返す。10 人のレーンの割り当てはチームごとにペナルティ最小のものから、対面の差が小さくなる組を選ぶ（同点の候補は 24 個まで）。6・8 人でレーンの「同じ main」は `lock ?? mains[0]` で見る。
- **`scoreProposal(slots, players, view)`**: 手で入れ替えた案の点数の出し直し。入れ替えで lock が破れるとレーンのペナルティ 1000 を足す（案は隠さない）。
- **`formatForDiscord(p, names, ranks, opts)`** の引数: `names: Record<puuid, {gameName, tagLine}>`、`ranks: Record<puuid, {label, points}>`（`label` は `rankLabel`、`points` は青赤の平均用）、`opts` に `mains?: Record<puuid, Lane|null>` を足した（6・8 人の `(MID)` 用）。1 行目は `**{title}** ランク差 N`（`withRank` のとき）。
- **`effectiveRank`**: 手動の上書きは `prefs.rankOverride`（settings の `teamPlayers[puuid].rankOverride`）。ソロ / フレックス / 前シーズンも 14 日より古ければ使わない（設計は推定だけに書いてあったが、§3.7.3 の表に合わせた）。
- **推定の打ち切り**: 40 人は「その試合まで数えて 40 人以上になったら次の試合を取らない」（試合の途中では切らない。最大 48 人になりうる）。
- **キャッシュ**: `parseCacheFile` は `players` のキーと `puuid` が違う項目を捨てる。`pruneCache` は新しいオブジェクトを返す。名前だけ（データなし）の人は `nameSeenAt` から 30 日で消える。
- **`parseCustomLobby`**（`lobby.ts`）、`parseRiotIdLines` と `lookupRiotId(request, input)`（`riotId.ts`）を足した。`parseRiotIdLines` は `{input, valid}[]` を返す（不正な行は呼び出し側が `error: "format"` にする。`lookupRiotId` は不正なら `format` を返す）。
- **settings**: `parseTeamPlayers`、`TeamPlayerPref`、`TeamsSettings`、`DEFAULT_TEAMS_SETTINGS`、`TEAM_PLAYERS_MAX` を足した。`mains` は最大 2、`rankOverride` は 0 以上の整数に丸める。
- **protocol**: 設計どおり（`TeamsApi`、スキーマ、`LolViewerBridge.teams?`）。`z.record(LaneSchema, …)` は zod 4 では全レーンのキーが要るので、`LaneProfile.counts` は常に 5 レーン分を持つ。
- **lcu-probe**: `ID_LIKE_KEY` の 30 文字以上の規則は、数字か `-` を含むときだけ ID とみなす。既存テストの「a を 78 回」のキーは `a1` の繰り返しなどに変えた。
- decisions.md の M-038 は M-039 の後ろに追記した（番号順ではなく追記順）。

---

## 実装メモ（実装 B）

実装 B（つなぎと画面）で設計から変えた点・足した点。仕様の本体は [new-app-spec.md](./new-app-spec.md) §2.5・§3.8。

### 設計からの変更・補足
- **main の分け方**: 設計は `teams.ts` に `TeamsController`、`teams-core.ts` に Electron に依存しない部分。実装は `TeamsController` そのものを `teams-core.ts` に置き（ファイル、LCU、タイマー、push はすべて注入）、`teams.ts` は `app.getPath("userData")/team-cache.json` の読み書き（一時ファイル → `rename`）と IPC の登録（`setupTeams`）だけにした。`overlay-core.ts` と同じ形で、ゲート・ロビー・保存のまとめ・IPC 相当の呼び出しまで単体テストできる（`teams-core.test.ts`）。
- **A の API の変更はなし**（`TeamFetcher`、`balanceTeams` などはそのまま使った）。足したのは protocol の IPC 検査用のスキーマだけ: `TeamsPuuidSchema`、`TeamsPrefetchRequestSchema`、`TeamsRiotIdLinesSchema`（と上限の定数）。main が zod を直接持たずに検査できるようにするため（desktop の依存に zod が無い）。
- **フラグを後から ON にしたとき**: フラグ OFF の間に来たロビーのイベントは捨てるので、ON にしてキャッシュを読み終えたあとに `connector.resync()` でロビーを取り直す（`onEnabled`）。フラグ OFF にするときは、書いていない変更を 1 度書いてから止める（取得中の作業は接続待ちのまま捨てる）。OFF → ON の間に前の書き込みが終わるのを待ってから読む。
- **ロビーの扱い**: メンバーの組が変わったときだけ `ensure` を呼ぶ。切断するとロビーは「なし」に戻す。`Delete` のイベントは null として渡す。`Clear all cached data` のあと、ロビーにいればその人たちをもう一度取る（自動取得の約束を保つため）。
- **事前取得の名前**: `prefetch` の IPC は PUUID だけなので、直前の `friends()` / `recentPlayers()` / Riot ID の引きで知った名前を main のメモリに最大 1000 件持ち、取得前に `upsertPlayer` で名前だけ先に入れる（保存済みの一覧にすぐ名前が出る）。
- **E2E のシナリオの数**: 設計 §8 は「参加 8・控え 2」と書いたが、チームの枠は 5 + 4（ボット 1 を除く）= 9 人、観戦 2 人なので、実際は Players (9) / Bench (2)。控えの 1 人を参加に入れて 10 人。シナリオにはさらに t=2000 のロビー更新（観戦に 1 人増える）を入れ、WebSocket 経由の更新も確かめた。ゲームの日時は、E2E が実行日に合わせてずらす（キャッシュは 60 日以内の試合しか数えないので、固定の日時だと将来動かなくなる）。
- **fake-lcu**: `FakeLcu.getRequests`（GET したパスとクエリの一覧）を足した。フラグ OFF のときにランクや戦績を一切読まないことを E2E で確かめるため。シナリオの生成は `tools/fake-lcu/src/make-teams-scenario.ts`（`pnpm make-teams-scenario`）。コミットした JSONL と生成結果が一致することをテストで確かめる。
- **renderer**: 入れ替えは「クリック → クリック」（ドラッグではない）。参加 / 控えは ↓ ↑ のボタン（ドラッグではない）。見た目の 🔒 は SVG のアイコン。提案の「別の案」は `More`（次の 3 件。最後まで行くと最初に戻る）。main が push する状態は 200ms ごとに新しいオブジェクトになるので、提案は中身（`BalancePlayer` の JSON）が変わったときだけやり直す。Discord の文字列は常に画面に出す（コピーが拒否されたときの代わりも兼ねる）。
- **Storybook の story**: `Screens/Teams`（ロビーなし / 保存済みを足した 8 人 / 10 人 / レーン重視 / 8 人 / 9 人 / lock の衝突 / 手動の設定 / 取得中 / 控えから移した後 / Prefetch の各タブ / 制限中 / Saved の詳細 / ブラウザ）、`Screens/App` の `TeamsTab`、`Components/TopBar` の `WithTeamsTab`。fixture は `apps/web/src/fixtures/teams.ts`（合成の 12 人。`Player1#tag1` 形式）。

