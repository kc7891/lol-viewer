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

基本的に同じ名前になるようにしてある。

### 2-2. 特殊マッピング（正規化だけでは解決しないもの）

| CSV の name | JSON のキー | 備考 |
|---|---|---|
| `wukong` | `monkeyking` | Riot API 内部名が MonkeyKing |

JSON内でも特別対応としてwukongとして扱う必要がある

---

## 3. 推奨する実装の流れ

1. champions.jsonの生成でmonkeykingをwukongに変換するような処理を追加する
2. `fetch_champions.py` に CSV 読み込み・正規化・マージ処理を追加する
3. `python fetch_champions.py` を実行して `champions.json` を再生成する
4. 生成された JSON にレーン情報が正しく含まれていることを確認する
5. `champion_data.py` の `ChampionData` クラスが新しいフィールドを利用できるようにする（UI 側で必要な場合）
