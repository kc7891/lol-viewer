# 敵チャンピオンのレーン適性に基づく配置の実装設計

## 概要

`_apply_new_enemies()` で敵チャンピオンを配置する際、現在の「最初の空き行に入れる」ロジックを「champions.json の lanes 適性値に基づき、最も適した空き行に入れる」ように変更する。

## 変更対象

**ファイル: `main.py`**
- `_apply_new_enemies()` メソッド（2700行目付近）のみ

## 現状のコード

```python
def _apply_new_enemies(self, enemies: list):
    for name in enemies:
        if not name:
            continue
        if any(self._matchup_data[i][1] == name for i in range(5)):
            continue
        # First empty enemy slot
        for i in range(5):
            if not self._matchup_data[i][1]:
                ally, _ = self._matchup_data[i]
                self._matchup_data[i] = (ally, name)
                break
```

## 必要な知識

### champions.json のレーンキー → LANE_TO_INDEX の行インデックスへのマッピング

champions.json の `lanes` キーと `LANE_TO_INDEX`（2624行目）のキーは異なる:

| champions.json | LANE_TO_INDEX | 行index |
|---------------|---------------|---------|
| `top`         | `top`         | 0       |
| `jg`          | `jungle`      | 1       |
| `mid`         | `middle`      | 2       |
| `bot`         | `bottom`      | 3       |
| `sup`         | `support`     | 4       |

### チャンピオンデータへのアクセス方法

```python
self.champion_data  # ChampionData インスタンス（main.py:1444）
self.champion_data.get_champion(name)  # name(英語名)からchampion情報dictを返す
```

`get_champion()` は英語名で引くメソッド。返り値は champions.json の各エントリ dict。
`lanes` フィールドの例: `{"top": 5, "jg": 0, "mid": 0, "bot": 0, "sup": 0}`

### _apply_new_enemies の引数 `enemies` の中身

`enemies` は英語チャンピオン名の文字列リスト: `["Yasuo", "Thresh", ...]`

## 実装方針

### 1. マッピング定数を追加

`LANE_TO_INDEX` の近く（2624行目付近）にクラス変数として追加:

```python
LANE_JSON_TO_INDEX = {"top": 0, "jg": 1, "mid": 2, "bot": 3, "sup": 4}
```

### 2. `_apply_new_enemies()` を変更

「最初の空き行」ループを「適性値が最も高い空き行」に変更する。

```python
def _apply_new_enemies(self, enemies: list):
    """Place new enemy champions into matchup rows based on lane aptitude.

    - If a champion is already present in any enemy slot, skip it.
    - Place in the empty row with the highest lane aptitude from champions.json.
    - If aptitude data is unavailable, fall back to the first empty slot.
    - Ties are broken by row order (top → jungle → middle → bottom → support).
    """
    for name in enemies:
        if not name:
            continue
        if any(self._matchup_data[i][1] == name for i in range(5)):
            continue

        # 空き行のインデックスを収集
        empty_indices = [i for i in range(5) if not self._matchup_data[i][1]]
        if not empty_indices:
            break

        # チャンピオンのレーン適性を取得
        best_idx = empty_indices[0]  # フォールバック: 最初の空き行
        champ_info = self.champion_data.get_champion(name) if self.champion_data else None
        if champ_info:
            lanes = champ_info.get("lanes", {})
            # 空き行の中から最も適性値が高い行を選ぶ（同点はindex順=行順で先のものが勝つ）
            best_score = -1
            for i in empty_indices:
                for json_key, idx in self.LANE_JSON_TO_INDEX.items():
                    if idx == i:
                        score = lanes.get(json_key, 0)
                        if score > best_score:
                            best_score = score
                            best_idx = i
                        break

        ally, _ = self._matchup_data[best_idx]
        self._matchup_data[best_idx] = (ally, name)
```

### 3. 最適化メモ

`LANE_JSON_TO_INDEX` の逆引き（index → json_key）を毎回ループで探すのが気になる場合は、逆引きリストを使っても良い:

```python
# index → json_key の逆引き
INDEX_TO_LANE_JSON = ["top", "jg", "mid", "bot", "sup"]
```

これを使えば内側ループが不要になる:

```python
for i in empty_indices:
    score = lanes.get(self.INDEX_TO_LANE_JSON[i], 0)
    if score > best_score:
        best_score = score
        best_idx = i
```

こちらの方がシンプルなので推奨。

## 設計上のポイント

- **既に配置済みの敵は動かさない**: `already placed` チェックは現状通り維持
- **champion_data が None の場合のフォールバック**: 従来通り最初の空き行
- **lanes データがないチャンピオンのフォールバック**: 従来通り最初の空き行
- **同点時の優先順位**: `empty_indices` は 0→4 の昇順なので、`>` 比較（`>=` ではなく）により行順が早い方が優先される

## テスト観点

- レーン適性通りに配置されるか（例: sup:5 のチャンピオン → index 4）
- 最適レーンが埋まっている場合、次に適性の高い空き行に入るか
- lanes データがないチャンピオンは最初の空き行に入るか
- champion_data が None の場合もクラッシュしないか
- 既に配置済みの敵は重複配置されないか
