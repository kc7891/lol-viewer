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
[CURRENT MATCHUP]                              [Ally vs Enemy]
```

- 左側: "CURRENT MATCHUP" — 8pt bold, `#c1c9d4`
- 右側: "Ally" (`#0078f5`) + "vs" (`#6d7a8a`) + "Enemy" (`#e0342c`) — リッチテキスト
- 高さ: 24px

### 行の構成 (左から右)

```
[レーン名] [↑↓] [味方アイコン] [味方名] [VS] [敵名] [敵アイコン] [⧉] [↑↓]
```

| 要素 | サイズ | 説明 |
|------|--------|------|
| レーン名 | 幅44px | Top/Jungle/Mid/Bot/Support — 8pt, `#6d7a8a` (#73) |
| ↑↓ ボタン (左) | 12×10px, 縦並び | 行の並べ替え (#67, #73) |
| チャンピオンアイコン | 24×24px | チャンピオン画像 (Data Dragon) |
| チャンピオン名 | 可変幅 | 白色 (`#e2e8f0`) 9pt bold (#73) |
| VS ラベル | 自動幅 | "VS" — 8pt, `#6d7a8a` (#73) |
| ⧉ ボタン | 18×18px | マッチアップビューアを開く (#68) |
| ↑↓ ボタン (右) | 12×10px, 縦並び | 行の並べ替え (#73) |

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

### Feature Flag

- キー: `matchup_list`
- デフォルト: OFF (実験的機能)
- Settings > Feature Flags で切り替え可能

## 機能

### 行の並べ替え (#67)
- ↑ / ↓ ボタンで行を上下に移動 (左右両サイドに縦並びで配置)
- 味方・敵ペアがそのまま移動する

### ビューアを開く (#68)
- ⧉ ボタンでその行のマッチアップをビューアで開く
- 行の位置からレーンを判定 (0=top, 1=jungle, 2=middle, 3=bottom, 4=support)

### データ連携

`ChampionDetectorService` の `matchup_pairs_updated` シグナルからデータを受信:

```
ChampionDetectorService.matchup_pairs_updated(pairs)
  → MainWindow.on_matchup_pairs_updated(pairs)
    → self._matchup_data を更新
    → update_matchup_list() でUI反映
```
