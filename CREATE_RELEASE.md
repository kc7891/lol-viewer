# GitHub Releaseの作成手順

## 📦 準備完了

以下のファイルが準備されています：
- `release/LoL-Analytics-Viewer-Windows-x64.zip` (111 MB)
- `RELEASE_NOTES.md` (リリースノート)

## 🚀 GitHub Releaseの作成手順

### 方法1: GitHub Web UI（推奨）

1. **GitHubリポジトリにアクセス**
   ```
   https://github.com/kc7891/lol-viewer
   ```

2. **Releasesページへ移動**
   - 右側のサイドバーから「Releases」をクリック
   - または直接: https://github.com/kc7891/lol-viewer/releases

3. **新しいリリースを作成**
   - 「Draft a new release」ボタンをクリック

4. **リリース情報を入力**
   - **Tag**: `v0.1.0` (新しいタグを作成)
   - **Target**: `claude/lol-analytics-browser-viewer-011CUpwvQV2evTQV3wTHbwQE` (現在のブランチ)
   - **Release title**: `LoL Analytics Viewer v0.1.0`
   - **Description**: `RELEASE_NOTES.md` の内容をコピー＆ペースト

5. **ファイルをアップロード**
   - 「Attach binaries」セクションにファイルをドラッグ＆ドロップ
   - アップロードするファイル:
     - `release/LoL-Analytics-Viewer-Windows-x64.zip`

6. **公開**
   - 「Publish release」ボタンをクリック

### 方法2: コマンドライン（gh CLI使用）

もしローカル環境でgh CLIが使える場合：

```bash
# リリースを作成してファイルをアップロード
gh release create v0.1.0 \
  --title "LoL Analytics Viewer v0.1.0" \
  --notes-file RELEASE_NOTES.md \
  release/LoL-Analytics-Viewer-Windows-x64.zip
```

## ✅ リリース後の確認

1. **ダウンロードリンクの確認**
   ```
   https://github.com/kc7891/lol-viewer/releases/download/v0.1.0/LoL-Analytics-Viewer-Windows-x64.zip
   ```

2. **READMEの更新**
   - README.mdのインストール手順のリンクが正しく動作するか確認

3. **テスト**
   - ZIPファイルをダウンロードして解凍
   - アプリケーションが正常に起動するか確認

## 📝 リリースノート（コピー用）

以下の内容を「Description」欄にコピー＆ペーストしてください：

---

# LoL Analytics Viewer v0.1.0

## 🎮 Windows用Electronアプリ - 環境設定不要！

League of Legendsのチャンピオン選択時に、自動的にLoL Analyticsページを開くデスクトップアプリケーションです。

### ✨ 主な機能

- **💻 ワンクリック起動**: .exeファイルをダブルクリックするだけ
- **📍 システムトレイ常駐**: バックグラウンドで動作、邪魔にならない
- **🎨 GUI設定画面**: 美しいインターフェースで機能のON/OFF切り替え
- **⚡ 自動ページ表示**:
  - マッチアップ勝率（自分のチャンピオン vs 敵チャンピオン）
  - 自分のチャンピオンのカウンター情報
  - 敵チャンピオンのカウンター情報（カウンターピック用）
  - ビルドガイド（試合中も表示可能）
- **🔮 レーン自動予測**: ピック順とメタ情報からレーンを推測
- **🔄 自動再接続**: League Clientとの接続が切れても自動復帰

### 🆕 v0.1.0の新機能・修正

#### 重要な修正
- ✅ **LCU再接続の実装**: WebSocket切断時に自動的に再接続します
- ✅ **メモリリークの修正**: 設定画面を開閉してもメモリが蓄積しません
- ✅ **重複イベント防止**: 同じチャンピオンで複数回URLが開かれる問題を修正
- ✅ **URLエスケープ改善**: 特殊文字を含むURLも正しく処理します

#### 技術的改善
- LCU接続が安定し、League Clientの再起動にも対応
- イベント処理の最適化で動作がスムーズに
- セキュリティ強化（シェルインジェクション対策）

### 📦 インストール方法

1. **ダウンロード**
   - 下の `Assets` から `LoL-Analytics-Viewer-Windows-x64.zip` をダウンロード

2. **解凍**
   - ZIPファイルを任意の場所に解凍
   - `win-unpacked` フォルダが作成されます

3. **起動**
   - `win-unpacked` フォルダ内の `LoL Analytics Viewer.exe` をダブルクリック
   - システムトレイ（タスクバー右下）にアイコンが表示されます

4. **使用開始**
   - League of Legendsを起動
   - チャンピオン選択を開始すると自動的にページが開きます

### 💡 使い方

#### 基本操作
- **設定画面を開く**: トレイアイコンを右クリック → "Settings"
- **停止/再開**: トレイアイコンを右クリック → "Stop" / "Start"
- **終了**: トレイアイコンを右クリック → "Quit"

#### 設定項目
- **Matchup Analysis**: 自分 vs 敵のマッチアップ勝率
- **My Counters**: 自分のチャンピオンのカウンター情報
- **Enemy Counters**: 敵チャンピオンのカウンター（カウンターピック用）
- **Build Guide**: ビルドガイド表示
- **In-Game Build**: 試合中もビルドガイドを表示

各機能はトリガータイミング（Hover / Pick / Lock-in）を選択可能です。

### ⚙️ 動作要件

- **OS**: Windows 10/11 (64-bit)
- **必須**: League of Legendsクライアントがインストール済み
- **不要**: Node.js、npmなどの環境設定は一切不要

### 🐛 既知の問題

- デフォルトのElectronアイコンを使用しています（カスタムアイコンは今後追加予定）
- 初回起動時にWindows Defenderの警告が出る場合があります（コード署名未対応のため）

### 📚 ドキュメント

- [使用方法の詳細](https://github.com/kc7891/lol-viewer/blob/main/ELECTRON_GUIDE.md)
- [ビルド方法](https://github.com/kc7891/lol-viewer/blob/main/BUILD_DISTRIBUTION.md)
- [プロジェクト概要](https://github.com/kc7891/lol-viewer/blob/main/README.md)

### 🤝 フィードバック

バグ報告や機能リクエストは [Issues](https://github.com/kc7891/lol-viewer/issues) までお願いします。

### 📄 ライセンス

MIT License

---

**ファイルサイズ**: 111 MB (ZIP) / 238 MB (解凍後)
**ビルド日**: 2025-11-06
**Electronバージョン**: 33.4.11

---

## 🔗 ダウンロードリンク

配布ファイルはこのページの下部「Assets」セクションからダウンロードできます。

## 📸 スクリーンショット

（今後追加予定）
