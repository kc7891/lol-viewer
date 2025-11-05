# 構築チェックリスト

このドキュメントは、LoL Analytics Browser Viewerの実装を段階的に進めるためのチェックリストです。
各ステップには動作確認ポイントが含まれています。

---

## Phase 1: プロジェクトセットアップ

### 1.1 基本ファイルの作成
- [ ] `package.json` - プロジェクトメタデータと依存関係
- [ ] `tsconfig.json` - TypeScript設定
- [ ] `biome.json` - Linter & Formatter設定
- [ ] `.gitignore` - Git除外設定
- [ ] `README.md` - プロジェクト説明

**動作確認**: `bun install`が成功すること

### 1.2 ディレクトリ構造の作成
```
src/
├── core/
│   ├── lcu/
│   ├── analytics/
│   ├── browser/
│   └── prediction/
├── utils/
├── cli/
└── types/
```
- [ ] 上記ディレクトリを作成
- [ ] 各ディレクトリに`.gitkeep`を配置（空ディレクトリをコミット用）

**動作確認**: ディレクトリ構造が正しく作成されていること

---

## Phase 2: 型定義

### 2.1 共通型定義
- [ ] `src/types/champion.ts` - Champion, Role型
- [ ] `src/types/event.ts` - LCUイベント型
- [ ] `src/types/config.ts` - 設定ファイル型

**動作確認**: `bun run build`でコンパイルエラーがないこと

### 2.2 型定義の内容
- [ ] `Champion` インターフェース
- [ ] `Role` 型（'top' | 'jungle' | 'mid' | 'adc' | 'support'）
- [ ] `ChampSelectEvent` インターフェース
- [ ] `Config` インターフェース（Zodスキーマ付き）

---

## Phase 3: ユーティリティ実装

### 3.1 Logger
- [ ] `src/utils/logger.ts` - ログ機能
- [ ] ログレベル（debug, info, warn, error）
- [ ] 構造化ログ対応

**動作確認**:
```typescript
import { logger } from './utils/logger';
logger.info('Test log');
```

### 3.2 Config Loader
- [ ] `src/utils/config.ts` - 設定ファイル読み込み
- [ ] Zodバリデーション
- [ ] デフォルト値の設定

**動作確認**:
```typescript
import { loadConfig } from './utils/config';
const config = loadConfig();
console.log(config);
```

### 3.3 Retry Utility
- [ ] `src/utils/retry.ts` - リトライ機能
- [ ] Exponential backoff対応

**動作確認**:
```typescript
await retry(() => fetch('https://example.com'), {
  maxAttempts: 3,
  delayMs: 1000
});
```

---

## Phase 4: Data Dragon統合

### 4.1 Champion Data Fetcher
- [ ] `src/core/prediction/champion-data.ts`
- [ ] Data DragonからチャンピオンJSON取得
- [ ] チャンピオンID → 名前マッピング
- [ ] チャンピオン → ロールマッピング

**動作確認**:
```bash
bun run src/core/prediction/champion-data.ts
# チャンピオンデータが取得できること
```

### 4.2 Champion Data Cache
- [ ] メモリキャッシュ実装
- [ ] TTL設定（1日）

---

## Phase 5: URL Builder実装

### 5.1 Analytics Site Interface
- [ ] `src/core/analytics/types.ts` - AnalyticsSiteインターフェース
- [ ] メソッド定義（buildMatchupURL, buildCounterURL, buildBuildURL）

### 5.2 LoL Analytics実装
- [ ] `src/core/analytics/sites/lol-analytics.ts`
- [ ] 各URLビルドメソッド実装

**動作確認**:
```typescript
const site = new LoLAnalyticsSite('https://lolanalytics.com');
console.log(site.buildMatchupURL('Ahri', 'Zed'));
// => https://lolanalytics.com/champion/Ahri/matchup/Zed
console.log(site.buildCounterURL('Ahri'));
// => https://lolanalytics.com/champion/Ahri/counters
console.log(site.buildBuildURL('Ahri'));
// => https://lolanalytics.com/champion/Ahri/build
```

### 5.3 URL Builder Factory
- [ ] `src/core/analytics/url-builder.ts`
- [ ] 複数サイト対応（将来的にu.gg, op.gg追加用）

---

## Phase 6: Browser Controller実装

### 6.1 システムコマンド方式（シンプル、推奨）
- [ ] `src/core/browser/controller.ts`
- [ ] OS判定（Windows/macOS/Linux）
- [ ] 適切なコマンド実行（`open`, `xdg-open`, `start`）

**動作確認**:
```typescript
const controller = new BrowserController();
await controller.open('https://lolanalytics.com');
// ブラウザが開くこと
```

### 6.2 Tab Manager（オプション、Playwright使用）
- [ ] `src/core/browser/tab-manager.ts`
- [ ] CDP経由で既存ブラウザに接続
- [ ] タブの再利用機能

**動作確認**:
```typescript
const manager = new TabManager();
await manager.openOrUpdate('matchup', 'https://lolanalytics.com/champion/Ahri/matchup/Zed');
await manager.openOrUpdate('matchup', 'https://lolanalytics.com/champion/Ahri/matchup/Yasuo');
// 同じタブで更新されること
```

---

## Phase 7: LCU接続実装

### 7.1 LCU Credentials取得
- [ ] `src/core/lcu/credentials.ts`
- [ ] プロセス情報からポート・トークン抽出
- [ ] Windows対応（WMIC）
- [ ] macOS/Linux対応（ps）

**動作確認**:
```bash
# League Clientを起動した状態で
bun run src/core/lcu/credentials.ts
# ポートとトークンが表示されること
```

### 7.2 LCU Connector
- [ ] `src/core/lcu/connector.ts`
- [ ] WebSocket接続
- [ ] 自己署名証明書対応
- [ ] 接続/切断処理
- [ ] イベントエミッター

**動作確認**:
```typescript
const connector = new LCUConnector();
const credentials = await getLCUCredentials();
await connector.connect(credentials);
console.log('Connected:', connector.isConnected());
await connector.disconnect();
```

### 7.3 Event Parser
- [ ] `src/core/lcu/event-parser.ts`
- [ ] チャンピオン選択イベントのパース
- [ ] Ban/Pick/Hover/Lock-in検知

**動作確認**:
```typescript
const parser = new ChampSelectEventParser();
const event = parser.parse(rawLCUEvent);
console.log(event);
// { type: 'pick', championId: 103, championName: 'Ahri', ... }
```

---

## Phase 8: Lane Predictor実装

### 8.1 Lane Prediction Logic
- [ ] `src/core/prediction/lane-predictor.ts`
- [ ] チャンピオンの主要ロール取得
- [ ] Pick順序分析
- [ ] チーム構成からの推測

**動作確認**:
```typescript
const predictor = new LanePredictor();
const lane = predictor.predict('Ahri', [], 3);
console.log(lane); // 'mid'

const team = [
  { name: 'Darius', predictedRole: 'top' },
  { name: 'Lee Sin', predictedRole: 'jungle' }
];
const lane2 = predictor.predict('Ahri', team, 3);
console.log(lane2); // 'mid' (top/jungleは除外される)
```

---

## Phase 9: アプリケーションコア実装

### 9.1 Application Class
- [ ] `src/index.ts` - メインアプリケーションクラス
- [ ] 各コンポーネントの統合
- [ ] イベントハンドラー
- [ ] ライフサイクル管理（initialize, start, stop, cleanup）

### 9.2 イベントハンドラー実装
- [ ] `onChampionHover` - Hover時にカウンターページを開く
- [ ] `onChampionPick` - Pick時にマッチアップページを開く
- [ ] `onChampionLockIn` - Lock-in時にビルドページを開く
- [ ] `onGameStart` - 試合開始時にビルドページを開く

**動作確認**:
```bash
# League Clientでチャンピオン選択を開始
bun run src/index.ts
# イベントが検知され、ブラウザが開くこと
```

---

## Phase 10: CLI実装

### 10.1 CLI Commands
- [ ] `src/cli/commands.ts`
- [ ] `matchup <champ1> <champ2>` コマンド
- [ ] `counters <champ>` コマンド
- [ ] `counter-of <champ>` コマンド
- [ ] `build <champ>` コマンド

**動作確認**:
```bash
bun run src/cli/index.ts matchup Ahri Zed
# ブラウザでマッチアップページが開くこと
```

### 10.2 CLI UI
- [ ] `src/cli/ui.ts`
- [ ] ターミナルUI（chalk + ora使用）
- [ ] ステータス表示
- [ ] チーム構成表示

**動作確認**:
```bash
bun run src/cli/index.ts
# UIが表示されること
```

---

## Phase 11: 設定ファイル対応

### 11.1 Default Config
- [ ] `config/default.json` - デフォルト設定
- [ ] ブラウザ設定
- [ ] LoL Analytics設定
- [ ] LCU設定
- [ ] UI設定

### 11.2 Config Override
- [ ] ユーザー設定ファイル読み込み（`~/.lol-viewer/config.json`）
- [ ] コマンドライン引数での設定上書き

**動作確認**:
```bash
bun run src/index.ts --config ./my-config.json
# カスタム設定が適用されること
```

---

## Phase 12: エラーハンドリング強化

### 12.1 Custom Error Classes
- [ ] `src/utils/errors.ts`
- [ ] `LCUConnectionError`
- [ ] `ChampionNotFoundError`
- [ ] `BrowserLaunchError`

### 12.2 Global Error Handler
- [ ] プロセス終了時のクリーンアップ
- [ ] 未処理エラーのキャッチ

**動作確認**:
```typescript
// League Clientが起動していない状態で
bun run src/index.ts
// エラーメッセージが表示され、適切に終了すること
```

---

## Phase 13: 試合中機能（In-Game API）

### 13.1 In-Game API Monitor
- [ ] `src/core/lcu/in-game-monitor.ts`
- [ ] `https://127.0.0.1:2999/liveclientdata/allgamedata`に接続
- [ ] ゲーム開始検知
- [ ] 自分のチャンピオン特定

**動作確認**:
```bash
# 実際にゲームを開始した状態で
bun run src/core/lcu/in-game-monitor.ts
# ゲーム情報が取得できること
```

### 13.2 In-Game Build Auto Open
- [ ] ゲーム開始時に自動的にビルドページを開く

**動作確認**:
```bash
# ゲームを開始
bun run src/index.ts
# ビルドページが自動的に開くこと
```

---

## Phase 14: テスト実装

### 14.1 Unit Tests
- [ ] `tests/unit/url-builder.test.ts` - URLビルダーのテスト
- [ ] `tests/unit/lane-predictor.test.ts` - レーン推測のテスト
- [ ] `tests/unit/event-parser.test.ts` - イベントパーサーのテスト

**動作確認**:
```bash
bun test
# すべてのテストがパスすること
```

### 14.2 Integration Tests
- [ ] `tests/integration/lcu-connection.test.ts` - LCU接続テスト（モック）
- [ ] `tests/integration/browser-open.test.ts` - ブラウザ起動テスト

---

## Phase 15: ドキュメント整備

### 15.1 README更新
- [ ] インストール方法
- [ ] 使い方
- [ ] 設定方法
- [ ] トラブルシューティング

### 15.2 API Documentation
- [ ] 主要クラス・関数のJSDoc
- [ ] 使用例

---

## Phase 16: パッケージング

### 16.1 npm package
- [ ] package.json の `bin` フィールド設定
- [ ] シバン（`#!/usr/bin/env bun`）追加

**動作確認**:
```bash
bun link
lol-analytics-viewer
# グローバルコマンドとして動作すること
```

### 16.2 スタンドアロンバイナリ（オプション）
- [ ] `bun build --compile` でバイナリ化
- [ ] Windows/macOS/Linux版の作成

---

## 動作確認の重要ポイント

### ✅ Checkpoint 1: 基本セットアップ（Phase 1-3完了後）
```bash
bun install
bun run build
bun run src/utils/logger.ts
```

### ✅ Checkpoint 2: URL生成（Phase 5完了後）
```bash
bun run test-url-builder.ts
# 各種URLが正しく生成されること
```

### ✅ Checkpoint 3: ブラウザ起動（Phase 6完了後）
```bash
bun run test-browser.ts
# ブラウザが正しく開くこと
```

### ✅ Checkpoint 4: LCU接続（Phase 7完了後）
```bash
# League Client起動状態で
bun run test-lcu.ts
# LCUに接続できること
```

### ✅ Checkpoint 5: 統合テスト（Phase 9完了後）
```bash
# League Clientでチャンピオン選択開始
bun run src/index.ts
# チャンピオンをHover/Pickすると自動的にページが開くこと
```

### ✅ Checkpoint 6: CLI動作確認（Phase 10完了後）
```bash
bun run src/cli/index.ts matchup Ahri Zed
bun run src/cli/index.ts counters Ahri
```

### ✅ Checkpoint 7: 試合中機能（Phase 13完了後）
```bash
# 実際にゲームを開始
bun run src/index.ts
# ビルドページが自動的に開くこと
```

---

## トラブルシューティングチェックリスト

### LCU接続できない場合
- [ ] League Clientが起動しているか確認
- [ ] `getLCUCredentials()` でポート・トークンが取得できるか確認
- [ ] ファイアウォールでブロックされていないか確認

### ブラウザが開かない場合
- [ ] OSに応じたコマンド（`open`, `xdg-open`, `start`）が使えるか確認
- [ ] URLが正しく構築されているか確認
- [ ] ブラウザがインストールされているか確認

### チャンピオンデータが取得できない場合
- [ ] Data Dragon APIにアクセスできるか確認
- [ ] ネットワーク接続を確認
- [ ] APIのバージョンを確認（最新版を使用）

---

## 進捗管理

各フェーズ完了時にチェックボックスをマークしてください。

- [ ] Phase 1: プロジェクトセットアップ
- [ ] Phase 2: 型定義
- [ ] Phase 3: ユーティリティ実装
- [ ] Phase 4: Data Dragon統合
- [ ] Phase 5: URL Builder実装
- [ ] Phase 6: Browser Controller実装
- [ ] Phase 7: LCU接続実装
- [ ] Phase 8: Lane Predictor実装
- [ ] Phase 9: アプリケーションコア実装
- [ ] Phase 10: CLI実装
- [ ] Phase 11: 設定ファイル対応
- [ ] Phase 12: エラーハンドリング強化
- [ ] Phase 13: 試合中機能
- [ ] Phase 14: テスト実装
- [ ] Phase 15: ドキュメント整備
- [ ] Phase 16: パッケージング

---

## 見積もり工数

- Phase 1-3: 1-2時間
- Phase 4-6: 2-3時間
- Phase 7-8: 3-4時間
- Phase 9-10: 3-4時間
- Phase 11-13: 2-3時間
- Phase 14-16: 2-3時間

**合計**: 約13-19時間

---

## 次のステップ

このチェックリストに従って、Phase 1から順次実装を進めてください。
各Phaseの完了時には必ず動作確認を行い、問題があれば修正してから次のPhaseに進んでください。
