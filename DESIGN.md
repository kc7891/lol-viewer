# LoL Analytics Browser Viewer - 設計書

## 概要

League of Legendsのドラフト状況に基づいて、適切なLoL Analyticsページを自動的にブラウザで開くChromiumベースのアプリケーション。

### 目的
- u.ggのような便利な体験を提供
- LoL Analyticsのデータを**ブラウザ閲覧のみ**で利用（規約遵守）
- リアルタイムでドラフト状況を検知し、関連するページを自動表示

### 規約遵守
- ❌ データの取得・保存・利用は禁止
- ✅ ブラウザでの閲覧は許可範囲内
- ✅ URLの自動構築とブラウザ起動のみを行う

---

## システムアーキテクチャ

```
┌─────────────────────────────────────────┐
│    League of Legends Client             │
│  (LCU: League Client Update API)        │
└─────────────┬───────────────────────────┘
              │ WebSocket/HTTP
              │ (Champion Select Events)
              ▼
┌─────────────────────────────────────────┐
│    LoL Analytics Browser Viewer         │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │  Event Monitor                     │ │
│  │  - LCU APIに接続                   │ │
│  │  - チャンピオン選択イベント監視    │ │
│  └────────────────────────────────────┘ │
│              │                           │
│              ▼                           │
│  ┌────────────────────────────────────┐ │
│  │  URL Builder                       │ │
│  │  - ドラフト状況を解析              │ │
│  │  - LoL Analytics URLを構築         │ │
│  └────────────────────────────────────┘ │
│              │                           │
│              ▼                           │
│  ┌────────────────────────────────────┐ │
│  │  Browser Controller                │ │
│  │  - Chromiumを起動/制御             │ │
│  │  - ページを自動的に開く            │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│    Chromium Browser                     │
│    (LoL Analytics Pages)                │
└─────────────────────────────────────────┘
```

---

## 主要コンポーネント

### 1. LCU Monitor（League Client Update Monitor）
**責任**: League Clientとの通信、イベント検知

**機能**:
- LCU APIへの接続（WebSocket）
- チャンピオン選択フェーズの検知
  - Ban Phase
  - Pick Phase
  - 各プレイヤーのチャンピオン選択
- ゲームモード検知（ランク、ノーマル、ARAM等）
- セッション情報の取得

**技術**:
- LCU API（`https://127.0.0.1:2999/liveclientdata/allgamedata`）
- WebSocket接続 (`wss://riot:<token>@127.0.0.1:<port>`)
- 証明書検証の無効化（自己署名証明書対応）

**イベント**:
```typescript
interface ChampSelectEvent {
  type: 'ban' | 'pick' | 'hover' | 'lock-in';
  championId: number;
  championName: string;
  playerId: string;
  position: 'top' | 'jungle' | 'mid' | 'adc' | 'support' | 'unknown';
  team: 'ally' | 'enemy';
  timestamp: Date;
}
```

### 2. Analytics URL Builder
**責任**: LoL Analytics URLの構築

**機能**:
- チャンピオン名からURLパスを生成
- マッチアップURLの構築
  - 例: `/champion/{champion1}/matchup/{champion2}`
- ロール別統計URLの構築
  - 例: `/champion/{champion}/role/{role}`
- カウンターピックURLの構築
- ティアリストURLの構築

**URL例**:
```
# チャンピオン個別ページ
https://lolanalytics.com/champion/Ahri

# マッチアップページ
https://lolanalytics.com/champion/Ahri/matchup/Zed

# ロール別統計
https://lolanalytics.com/champion/Ahri/role/mid

# カウンターピック
https://lolanalytics.com/champion/Ahri/counters
```

### 3. Browser Controller
**責任**: Chromiumブラウザの制御

**機能**:
- Chromiumプロセスの起動
- 新規タブ/ウィンドウの管理
- 既存のタブの再利用
- ブラウザの閉じる処理

**オプション**:
- `--app=<url>`: アプリモードで起動
- `--window-size=1200,800`: ウィンドウサイズ指定
- `--new-window`: 新規ウィンドウで開く
- または既存のChrome/Edgeインスタンスを利用

**技術選択肢**:
1. **Puppeteer**: Node.jsからChromiumを制御
2. **Playwright**: より高機能なブラウザ自動化
3. **シンプルなコマンド実行**: `chromium-browser <url>`または`google-chrome <url>`

---

## データフロー

```
1. ユーザーがLoLクライアントでチャンピオン選択を開始
   ↓
2. LCU MonitorがWebSocketでイベントを受信
   ↓
3. イベントをパースして必要な情報を抽出
   - チャンピオン名
   - ロール
   - Ban/Pick状態
   - 味方/敵チーム
   ↓
4. URL Builderが適切なLoL Analytics URLを構築
   ↓
5. Browser Controllerがブラウザで該当URLを開く
   ↓
6. ユーザーがブラウザでLoL Analyticsを閲覧
```

---

## ユーザーインタラクション

### 起動方法
```bash
# CLIとして起動
lol-analytics-viewer

# または設定ファイルを指定
lol-analytics-viewer --config ./config.json
```

### 動作モード

#### 1. 自動モード（推奨）
- チャンピオン選択が始まると自動的に監視開始
- Pickされたチャンピオンに応じてページを開く
- マッチアップが確定すると自動更新

#### 2. 手動モード
- CLIからコマンドを入力してページを開く
```bash
> open ahri
> matchup ahri zed
> counters ahri
```

### UI/UX

#### ターミナルUI（推奨）
```
┌─ LoL Analytics Browser Viewer ─────────────────┐
│ Status: Connected to League Client             │
│ Mode: Champion Select (Draft Pick)             │
│                                                 │
│ Your Team:                                     │
│ [BAN] Yasuo       → Opening ban analysis...    │
│ [PICK] Ahri (YOU) → Opening champion page...   │
│ [PICK] Lee Sin                                 │
│                                                │
│ Enemy Team:                                    │
│ [BAN] Zed                                      │
│ [PICK] Katarina   → Opening matchup page...   │
│                                                │
│ Press 'q' to quit, 'r' to refresh             │
└────────────────────────────────────────────────┘
```

#### システムトレイ（オプション）
- バックグラウンドで動作
- アイコンクリックで状態確認
- 通知で新しいページを開いたことを表示

---

## 技術スタック

### プログラミング言語
**TypeScript/Node.js** (推奨)
- LCU APIとの相性が良い
- 非同期処理が簡単
- クロスプラットフォーム対応

**代替案**: Python（`requests`, `websocket-client`, `selenium`）

### 主要ライブラリ

```json
{
  "dependencies": {
    "ws": "^8.0.0",              // WebSocket通信
    "axios": "^1.0.0",           // HTTP通信
    "puppeteer": "^21.0.0",      // ブラウザ制御
    "commander": "^11.0.0",      // CLI構築
    "chalk": "^5.0.0",           // ターミナル色付け
    "ora": "^7.0.0",             // ローディングスピナー
    "dotenv": "^16.0.0"          // 環境変数管理
  }
}
```

### LCU API接続

```typescript
// LCU認証情報の取得
import { exec } from 'child_process';
import { promisify } from 'util';

async function getLCUCredentials() {
  // Windows: WMIC経由
  // macOS/Linux: ps経由
  const process = await findLeagueClientProcess();
  const port = extractPort(process);
  const token = extractToken(process);

  return {
    host: '127.0.0.1',
    port: port,
    username: 'riot',
    password: token
  };
}
```

---

## 設定ファイル

### config.json
```json
{
  "browser": {
    "type": "chromium",
    "executablePath": "/usr/bin/chromium-browser",
    "headless": false,
    "width": 1200,
    "height": 800,
    "reuseExisting": true
  },
  "lolAnalytics": {
    "baseUrl": "https://lolanalytics.com",
    "autoOpenDelay": 2000,
    "openMatchupOnConfirm": true,
    "openCountersOnHover": false
  },
  "lcu": {
    "autoDetect": true,
    "retryInterval": 5000,
    "enableSSL": true,
    "verifyCertificate": false
  },
  "ui": {
    "mode": "terminal",
    "showNotifications": true,
    "verbose": false
  }
}
```

---

## 実装フェーズ

### Phase 1: 基本機能 (MVP)
- [x] プロジェクト構造の作成
- [ ] LCU API接続
- [ ] チャンピオン選択イベントの検知
- [ ] 基本的なURL構築
- [ ] ブラウザ起動（シンプルなコマンド実行）

### Phase 2: 自動化
- [ ] WebSocketでのリアルタイム監視
- [ ] 自動的なページ遷移
- [ ] マッチアップ検知と自動表示
- [ ] エラーハンドリング

### Phase 3: UX改善
- [ ] ターミナルUIの実装
- [ ] 設定ファイルのサポート
- [ ] ロギング機能
- [ ] 起動時の自動接続

### Phase 4: 高度な機能
- [ ] タブの再利用と管理
- [ ] 複数のアナリティクスサイト対応（u.gg, op.gg等）
- [ ] ロール検出の精度向上
- [ ] カスタムURLテンプレート

---

## セキュリティとプライバシー

### 原則
1. **データを保存しない**: すべての情報は揮発性（メモリのみ）
2. **外部送信しない**: LoL Analytics以外への通信は行わない
3. **ローカル完結**: すべての処理はユーザーのマシン内で完結
4. **認証情報の保護**: LCU tokenは環境変数またはプロセス情報から取得

### 規約遵守チェックリスト
- [ ] データのスクレイピングを行わない
- [ ] APIの直接的な自動利用を行わない
- [ ] ページの内容を解析・保存しない
- [ ] 単にブラウザでURLを開くだけ
- [ ] ユーザーが手動でアクセスするのと同等の動作

---

## エラーハンドリング

### 想定されるエラー

1. **League Clientが起動していない**
   - 対応: 定期的にリトライ、ユーザーに通知

2. **LCU APIへの接続失敗**
   - 対応: 認証情報の再取得、ポート変更の検知

3. **ブラウザの起動失敗**
   - 対応: 代替ブラウザの試行、デフォルトブラウザの使用

4. **不明なチャンピオンID**
   - 対応: Data Dragonから最新のチャンピオンリストを取得

5. **ネットワークエラー**
   - 対応: タイムアウト設定、リトライロジック

---

## テスト戦略

### 単体テスト
- URL生成ロジック
- イベントパーサー
- 設定ファイルの読み込み

### 統合テスト
- LCU APIとの通信（モックサーバー）
- ブラウザ起動の検証

### 手動テスト
- 実際のチャンピオン選択での動作確認
- 各ゲームモードでの動作
- エッジケース（再接続、チャンピオン交換等）

---

## デプロイメント

### 配布方法

#### 1. npm package
```bash
npm install -g lol-analytics-viewer
lol-analytics-viewer
```

#### 2. スタンドアロン実行ファイル
- **pkg**を使用してNode.jsアプリをバイナリ化
- Windows: `.exe`
- macOS: `.app` または バイナリ
- Linux: バイナリ

#### 3. Electron版（オプション）
- GUIを持つデスクトップアプリとして配布
- 自動アップデート機能

---

## ロードマップ

### v0.1.0 - MVP
- 基本的なLCU接続
- チャンピオン選択の検知
- ブラウザでページを開く

### v0.2.0 - 自動化
- リアルタイム監視
- 自動ページ遷移
- エラーハンドリング

### v0.3.0 - UX向上
- ターミナルUI
- 設定ファイル
- 詳細なログ

### v1.0.0 - 安定版
- 全ゲームモード対応
- クロスプラットフォーム対応
- ドキュメント整備

### v1.1.0+ - 拡張機能
- 複数サイト対応
- プラグインシステム
- GUIオプション

---

## FAQ

### Q: これは規約違反ではないか？
A: データの取得・保存・利用は行わず、単にブラウザでURLを開くだけです。ユーザーが手動でアクセスするのと同じです。

### Q: u.ggとの違いは？
A: u.ggは独自のデータベースとOverlayを持ちますが、このツールは単にLoL Analyticsのページを開くだけです。

### Q: なぜChromiumを使うのか？
A: デフォルトブラウザがどれでも動作するようにするためです。コマンドラインから制御しやすい利点もあります。

### Q: macOS/Linuxでも動作するか？
A: はい。LCU APIはクロスプラットフォームです。プロセス検出の部分だけOS依存です。

---

## 参考リンク

- [LCU API Documentation](https://developer.riotgames.com/)
- [Rito Pls (LCU API Wrapper)](https://github.com/jjmaldonis/lcu-connector)
- [Data Dragon (Champion Data)](https://developer.riotgames.com/docs/lol#data-dragon)
- [Puppeteer Documentation](https://pptr.dev/)

---

## ライセンス

MIT License（予定）

**免責事項**:
このツールはRiot Gamesによって公式にサポートされていません。League of LegendsおよびRiot Gamesの利用規約に従って使用してください。
