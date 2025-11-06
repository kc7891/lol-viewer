# Windows配布パッケージのビルド手順

## ✅ ビルド完了

Windows用の配布パッケージが正常にビルドされました！

## 📦 配布ファイルの場所

```
release/LoL-Analytics-Viewer-Windows-x64.zip (111 MB)
```

このZIPファイルには、Windowsで実行可能なすべてのファイルが含まれています。

## 🚀 ユーザーへの配布方法

### 方法1: ZIPファイルを直接配布

1. `release/LoL-Analytics-Viewer-Windows-x64.zip` をユーザーに送信
2. ユーザーは以下の手順で使用：
   ```
   1. ZIPファイルを解凍
   2. win-unpackedフォルダを開く
   3. "LoL Analytics Viewer.exe" をダブルクリック
   ```

### 方法2: GitHub Releasesで配布（推奨）

1. GitHubリポジトリでReleaseを作成
2. `LoL-Analytics-Viewer-Windows-x64.zip` をアップロード
3. リリースノートに使用方法を記載

## 📝 使用方法（ユーザー向け）

### 初回起動

1. ZIPファイルを解凍
2. `win-unpacked` フォルダ内の **LoL Analytics Viewer.exe** をダブルクリック
3. システムトレイ（タスクバー右下）にアイコンが表示されます

### 基本操作

- **起動**: アプリは自動的にLeague of Legendsクライアントに接続します
- **設定**: トレイアイコンを右クリック → "Settings"
- **停止/再開**: トレイアイコンを右クリック → "Stop" / "Start"
- **終了**: トレイアイコンを右クリック → "Quit"

### 動作要件

- Windows 10/11 (64-bit)
- League of Legends クライアントがインストール済み
- 環境設定不要（Node.js等のインストール不要）

## 🔧 開発者向け：再ビルド手順

ソースコードから再ビルドする場合：

```bash
# 依存関係のインストール
npm install

# TypeScriptコンパイル
npm run build

# Windowsパッケージの作成
npm run package
```

ビルド成果物は `release/` ディレクトリに出力されます。

## ⚠️ 既知の制約事項

### Linux環境でのビルド

現在の環境（Linux）でWindows用インストーラー（NSIS）を作成するには`wine`が必要です。
そのため、以下の構成でビルドしています：

- **ターゲット**: `portable` (ポータブル実行ファイル)
- **形式**: アンパック済みディレクトリ → ZIPアーカイブ

### NSISインストーラーを作成する場合

Windows環境で実行するか、Linuxに`wine`をインストールしてください：

```bash
# package.jsonを編集
"win": {
  "target": [
    {
      "target": "nsis",  // portable → nsis に変更
      "arch": ["x64"]
    }
  ]
}

# Linuxの場合はwineをインストール
sudo apt-get install wine64

# ビルド実行
npm run package
```

## 🎨 アイコンのカスタマイズ

現在はデフォルトのElectronアイコンを使用しています。
カスタムアイコンを使用する場合：

1. アイコンファイルを準備：
   - `assets/icon.ico` (Windows用、256x256px推奨)
   - `assets/tray-icon.png` (トレイ用、16x16px)

2. `package.json` を編集：
   ```json
   "win": {
     "icon": "assets/icon.ico"
   }
   ```

3. 再ビルド

## 📊 パッケージサイズ

- **アンパック時**: 約238 MB
- **ZIP圧縮後**: 約111 MB
- **主な内訳**:
  - Electron本体: ~180 MB
  - アプリケーションコード: ~7 MB
  - Chromium依存ライブラリ: ~50 MB

## 🔐 コード署名について

現在のビルドは署名されていません。
Windows Defenderで警告が表示される場合がありますが、正常な動作です。

コード署名を追加する場合：
1. コード署名証明書を取得
2. `package.json` に証明書情報を追加
3. Windows環境で再ビルド

## 📚 関連ドキュメント

- [ELECTRON_GUIDE.md](./ELECTRON_GUIDE.md) - Electronアプリの使用方法
- [README.md](./README.md) - プロジェクト概要
- [VERIFICATION_STATUS.md](./VERIFICATION_STATUS.md) - テスト状況

---

**ビルド日時**: 2025-11-06
**Electron バージョン**: 33.4.11
**Node.js バージョン**: 22.x
