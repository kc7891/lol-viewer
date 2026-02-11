# champion_lane.csv を champions.json に統合する計画

## 概要

`fetch_champions.py` が `champions.json` を生成する際に、`champion_lane.csv` を読み込み、各チャンピオンにレーン適性情報（top / jg / mid / bot / sup）を付与する。

---

## 1. 変更対象ファイル

### `fetch_champions.py`

#### 1-1. CSV 読み込み関数の追加

新規関数 `load_lane_data(csv_path: str) -> dict` を追加する。

- `champion_lane.csv` を読み込み、チャンピオン名をキーとしたレーン情報の辞書を返す
- CSV の `name` 列は表示名形式（スペース・アポストロフィ等を含む）なので、JSON 側のキー形式（小文字・記号なし・スペースなし）に正規化する処理が必要
- 正規化ルールは後述の「名前マッピング」セクションに従う

#### 1-2. `build_champion_dictionary()` の変更

- 既存のチャンピオン辞書を構築した後、`load_lane_data()` を呼び出す
- 各チャンピオンのエントリに `lanes` フィールド（もしくは `top`, `jg`, `mid`, `bot`, `sup` の各フィールド）を追加する
- CSV に存在しないチャンピオンにはデフォルト値（全て 0）を設定する

#### 1-3. `get_fallback_champion_data()` の変更

- この関数も同様に、辞書構築後にレーン情報をマージする
- `build_champion_dictionary()` と共通のマージロジックを使う

#### 1-4. 出力形式の変更例

変更後の `champions.json` の各エントリは以下の形式になる:

```json
{
  "aatrox": {
    "english_name": "Aatrox",
    "japanese_name": "エイトロックス",
    "image_url": "https://ddragon.leagueoflegends.com/cdn/15.22.1/img/champion/Aatrox.png",
    "id": "Aatrox",
    "lanes": {
      "top": 5,
      "jg": 0,
      "mid": 0,
      "bot": 0,
      "sup": 0
    }
  }
}
```

### `check_build.py`（任意）

- `champions.json` のバリデーションに `lanes` フィールドの存在チェックを追加してもよい

---

## 2. CSV 名 → JSON キーの名前マッピング

CSV の `name` 列と JSON のキーは命名規則が異なるため、変換が必要である。

### 2-1. 基本的な正規化ルール

CSV 名に対して以下の処理を順に適用すると、大半の名前は JSON キーと一致する:

1. 小文字化（すでに小文字だが念のため）
2. アポストロフィ `'` を除去
3. ピリオド `.` を除去
4. スペースを除去

### 2-2. 特殊マッピング（正規化だけでは解決しないもの）

| CSV の name | JSON のキー | 備考 |
|---|---|---|
| `wukong` | `monkeyking` | Riot API 内部名が MonkeyKing |
| `nunu & willump` | `nunu` | JSON 側は `nunu` のみ |
| `renata glasc` | `renata` | JSON 側は `renata` のみ |

### 2-3. 正規化で解決するマッピング（19件）

参考として、基本ルール適用で自動解決されるものの一覧:

| CSV の name | JSON のキー |
|---|---|
| `aurelion sol` | `aurelionsol` |
| `bel'veth` | `belveth` |
| `cho'gath` | `chogath` |
| `dr. mundo` | `drmundo` |
| `jarvan iv` | `jarvaniv` |
| `kai'sa` | `kaisa` |
| `kha'zix` | `khazix` |
| `kog'maw` | `kogmaw` |
| `k'sante` | `ksante` |
| `lee sin` | `leesin` |
| `master yi` | `masteryi` |
| `miss fortune` | `missfortune` |
| `rek'sai` | `reksai` |
| `tahm kench` | `tahmkench` |
| `twisted fate` | `twistedfate` |
| `vel'koz` | `velkoz` |
| `xin zhao` | `xinzhao` |

### 2-4. CSV 側の問題データ

以下は CSV のデータ品質に関する問題であり、CSV 自体の修正も検討すべきである。

| 問題 | 内容 |
|---|---|
| `zaahen` | JSON に該当チャンピオンなし。無効データとして無視するか CSV から削除する |
| `hecarim` が重複 | CSV に2行存在する。重複を除去すべき |
| `heimerdinger` が重複 | CSV に2行存在する。重複を除去すべき |
| `nidalee` が欠落 | JSON には存在するが CSV にない。CSV にデータを追加すべき |
| `ambessa` が欠落 | JSON には存在するが CSV にない。CSV にデータを追加すべき |
| `zyra` が欠落 | JSON には存在するが CSV にない。CSV にデータを追加すべき |

---

## 3. 推奨する実装の流れ

1. まず `champion_lane.csv` のデータ品質問題（重複・欠落・無効エントリ）を修正する
2. `fetch_champions.py` に CSV 読み込み・正規化・マージ処理を追加する
3. `python fetch_champions.py` を実行して `champions.json` を再生成する
4. 生成された JSON にレーン情報が正しく含まれていることを確認する
5. `champion_data.py` の `ChampionData` クラスが新しいフィールドを利用できるようにする（UI 側で必要な場合）
