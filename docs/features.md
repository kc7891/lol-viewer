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
