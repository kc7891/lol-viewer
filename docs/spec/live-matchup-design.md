# 試合中のゴールド差と対面表の補正（Live Client Data API）設計書

新版（`next/`）に、試合中だけ Live Client Data API を読んで「対面とのアイテムゴールド差」を出し、対面表の行を本当のレーンに直す機能を足すための設計。**実装者はこの文書の順番どおりに作る**（§10）。迷ったらこの文書を優先し、書いていないことは決めずに質問する。

- 対象: `next/`（Electron + TypeScript + React）。
- 前提として読むもの: [new-app-spec.md](./new-app-spec.md) §2.2（Matchup / Cooldowns）、§3（自動検知）、§3.4（自動配置）、[decisions.md](./decisions.md) M-010 / M-011 / M-016、`next/CLAUDE.md`（ゾーン、完了の定義）。
- 決定番号は M-025〜M-029 を使う（§2。decisions.md に追記する文面もそこに書いた）。
- 作成: 2026-11-23。

---

## 1. 目的と範囲

### 1.1 やること
1. **ゴールド差**: フェーズが `InProgress` の間、`GET /liveclientdata/playerlist`（127.0.0.1:2999）を 2 秒ごとに読み、各プレイヤーの「アイテムの合計金額（推定ゴールド）」を出す。Matchup の各行の中央（今 `vs` と出ている所）に、**味方 − 敵** の差を `+1.4k` / `-150` / `0` の形で色分けして出す。レベル差が 0 でなければ、その下に小さく `Lv+1` を出す。
2. **対面表の補正**: playerlist の `position`（`TOP` / `JUNGLE` / `MIDDLE` / `BOTTOM` / `UTILITY`。ブラインド、ARAM、カスタムでは `""`）と、`position` が空のときの「Smite を持っている ⇒ ジャングル」で、両チームの行を直す。補正の規則は §5.5（M-027）。
3. **Cooldowns の既定**: 既定の対象を「`YOU` の行の敵」にする。補正後の表に自然に従い、自分のレーンが null（ブラインド、ARAM）でも自分の行の敵になる（M-028）。
4. **Feature Flag**: すべて Feature Flag `liveClientData`（**既定 OFF**）の後ろに置く。OFF のときは 127.0.0.1:2999 へ 1 回も問い合わせず（記録機能を除く。§6.4）、Matchup と Cooldowns は今と同じに動く。切り替えは再起動なしで効く（M-025）。

### 1.2 やらないこと（範囲外）
- アビリティヘイストによるクールダウンの補正、スキルレベル連動、タイマー。
- 所持金（未使用のゴールド）、CS、KDA、ワードスコアの表示。敵の所持金は Live Client Data API でも取れない（自分の `activePlayer.currentGold` だけ）ので、比べられるのは「アイテムの金額」だけ。
- `/liveclientdata/activeplayername`、`/liveclientdata/allgamedata`、`/liveclientdata/activeplayer` を読むこと（M-029）。
- 観戦、リプレイ、Arena（2 人 × 複数チーム）への対応。来たデータが 2 チーム × 最大 5 人の形でなければ使わない（§5.3）。
- 試合中のデータの保存（ファイル、`localStorage` のどちらにも保存しない）。
- `packages/lcu` の変更。既存の `startLiveClientPoller` をそのまま使う（§6.2）。

---

## 2. 決定事項（decisions.md に追記する）

decisions.md の一覧表の末尾（M-024 の行の下）に次の 5 行を足し、本文の末尾（「未決事項」の前）に §2.1 の節を足す。

| 番号 | 決定 | 区分 | 関係する旧資料 |
|---|---|---|---|
| M-025 | 試合中（`InProgress`）だけ、Live Client Data API（`127.0.0.1:2999/liveclientdata/playerlist`）を 2 秒ごとに GET する（M-010 の例外）。Feature Flag `liveClientData` の後ろに置き、既定は OFF。OFF なら 2999 に問い合わせない（記録機能は従来どおり別）。切り替えは再起動なしで効く | 新版の方針（M-010 の例外） | 03 §2.1, §12（Live Client Data API は旧版では設計書だけ） |
| M-026 | 推定ゴールドは「アイテムの Data Dragon `gold.total` × 個数の合計」。消費して無くなるアイテム（`consumed: true`。ポーション、コントロールワード、エリクサーなど）は 0、トリンケットは元から 0。表に無い ID だけ Live Client の `price × count`（`consumable` なら 0）で代える | 新版の方針 | — |
| M-027 | 試合中の位置（`position`、空なら Smite ⇒ jungle）で対面表を直す。直すのは「その側の割り当てが前回直したときと変わったとき」だけ（ふつうは試合ごとに 1 回）。その後のユーザーの入れ替えは保つ。表から消すことはしない | 新版の方針（§3.4 の規則の追加） | 01 §7 |
| M-028 | Cooldowns の既定の対象は、`YOU` の行の敵 → 自分のレーンの行の敵 → 対面表の最初の敵、の順 | 改善（§2.2 の改訂） | — |
| M-029 | Live Client のデータから「自分のチーム」を決めるのに名前（Riot ID）を使わない。自分のチャンピオン、次に MatchState の味方・敵との一致で決める。決まらなければ試合中のデータを使わない | 新版の方針（個人情報） | — |

### 2.1 本文に追記する節

```markdown
## M-025〜M-029 試合中のゴールド差と対面表の補正（2026-11-23）
- 設計と理由は [live-matchup-design.md](./live-matchup-design.md)。要点だけここに残す。
- **M-025（ポーリング）**: LCU（WAMP）には試合中のアイテムやレベルが流れてこない。試合中のゲームが自分で出している Live Client Data API（ローカル、認証なし、GET だけ）を読むしかなく、イベントの購読も無いのでポーリングにする。M-010 の「ポーリングしない」は LCU についての決定で、これはその例外。
  - 読むのは `/liveclientdata/playerlist` の 1 つだけ。間隔は 2 秒。フェーズが `InProgress` で、かつ Feature Flag `liveClientData` が ON の間だけ動かす。ロード画面の間の 404 や接続失敗は「まだ無い」として黙って次を待つ。
  - Feature Flag は renderer の設定（`localStorage`）にあり、IPC（`live:set-enabled`）で main に伝える。main の既定は OFF なので、renderer が ON と言うまで 1 回も問い合わせない。
  - 記録機能（Settings > Record session）の Live Client の読み取りは、ユーザーが明示的に始める別の操作なので、このフラグに関係なく従来どおり動く。
- **M-026（ゴールド）**: Live Client の `items[].price` は、意味（単体の値段か、合成の差額か）が文書化されておらず実機で確かめていない。Data Dragon の `gold.total` は合成元を含む総額で、どの版でも意味が同じ。`pnpm champion-data`（M-015 の 1 本化した生成処理）で `packages/core/data/items.json` を作る。
- **M-027（補正）**: 位置は試合が始まってから変わらないので、「割り当てが変わったときだけ」直せば実質 1 回になり、そのあとユーザーがドラッグで直した並びを次のポーリングで壊さない。同じレーンを 2 人が名乗ったら、そのレーンは直さない。Refresh（⟳）は事実から置き直すので、補正もやり直す。
- **M-028（Cooldowns）**: ブラインドや ARAM では自分のレーンが null なので、これまでは最初の敵（たいてい TOP）になっていた。`YOU` の行を見れば、補正やユーザーの入れ替えにも従う。
- **M-029（名前を使わない）**: `activeplayername` は名前の文字列そのものを返し、記録機能の伏せ方（キー名で伏せる）では伏せられない。チャンピオンで決めれば名前は要らない。playerlist の名前は core の `toLcuEvent` で捨て、MatchState には入れない。
```

---

## 3. データの流れ

```
[Game 127.0.0.1:2999]                         (main process)                                      (renderer)
  GET /liveclientdata/playerlist  ◀── startLiveClientPoller (packages/lcu, 既存, GET only, 2s)
        │ 200 で中身が変わったときだけ RawLcuEvent {uri:"/liveclientdata/playerlist"}
        ▼
  core.toLcuEvent ──▶ LcuEvent {type:"live-players", players: LivePlayerFact[] | null}
        │              (championId / team ORDER|CHAOS / lane / level / itemGold だけ。名前はここで捨てる)
        ▼
  Hub.dispatch ──▶ core.reduce: phase==="InProgress" のときだけ保持し、
        │          MatchState.live: LivePlayer[] | null（team は ally / enemy に変換済み）
        ▼
  hub.subscribe ──▶ IPC "hub:state" ─────────────────────────────▶ App: flag OFF なら live を null にして
        │                                                              useWorkspace(match)
        │                                                                 │
        └──▶ LiveGate.setPhase(phase)                                     ▼
                ▲                                              core.workspaceReducer({type:"match"})
                │ IPC "live:set-enabled"(boolean)                  ├ placeMatchup（今と同じ）
                └──────────── preload bridge.live.setEnabled ◀──┤ applyLiveLanes（M-027）
                                                                   ▼
                                                     MatchupSection: rowLiveDiff → `+1.4k` / `Lv+1`
                                                     CooldownPanel: defaultCooldownChampion（M-028）
```

- LiveGate（`apps/desktop/src/live-core.ts`）は「flag ON かつ phase が InProgress」のときだけポーラーを動かす（§6.2）。
- 記録機能（`recording.ts`）は自分のポーラーを持ったまま（変更しない。§6.4）。

---

## 4. 型とプロトコルの変更（`packages/protocol/src/index.ts`、🟡）

### 4.1 `PROTOCOL_VERSION`
`2` → `3`。MatchState に必須の項目（出力型）が増えるため。`packages/hub/src/integration.test.ts` の `toBe(2)` を `toBe(3)` に直す。

### 4.2 Live Client の生データ（読むものの部分集合）
「LCU payload subsets」の節の末尾に足す。`looseObject` なので他のキー（`riotId` など）も通るが、これは `toLcuEvent` の中だけで使い、外へは出さない（§5.1）。

```ts
// ── Live Client Data API payload subsets (in-game, 127.0.0.1:2999) ──

export const LiveClientItemSchema = z.looseObject({
  itemID: z.number(),
  count: z.number().optional(),
  /** Meaning not documented (own price vs. combine cost); only a fallback for unknown items (M-026). */
  price: z.number().optional(),
  consumable: z.boolean().optional(),
});

export const LiveClientSpellSchema = z.looseObject({
  displayName: z.string().optional(),
  rawDisplayName: z.string().optional(),
  rawDescription: z.string().optional(),
});

export const LiveClientPlayerSchema = z.looseObject({
  championName: z.string().optional(),
  /** "game_character_displayname_<Data Dragon id>", e.g. "..._MonkeyKing". */
  rawChampionName: z.string().optional(),
  /** "ORDER" | "CHAOS" (anything else is ignored). */
  team: z.string().optional(),
  /** "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" | "" (blind, ARAM, custom). */
  position: z.string().optional(),
  level: z.number().optional(),
  items: z.array(LiveClientItemSchema).optional(),
  summonerSpells: z
    .looseObject({ summonerSpellOne: LiveClientSpellSchema.optional(), summonerSpellTwo: LiveClientSpellSchema.optional() })
    .optional(),
});
export type LiveClientPlayer = z.infer<typeof LiveClientPlayerSchema>;
```

### 4.3 LcuEvent に `live-players` を足す
```ts
/** One player of /liveclientdata/playerlist, reduced to facts (no names). Built by core.toLcuEvent. */
export const LivePlayerFactSchema = z.object({
  championId: z.number().int().positive(),
  team: z.enum(["ORDER", "CHAOS"]),
  /** From `position`; when that is empty, Smite => "jungle"; otherwise null. */
  lane: LaneSchema.nullable(),
  level: z.number().int().nonnegative(),
  /** Estimated gold: sum of item values (M-026). */
  itemGold: z.number().int().nonnegative(),
});
export type LivePlayerFact = z.infer<typeof LivePlayerFactSchema>;

// LcuEventSchema の配列に 1 行足す:
  /** Live Client Data API (in game). null = the list is gone (Delete / flag turned off). */
  z.object({ type: z.literal("live-players"), players: z.array(LivePlayerFactSchema).nullable() }),
```

### 4.4 MatchState に `live` を足す
`AllySchema` の近くに `LivePlayerSchema` を、`MatchStateSchema` の `enemies` の後に `live` を足す。

```ts
export const LivePlayerSchema = z.object({
  championId: z.number().int().positive(),
  /** Relative to me (M-029). */
  team: z.enum(["ally", "enemy"]),
  lane: LaneSchema.nullable(),
  level: z.number().int().nonnegative(),
  itemGold: z.number().int().nonnegative(),
});
export type LivePlayer = z.infer<typeof LivePlayerSchema>;

// MatchStateSchema:
  /**
   * In game only (phase InProgress) and only while the liveClientData feature flag is on:
   * every player of the Live Client player list, in its order. null otherwise, and when my
   * team could not be told (M-029). No names.
   */
  live: z.array(LivePlayerSchema).nullable().default(null),
```

### 4.5 ブリッジに `live` を足す
```ts
export interface LiveClientControlApi {
  /** Feature flag liveClientData (M-025): main polls the Live Client Data API only while this is true and a game is in progress. */
  setEnabled(enabled: boolean): void;
}
// LolViewerBridge に:
  /** Present only in the desktop app. */
  readonly live?: LiveClientControlApi;
```

### 4.6 アイテムの金額データ（生成物）
`ChampionDataSchema` の後に足す。

```ts
// ── Static item data (generated from Data Dragon item.json; see tools/champion-data) ──
export const ItemDataSchema = z.object({
  source: z.literal("Data Dragon"),
  patch: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** item id (string key) -> gold counted for the item (gold.total; 0 when consumed on use). */
  items: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative()),
});
export type ItemData = z.infer<typeof ItemDataSchema>;
```

---

## 5. アルゴリズム

すべて `packages/core`（🟢、純粋関数、I/O なし）に置く。新しいファイル `packages/core/src/live.ts` を作り、`index.ts` から `export * from "./live.ts";` する。

### 5.1 playerlist の正規化（`toLcuEvent` の中）

`packages/core/src/scenario.ts` の `toLcuEvent` に case を足す。

```ts
case "/liveclientdata/playerlist": {
  if (deleted) return { type: "live-players", players: null };
  if (!Array.isArray(raw.data)) return null;
  const players: LivePlayerFact[] = [];
  for (const item of raw.data) {
    const p = LiveClientPlayerSchema.safeParse(item);   // 1 人壊れていても他は使う
    if (!p.success) continue;
    const fact = normalizeLivePlayer(p.data);
    if (fact) players.push(fact);
  }
  return { type: "live-players", players };
}
```
`SUBSCRIBED_URIS` には足さない（LCU の購読ではないため）。コメントに「`/liveclientdata/playerlist` は Live Client Data API（ポーリング、M-025）」と書く。

`live.ts`:
```ts
const RAW_CHAMPION_PREFIX = "game_character_displayname_";

/** Champion id from rawChampionName (Data Dragon id), else from championName (English or Japanese). */
export function championIdFromLive(p: Pick<LiveClientPlayer, "rawChampionName" | "championName">): number | null {
  const raw = p.rawChampionName ?? "";
  if (raw.startsWith(RAW_CHAMPION_PREFIX)) {
    const c = getChampionByDdragonId(raw.slice(RAW_CHAMPION_PREFIX.length));
    if (c) return c.id;
  }
  const name = p.championName ?? "";
  if (!name) return null;
  const exact = CHAMPIONS.find((c) => c.name === name || c.nameJa === name);
  if (exact) return exact.id;
  const n = normalizeSearch(name);
  const loose = CHAMPIONS.find((c) => [c.name, c.nameJa, c.ddragonId, c.slug].some((k) => normalizeSearch(k) === n));
  return loose?.id ?? null;
}

/** Smite in either summoner spell slot. raw* keys survive recordings (displayName is masked there). */
export function hasSmite(p: Pick<LiveClientPlayer, "summonerSpells">): boolean {
  const spells = [p.summonerSpells?.summonerSpellOne, p.summonerSpells?.summonerSpellTwo];
  return spells.some(
    (s) => !!s && (/SummonerSmite/i.test(s.rawDescription ?? "") || /SummonerSmite/i.test(s.rawDisplayName ?? "") ||
      s.displayName === "Smite" || s.displayName === "スマイト"),
  );
}

export function normalizeLivePlayer(p: LiveClientPlayer): LivePlayerFact | null {
  const championId = championIdFromLive(p);
  if (championId == null) return null;                 // unknown champion (old champions.json): drop
  const team = p.team === "ORDER" || p.team === "CHAOS" ? p.team : null;
  if (!team) return null;
  const lane = normalizeLane(p.position) ?? (hasSmite(p) ? "jungle" : null);   // normalizeLane は reducer.ts の既存関数
  const level = Math.max(0, Math.trunc(p.level ?? 0));
  return { championId, team, lane, level, itemGold: itemGold(p.items ?? []) };
}
```
- `champions.ts` に `getChampionByDdragonId(id: string): Champion | undefined` を足す（`byDdragonId` の Map。見つからなければ大小を無視して探す）。
- 戻り値には名前に当たるもの（`riotId`、`summonerName`、`championName` の文字列）を**入れない**。テストで確かめる（§9.1）。
- **循環 import を作らない**: `reducer.ts` は `live.ts`（`buildLivePlayers`）を import する。`live.ts` が `reducer.ts` を import しないように、`normalizeLane` を新しいファイル `packages/core/src/lanes.ts` へ移し、`live.ts` と `reducer.ts` の両方がそこから import する。`reducer.ts` には `export { normalizeLane } from "./lanes.ts";` を残す（公開 API と既存テストの import を変えないため。`index.ts` に `lanes.ts` は足さない）。`live.ts` が import してよいのは `champions.ts`、`search.ts`、`lanes.ts`、`@lol-viewer/protocol`、`../data/items.json` だけ。
- `normalizeLane` は `"TOP"`→top、`"JUNGLE"`→jungle、`"MIDDLE"`→middle、`"BOTTOM"`→bottom、`"UTILITY"`→support、`""`/`"NONE"`/その他→null（既存の実装がそうなっている。変えない）。

### 5.2 アイテムの金額（M-026）

```ts
import itemsRaw from "../data/items.json" with { type: "json" };
export const ITEM_DATA = ItemDataSchema.parse(itemsRaw);
const ITEM_GOLD = new Map(Object.entries(ITEM_DATA.items).map(([k, v]) => [Number(k), v]));

/** Gold counted for one inventory slot. */
export function itemValue(it: { itemID: number; count?: number; price?: number; consumable?: boolean }): number {
  const count = it.count != null && it.count > 0 ? Math.trunc(it.count) : 1;
  const known = ITEM_GOLD.get(it.itemID);
  if (known !== undefined) return known * count;          // consumed items are 0 in the table
  if (it.consumable) return 0;
  return Math.max(0, Math.round(it.price ?? 0)) * count;  // unknown id (data older than the game)
}
export const itemGold = (items: readonly Parameters<typeof itemValue>[0][]): number =>
  items.reduce((sum, it) => sum + itemValue(it), 0);
```

規則（M-026）:
| アイテム | 数え方 | 例 |
|---|---|---|
| ふつうのアイテム（完成品、素材、ブーツ、ジャングルペット、サポートアイテム） | `gold.total × count` | Infinity Edge 3500、Berserker's Greaves 1100、Gustwalker Hatchling 450、World Atlas 400 |
| 使うと無くなるもの（Data Dragon の `consumed: true`） | 0 | Health Potion、Control Ward、Elixir of Iron、Total Biscuit |
| 使っても無くならないポーション（`consumed` なし） | `gold.total` | Refillable Potion 150、Corrupting Potion 500 |
| トリンケット | 0（`gold.total` が 0） | Stealth Ward、Oracle Lens、Farsight Alteration |
| `items.json` に無い ID | `consumable` なら 0、それ以外 `price × count` | 新しいパッチのアイテム |

`items.json` の作り方は §8 の `tools/champion-data`。

### 5.3 自分のチームと `MatchState.live`（M-029）

```ts
/** My team in the Live Client list, without names: my champion, else overlap with MatchState allies / enemies. */
export function resolveMyTeam(players: readonly LivePlayerFact[], match: Pick<MatchState, "self" | "allies" | "enemies">): "ORDER" | "CHAOS" | null {
  const teamsWith = (id: number) => new Set(players.filter((p) => p.championId === id).map((p) => p.team));
  if (match.self) {
    const t = teamsWith(match.self.championId);
    if (t.size === 1) return [...t][0]!;
  }
  const score = (team: "ORDER" | "CHAOS") => {
    const ids = players.filter((p) => p.team === team).map((p) => p.championId);
    return ids.filter((id) => match.allies.some((a) => a.championId === id)).length - ids.filter((id) => match.enemies.includes(id)).length;
  };
  const o = score("ORDER");
  const c = score("CHAOS");
  return o > c ? "ORDER" : c > o ? "CHAOS" : null;
}

/** MatchState.live from the facts; null when the shape is not 2 teams of <= 5 or my team is unknown. */
export function buildLivePlayers(players: readonly LivePlayerFact[], match: Pick<MatchState, "self" | "allies" | "enemies">): LivePlayer[] | null {
  const order = players.filter((p) => p.team === "ORDER").length;
  const chaos = players.length - order;
  if (players.length === 0 || order > 5 || chaos > 5) return null;
  const mine = resolveMyTeam(players, match);
  if (!mine) return null;
  return players.map((p) => ({ championId: p.championId, team: p.team === mine ? "ally" : "enemy", lane: p.lane, level: p.level, itemGold: p.itemGold }));
}
```

### 5.4 reducer（`packages/core/src/reducer.ts`）への組み込み

1. `DetectorState` に `liveFacts: LivePlayerFact[] | null;` を足す（コメント: 「Last Live Client player list (in game only); kept so `live` can be rebuilt when self / allies arrive later」）。`initialDetectorState()` で `null`。
2. `initialMatchState()` に `live: null` を足す。
3. `step()` に case を足す:
   ```ts
   case "live-players":
     if (event.players == null) return d.liveFacts == null ? d : { ...d, liveFacts: null };
     if (d.match.phase !== "InProgress") return d;   // late answer after the game: ignore
     return { ...d, liveFacts: event.players };
   ```
4. `withLive(d)` を足し、`reduce()` で `step` の後に必ず通す。
   ```ts
   /** MatchState.live follows liveFacts in game; outside InProgress both are cleared (no stale data next game). */
   function withLive(d: DetectorState): DetectorState {
     if (d.match.phase !== "InProgress") {
       return d.liveFacts == null && d.match.live == null ? d : { ...d, liveFacts: null, match: { ...d.match, live: null } };
     }
     const live = d.liveFacts ? buildLivePlayers(d.liveFacts, d.match) : null;
     return { ...d, match: { ...d.match, live } };
   }

   export function reduce(d: DetectorState, event: LcuEvent): DetectorState {
     const stepped = step(d, event);
     if (stepped === d) return d;
     const next = withLive(stepped);
     const match = JSON.stringify(next.match) === JSON.stringify(d.match) ? d.match : next.match;
     return match === next.match ? next : { ...next, match };
   }
   ```
   - 「変わらないイベントは同じオブジェクトを返す」「観測できる変化が無ければ同じ MatchState」という既存の約束はこれで保たれる（`stepped === d` を先に見る。`withLive` は中身が同じなら JSON 比較で前の `match` に戻る）。
   - 新しい試合、`None` / `Lobby`、切断はどれもフェーズが `InProgress` 以外になるので、`withLive` が `liveFacts` と `live` を消す。`startNewMatch` などを個別に直す必要は無い。
   - `self` や `allies` が後から届いても（`current-summoner` → `applyTeams`）、`withLive` が毎回作り直すので自分のチームの判定が追従する。

### 5.5 対面表の補正（`packages/core/src/workspace.ts`、M-027）

#### 型
```ts
export type Workspace = {
  ...既存...
  /**
   * Per side, the lane assignment from live data that was last applied to `rows` (assignmentKey),
   * or null. A side is corrected again only when its assignment changes (M-027).
   */
  liveApplied: { ally: string | null; enemy: string | null };
};
```
`initialWorkspace()` で `{ ally: null, enemy: null }`。新しい試合（`applyMatch` の 1.）でも `{ ally: null, enemy: null }` に戻す。

#### 割り当て
```ts
/** Champion -> lane for one side of the live list. Lanes claimed by two players, and champions listed twice, are dropped. */
export function liveLaneAssignments(live: readonly LivePlayer[], side: Side): Map<number, Lane> {
  const players = live.filter((p) => p.team === side);
  const idCount = new Map<number, number>();
  for (const p of players) idCount.set(p.championId, (idCount.get(p.championId) ?? 0) + 1);
  const claims = players.filter((p) => p.lane != null && idCount.get(p.championId) === 1);
  const out = new Map<number, Lane>();
  for (const lane of LANES) {
    const who = claims.filter((p) => p.lane === lane);
    if (who.length === 1) out.set(who[0]!.championId, lane);
  }
  return out;   // insertion order = LANES order
}

/** Stable text form, e.g. "jungle:64,middle:103". "" = nothing assigned. */
export const assignmentKey = (a: Map<number, Lane>): string => [...a].map(([id, lane]) => `${lane}:${id}`).join(",");
```

#### 1 つの側を直す
既存の `bestEmptyRow(rows, side, id)` を「セルの配列」版に一般化して両方から使う:
```ts
/** Index of the empty cell with the highest lane score for the champion; ties go to the upper row. */
function bestEmptyIndex(cells: readonly (number | null)[], championId: number): number | null { ...今の bestEmptyRow と同じ中身... }
const bestEmptyRow = (rows: MatchupRow[], side: Side, id: number) => bestEmptyIndex(rows.map((r) => r[side]), id);
```

```ts
/**
 * Move the assigned champions of one side to their lane's row. Everyone else keeps their row
 * when it is still free; the ones pushed out go to the best-fitting free row. Nothing is removed,
 * nothing is added (champions not in the table are ignored).
 */
export function correctSide(rows: MatchupRow[], side: Side, assign: Map<number, Lane>): MatchupRow[] {
  const cur = rows.map((r) => r[side]);
  const next: (number | null)[] = cur.map(() => null);
  const fixed = new Set<number>();
  for (const [id, lane] of assign) {
    if (!cur.includes(id)) continue;
    const i = LANES.indexOf(lane);
    next[i] = id;
    fixed.add(i);
  }
  if (fixed.size === 0) return rows;
  const displaced: number[] = [];
  cur.forEach((id, i) => {
    if (id == null || next.includes(id)) return;          // empty, or moved above
    if (next[i] == null) next[i] = id; else displaced.push(id);
  });
  for (const id of displaced) {
    const i = bestEmptyIndex(next, id)!;                   // always exists: same number of champions
    next[i] = id;
  }
  return rows.map((r, i) => (r[side] === next[i] ? r : { ...r, [side]: next[i] }));
}
```

#### いつ直すか
```ts
/** M-027: correct each side when its live assignment differs from the one applied last. */
function applyLiveLanes(ws: Workspace, state: MatchState): Workspace {
  if (state.phase !== "InProgress" || !state.live) return ws;
  let { rows, liveApplied } = ws;
  for (const side of ["ally", "enemy"] as const) {
    const a = liveLaneAssignments(state.live, side);
    const key = assignmentKey(a);
    if (key === "" || key === liveApplied[side]) continue;
    rows = correctSide(rows, side, a);
    liveApplied = { ...liveApplied, [side]: key };
  }
  return rows === ws.rows && liveApplied === ws.liveApplied ? ws : { ...ws, rows, liveApplied };
}
```
- `applyMatch` の「2. Matchup table」を次のようにする:
  ```ts
  if (state.phase === "ChampSelect" || state.phase === "InProgress") {
    next = { ...next, rows: placeMatchup(next.rows, state) };
    next = applyLiveLanes(next, state);
  }
  ```
- `refreshMatchup`: 置き直したあと、`liveApplied` を `{ally: null, enemy: null}` にしてから `applyLiveLanes` を通す（事実から作り直すので補正もやり直す）。
  ```ts
  case "refreshMatchup": {
    const base = { ...ws, rows: ws.last ? placeMatchup(emptyRows(), ws.last) : emptyRows(), pending: [], liveApplied: { ally: null, enemy: null } };
    return ws.last ? applyLiveLanes(base, ws.last) : base;
  }
  ```
- `swapRows`、`debugAdd` は `liveApplied` を変えない。だから次のポーリングで同じ割り当てが来ても、ユーザーの入れ替えは保たれる。

#### 規則のまとめ（spec に書く文）
- 補正は、試合中（`InProgress`）に試合中のデータが届いたときだけ。その側の割り当て（チャンピオン → レーン）が、前回その側を直したときと違えば直す。位置は試合中に変わらないので、ふつうは試合ごとに 1 回。
- 割り当てに入るのは、その側で 1 人だけが名乗ったレーン。`position` が空なら Smite を持つ人がジャングルを名乗る。2 人が同じレーンを名乗ったら、そのレーンは誰も動かさない。
- 割り当てのある子はそのレーンの行へ。それ以外の子は、自分の行が空いていればそのまま。押し出された子は、空いた行のうちレーン適性が最も高い行へ（同点は上）。表に居ない子は無視する。消さない、足さない。
- 試合前（チャンピオンセレクト中）にユーザーが入れ替えた並びは、補正で上書きされることがある（位置の方が事実なので）。補正のあとの入れ替えは保たれる。
- Refresh（⟳）は補正もやり直す。
- Feature Flag が OFF なら `live` が来ないので、補正は起きない（今と同じ）。

### 5.6 Cooldowns の既定（M-028）
`defaultCooldownChampion` を置き換える。
```ts
/** Default cooldown target: the enemy in the row where I am (YOU), else my lane's row, else the first enemy. */
export function defaultCooldownChampion(ws: Workspace): number | null {
  const self = ws.last?.self ?? ws.lastSelf;
  const mine = self ? ws.rows.find((r) => r.ally === self.championId)?.enemy : null;
  if (mine != null) return mine;
  const laneEnemy = self?.lane ? ws.rows[LANES.indexOf(self.lane)]?.enemy : null;
  return laneEnemy ?? ws.rows.find((r) => r.enemy != null)?.enemy ?? null;
}
```
- `MatchupSection` の `YOU` の判定（`ws.last?.self?.championId ?? ws.lastSelf?.championId`）と同じ「自分」を使う。
- 既存のテスト `defaultCooldownChampion: ... state(null)` は `GAREN` → `ZED` に変わる（自分＝Ahri が適性で MID に置かれ、MID の敵が Zed）。これは意図した変更（M-028）なので、テストの期待値とテスト名を直す。
- `App.tsx` の「クリックした対象」（`cooldownPick`）は今のまま（新しい試合で既定に戻る）。

### 5.7 行ごとの差と表示値
`workspace.ts` の「derived values」に足す:
```ts
export type RowLiveDiff = { gold: number; level: number; ally: LivePlayer; enemy: LivePlayer };

/** Ally minus enemy in one row, from the last MatchState's live list; null when either side is missing. */
export function rowLiveDiff(ws: Workspace, index: number): RowLiveDiff | null {
  const live = ws.last?.live;
  const row = ws.rows[index];
  if (!live || !row || row.ally == null || row.enemy == null) return null;
  const ally = live.find((p) => p.team === "ally" && p.championId === row.ally);
  const enemy = live.find((p) => p.team === "enemy" && p.championId === row.enemy);
  if (!ally || !enemy) return null;
  return { gold: ally.itemGold - enemy.itemGold, level: ally.level - enemy.level, ally, enemy };
}
```
`live.ts` に表示用の関数を足す:
```ts
/** "+1.4k", "-950", "0" (|d| < 50), "+10k" (>= 9 950). ASCII + and -. */
export function formatGoldDiff(d: number): string {
  const r = Math.round(d);
  const a = Math.abs(r);
  if (a < 50) return "0";
  const sign = r > 0 ? "+" : "-";
  if (a < 1000) return `${sign}${a}`;
  const k = Math.round(a / 100) / 10;
  return k < 10 ? `${sign}${k.toFixed(1)}k` : `${sign}${Math.round(a / 1000)}k`;
}
export const goldTrend = (d: number): "ahead" | "behind" | "even" => (Math.abs(Math.round(d)) < 50 ? "even" : d > 0 ? "ahead" : "behind");
/** "Lv+1" / "Lv-2"; null when equal. */
export const formatLevelDiff = (d: number): string | null => (d === 0 ? null : `Lv${d > 0 ? "+" : "-"}${Math.abs(d)}`);
```
例: 0→`0`、49→`0`、50→`+50`、-150→`-150`、999→`+999`、1000→`+1.0k`、1400→`+1.4k`、-12345→`-12k`、9949→`+9.9k`、9950→`+10k`。

---

## 6. Feature Flag と main のゲート（M-025）

### 6.1 フラグの定義（`packages/core/src/settings.ts`、🟢）
```ts
export type FeatureFlagDef = { label: string; description: string; default: boolean };

/** Feature flag definitions. Settings > Feature flags lists them; the stored value wins over the default. */
export const FEATURE_FLAGS = {
  liveClientData: {
    label: "Live game data",
    description:
      "During a game, read the game's Live Client Data API on this PC (127.0.0.1:2999) every 2 seconds: " +
      "item gold differences in the matchup, and rows moved to the real lanes. Off: no requests are made.",
    default: false,
  },
} as const satisfies Record<string, FeatureFlagDef>;
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];

export function isFeatureOn(s: Settings, key: FeatureFlagKey): boolean {
  return s.featureFlags[key] ?? FEATURE_FLAGS[key].default;
}
/** Every defined flag back to its default; unknown stored keys are kept (M-016). */
export function resetFeatureFlags(flags: Record<string, boolean>): Record<string, boolean> {
  return { ...flags, ...Object.fromEntries(FEATURE_FLAG_KEYS.map((k) => [k, FEATURE_FLAGS[k].default])) };
}
export const flagsAtDefaults = (s: Settings): boolean => FEATURE_FLAG_KEYS.every((k) => isFeatureOn(s, k) === FEATURE_FLAGS[k].default);
```
- 保存の形は今のまま（`featureFlags: Record<string, boolean>`、`parseSettings` も今のまま）。`DEFAULT_SETTINGS.featureFlags` は `{}` のまま（既定は定義側が持つ）。
- `settings.test.ts` の `expect(FEATURE_FLAGS).toEqual({})` は「`liveClientData` が既定 OFF で定義されている」テストに置き換える。

### 6.2 main のゲート（`apps/desktop/src/live-core.ts`、新規、🔴）
Electron に依存しない小さな部品にして、Vitest で単体テストする（`log-core.ts` / `update-core.ts` と同じ形）。

```ts
/**
 * Live Client Data API gate (M-025): the poller runs only while the feature flag is on AND the
 * game is in progress. Off by default: nothing is requested until the renderer turns it on.
 */
export const LIVE_POLL_MS = 2000;

export type LiveGateDeps = {
  /** Start polling (startLiveClientPoller). */
  start: () => { stop: () => void };
  /** Drop MatchState.live (dispatch {type: "live-players", players: null}). */
  clear: () => void;
};

export type LiveGate = {
  setEnabled(enabled: boolean): void;
  setPhase(phase: string): void;
  readonly enabled: boolean;
  readonly polling: boolean;
  dispose(): void;
};

export function createLiveGate(deps: LiveGateDeps): LiveGate {
  let enabled = false;
  let phase = "None";
  let poller: { stop: () => void } | null = null;
  const sync = () => {
    const want = enabled && phase === "InProgress";
    if (want && !poller) poller = deps.start();
    else if (!want && poller) {
      poller.stop();
      poller = null;
    }
  };
  return {
    setEnabled(v) {
      if (v === enabled) return;
      enabled = v;
      sync();
      if (!v) deps.clear();
    },
    setPhase(p) {
      if (p === phase) return;
      phase = p;
      sync();
    },
    get enabled() { return enabled; },
    get polling() { return poller != null; },
    dispose() {
      enabled = false;
      sync();
    },
  };
}
```
- **`setPhase` からは `clear()`（= `hub.dispatch`）を呼ばない**。`setPhase` は `hub.subscribe` のリスナーの中から呼ばれるので、そこで dispatch すると Hub の通知が入れ子になり、renderer に古い MatchState が後から届くおそれがある。フェーズが変わったときの `live` の消去は reducer（§5.4 `withLive`）がやる。`setEnabled(false)` は IPC から呼ばれるので dispatch してよい。

### 6.3 main.ts の配線（🔴、最小限）
`apps/desktop/src/main.ts` の `connector` を作った直後に足す。

```ts
import { startLiveClientPoller, startLcuConnector } from "@lol-viewer/lcu";
import { createLiveGate, LIVE_POLL_MS } from "./live-core.ts";

  // M-025: Live Client Data API, only while the feature flag is on and a game is in progress (GET, 127.0.0.1 only).
  const live = createLiveGate({
    start: () => {
      try {
        return startLiveClientPoller({
          intervalMs: LIVE_POLL_MS,
          onData: (raw) => {
            const e = toLcuEvent(raw);
            if (e) hub.dispatch(e);
          },
        });
      } catch (err) {
        log.warn("live", "live client poller not started", String(err)); // e.g. LOL_LIVE_CLIENT_URL not on 127.0.0.1
        return { stop: () => {} };
      }
    },
    clear: () => hub.dispatch({ type: "live-players", players: null }),
  });
  hub.subscribe((s) => live.setPhase(s.phase));
  ipcMain.on("live:set-enabled", (e, enabled: unknown) => {
    if (fromApp(e) && typeof enabled === "boolean") live.setEnabled(enabled);
  });
```
- `before-quit` の `connector.stop();` の前に `live.dispose();` を足す。
- E2E 用の `globalThis.__lolViewer` に `live` を足す（`{ hub, views, recording: rec, live }`）。
- ファイル先頭の環境変数の説明 `LOL_LIVE_CLIENT_URL` の行を「Live Client Data API base URL (fake in tests). Used by the recorder and, with the liveClientData flag on, in game」に直す。
- `packages/lcu` は変えない。`startLiveClientPoller` は既に GET だけ・ホストが 127.0.0.1 以外なら例外・中身が変わったときだけ通知、になっている。

### 6.4 記録機能との関係
`apps/desktop/src/recording.ts` は**変えない**。記録中は記録用のポーラーが今までどおり 3 秒ごとに 2999 を読む（記録はユーザーが Settings で明示的に始める別の操作で、フラグとは独立）。フラグ ON で試合中に記録すると、2 つのポーラーが別々に読む（2〜3 秒に 1 回ずつ。ローカルの軽い GET なので問題にしない）。spec と M-025 にこの関係を書く。

### 6.5 preload（🔴、最小限）
`apps/desktop/src/preload.ts` の `bridge` に足す:
```ts
  live: {
    setEnabled: (enabled: boolean) => ipcRenderer.send("live:set-enabled", enabled === true),
  },
```

### 6.6 renderer（`apps/web/src/App.tsx`、🟢）
```ts
const rawMatch = useMatchState();
const liveOn = isFeatureOn(settings, "liveClientData");
// M-025: with the flag off the app behaves as before, whatever the bridge sends.
const match = useMemo(() => (liveOn || rawMatch.live == null ? rawMatch : { ...rawMatch, live: null }), [rawMatch, liveOn]);
useEffect(() => {
  bridge.live?.setEnabled(liveOn);
}, [bridge, liveOn]);
const [ws, dispatch] = useWorkspace(match, initialWs);
```
- 今 `match` を使っている所（TopBar、SettingsPage）はそのまま `match` を使ってよい（`live` 以外は同じ）。
- renderer 側でも消すのは二重の守り。ブラウザのモック（シナリオに live の行がある場合）や Hub の WebSocket 経由でも、フラグ OFF なら表示も補正も起きない。

---

## 7. UI 仕様

### 7.1 Matchup の行（`apps/web/src/components/MatchupSection.tsx`）
- 行の中央の `<span className="vs">vs</span>` を、`rowLiveDiff(ws, i)` があるときだけ次に置き換える:
  ```tsx
  <span
    className="vs live-diff"
    data-trend={goldTrend(diff.gold)}
    data-gold-diff={diff.gold}
    data-level-diff={diff.level}
    title={`Item gold: ${allyName} ${diff.ally.itemGold.toLocaleString("en-US")} vs ${enemyName} ${diff.enemy.itemGold.toLocaleString("en-US")} · Level ${diff.ally.level} vs ${diff.enemy.level}`}
    aria-label={`Item gold difference ${formatGoldDiff(diff.gold)}${lvl ? `, level ${lvl.slice(2)}` : ""}`}
  >
    <span className="gold">{formatGoldDiff(diff.gold)}</span>
    {lvl && <span className="lvl">{lvl}</span>}
  </span>
  ```
  （`lvl = formatLevelDiff(diff.level)`、`allyName` / `enemyName` は `getChampion(...)!.name`）
- 1 行でも差を出すときは `.matchup-rows` に `has-live` クラスを付ける（中央の列を広げる）。差が無い行は今までどおり `vs`。
- 符号は味方から見た値（味方 − 敵）。プラスは味方が多い。
- 行の `data-lane` は変えない（E2E が使っている）。

### 7.2 CSS（`apps/web/src/styles.css`、既存のトークンだけ使う）
`/* Matchup */` の節の `.matchup-row .vs` の後に足す:
```css
.matchup-rows.has-live .matchup-row {
  grid-template-columns: 2rem minmax(0, 1fr) 2.4rem minmax(0, 1fr) 1.6rem;
}
.matchup-row .live-diff {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.15;
  text-transform: none; /* .vs は uppercase: "k" を "K" にしない */
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.live-diff .gold {
  font-size: 0.68rem;
  font-weight: 700;
}
.live-diff .lvl {
  font-size: 0.56rem;
  color: var(--text-2);
}
.live-diff[data-trend="ahead"] .gold {
  color: var(--success);
}
.live-diff[data-trend="behind"] .gold {
  color: var(--danger);
}
.live-diff[data-trend="even"] .gold {
  color: var(--text-3);
}
```
- サイドバー 240px では名前がほぼ隠れる（今も 240px では大きく省略される）。アイコンと差が見えれば良しとする。300px（既定）と 240px の両方の story を作り、スクショを見て確かめる。

### 7.3 Cooldowns
見た目の変更なし。対象の決め方だけ §5.6。

### 7.4 Settings > Feature flags（`apps/web/src/components/SettingsPage.tsx`）
新しいカード `FeatureFlagsCard` を作り、`SettingsPage` の `DisplayCard` と `VersionCard` の間に置く。`FEATURE_FLAG_KEYS` が空なら何も出さない（`return null`）。

```tsx
export function FeatureFlagsCard({ notify }: { notify: (text: string, kind?: ToastKind) => void }) {
  const { settings, update } = useSettings();
  const desktop = useBridge().live != null;
  if (FEATURE_FLAG_KEYS.length === 0) return null;
  return (
    <section className="card" aria-label="Feature flags">
      <h2>Feature flags</h2>
      <p className="desc">Optional features. Changes apply at once.</p>
      {FEATURE_FLAG_KEYS.map((k) => {
        const def = FEATURE_FLAGS[k];
        const on = isFeatureOn(settings, k);
        return (
          <div className="setting-row flag-row" key={k}>
            <div className="flag-text">
              <label className="setting-label" htmlFor={`flag-${k}`}>{def.label}</label>
              <span className="hint" id={`flag-${k}-desc`}>{def.description}</span>
            </div>
            <input
              id={`flag-${k}`}
              type="checkbox"
              role="switch"
              className="switch"
              checked={on}
              aria-describedby={`flag-${k}-desc`}
              onChange={(e) => {
                update({ featureFlags: { ...settings.featureFlags, [k]: e.target.checked } });
                notify(`${def.label}: ${e.target.checked ? "on" : "off"}.`, "success");
              }}
            />
          </div>
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
```
- `SettingsPage` は `notify` を既に受け取っているので、それを渡す。
- CSS: `.flag-row { align-items: flex-start; gap: 1rem; }`、`.flag-text { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }`（既存の `.setting-row` / `.hint` / `.switch` を流用）。
- 文言は英語（今の UI と同じ）。旧版の通知「(restart may be required)」は付けない（再起動不要）。

---

## 8. ファイルごとの変更一覧

| ファイル | ゾーン | 変更 |
|---|---|---|
| `packages/protocol/src/index.ts` | 🟡 | §4 のすべて（`PROTOCOL_VERSION` 3、Live Client の生データ、`LivePlayerFact`、`live-players`、`LivePlayer`、`MatchState.live`、`LiveClientControlApi`、`ItemDataSchema`） |
| `packages/core/src/live.ts`（新規） | 🟢 | §5.1〜5.3、§5.7 の表示関数、`ITEM_DATA` |
| `packages/core/src/champions.ts` | 🟢 | `getChampionByDdragonId` |
| `packages/core/src/lanes.ts`（新規） | 🟢 | `normalizeLane` を `reducer.ts` から移す（§5.1 の循環 import の注意） |
| `packages/core/src/scenario.ts` | 🟢 | `toLcuEvent` に `/liveclientdata/playerlist` |
| `packages/core/src/reducer.ts` | 🟢 | `liveFacts`、`live: null`、`step` の case、`withLive`、`reduce` |
| `packages/core/src/workspace.ts` | 🟢 | `liveApplied`、`liveLaneAssignments`、`assignmentKey`、`bestEmptyIndex`、`correctSide`、`applyLiveLanes`、`refreshMatchup`、`defaultCooldownChampion`、`rowLiveDiff` |
| `packages/core/src/settings.ts` | 🟢 | §6.1 |
| `packages/core/src/index.ts` | 🟢 | `export * from "./live.ts";` |
| `packages/core/data/items.json`（新規、生成物） | 🟢 | `pnpm champion-data --version 16.23.1` で作る。手で書かない |
| `tools/champion-data/src/index.ts` | 🟢（tools） | `DDragonItemFile` 型、`transformItems`、`formatItems`、`itemDiffLines` |
| `tools/champion-data/src/cli.ts` | 🟢（tools） | `item.json`（en_US）を取得して `items.json` を書く。要約に 1 行足す |
| `tools/champion-data/src/index.test.ts` | 🟢 | `transformItems` のテスト |
| `.github/workflows/next-champion-data.yml` | （🔴 の一覧には無いが CI 設定。PR に書く） | `add-paths` に `next/packages/core/data/items.json` を足す（複数行の書き方: `add-paths: \|` の下に 2 行） |
| `tools/fake-lcu/src/server.ts` | 🟡 | `liveClientRequests: string[]`（`/liveclientdata/` への GET のパスを記録）を `FakeLcu` に足す |
| `scenarios/live-ingame.jsonl`（新規、合成） | 🟢 | §9.3 |
| `apps/desktop/src/live-core.ts`（新規） | 🔴 | §6.2 |
| `apps/desktop/src/live-core.test.ts`（新規） | 🔴（テスト） | §9.1 |
| `apps/desktop/src/main.ts` | 🔴 | §6.3 |
| `apps/desktop/src/preload.ts` | 🔴 | §6.5 |
| `apps/desktop/src/recording.ts` | 🔴 | **変えない** |
| `packages/lcu/src/index.ts` | 🔴 | **変えない** |
| `packages/hub/src/integration.test.ts` | 🟡 | `toBe(3)`、live のテスト 1 つ（§9.1） |
| `apps/web/src/App.tsx` | 🟢 | §6.6 |
| `apps/web/src/components/MatchupSection.tsx` | 🟢 | §7.1 |
| `apps/web/src/components/SettingsPage.tsx` | 🟢 | §7.4 |
| `apps/web/src/styles.css` | 🟢 | §7.2、§7.4 の CSS |
| `apps/web/src/fixtures.ts` | 🟢 | §9.4 |
| `apps/web/src/components/Sidebar.stories.tsx`、`App.stories.tsx`、`SettingsCards.stories.tsx` | 🟢 | §9.5 |
| `e2e/storybook.spec.ts` | 🟢 | §9.6 |
| `e2e/electron-live.spec.ts`（新規） | 🟢 | §9.7 |
| `packages/core/src/*.test.ts` | 🟢 | §9.1 |
| `docs/spec/decisions.md`、`new-app-spec.md`、`new-app-design.md`、`progress.md` | — | §11 |

### 8.1 `tools/champion-data` の変更（詳細）
`index.ts`:
```ts
/** The subset of Data Dragon `item.json` we read. */
export type DDragonItem = { name: string; gold: { total: number }; consumed?: boolean };
export type DDragonItemFile = { version: string; data: Record<string, DDragonItem> };

/** item id -> counted gold (M-026): gold.total, 0 for items consumed on use. Sorted by numeric id. */
export function transformItems(file: DDragonItemFile): ItemData {
  const ids = Object.keys(file.data).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  const items: Record<string, number> = {};
  for (const id of ids) {
    const it = file.data[id]!;
    items[id] = it.consumed === true ? 0 : Math.max(0, Math.round(it.gold.total));
  }
  return ItemDataSchema.parse({ source: "Data Dragon", patch: file.version, items });
}
export const formatItems = (d: ItemData): string => JSON.stringify(d, null, 2) + "\n";
/** One summary line: "Items: 863 (5 changed)". */
export function itemDiffLine(before: ItemData | null, after: ItemData): string { ... 値が変わった ID と増減した ID の数 ... }
```
`cli.ts`: 既存の `Promise.all` に `getJson<DDragonItemFile>(`${BASE}/cdn/${version}/data/en_US/item.json`)` を足し、`packages/core/data/items.json` に `formatItems(transformItems(...))` を書く。`en.version` と item の `version` が違えば例外。要約（`summary`）の末尾に `itemDiffLine` の行を足す。

生成のしかた（実装者が 1 回だけ）: `cd next && pnpm champion-data --version 16.23.1`。終わったら `git diff --stat packages/core/data/champions.json` が空（同じ版なので変わらない）であることを確かめる。変わっていたら champions.json の変更は戻し（`git checkout -- packages/core/data/champions.json`）、items.json だけ残す。この環境から ddragon.leagueoflegends.com に届くことは確認済み（2026-11-23）。

---

## 9. テスト計画

### 9.1 単体テスト（Vitest、`pnpm test`）

**`packages/core/src/live.test.ts`（新規）**
- `itemValue` / `itemGold`: Infinity Edge（3031）=3500、Health Potion（2003, count 3）=0、Control Ward（2055）=0、Stealth Ward（3340）=0、Refillable Potion（2031）=150、Boots（1001, count 2）=600、未知の ID（999999, price 100, count 2）=200、未知かつ `consumable: true` =0、`count` 無し =1 個。`price` が `gold.total` と違っても既知の ID では使わない（例: 3031 に `price: 725` を付けても 3500）。
- `championIdFromLive`: `rawChampionName: "game_character_displayname_MonkeyKing"` → 62、`championName: "ウーコン"`（raw 無し）→ 62、`championName: "Kai'Sa"` → 145、`"kaisa"` → 145、空 → null、存在しない名前 → null。
- `hasSmite`: `rawDescription: "GeneratedTip_SummonerSpell_SummonerSmite_Description"` → true（2 枠目でも）、`displayName: "スマイト"` → true、Flash だけ → false、`summonerSpells` 無し → false。
- `normalizeLivePlayer`: `position: "UTILITY"` → support、`"MIDDLE"` → middle、`""` + Smite → jungle、`""` + Smite 無し → null、`"TOP"` + Smite → top（位置が優先）、`team: "NEUTRAL"` → null、未知のチャンピオン → null。**戻り値を `JSON.stringify` しても `riotId` / `summonerName` に入れた文字列（例 `"Secret#JP1"`）が出てこない**。
- `resolveMyTeam`: self が片方のチームだけにいる → そのチーム、self が両方にいる（ミラー）→ allies / enemies の一致で決める、self 無し → 一致で決める、同点 → null。
- `buildLivePlayers`: 6 人のチーム → null、空 → null、team の変換（mine → ally）。
- `formatGoldDiff` / `goldTrend` / `formatLevelDiff`: §5.7 の例をすべて。

**`packages/core/src/scenario.test.ts` または `reducer.test.ts`（既存のファイルに足す）**
- `toLcuEvent`: playerlist → `live-players`（壊れた 1 人は飛ばす）、Delete → `players: null`、配列でない data → null。
- （M-031 で改訂: `EndOfGame` と切断では `live` を消さずに残す。消すのは新しい試合、ChampSelect を経ない次のゲームの開始、`live-players` null。playerlist の `Delete` は無視する）
- reduce: `InProgress` 以外で来た `live-players` は無視（同じオブジェクトが返る）／`InProgress` で `live` が入る／`EndOfGame` で `live` が null／新しい試合（ChampSelect）で null／切断で null／`live-players` null で null／同じ中身の playerlist（`respawnTimer` だけ違う、など事実が同じ）は同じ MatchState オブジェクト／`current-summoner` が後から届くと `team` が作り直される（teamOne 仮定 → 正しいチーム）。
- `scenarios/live-ingame.jsonl` を `reduceAll` して、2 回目の playerlist の直後の `live` が §9.3 の表どおり（10 人、team、lane、level、itemGold）。

**`packages/core/src/workspace.test.ts`（既存に足す）**
- `liveLaneAssignments`: 5 人そろう → 5 件、同じレーンを 2 人 → そのレーンは無し、lane null は無視、同じチャンピオンが 2 人 → その子は無し。
- `correctSide`: 全員の割り当て → そのまま並ぶ／Smite だけ（jungle 1 件）→ ジャングルの子とスワップ（他は動かない）／押し出された子が 2 人 → 適性の高い空き行へ／表に居ない子の割り当ては無視／空のセルがある側／割り当てが空 → 同じ配列を返す。
- `applyMatch` + live:
  - §9.3 のシナリオ相当: チャンピオンセレクト後の推測（敵 TOP Jayce、JG Karma、MID Gragas、BOT Varus、SUP Pantheon）→ live 到着で（Pantheon、Gragas、Jayce、Varus、Karma）。味方は変わらない。
  - 補正のあと `swapRows`（敵 0↔1）→ 次の同じ live の MatchState でもスワップが保たれる（M-027）。
  - 割り当てが変わる（例: 2 回目の live で position が入った）→ もう一度直す。
  - `phase: "ChampSelect"` で `live` がある MatchState（ありえないが）→ 直さない。
  - `live: null` の MatchState だけを流したときの結果が、今の実装と同じ（既存のテストがそのまま通ること自体が確認。追加で、`live` 無しの in-game シナリオで `liveApplied` が `{null, null}` のまま）。
  - 新しい試合で `liveApplied` が戻る。`refreshMatchup` で補正がやり直される（ユーザーのスワップは消える）。
- `defaultCooldownChampion`（M-028）: 自分の行の敵／自分の行に敵がいない → レーンの行 → 最初の敵／lane null でも自分の行の敵（既存の `state(null)` は ZED に直す）／ユーザーが自分（味方）を別の行へ動かしたら、その行の敵。
- `rowLiveDiff`: 片側が空 → null、live に居ない子 → null、差の符号（味方 − 敵）。

**`packages/core/src/settings.test.ts`**
- `FEATURE_FLAGS.liveClientData.default === false`、`isFeatureOn(DEFAULT_SETTINGS, "liveClientData") === false`、保存値 true が勝つ、`resetFeatureFlags({ liveClientData: true, unknown: true })` → `{ liveClientData: false, unknown: true }`、`flagsAtDefaults`。

**`packages/core/src/champions.test.ts`**
- `it.each` のシナリオ一覧に `"live-ingame"` を足す。
- `items.json`: スキーマが通る、`ITEM_DATA.patch === CHAMPION_DATA.patch`、300 件以上、3031=3500、2003=0、3340=0。

**`tools/champion-data/src/index.test.ts`**
- `transformItems`: consumed → 0、数字でないキーは捨てる、ID 順、スキーマが通る。

**`apps/desktop/src/live-core.test.ts`（新規。フラグ OFF ⇒ ポーリングしない）**
- フラグに触れずに `setPhase("InProgress")` → `start` は 0 回、`polling` は false。
- `setEnabled(true)` だけ（フェーズ `None`）→ `start` 0 回。
- `setEnabled(true)` → `setPhase("InProgress")` → `start` 1 回。もう一度 `setPhase("InProgress")` → 増えない。
- `setPhase("EndOfGame")` → `stop` 1 回、`polling` false。
- 試合中に `setEnabled(false)` → `stop` 1 回、`clear` 1 回。`setEnabled(false)` をもう一度 → `clear` は増えない。
- `setPhase` では `clear` を呼ばない。`dispose()` → 止まる。

**`packages/hub/src/integration.test.ts`**
- `protocolVersion` を 3 に。
- 追加: `scenarios/live-ingame.jsonl` で fake LCU を起動し、`startLcuConnector` と `startLiveClientPoller({ intervalMs: 50, baseUrl: http://127.0.0.1:<fake.port> })` の両方を Hub につなぐ。InProgress と 2 回目の playerlist まで `advanceTo` し、`hub.state.live` に 10 人、`team` が §9.3 どおり、名前の文字列（`player-1` など）が `JSON.stringify(hub.state)` に無い。`fake.rejectedWrites` は空。

**`packages/recorder`** の committed scenarios テストが、新しいシナリオも検査する（何もしなくても `scenarios/*.jsonl` を全部見る）。

### 9.2 個人情報
- シナリオの名前系のキー（`riotId`、`riotIdGameName`、`riotIdTagLine`、`summonerName`、`displayName`、`rawDisplayName`）は `player-N` / `tag-N` だけにする（記録ツールの伏せ方と同じ形）。アイテムとスペルの `displayName` / `rawDisplayName` は**書かない**（伏せ方のキーに当たるので、書くなら `player-N` にしなければならず紛らわしい）。Smite は `rawDescription` で表す。

### 9.3 合成シナリオ `scenarios/live-ingame.jsonl`
1 行目はコメント: `// synthetic: ranked draft, enemies guessed by lane suitability, in-game live client player list corrects them (M-025..M-028)`

| t | uri | 中身 |
|---|---|---|
| 0 | gameflow-phase | `"Lobby"` |
| 300 | gameflow-phase | `"ChampSelect"` |
| 300 | gameflow/v1/session | `{"phase":"ChampSelect","gameData":{"gameId":5001,"queue":{"id":420,"gameMode":"CLASSIC"}}}` |
| 400 | champ-select/v1/session | `gameId` 5001、`localPlayerCellId` 2、myTeam 5 人（cell 0〜4、championId 0、assignedPosition top / jungle / middle / bottom / utility、summonerId 1000002 / 1000003 / **1000001** / 1000004 / 1000005）、theirTeam 5 人（cell 5〜9、championId 0、assignedPosition `""`、summonerId 0） |
| 800 | champ-select/v1/session | 同じで myTeam の championId を 86 / 64 / 103 / 222 / 412 |
| 1200 | champ-select/v1/session | さらに theirTeam の championId を cell 順に 126 / 79 / 80 / 110 / 43 |
| 2400 | gameflow-phase | `"GameStart"` |
| 2800 | gameflow-phase | `"InProgress"` |
| 2800 | gameflow/v1/session | `{"phase":"InProgress","gameData":{"gameId":5001,"queue":{"id":420,"gameMode":"CLASSIC"},"teamOne":[enemies],"teamTwo":[allies]}}`。teamOne: summonerId 1000101〜1000105 と 126 / 79 / 80 / 110 / 43。teamTwo: 1000002/86、1000003/64、1000001/103、1000004/222、1000005/412 |
| 2900 | current-summoner | `{"summonerId":1000001}` |
| 3500 | /liveclientdata/playerlist | 序盤（下の表 A） |
| 5000 | /liveclientdata/playerlist | 中盤（下の表 B） |
| 6900 | /liveclientdata/playerlist | `eventType: "Delete"`、`data: null`（試合が終わって API が消えた。偽 LCU は 404 を返す） |
| 7000 | gameflow-phase | `"EndOfGame"` |
| 7400 | gameflow-phase | `"Lobby"` |

チャンピオンセレクト後の自動配置（今の規則）は 敵 TOP Jayce / JG Karma / MID Gragas / BOT Varus / SUP Pantheon になる（2026-11-23 に core で確認済み）。live の位置では TOP Pantheon / JG Gragas / MID Jayce / BOT Varus / SUP Karma。

playerlist の 1 人分の形（この順で 10 人。ORDER = 敵 5 人、CHAOS = 味方 5 人。名前系は `player-1`〜`player-10`、`tag-1`〜`tag-10`）:
```json
{"championName":"ジェイス","rawChampionName":"game_character_displayname_Jayce","team":"ORDER","position":"MIDDLE","level":11,"isBot":false,"isDead":false,"respawnTimer":0,"riotId":"player-1","riotIdGameName":"player-1","riotIdTagLine":"tag-1","summonerName":"player-1","scores":{"kills":3,"deaths":2,"assists":1,"creepScore":140,"wardScore":6},"summonerSpells":{"summonerSpellOne":{"rawDescription":"GeneratedTip_SummonerSpell_SummonerFlash_Description"},"summonerSpellTwo":{"rawDescription":"GeneratedTip_SummonerSpell_SummonerTeleport_Description"}},"items":[{"itemID":6692,"count":1,"price":625,"consumable":false,"canUse":false,"slot":0}]}
```
- `championName` は日本語クライアントを想定して日本語名（ガレン、リー・シン、アーリ、ジンクス、スレッシュ、ジェイス、グラガス、パンテオン、ヴァルス、カルマ）。`rawChampionName` の Data Dragon ID は Garen、LeeSin、Ahri、Jinx、Thresh、Jayce、Gragas、Pantheon、Varus、Karma。
- **`price` にはわざと Data Dragon の `gold.base`（合成の差額）を入れる**。`price` を足してしまう実装はテストで落ちる。
- Smite: Lee Sin と Gragas の `summonerSpellTwo.rawDescription` を `GeneratedTip_SummonerSpell_SummonerSmite_Description` にする。他は Flash + Teleport / Ignite / Heal / Exhaust（`GeneratedTip_SummonerSpell_SummonerDot_Description` など。中身は判定に使わない）。
- `consumable` は 2003 と 2055 だけ true。`slot` は 0 から順に。

**表 A（t=3500、全員レベル 1）**

| team | チャンピオン | position | アイテム（itemID ×count、price） | itemGold |
|---|---|---|---|---|
| ORDER | Jayce | MIDDLE | 1055（450）、2003 ×1（50） | 450 |
| ORDER | Gragas | JUNGLE | 1101（450） | 450 |
| ORDER | Pantheon | TOP | 1055（450）、2003 ×1（50） | 450 |
| ORDER | Varus | BOTTOM | 1055（450）、2003 ×1（50） | 450 |
| ORDER | Karma | UTILITY | 3865（400） | 400 |
| CHAOS | Garen | TOP | 1055（450）、2003 ×1（50） | 450 |
| CHAOS | Lee Sin | JUNGLE | 1102（450） | 450 |
| CHAOS | Ahri | MIDDLE | 1056（400）、2003 ×2（50） | 400 |
| CHAOS | Jinx | BOTTOM | 1055（450）、2003 ×1（50） | 450 |
| CHAOS | Thresh | UTILITY | 3865（400） | 400 |

差（補正後の行）: TOP `0`、JG `0`、MID `-50`、BOT `0`、SUP `0`。レベル差なし。

**表 B（t=5000）**

| team | チャンピオン | position | level | アイテム（itemID ×count、price = gold.base） | itemGold |
|---|---|---|---|---|---|
| ORDER | Jayce | MIDDLE | 11 | 6692（625）、3047（600）、1036（350）、1036（350）、3340（0） | 4800 |
| ORDER | Gragas | JUNGLE | 9 | 1101（450）、3802（250）、3020（800）、3364（0） | 2750 |
| ORDER | Pantheon | TOP | 10 | 3142（675）、3047（600）、1036（350）、2003 ×1（50）、3340（0） | 4350 |
| ORDER | Varus | BOTTOM | 11 | 6672（325）、3006（300）、1038（1300）、1055（450）、3340（0） | 5850 |
| ORDER | Karma | UTILITY | 8 | 3876（0）、6617（500）、1001（300）、2055 ×2（75）、3364（0） | 2900 |
| CHAOS | Garen | TOP | 11 | 3071（225）、3047（600）、1029（300）、2003 ×2（50）、3340（0） | 4500 |
| CHAOS | Lee Sin | JUNGLE | 10 | 1102（450）、3142（675）、3158（350）、2055 ×1（75）、3364（0） | 4150 |
| CHAOS | Ahri | MIDDLE | 12 | 6655（450）、3020（800）、1056（400）、1052（400）、3340（0） | 4650 |
| CHAOS | Jinx | BOTTOM | 10 | 6672（325）、3006（300）、1036（350）、1055（450）、3340（0） | 4900 |
| CHAOS | Thresh | UTILITY | 8 | 3877（0）、3190（700）、1001（300）、3364（0） | 2900 |

（itemGold は Data Dragon 16.23.1 の `gold.total` で計算済み。items.json を作り直したら、この値になることをテストで確かめる。）

差（補正後の行、味方 − 敵）:

| 行 | 味方 vs 敵 | gold | 表示 | trend | level | 表示 |
|---|---|---|---|---|---|---|
| TOP | Garen vs Pantheon | +150 | `+150` | ahead | +1 | `Lv+1` |
| JG | Lee Sin vs Gragas | +1400 | `+1.4k` | ahead | +1 | `Lv+1` |
| MID | Ahri vs Jayce | -150 | `-150` | behind | +1 | `Lv+1` |
| BOT | Jinx vs Varus | -950 | `-950` | behind | -1 | `Lv-1` |
| SUP | Thresh vs Karma | 0 | `0` | even | 0 | （出さない） |

Cooldowns の既定: live 到着前（フラグ OFF を含む）は **Gragas**（推測の MID の敵）、到着後は **Jayce**。

### 9.4 fixtures（`apps/web/src/fixtures.ts`）
- `replay(count)` を `replayEvents(events, count)` に一般化する（既存の呼び出しは `replayEvents(events, n)`）。
- 新しいシナリオを `?raw` で読み、`liveEvents = [connect, ...scenarioEvents(parseScenario(liveText))]`。
- `liveScenes`:
  - `inGameGuessed`: `current-summoner` まで（live 無し）。
  - `liveEarly`: 1 回目の `live-players` まで。
  - `liveMid`: 2 回目の `live-players` まで。
  - `liveFlagOff`: 2 回目の `live-players` の位置まで、ただし `live-players` のイベントを**取り除いて**流したもの（main がポーリングしない状態と同じ）。
  - `liveSwappedAfter`: `liveMid` に `act(..., { type: "swapRows", side: "enemy", from: 0, to: 4 })` してから、`liveMid.match` をもう一度 `{type: "match"}` で流したもの（スワップが保たれる絵）。

### 9.5 stories
- `Sidebar.stories.tsx`: `Demo` に `width?: number`（既定 320）を足す。`MatchupLive`（`liveScenes.liveMid`）、`MatchupLiveNarrow`（同じ、width 240）、`MatchupLiveEarly`（`liveEarly`）、`MatchupInGameFlagOff`（`liveFlagOff`）、`MatchupLiveSwapKept`（`liveSwappedAfter`）。
- `App.stories.tsx`: `InGameLive`（`liveScenes.liveMid`、`settings: { ...DEFAULT_SETTINGS, featureFlags: { liveClientData: true } }`）、`InGameLiveFlagOff`（`liveScenes.liveFlagOff`、既定の設定）。
- `SettingsCards.stories.tsx`: `Wrap` に `settings?: Settings` を足して `Harness` に渡す。`FeatureFlags`（既定 OFF）、`FeatureFlagsOn`（ON。Reset が押せる）。`FeatureFlagsCard` には `notify={() => {}}`。

### 9.6 Storybook の E2E（`e2e/storybook.spec.ts`）
1. `in game with live data: enemies moved to their lanes, gold and level diffs, cooldowns on my lane opponent`（`screens-app--in-game-live`）:
   - 敵の名前を行順に `.matchup-row .side.enemy .name` で `["Pantheon", "Gragas", "Jayce", "Varus", "Karma"]`。
   - `.matchup-row[data-lane="jungle"] .live-diff .gold` が `+1.4k`、`.live-diff` の `data-trend` が `ahead`。MID は `-150` / `behind`、SUP は `0` / `even`、BOT の `.lvl` が `Lv-1`、SUP に `.lvl` が無い。
   - Cooldowns の `.cd-champ` が `Jayce`。
2. `live data flag off: the table and cooldowns are as before`（`screens-app--in-game-live-flag-off`）: 敵が `["Jayce", "Karma", "Gragas", "Varus", "Pantheon"]`、`.live-diff` が 0 個、`.matchup-row .vs` が 5 個とも `vs`、Cooldowns が `Gragas`。
3. `Settings: the live data flag is off by default, toggles at once and resets`（`screens-app--settings`）: region `Feature flags` の switch `Live game data` が未チェック、Reset が無効。クリックでチェック、トースト `Live game data: on.`、Reset が有効。Reset で未チェックに戻り `Feature flags reset to defaults.`。
4. 既存の `cooldowns default to my lane's enemy and follow clicks` は `Zed` のまま通ること（ranked のシナリオでは自分の行＝MID）。
- 全 story のスクショは既存の仕組みで `e2e/screenshots/storybook/` に出る。`components-sidebar--matchup-live`、`--matchup-live-narrow`、`screens-app--in-game-live` を**自分で開いて**、差が読めること、240px で崩れない（はみ出さない、行の高さが変わらない）ことを確かめる。

### 9.7 Electron の E2E（`e2e/electron-live.spec.ts`、新規）
`electron-recorder.spec.ts` と同じ起動のしかたで、`scenarios/live-ingame.jsonl`、`LOL_LIVE_CLIENT_URL: http://127.0.0.1:${fake.port}`。`test.describe.configure({ mode: "serial" })` で次の順:
1. **フラグ OFF ではポーリングしない**: 接続を待つ → `t=5000` まで `advanceTo`（`page.waitForTimeout(10)` を挟む）→ 5 秒待つ → `fake.liveClientRequests` が空、`__lolViewer.live.polling` が false、`.live-diff` が 0 個、敵の並びが推測どおり（JG が Karma）。
2. **ON にすると再起動なしで読み始める**: Settings → `Live game data` の switch → Viewers へ戻る → `expect.poll(fake.liveClientRequests.length) > 0`（10 秒）→ JG の `.gold` が `+1.4k`、敵が `["Pantheon", "Gragas", "Jayce", "Varus", "Karma"]`、Cooldowns が `Jayce`。`grabScreen("live-on")` でスクショ。
3. **ユーザーの入れ替えは次のポーリングでも保たれる**: 敵の TOP を SUP の行へドラッグ（既存の storybook の DnD テストと同じ操作）→ 5 秒待つ → 入れ替えたまま。
4. **OFF に戻すと止まり、表示が消える**: Settings で OFF → `.live-diff` が 0 個、`__lolViewer.live.polling` false、リクエスト数を記録して 5 秒待っても増えない（実行中の 1 回分の +1 は許す）。
5. **試合が終わると止まる**: もう一度 ON → `t=7400`（EndOfGame → Lobby）まで進める → `polling` が false、`.live-diff` は残る（M-031）。続けて ChampSelect を流すと `.live-diff` が 0 個。
- `fake.rejectedWrites` が空。

---

## 10. 実装の順序

各段で `pnpm typecheck && pnpm test` を通してから次へ進む。

1. **protocol**: §4 を入れる。`PROTOCOL_VERSION` 3、hub テストの `toBe(3)`。
2. **アイテムデータ**: `tools/champion-data` に §8.1 → テスト → `pnpm champion-data --version 16.23.1` で `items.json` を作る（champions.json が変わらないことを確認）→ workflow の `add-paths`。
3. **core/live.ts**: §5.1〜5.3、§5.7 の表示関数、`getChampionByDdragonId`、`live.test.ts`。
4. **シナリオ**: `scenarios/live-ingame.jsonl`（§9.3）。`pnpm test` の個人情報検査が通ること。
5. **toLcuEvent と reducer**: §5.1 の case、§5.4。シナリオで `live` が表 B どおりになるテスト。
6. **workspace**: §5.5、§5.6、§5.7 の `rowLiveDiff`。テスト（§9.1）。既存テストの `state(null)` を直す。
7. **settings**: §6.1 とテスト。
8. **fixtures → stories**（§9.4、§9.5）。この時点では UI はまだ差を出さないので、story は「敵の並びが直る」「Cooldowns が Jayce」だけが見える。
9. **UI**: §7.1、§7.2（MatchupSection、CSS）、§7.4（FeatureFlagsCard）、§6.6（App）。story のスクショを見る。
10. **Storybook の E2E**（§9.6）。
11. **fake-lcu**: `liveClientRequests`。
12. **desktop**（🔴）: `live-core.ts` と `live-core.test.ts`、`main.ts`、`preload.ts`。
13. **hub の結合テスト**（§9.1）と **Electron の E2E**（§9.7）。
14. **ドキュメント**（§11）。
15. 完了の定義のコマンド（§14）を全部流し、スクショを見て、PR 本文（§12）を書く。コミットは `chore(next):` / `test(next):` / `docs(next):`。

---

## 11. 仕様書の更新箇所

**decisions.md**: §2 の表の 5 行と §2.1 の節。

**new-app-spec.md**
- 冒頭の「最終確認」の日付と内容。
- §1: 「LCU への操作は GET と WAMP の購読だけ」の後に「試合中は、Feature Flag `liveClientData` が ON のときだけ、ゲームの Live Client Data API（127.0.0.1:2999）の `/liveclientdata/playerlist` を 2 秒ごとに GET する（M-025）」。
- §1.2 の表: MatchState の内容に「試合中のデータ（`live`: チャンピオン、味方/敵、レーン、レベル、推定ゴールド。名前なし）」。Settings の内容の Feature Flag に `liveClientData`。
- §2.2 Matchup: 行の形に「試合中のデータがあれば、`vs` の代わりに味方 − 敵のアイテムゴールド差（`+1.4k`、緑 / 赤 / 灰）と、違えばレベル差（`Lv+1`）。ツールチップに両方の金額とレベル」。自動配置の参照に §3.4 の補正を足す。
- §2.2 Cooldowns: 既定を M-028 の順に直す。
- §2.4 Settings: カードの表に `Feature flags` の行（Display と Version の間。`Live game data` の switch、説明、`Reset flags to defaults`、通知の文言、ブラウザでの注記）。表の下の「Feature Flag の仕組みは…画面には出さない」の段落を「定義（`FEATURE_FLAGS`）が 1 つ以上あるときカードを出す。今は `liveClientData` だけ」に直す。
- §3.1 の 7.（「LCU へ書き込む API は持たない」）の後に、Live Client Data API の扱い（ホスト 127.0.0.1 だけ、GET だけ、認証なし、200 以外は黙って次へ）。
- §3.2 の表に行を足す: 「試合中のデータ」= `InProgress` の間だけ受け取る。それ以外のフェーズで来たものは捨てる。フェーズが `InProgress` 以外になる、新しい試合、切断、一覧の削除で消える。自分のチームは M-029。アイテムの金額は M-026。
- §3.4 に補正の規則（§5.5 の「規則のまとめ」）を足す。
- §3.5: 「ポーリングは無い（M-010）」を「LCU はポーリングしない（M-010）。例外: 試合中の Live Client Data API（M-025、Feature Flag、既定 OFF）」に。
- 新しい節 §3.6「試合中のデータ（Live Client Data API）」: §3 の図、ゲートの条件、記録機能との関係（§6.4）、Feature Flag の伝え方（IPC `live:set-enabled`）。
- §5 の表: `featureFlags` の行を「名前 → 真偽。定義: `liveClientData`（既定 偽）。保存済みの未定義のキーは掃除しない（M-016）」に。
- §6.3 開発・テスト用の入口: `LOL_LIVE_CLIENT_URL`、`__lolViewer.live`。
- §8 の移植チェック表: 01「Feature Flags の画面」→ 実装済み（カード、即保存、即反映、Reset。旧版の「restart may be required」は出さない）。03「（参考）Live Client Data API」と §8.3 の 823 行目（「記録機能だけが使う」）を「記録機能と、フラグ ON の試合中のゴールド差・補正」に。
- §9.1: 本物のゲームでの Live Client Data API（§13 の項目）。

**new-app-design.md**: §1 の全体構成の図に Live Client の矢印、§2（MatchState の規則）に `live`、§3.1 に補正（M-027）、§3.3 の派生値に `rowLiveDiff` と `defaultCooldownChampion`（M-028）。

**progress.md**: 「1. 機能」に行を足す: 「試合中のゴールド差と対面表の補正（Live Client Data API、Feature Flag） | ✅ | `core/live.ts`、`workspace.ts`、`apps/desktop/src/live-core.ts` | M-025〜M-029。実機のゲームでは未確認」。Cooldowns の行の備考に M-028。Settings の Feature Flag の行を足す（または既存の行に）。「3. 実機で確認が必要なこと」に §13 の項目。最終更新の日付。

README.md（docs/spec）の表には、この文書の行を設計時に追加済み。

---

## 12. PR に書くこと

- **🔴 `apps/desktop`**（人間のレビュー必須）:
  - `main.ts`: Live Client のゲート（`live-core.ts`）を作り、`hub.subscribe` でフェーズを渡す。IPC `live:set-enabled` を 1 つ足した（自分の renderer から、`boolean` のときだけ受け付ける）。終了時に止める。
  - `preload.ts`: `bridge.live.setEnabled(boolean)` を 1 つ足した（`ipcRenderer.send` だけ。新しい権限、Node、外部ビューへの露出は無い）。
  - `live-core.ts`（新規）: フラグ ON かつ `InProgress` の間だけポーラーを動かす。既定は OFF。単体テストあり。
  - `recording.ts` は変えていない（記録中のポーラーはフラグと独立。M-025）。
- **🔴 `packages/lcu`**: **変更なし**。既存の `startLiveClientPoller`（GET だけ、127.0.0.1 だけ、`/liveclientdata/playerlist` だけ）を使う。新しいパスも書き込み系も足していない。
- **🟡 `packages/protocol`**: MatchState に `live` を足し `PROTOCOL_VERSION` を 3 にした。LcuEvent に `live-players`、ブリッジに `live`、アイテムデータのスキーマ。全層のテスト（core / hub / web の型、Storybook、Electron E2E）を通した。
- **🟡 `tools/fake-lcu`**: `/liveclientdata/` への GET を `liveClientRequests` に記録（フラグ OFF で問い合わせないことの E2E 用）。
- **🟡 `packages/hub`**: テストの変更だけ（`protocolVersion` 3、live の結合テスト）。
- **CI 設定**: `next-champion-data.yml` の `add-paths` に `items.json` を足した（週次の自動更新に含めるため）。
- **M-010 の例外**であること、既定 OFF であること、名前を MatchState に入れないこと、何も保存しないこと。
- 変更前後のスクショ: Matchup（ranked の in-game、フラグ OFF / ON）、240px、Settings の Feature flags カード。
- **実機で確かめていないこと**（§13）を列挙する。

---

## 13. リスク、実機でしか確かめられないこと

- **`position` の中身**: ランク / ノーマルドラフトでは割り当てられたロール（ゲーム内で入れ替えたロールではない）と考えている。ロールを交換したプレイヤーは間違った行に置かれる（ユーザーがドラッグで直せば、その後は保たれる）。ブラインド、ARAM、カスタムで `""` になることも未確認（`""` 以外の値、例えば `"NONE"` でも null になるように作ってある）。
- **`items[].price` の意味**: 未確認なので既知のアイテムでは使わない（M-026）。新パッチのアイテムが `items.json` に入るまでの間だけ使う。
- **ロード画面**: playerlist が 404 を返すのか、部分的なリストを返すのか未確認。部分的なリストでも 2 チーム × 5 人以下なら使い、割り当てが増えれば補正をやり直す（M-027 の「変わったときだけ」）。
- **自分のチームの判定**: ふつうは `self`（チャンピオンセレクトのピック）で決まる。アプリを試合中に起動した場合は `self` が無く、gameflow の味方（summonerId で判定済み）との一致で決める。ミラー（ブラインドの同じチャンピオン同士、One for All）で決まらないときは試合中のデータを使わない。
- **自己署名証明書**: 2999 は自己署名の https。`startLiveClientPoller` はこのリクエストだけ検証を緩めている（既存）。実機での動作は記録機能でも未確認。
- **Smite の判定**: `rawDescription` / `rawDisplayName` の `SummonerSmite` を探す。Smite の内部名が変わると判定できない（その場合は補正が起きないだけ）。
- **ゴールド差の意味**: アイテムの金額だけで、所持金や消耗品は含まない。買い物に戻るまでは実際の差より小さく見える。ツールチップに「Item gold」と書いて区別する。
- **性能**: 2 秒ごとの GET 1 回、MatchState の JSON 比較 1 回。ゴールドやレベルが変わらなければ renderer には送らない（中身が同じなら同じ MatchState）。
- **CI で確かめられないもの**: 本物のゲームクライアント（127.0.0.1:2999）、日本語クライアントの `championName`、Vanguard 環境での 2999 への接続。

---

## 14. 完了の定義のコマンドと、この環境（Linux コンテナ）での可否

```bash
cd next
pnpm typecheck && pnpm test && pnpm storybook:build && pnpm e2e:storybook
pnpm desktop:build && xvfb-run -a pnpm e2e:electron
```
2026-11-23 の調査時点:
- `pnpm`（10.28.0）、Node 22、`xvfb-run` はある。`pnpm install --frozen-lockfile` は通る。
- `pnpm typecheck`、`pnpm test`、`pnpm storybook:build`、`pnpm desktop:build` は動くはず。
- `pnpm e2e:storybook` / `e2e:electron` には Playwright のブラウザ（`~/.cache/ms-playwright` が無い）が要る: `pnpm exec playwright install chromium`。
- Electron の本体（`node_modules/.pnpm/electron@45.2.2/node_modules/electron/dist`）はインストールスクリプトが実行されておらず無い: `node node_modules/.pnpm/electron@45.2.2/node_modules/electron/install.js`（github.com には届く）。
- スクショの全画面取得（`import`、ImageMagick）が無ければ Electron の `grabScreen` は黙って飛ばす（既存の動作）。その場合は Storybook のスクショで見た目を確かめ、PR にその旨を書く。
- どれかが動かせなかったら、動かせなかったコマンドと理由を PR に書く（「通った」と書かない）。

---

## 15. 実装メモ（設計からの差異、2026-11-23）

設計どおりに実装した。次の小さな差異だけある。

- `correctSide`（§5.5）: 結果が現在の並びと同じなら、新しい配列を作らず渡された `rows` をそのまま返す（`applyLiveLanes` が「変わらなければ同じ Workspace」を返せるように）。挙動は同じ。
- `.switch`（`styles.css`）に `flex: none` を足した。`FeatureFlagsCard` の説明文が長いと、flex の行の中で switch が潰れて見えたため（既存の Display カードでは起きなかった）。
- `staticBridge` のオプションに `live`（Settings の注記を出さないための stub）を足した（stories 用）。
- Storybook の E2E に、設計の 3 本に加えて 1 本（`components-sidebar--matchup-live-swap-kept`: 補正のあとの入れ替えが保たれる絵）を足した。`SettingsCards.stories.tsx` に `FeatureFlagsBrowser`（ブラウザ: 「desktop app」の注記）を足した。
- hub の結合テスト（§9.1）は、偽 LCU のイベントを `advanceTo` で一度に流すと WAMP の購読が間に合わず取りこぼすことがあったので、Electron の E2E と同じく 10ms ずつ進める。
