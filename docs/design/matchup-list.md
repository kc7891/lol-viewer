# マッチアップリスト デザイン仕様 (#73)

## 概要

Viewers ページ上部に表示される5行のマッチアップリスト。味方チャンピオンと敵チャンピオンの対面ペアを一覧表示し、ビューアの操作を支援する。

## レイアウト仕様

Issue #73 のデザインモックアップに基づく寸法:

| 要素 | 高さ |
|------|------|
| セクションタイトル | 24px |
| 各行 (アイテム) | 33px |
| 行の区切り線 | 1px |

## 実装

### セクションタイトル (#73)

```
[CURRENT MATCHUP] [Refresh]                    [Ally vs Enemy]
```

- 左側: "CURRENT MATCHUP" — 8pt bold, `#c1c9d4`
- 中央: "Refresh" ボタン — 7pt, `#6d7a8a`, border付き (全行クリア＋再取得)
- 右側: "Ally" (`#0078f5`) + "vs" (`#6d7a8a`) + "Enemy" (`#e0342c`) — リッチテキスト
- 高さ: 24px

### 行の構成 (左から右)

```
[レーン名] [↑↓] [味方アイコン] [味方名] [VS] [敵名] [敵アイコン] [⧉] [↑↓]
```

| 要素 | サイズ | 説明 |
|------|--------|------|
| レーン名 | 幅44px | Top/Jungle/Mid/Bot/Support — 8pt, `#6d7a8a` (#73) |
| ↑↓ ボタン (左) | 12×10px, 縦並び | 味方チャンピオンの並べ替え |
| チャンピオンアイコン | 24×24px | チャンピオン画像 (Data Dragon) |
| チャンピオン名 | 可変幅 | 白色 (`#e2e8f0`) 9pt bold (#73) |
| VS ラベル | 自動幅 | "VS" — 8pt, `#6d7a8a` (#73) |
| ⧉ ボタン | 18×18px | マッチアップビューアを開く (#68) |
| ↑↓ ボタン (右) | 12×10px, 縦並び | 敵チャンピオンの並べ替え |

### 配置

```
Viewers ページ
├─ MatchupListWidget (matchup_list_widget)  ← ここ
├─ Toolbar
└─ Viewers Splitter
```

### スタイル

- **背景色**: `#090e14` (--sidebar-background)
- **セクションタイトル高さ**: 24px
- **行の高さ**: 33px
- **行の区切り線**: 1px, `rgba(34, 39, 47, 0.5)`
- **行の余白**: 左右 4px
- **行間スペーシング**: 4px
- **コンテナ余白**: 左右 8px
- **矢印ボタン**: 透明背景, `#6d7a8a` → hover `#c1c9d4`, 縦並び
- **オープンボタン**: 透明背景, `#6d7a8a` → hover `#c1c9d4`, ⧉ アイコン
- **Refreshボタン**: 透明背景, `#6d7a8a`, 1px border, border-radius 3px

### Feature Flag

- キー: `matchup_list`
- デフォルト: OFF (実験的機能)
- Settings > Feature Flags で切り替え可能

## データ管理ルール

### 基本原則: 一度取得したデータは自動的に破棄しない

- UIの `_matchup_data` が状態の源泉
- Detectorは新規検出データを提供するだけで、UIが差分マージする
- 空のシグナルが来てもUIはクリアしない
- データをクリアする契機は2つのみ:
  1. **Refreshボタン**: ユーザーが明示的にクリアを要求
  2. **新ChampSelect開始**: 新しいゲームのチャンピオンセレクト開始時に自動クリア

### 味方チャンピオンの配置

1. **レーン情報あり** (ドラフトピック等): レーン対応行に配置
   - top→行0, jungle→行1, middle→行2, bottom→行3, support→行4
   - レーン指定行が埋まっている場合は最初の空行にフォールバック
   - レーン付き味方を先に処理し、その後レーンなし味方を処理
2. **レーン情報なし** (ブラインドピック等): 取得順に最初の空行に配置

### 敵チャンピオンの配置

- ピック順で最初の空行に配置
- レーン情報は使用しない（ドラフトでも敵のレーンは不明）
- ユーザーが手動で並び替えて対面を調整

### 並び替え

- ↑↓ボタンで味方・敵を独立に上下移動（隣接行とスワップ）
- 並び替え後も新データは空行にのみ追加される（既存配置を上書きしない）

### Refreshボタン

- タイトル行の "CURRENT MATCHUP" 右に配置
- クリック時: 全5行をクリアし、Detectorに即時再取得を要求
- 意図しないタイミングでリストが消える問題を防ぐ代替手段

### ブラインドピック対応

- ChampSelect中は味方のみ表示（敵は非表示）
- ゲーム開始(InProgress)で敵チャンピオンが取得可能になる
- ポーリングサイクル（2秒間隔）で空行に順次埋まる
- 既に値が入っている行は変更しない

## データ連携

`ChampionDetectorService` の `matchup_data_updated` シグナルからデータを受信:

```
ChampionDetectorService.matchup_data_updated(data: dict)
  data = {
      "allies": [(name, lane), ...],    # レーン付き味方リスト
      "enemies": [name, ...],           # ピック順敵リスト
      "phase": "ChampSelect" | "InProgress",
      "is_new_session": bool,           # True → UI自動クリア
  }
  → MainWindow.on_matchup_data_updated(data)
    → _apply_new_allies() / _apply_new_enemies()
    → update_matchup_list() でUI反映
```

### シグナル発行ルール

- `phase == 'None'` / `'Lobby'` 時: シグナルを発行しない（UIデータ保持）
- `phase == 'ChampSelect'` / `'InProgress'` 時: 検出データ付きシグナルを発行
- 切断時: シグナルを発行しない（UIデータ保持）

### ビューアを開く (#68)
- ⧉ ボタンでその行のマッチアップをビューアで開く
- 行の位置からレーンを判定 (0=top, 1=jungle, 2=middle, 3=bottom, 4=support)
