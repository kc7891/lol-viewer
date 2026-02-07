# LoL Viewer 機能ドキュメント

## QR Code Overlay

WebビューにQRコードを重ねて表示する機能。スマートフォンなどで読み取ることで、表示中のページURLを簡単に共有できる。

### 概要

- Settings > Display Settings で ON/OFF を切り替え可能（デフォルト: ON）
- 設定変更は即座に全Webビューに反映される（再起動不要）
- QSettings キー: `display/qr_code_overlay`

### 技術詳細

| 項目 | 値 |
|------|-----|
| クラス | `QrCodeOverlay` (`main.py`) |
| 親クラス | `QWidget` |
| QR生成ライブラリ | `segno` |
| QRコードサイズ | 120×120px (`_QR_SIZE`) |
| トグルボタンサイズ | 32×32px |
| 表示位置 | ターゲットウィジェットの右下 (マージン10px) |

### 仕組み

1. `QrCodeOverlay` は `QWidget` を継承したフローティングウィジェット
2. `segno` ライブラリでQRコードをPNG生成し、`QLabel` に `QPixmap` として表示
3. トグルボタン ("QR") で折りたたみ/展開が可能
4. `eventFilter` でターゲットウィジェットのリサイズ/移動を監視し、自動的に位置を更新
5. `_install_qr_overlay()` ヘルパー関数でインスタンス生成とイベントフィルタ設定を行う

### 適用箇所

- **Live Game ページ**: `self._live_game_qr_overlay`
- **Champion Viewer**: 各 `ChampionViewerWidget` の `self._qr_overlay`

### 設定の反映フロー

```
ユーザーがチェックボックスを操作
  → _set_qr_overlay_enabled()
    → QSettings に永続化
    → _apply_qr_overlay_setting()
      → 全WebビューのQRオーバーレイを追加/削除
```

### 開発経緯

当初は Feature Flag (`qr_code_overlay`, デフォルト OFF) として実装・テストを行い、動作確認完了後に Display Settings セクション（デフォルト ON）に昇格した。

---

## Matchup List (#73)

Viewersページ上部に表示される5行のマッチアップリスト。ライブゲーム検知で取得した味方・敵チャンピオンの対面ペアを一覧表示する。

### 概要

- Feature Flag (`matchup_list`) で ON/OFF を切り替え可能（デフォルト: OFF）
- `ChampionDetectorService` の `matchup_pairs_updated` シグナルでデータを受信
- 行の位置がレーンに対応 (0=top, 1=jungle, 2=middle, 3=bottom, 4=support)

### 技術詳細

| 項目 | 値 |
|------|-----|
| 実装箇所 | `_create_matchup_list_widget()` (`main.py`) |
| 配置 | Viewers ページ上部（ツールバーの上） |
| 行数 | 5行固定 |
| 行の高さ | 50px |
| アイコンサイズ | 24×24px |
| 味方チャンピオン名色 | `#0078f5` (--ally) |
| 敵チャンピオン名色 | `#e0342c` (--enemy) |
| 背景色 | `#090e14` (--sidebar-background) |

### 各行の構成

```
[▲] [▼] [味方アイコン] [味方名] [⇄] [敵名] [敵アイコン] [↗]
```

- **▲ / ▼**: 行の並べ替え (#67)
- **⇄**: 敵チャンピオンの入れ替え（味方は固定） (#67)
- **↗**: マッチアップビューアを開く (#68)

### デザイン仕様

詳細なデザイン仕様は [design/matchup-list.md](../design/matchup-list.md) を参照。
