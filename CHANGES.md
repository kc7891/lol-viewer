# Electron化による変更点

## 削除した不要な実装

### Playwright (playwright@^1.48.0)
- **理由**: 実際には使用していなかった
- **影響**: パッケージサイズ ~100MB 削減
- **代替**: シンプルな`exec`コマンドでブラウザを起動（既に実装済み）
- **将来**: タブ管理が必要になったら再追加可能

## 保持した実装（意図的）

### CLIモード (src/cli/*)
- **理由**: 開発者向けツール、デバッグに有用
- **使用例**: `npm run cli matchup Ahri Zed`

### ターミナルUI (chalk, ora)
- **理由**: CLIモードとLoggerで使用中
- **用途**: 色付きログ、スピナー表示

### Browser Controller (src/core/browser/controller.ts)
- **理由**: Electronアプリでも使用
- **方式**: システムコマンド（軽量・シンプル）

## Electronアプリで追加した実装

### 新規ファイル
- `src/electron/main.ts` - Electronメインプロセス
- `src/electron/preload.ts` - セキュアなIPC
- `assets/settings.html` - GUI設定画面

### 新規依存関係
- `electron@^33.2.0` - Electronフレームワーク
- `electron-builder@^25.1.8` - パッケージビルダー
- `electron-store@^8.2.0` - 設定永続化

## まとめ

✅ 不要な実装を削除（Playwright）
✅ 有用な実装は保持（CLI、Logger等）
✅ Electron専用機能を追加（GUI、システムトレイ）

結果: より軽量でユーザーフレンドリーなアプリケーション
