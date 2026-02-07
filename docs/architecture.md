# LoL Viewer アーキテクチャノート

## 技術スタック

- **言語**: Python 3
- **GUIフレームワーク**: PyQt6 (6.6.0+)
- **Web表示**: PyQt6-WebEngine (`QWebEngineView`)
- **配布**: PyInstaller (Windows向け)
- **QRコード生成**: `segno` ライブラリ

## メインファイル構成

アプリケーションの大部分は `main.py` (約2,700行) に集約されている。

### 主要クラス

| クラス | 役割 |
|--------|------|
| `MainWindow` | アプリ全体のウィンドウ。設定管理・ページ切り替え・ビューア管理を担う |
| `ChampionViewerWidget` | チャンピオン情報を表示するWebビューウィジェット |
| `QrCodeOverlay` | WebビューにQRコードを重ねて表示するフローティングウィジェット |
| `LCUConnectionStatusWidget` | LCU接続状態を表示するステータスウィジェット |
| `MatchupListWidget` | マッチアップリストをサイドバーに表示するウィジェット |
| `NullWebView` | テスト/ヘッドレス環境用のWebEngineView代替 |

### 外部モジュール

| ファイル | 役割 |
|----------|------|
| `champion_data.py` | チャンピオンデータの読み込み・検索 |
| `lcu_detector.py` | League Client (LCU) との接続検出・通信 |
| `updater.py` | アプリの自動アップデート |
| `logger.py` | ロギングユーティリティ |

## 設定の永続化 (QSettings)

`QSettings("LoLViewer", "LoLViewer")` を使用。Windows ではレジストリ、Linux/macOS ではINIファイルに保存される。

### 設定キー一覧

| キー | 型 | デフォルト | 用途 |
|------|----|-----------|------|
| `build_url` | str | `DEFAULT_BUILD_URL` | ビルド分析URL |
| `matchup_url` | str | `DEFAULT_MATCHUP_URL` | マッチアップ分析URL |
| `counter_url` | str | `DEFAULT_COUNTER_URL` | カウンター分析URL |
| `aram_url` | str | `DEFAULT_ARAM_URL` | ARAM分析URL |
| `live_game_url` | str | `DEFAULT_LIVE_GAME_URL` | ライブゲーム分析URL |
| `sidebar_width` | int | 200 | サイドバー幅 |
| `feature_flags/{key}` | bool | フラグ定義による | 実験的機能のON/OFF |
| `display/qr_code_overlay` | bool | True | QRコードオーバーレイの表示 |

### 新しい設定を追加する手順

1. `MainWindow.__init__()` で `self.settings.value()` を使って読み込む
2. Settingsページ (`create_settings_page()`) にUIコントロールを追加する
3. 変更時のハンドラメソッドで `self.settings.setValue()` を呼んで永続化する
4. 即座にUIに反映する必要がある場合は、ハンドラ内で対応する `_apply_*` メソッドを呼ぶ

## Feature Flags

`FEATURE_FLAG_DEFINITIONS` (辞書) で定義される実験的機能のトグル。

- キー: 機能の識別子
- `label`: UIに表示するラベル
- `default`: デフォルト値 (bool)
- `description`: ツールチップに表示する説明

Feature Flagは `feature_flags/{key}` としてQSettingsに永続化される。`cleanup_feature_flag_settings()` が起動時に呼ばれ、定義から削除されたフラグのゴミデータを自動削除する。

### Feature Flag vs Display Settings の使い分け

- **Feature Flag**: 実験的・不安定な機能。テスト完了後に正式設定へ昇格させる
- **Display Settings**: テスト済みの安定した表示設定。デフォルトONで提供

## シグナル通信

PyQt6のシグナル/スロットパターンを使用。

| シグナル | 発信元 | 用途 |
|----------|--------|------|
| `champion_detected` | `ChampionDetectorService` | 自チームのチャンピオン検出 |
| `enemy_champion_detected` | `ChampionDetectorService` | 敵チームのチャンピオン検出 |
| `matchup_pairs_updated` | `ChampionDetectorService` | マッチアップペア更新 |
| `close_requested` | `ChampionViewerWidget` | ビューア閉鎖リクエスト |
| `champion_updated` | `ChampionViewerWidget` | チャンピオン更新 |
| `connection_status_changed` | `ChampionDetectorService` | LCU接続状態変更 |

## 起動シーケンス

```
MainWindow.__init__()
  ├─ ChampionData 読み込み
  ├─ QSettings 初期化
  ├─ URL設定読み込み
  ├─ Feature Flag クリーンアップ & 読み込み
  ├─ Display設定読み込み
  ├─ ChampionDetectorService 初期化 & シグナル接続
  ├─ LCUConnectionStatusWidget 作成
  └─ init_ui()
      ├─ サイドバー作成 (タブ: Live Game / Viewers / Settings)
      ├─ Live Game ページ作成 (QRオーバーレイ条件付きインストール)
      ├─ Viewers ページ作成
      ├─ Settings ページ作成
      └─ サイドバー幅復元
```

## カラーパレット

アプリ全体のダークテーマは以下の配色で統一されている（issue #75 で定義）。

| 変数名 | カラーコード | 用途 |
|--------|-------------|------|
| `--background` | `#0d1117` | ページ背景 |
| `--foreground` | `#e2e8f0` | プライマリテキスト |
| `--card` | `#141b24` | カード/パネル背景 |
| `--card-foreground` | `#e2e8f0` | カード内テキスト |
| `--primary` | `#00d6a1` | ボタン、アクティブ状態、ハイライト |
| `--primary-foreground` | `#0d1117` | プライマリ背景上のテキスト |
| `--secondary` | `#1c2330` | セカンダリ表面、ホバー状態 |
| `--secondary-foreground` | `#c1c9d4` | セカンダリテキスト |
| `--muted` | `#181f29` | 控えめな背景 |
| `--muted-foreground` | `#6d7a8a` | プレースホルダー、ラベル |
| `--border` | `#222a35` | 区切り線、ボーダー |
| `--input` | `#222a35` | 入力フィールドのボーダー |
| `--ring` | `#00d6a1` | フォーカスリング |
| `--sidebar-background` | `#090e14` | サイドバー背景 |
| `--sidebar-foreground` | `#c1c9d4` | サイドバーテキスト |
| `--sidebar-primary` | `#00d6a1` | サイドバーのアクティブアイテム |
| `--sidebar-accent` | `#171e28` | サイドバーのホバー/選択 |
| `--sidebar-border` | `#1c2330` | サイドバーの区切り線 |
| `--ally` | `#0078f5` | 味方チーム (青) |
| `--enemy` | `#e0342c` | 敵チーム (赤) |
| `--win` | `#22c55e` | 勝利インジケーター |
| `--loss` | `#e0342c` | 敗北インジケーター |
| `--destructive` | `#e0342c` | エラー/削除アクション |
| `--destructive-foreground` | `#fafafa` | destructive背景上のテキスト |

ボーダー半径は `6px` (`border-radius: 6px`) で統一。

## 機能ドキュメント

個別機能の詳細は [features.md](./features.md) を参照。
