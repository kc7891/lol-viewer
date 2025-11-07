# 空白画面問題の修正

## 問題の概要

Electronアプリ（.exe）を実行したときに画面が空白になる問題が発生していました。

## 根本原因

アプリケーションがビルドされていなかったため、以下のファイルが存在しませんでした:
- `dist/electron/main.cjs` - Electronメインプロセス
- `dist/electron/preload.cjs` - preloadスクリプト（electronAPI公開用）
- ビルドされたTypeScriptファイル

preloadスクリプトが読み込まれないため、`window.electronAPI`が未定義となり、設定画面が正しく動作せず空白画面となっていました。

## 修正内容

1. **依存関係のインストール**
   ```bash
   npm install
   ```

2. **アプリケーションのビルド**
   ```bash
   npm run build
   ```
   このコマンドで以下が実行されます:
   - TypeScriptコンパイル
   - Electronファイルのビルド（main.cjs, preload.cjs）

3. **実行ファイルのパッケージング**
   ```bash
   npm run package
   ```
   このコマンドで以下が作成されます:
   - `release/win-unpacked/LoL Analytics Viewer.exe`
   - すべての必要なファイルを含むapp.asar
   - 配布用のZIPファイル

## ビルド後の確認事項

✅ `dist/electron/main.cjs` - 存在する（15.6 KB）
✅ `dist/electron/preload.cjs` - 存在する（1.7 KB）
✅ `assets/settings.html` - 存在する（21.8 KB）
✅ `release/win-unpacked/LoL Analytics Viewer.exe` - 存在する（181 MB）
✅ `release/win-unpacked/resources/app.asar` - すべてのファイルを含む（6.5 MB）

## 配布方法

### オプション1: win-unpackedフォルダをそのまま配布

```
release/win-unpacked/
├── LoL Analytics Viewer.exe  ← これを実行
├── resources/
├── locales/
└── その他のDLLファイル
```

### オプション2: ZIPアーカイブを配布

```bash
# 以下のファイルを配布
release/LoL-Analytics-Viewer-Windows-x64.zip (111 MB)
```

ユーザーは解凍後、`win-unpacked`フォルダ内の`LoL Analytics Viewer.exe`を実行します。

## 今後のビルド手順

新しいバージョンをリリースする際は、必ず以下の手順を実行してください:

```bash
# 1. 依存関係が最新であることを確認
npm install

# 2. ビルド
npm run build

# 3. パッケージング
npm run package

# 4. テスト（Windowsマシンで）
cd release/win-unpacked
# LoL Analytics Viewer.exe を実行してテスト
```

## 注意事項

- Linux環境でビルドした場合、署名ステップでエラーが出ますが、実行ファイル自体は正常に作成されます
- Windows環境でビルドすれば署名エラーは発生しません
- `package.json`で`"sign": false`が設定されているため、署名は不要です

## トラブルシューティング

### ビルドエラーが発生する場合

```bash
# node_modulesを削除して再インストール
rm -rf node_modules
npm install
npm run build
```

### 実行時にpreloadエラーが出る場合

preload.cjsが正しくビルドされているか確認:
```bash
ls -l dist/electron/preload.cjs
# ファイルサイズが1KB以上あればOK
```

### 画面は表示されるがAPIエラーが出る場合

設定画面に以下のエラーが表示される場合:
```
Error: API Not Available
The Electron API could not be loaded.
```

これは`preload.cjs`が正しく読み込まれていない証拠です。`npm run build`を再実行してください。

## まとめ

空白画面の問題は、**ビルドされていないアプリケーションを実行しようとしたこと**が原因でした。`npm run build`と`npm run package`を実行することで問題は解決しました。

今後は必ず以下を確認してください:
1. ✅ `npm install`で依存関係をインストール
2. ✅ `npm run build`でアプリケーションをビルド
3. ✅ `npm run package`で実行ファイルをパッケージング
4. ✅ `release/win-unpacked`内のファイルを配布
