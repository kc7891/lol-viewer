# Linux環境でWindows .exeファイルをテストする方法

Windows環境でのダウンロード・テストを繰り返さなくても、Linux環境である程度のテストができます。

## 方法1: 自動健全性チェック（推奨・最速）

ビルド後に自動で基本的な問題をチェックします。

### 使い方

```bash
# ビルド
npm run build
npm run package

# 健全性チェックを実行
./scripts/verify-windows-build.sh
```

### チェック内容

- ✅ exeファイルの存在・サイズ確認
- ✅ 必須DLLファイルの確認
- ✅ resources/app.asarの確認
- ✅ ES moduleエラーの検出
- ✅ ビルドファイルの整合性確認
- ✅ ZIPファイルサイズの確認（GitHub制限）

### npm scriptsに追加

`package.json`に追加すると便利です：

```json
{
  "scripts": {
    "verify": "./scripts/verify-windows-build.sh",
    "package:verify": "npm run package && npm run verify"
  }
}
```

使い方：
```bash
npm run package:verify
```

## 方法2: Wine で実際にexeを実行（より完全なテスト）

Linux上でWindows .exeファイルを実際に実行できます。

### Wine のインストール

#### Ubuntu/Debian
```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install wine64 wine32 winetricks
```

#### Fedora
```bash
sudo dnf install wine winetricks
```

#### Arch Linux
```bash
sudo pacman -S wine winetricks
```

### Wineの初期設定

```bash
# Wineの初期化（初回のみ）
winecfg
```

ダイアログが表示されたら、Windowsのバージョンを選択（Windows 10推奨）してOK。

### exeファイルの実行

```bash
# ビルド
npm run build
npm run package

# zipを展開（まだの場合）
cd release
unzip -o LoL-Analytics-Viewer-Windows-x64.zip

# exeを実行
wine64 'win-unpacked/LoL Analytics Viewer.exe'

# または
cd win-unpacked
wine64 'LoL Analytics Viewer.exe'
```

### トラブルシューティング

#### 1. "wine: Bad EXE format"
64bit版のwineが必要です：
```bash
wine64 'LoL Analytics Viewer.exe'
```

#### 2. DLLエラー
必要なDLLをインストール：
```bash
winetricks vcrun2019 d3dx9 corefonts
```

#### 3. 起動しない
デバッグモードで実行：
```bash
WINEDEBUG=+all wine64 'LoL Analytics Viewer.exe' 2>&1 | tee wine-debug.log
```

#### 4. 画面が表示されない
仮想デスクトップで実行：
```bash
DISPLAY=:0 wine64 'LoL Analytics Viewer.exe'
```

### Wineの制限事項

- **完全なテストではない**: Wineは完全なWindows互換ではありません
- **LCU API接続不可**: League of Legendsクライアントとの通信はテストできません
- **基本的な起動確認のみ**: ウィンドウが表示されるか、クラッシュしないかの確認

### おすすめワークフロー

1. **開発中**: `npm test` でユニットテスト
2. **ビルド後**: `./scripts/verify-windows-build.sh` で健全性チェック
3. **重要な変更後**: Wineで起動確認
4. **リリース前**: Windows環境で最終確認

## 方法3: GitHub Actions CI/CD（自動化）

プッシュ時に自動でWindows環境でテストします。

### ワークフローファイル

`.github/workflows/test-windows.yml`:

```yaml
name: Test Windows Build

on:
  push:
    branches: [ main, 'claude/**' ]
  pull_request:
    branches: [ main ]

jobs:
  build-and-test:
    runs-on: windows-latest

    steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run tests
      run: npm test

    - name: Build
      run: npm run build

    - name: Package
      run: npm run package

    - name: Check exe exists
      run: |
        if (!(Test-Path "release/win-unpacked/LoL Analytics Viewer.exe")) {
          Write-Error "EXE file not found!"
          exit 1
        }
        Write-Output "✓ EXE file exists"

    - name: Upload artifact
      uses: actions/upload-artifact@v4
      with:
        name: windows-build
        path: release/win-unpacked/
        retention-days: 5
```

### 使い方

1. `.github/workflows/test-windows.yml` を作成
2. git push
3. GitHubのActionsタブで結果を確認
4. ビルドが成功したら、Artifactsからダウンロードしてテスト

### メリット

- ✅ 実際のWindows環境でテスト
- ✅ プッシュ時に自動実行
- ✅ ビルド成果物をダウンロード可能
- ✅ 無料（publicリポジトリ）

## おすすめの開発ワークフロー

```bash
# 1. コードを書く

# 2. ユニットテストを実行
npm test

# 3. ビルド
npm run build

# 4. パッケージング
npm run package

# 5. 健全性チェック（自動）
./scripts/verify-windows-build.sh

# 6. （必要に応じて）Wineで起動確認
wine64 'release/win-unpacked/LoL Analytics Viewer.exe'

# 7. コミット・プッシュ
git add .
git commit -m "..."
git push

# 8. GitHub ActionsでWindows環境での自動テスト
# （GitHubのActionsタブで確認）
```

## よくある問題と対策

### 問題1: "exports is not defined in ES module scope"

**原因**: Electron mainファイルがES moduleでビルドされている

**検出方法**:
```bash
./scripts/verify-windows-build.sh
# → ES module構文のチェックが実行される
```

**修正方法**:
- `package.json`の`build:electron`スクリプトで`--module CommonJS`を指定
- `main.js`を`main.cjs`にリネーム

### 問題2: "electronAPI is undefined"

**原因**: preloadスクリプトが正しくロードされていない

**検出方法**:
```bash
./scripts/verify-windows-build.sh
# → dist/electron/preload.cjs の存在チェック
```

**修正方法**:
- `src/electron/main.ts`で`preload.cjs`を正しくロード
- ビルド後に`dist/electron/preload.cjs`が存在することを確認

### 問題3: exeファイルが起動しない

**検出方法**:
```bash
# 健全性チェック
./scripts/verify-windows-build.sh

# Wineで起動テスト
wine64 'release/win-unpacked/LoL Analytics Viewer.exe'
```

**修正方法**:
1. 健全性チェックのエラーを修正
2. ビルドログを確認
3. Wineのデバッグログを確認

## 時間を節約する

従来のワークフロー:
```
コード変更 → ビルド → zip → ダウンロード → Windows → 解凍 → 実行 → エラー発見 → 最初から
時間: 約10-15分/回
```

新しいワークフロー:
```
コード変更 → ビルド → 健全性チェック → エラー即座に発見 → 修正
時間: 約2-3分/回
```

**5回繰り返す場合**:
- 従来: 50-75分
- 新方式: 10-15分
- **節約: 40-60分** ⏱️

## まとめ

1. **毎回必須**: `./scripts/verify-windows-build.sh`
   - 基本的な問題を即座に検出
   - ZIPサイズ、exeサイズ、ES moduleエラーなど

2. **重要な変更後**: Wine で起動確認
   - 実際に起動するか確認
   - クラッシュしないか確認

3. **リリース前**: Windows環境での最終確認
   - LCU API接続のテスト
   - 実際のゲーム環境でのテスト

4. **自動化**: GitHub Actions CI/CD
   - プッシュ時に自動テスト
   - Windows環境での動作保証

これで、「何回もダウンロードして試して初歩的なミスで動かない」という問題は大幅に減らせます！
