# Teams: 気に入ったチーム分けの保存（Matchups タブ）とメンバーの組の保存 設計書

- 状態: 実装済み（2026-11-28）。
- 決定番号: M-042（§7。decisions.md に追記する）。
- 前提: [teams-ui-v2-design.md](./teams-ui-v2-design.md)（M-040 の Match / People）、M-041（Add people のモーダル）。
- 持ち主の声（2026-11-28）:
  1. Match / People の横に Matchups のようなタブを作り、気に入ったチーム分けを保存できるようにしたい。
  2. Match で決めた内容も、名前を付けて保存して後で開けるようにしたい。保存するのは**誰を入れたか**だけでよい。

---

## 1. 2 つの「保存」

| | メンバーの組（Roster） | チーム分け（Matchup） |
|---|---|---|
| 何を保存するか | 参加にチェックした人の一覧（PUUID）だけ | 青と赤のチームの人とレーン |
| どこで保存するか | Match の Players の見出しの `Rosters ▾` | Match の提案の `☆ Save` |
| どこで開くか | 同じ `Rosters ▾` から選ぶ → Match のチェックがその組になる | 新しいタブ **Matchups** の一覧 → `Open in Match` |
| 使いどころ | 「いつもの 10 人」「金曜の 8 人」 | 「この分け方がよかった」を残す・Discord に貼り直す |

保存先はどちらも renderer の settings（localStorage。手動の好みと同じ）。端末の外には出さない。

---

## 2. メンバーの組（Roster）

### 2.1 データ（`settings.teamRosters`）
```ts
type SavedRoster = { id: string; name: string; puuids: string[]; savedAt: number };
```
- 名前は 1〜40 文字（前後の空白を除く）。同じ名前は 1 つだけ（大文字小文字を区別しない）。
- `puuids` は 1〜20 人。最大 50 組。
- tolerant parse（壊れた組だけ捨てる。PUUID は `PROBE_PUUID_RE` 相当で検査）。

### 2.2 画面（Match）
- Players の見出しの右に `Rosters ▾`（メニューボタン）。中身:
  - `Save current as…` → 小さなモーダル（名前の入力。既定 `Roster 11/28`。同じ名前があれば「`Friday 8` を上書きします」と出して `Overwrite` ボタンに変わる）。参加者が 0 人なら無効。
  - 保存した組の一覧（新しい順、最大 10 件を表示。`n people` を添える）→ 選ぶと**読み込み**。
  - `Manage rosters…` → モーダルで全件の一覧（名前の変更・複製・削除・人数・保存日）。
    - `Duplicate`: 同じ人の組を `<名前> (copy)`（あれば `(copy 2)`、`(copy 3)` …。大文字小文字を区別せず、40 文字に収まるよう元の名前を切る）で作り、保存日は今。一覧の先頭に出て、名前の欄が開いてフォーカスされる（そのまま名前を付けられる。Esc で自動の名前のまま残る）。上限 50 を超えるときは保存と同じく一番古いものを捨てるが、複製元は捨てない。
- 読み込み:
  - 組にいる人 = 参加（☑）、それ以外の候補 = 控え（☐）。
  - 組にいて今の候補にいない人は、People に保存されていれば「足した人」として一覧に加える（M-040 の Add people と同じ）。People にもいない人は加えられないので、toast で `2 people in "Friday 8" are not in People. Add them from People › Add.` と出す。
  - 読み込んだ組の名前を Players の見出しの下に小さく出す（`Roster: Friday 8`。チェックを変えたら `Roster: Friday 8 (edited)`）。
- ロビーが変わっても、読み込んだ組のチェックは保つ（M-038 のロビーの振り分けの規則より、組の読み込みを優先。新しくロビーに入った人は既定どおり）。

---

## 3. チーム分け（Matchup）と Matchups タブ

### 3.1 データ（`settings.teamMatchups`）
```ts
type SavedMatchup = {
  id: string; name: string; savedAt: number;
  blue: { puuid: string; lane: Lane | null }[];   // 3〜5 人
  red:  { puuid: string; lane: Lane | null }[];
  // 保存した時点の表示用の控え（キャッシュが消えても一覧を出せるように）
  people: Record<string, { gameName: string; tagLine: string; rankLabel: string }>;
  priority: "rankFirst" | "laneFirst";
};
```
- 名前の規則は Roster と同じ。最大 100 件。tolerant parse。

### 3.2 保存（Match の提案）
- 提案の見出しの右に `☆ Save`。押すと小さなモーダル（名前。既定 `Matchup 11/28 #3`。上書きの扱いは Roster と同じ）。
- 保存されるのは**今表示している案**（手で入れ替えた `Edited` の状態も含む）。
- 保存済みと同じ組み合わせ（青赤の人とレーンが同じ。青赤の入れ替えも同じとみなす）を表示しているときは、`☆` を `★ Saved as "…"` にする。

### 3.3 Matchups タブ（`Match | People | Matchups n`）
- 保存したチーム分けのカードの一覧（新しい順）。カード:
  - 見出し: 名前、保存日、`Rank priority` / `Lanes priority`。
  - 青と赤の表（レーン、名前、**保存時の**ランクの札）。今のランクと違う人は札の横に小さく今の値（`G2 → G1`）。
  - 下に今のデータで計算し直した差（`Rank diff now 12`。人が People から消えていれば出さない）。
  - 操作: `Copy for Discord`（M-038 の形式。見出しは保存名）、`Open in Match`、`⋯`（Rename / Delete。Delete は 2 回押し）。
- 検索（名前・人の名前）。0 件のときは「Save a proposal in Match with ☆ Save.」。

### 3.4 Open in Match
- Match に切り替え、チェックをその Matchup の人だけにし（読み込みの規則は §2.2 と同じ）、提案の欄にその分け方を `Edited` と同じ扱いで出す（見出しに `Saved: <名前>`、`Reset` で通常の提案に戻る）。
- People にいない人がいれば §2.2 と同じ toast。そのときは提案を出さず、通常の提案に戻す。

---

## 4. core（`packages/core`）
- `settings.ts`: `teamRosters`、`teamMatchups` のスキーマ・既定値（空配列）・tolerant parse・上限。
- `teams/saved.ts`（新）:
  - `normalizeName(name)`、`findByName(list, name)`（大文字小文字を無視）。
  - `upsertRoster(list, { name, puuids }, now, id?)` / `renameRoster` / `deleteRoster`（Matchup も同様）。上限を超えたら一番古いものを捨てる。
  - `duplicateRoster(list, id, now)`: 名前の付け方と上限は §2.2。
  - `applyRoster(candidates, roster, savedPlayers)`: `{ moved, extras, missing }`（Match のチェックと足した人、People にいない人）。
  - `sameMatchup(a, b)`: 青赤の入れ替えとチーム内の並びを無視して比べる。
  - `matchupFromProposal(proposal, info, view, name, now)`。
- それぞれ単体テスト（名前の規則、上書き、上限、壊れたデータ、applyRoster の 3 つの場合、sameMatchup）。

## 5. web（`apps/web/src/components/teams/`）
- `TeamsPage`: サブタブに `Matchups`（件数）。`Open in Match` からの切り替え。
- `MatchView`: `Rosters ▾`、Roster のモーダル（保存・管理）、読み込みの表示。
- `ProposalPanel`: `☆ Save` と保存のモーダル、外から渡された分け方（`Saved: …`）の表示と `Reset`。
- `MatchupsView`（新）: カードの一覧。
- モーダルは M-041 と同じ作り（Match / Matchups の画面の中に置く、Tab はモーダルの中だけ、Esc / 背景クリックで閉じてフォーカスを戻す）。共通の `Modal` 部品にまとめてよい（Add people もそれを使う形に直してよい）。
- ネイティブの prompt / confirm は使わない。文言は英語、Discord の文字列だけ日本語。

## 6. テスト
- core の単体テスト（§4）。
- stories: Rosters メニュー（空 / 3 件）、保存のモーダル（上書き表示）、管理のモーダル、Matchups（空 / 3 件 / 今のランクと違う人あり）、Open in Match 後の提案。
- Storybook E2E: Roster を保存 → チェックを変える → 読み込みで戻る（`(edited)` の表示も）。提案を `☆ Save` → Matchups に出る → `★ Saved as` の表示 → Rename / Delete → `Open in Match` で同じ分け方が出る → `Reset`。People にいない人を含む組の読み込みで toast。
- Electron E2E（既存の Teams の流れに 1 本）: Roster と Matchup を保存 → アプリを再起動しても残っている（localStorage）。
- スクショは自分で開いて確かめる。

## 7. 決定: M-042（decisions.md に追記する）

## M-042 Teams のメンバーの組とチーム分けの保存（2026-11-28）
- Match で、参加にチェックした人の組（Roster）に名前を付けて保存し、`Rosters ▾` から読み込める。保存するのは人の一覧だけ。
- Match の提案を `☆ Save` で名前を付けて保存できる（手で入れ替えた案も）。保存したチーム分けは新しいサブタブ **Matchups** に一覧で出し、`Copy for Discord`、`Open in Match`、名前の変更、削除ができる。表示用に保存時の名前とランクの札を控えておく。
- 保存先は renderer の settings（localStorage）。Roster は最大 50、Matchup は最大 100。デスクトップ（main）と LCU の変更は無い。

---

## 実装メモ（2026-11-28）

設計から変えた点・補った点:
- **`SavedPerson` に `points?: number | null` を足した**（§3.1 の型に無い）。Matchups の `Copy for Discord` が平均ランクとランク差（`ランク差 n`）を保存時の値で出せるようにするため。無い（古いデータ）ときは平均が出ない。
- **戻り値**: `upsertRoster` / `upsertMatchup` / `duplicateRoster` は `{ list, item, replaced }` を返す（`item` は保存・複製されたもの。名前や人数が不正なら `null` で一覧はそのまま）。`matchupFromProposal` は `id` の無い保存用の値を返し、`upsertMatchup` が `id` と `savedAt` を付ける。`matchupDiscordText(matchup, options)`、`missingPeopleText(name, n)`、`defaultRosterName` / `defaultMatchupName` も `teams/saved.ts` にある。
- **上書きの名前**: 同じ名前（大文字小文字を区別しない）で保存すると、入力した綴りの名前で置き換える（`TEN PEOPLE` で上書きすると名前も `TEN PEOPLE` になる）。id は保つ。
- **共通の `Modal`**（`Modal.tsx`）にまとめ、Add people もそれを使う。名前を聞く `NameDialog`（Roster の保存・Matchup の保存と名前の変更）と `RosterManager`（Manage rosters…）を足した。Roster の名前の変更は一覧の行の中で行う（モーダルの重なりを避ける）。名前の欄の Esc は欄だけを閉じ、モーダルは閉じない。
- **`★ Saved as "…"`** は押せる。押すと保存のモーダルが保存済みの名前で開く（`Overwrite` になる）。
- **`Open in Match` の提案**は、Priority の切り替え・`◀ ▶`・`Reset` のどれかで通常の提案に戻る（Reset は保存した分け方の Priority の提案に戻る）。チェックを変えて人が変わっても戻る。入れ替えは `Edited` と同じ（見出しは `Saved: <名前> (edited)`）。
- **ロビーが変わったときの Roster のチェック**は、これまでの `moved` の規則のまま（ロビーの人が変わっても保つ。ロビーから出たときだけロビー由来の選択を捨てる）。読み込んだ組に戻るための特別な記憶は持たない。
- **Matchups の `Copy for Discord`** は保存した名前とランクの札で作る。6・8 人の `(MID)` だけは今の得意レーンから出す。Clipboard が断られたらカードの中に文字列を出して全選択する。
- 保存日の表示は `Nov 28` の形（端末の地域設定の日付）。
- 上限（Roster 50 / Matchup 100）は、読み込み（tolerant parse）でも保存でも、一番古いものから捨てる。
