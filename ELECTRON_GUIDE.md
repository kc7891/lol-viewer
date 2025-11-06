# Electron アプリ化ガイド

## 🎯 概要

LoL Analytics ViewerをElectronアプリとして提供することで、**環境設定不要**でWindows上で動作します。

### メリット

- ✅ Node.js/npmのインストール不要
- ✅ .exeファイルをダブルクリックで起動
- ✅ システムトレイに常駐
- ✅ GUIで設定変更可能
- ✅ Windows起動時の自動起動（オプション）

## 📦 ビルド手順

### 1. 依存関係のインストール

```bash
cd lol-viewer
npm install
```

### 2. アイコンファイルの準備

`assets/` ディレクトリに以下のアイコンを配置：

- `icon.ico` - Windowsアプリアイコン（256x256）
- `tray-icon.png` - システムトレイアイコン（16x16 or 32x32）

**アイコンがない場合**: `assets/README.md` を参照してプレースホルダーを作成

### 3. ビルド

```bash
# TypeScriptのビルド
npm run build

# Electronアプリのパッケージング（Windows）
npm run package
```

### 4. 出力ファイル

ビルドが成功すると、`release/` ディレクトリに以下が生成されます：

```
release/
├── LoL Analytics Viewer Setup 0.1.0.exe  # インストーラー
└── win-unpacked/                         # ポータブル版
    └── LoL Analytics Viewer.exe
```

## 🚀 使い方

### エンドユーザー向け

1. **インストール**: `LoL Analytics Viewer Setup 0.1.0.exe` を実行
2. **起動**: デスクトップのショートカットまたはスタートメニューから起動
3. **システムトレイ**: アプリは最小化時にシステムトレイに常駐
4. **設定**: トレイアイコンを右クリック → Settings

### 開発者向け

```bash
# 開発モード（Electronで直接実行）
npm run dev:electron

# Electronアプリとして起動（ビルド後）
npm run start:electron

# すべてのプラットフォーム向けにビルド
npm run package:all
```

## ⚙️ Electron版の機能

### システムトレイ

- **起動/停止**: アプリの開始・停止
- **設定**: GUI設定画面を開く
- **終了**: アプリを完全に終了

トレイアイコンを右クリックでメニュー表示：

```
LoL Analytics Viewer
────────────────
⚡ Running  (または ⏸ Stopped)
────────────────
Settings
Start/Stop
────────────────
Quit
```

### 設定画面

美しいGUI設定画面で以下を変更可能：

#### Application Control
- **Start**: アプリケーション開始
- **Stop**: アプリケーション停止
- **Restart**: アプリケーション再起動

#### Features
各機能のON/OFF とトリガータイミング（Hover/Pick/Lock-in）:

- **Matchup Analysis**: マッチアップページを開く
- **My Counters**: 自分のチャンピオンのカウンターを表示
- **Enemy Counters**: 相手のチャンピオンのカウンターを表示
- **Build Guide**: ビルドガイドを表示（試合中も対応）

#### Settings
- **LoL Analytics Base URL**: 分析サイトのURL
- **Auto-open Delay**: ブラウザを開くまでの遅延（ミリ秒）
- **Max LCU Connection Retries**: LCU接続のリトライ回数

### 自動起動

デフォルトで、Electronアプリ起動時に自動的にバックグラウンドで監視を開始します。

無効にしたい場合は、`src/electron/main.ts` の以下を変更：

```typescript
// Auto-start application
const autoStart = store.get('autoStart', true) as boolean;
```

→ `true` を `false` に変更

## 🔧 カスタマイズ

### アプリ名・バージョン変更

`package.json` を編集：

```json
{
  "name": "lol-analytics-viewer",
  "version": "0.1.0",
  "build": {
    "productName": "LoL Analytics Viewer",
    "appId": "com.lolanalytics.viewer"
  }
}
```

### インストーラー設定

`package.json` の `build.nsis` セクション：

```json
{
  "nsis": {
    "oneClick": false,                        // ウィザード形式
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  }
}
```

### システムトレイアイコンのカスタマイズ

`src/electron/main.ts` の `createTray()` 関数を編集。

## 📝 配布方法

### 1. GitHub Releases

```bash
# ビルド
npm run package

# release/LoL Analytics Viewer Setup 0.1.0.exe をGitHubにアップロード
```

### 2. インストール手順書

ユーザーに以下を案内：

1. `LoL Analytics Viewer Setup 0.1.0.exe` をダウンロード
2. 実行してインストール
3. League of Legendsを起動
4. LoL Analytics Viewerを起動（自動的にシステムトレイに常駐）
5. チャンピオン選択を開始すると自動的にブラウザが開く

### 3. 必要システム要件

- **OS**: Windows 10/11 (64-bit)
- **メモリ**: 4GB以上推奨
- **その他**: League of Legends クライアント

## 🐛 トラブルシューティング

### ビルドエラー: "Icon not found"

`assets/icon.ico` が存在しない場合は、プレースホルダーを作成するか、`package.json` から `icon` の行を削除してください。

### アプリが起動しない

1. `release/win-unpacked/resources/app/dist/` にファイルが存在するか確認
2. `npm run build` が成功しているか確認
3. Node.jsのバージョンが20以上か確認

### システムトレイアイコンが表示されない

`assets/tray-icon.png` が存在するか確認。なければシンプルな16x16のPNG画像を作成してください。

### 設定が保存されない

Electron Storeはユーザーディレクトリに設定を保存します：
- Windows: `%APPDATA%/lol-analytics-viewer/config.json`

このファイルを削除すると設定がリセットされます。

## 🎨 UI/UXのカスタマイズ

設定画面のデザインは `assets/settings.html` で変更可能。

現在のデザイン：
- グラデーション背景（紫→ピンク）
- カード型UI
- ダークモード非対応（追加可能）

カスタマイズ例：

```html
<!-- ダークモードの追加 -->
<style>
  body.dark {
    background: #1a1a2e;
  }
  .container.dark {
    background: #16213e;
    color: #eee;
  }
</style>
```

## 🔒 セキュリティ

Electronアプリのセキュリティベストプラクティスを実装済み：

- ✅ Context Isolation有効
- ✅ Node Integration無効
- ✅ Preloadスクリプトで安全なAPI公開
- ✅ Content Security Policy（今後追加可能）

## 📊 パフォーマンス

- **起動時間**: 約2-3秒
- **メモリ使用量**: 約100-150MB（Chromiumベース）
- **CPU使用率**: アイドル時ほぼ0%

## 🚢 自動更新（今後実装可能）

electron-updaterを使用した自動更新機能を追加可能：

```bash
npm install electron-updater
```

`src/electron/main.ts` に追加：

```typescript
import { autoUpdater } from 'electron-updater';

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});
```

## 📚 参考リンク

- [Electron公式ドキュメント](https://www.electronjs.org/docs/latest/)
- [electron-builder](https://www.electron.build/)
- [electron-store](https://github.com/sindresorhus/electron-store)

---

**Note**: 初回ビルドには時間がかかる場合があります（Electronのダウンロードなど）。
