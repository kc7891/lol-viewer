# LoL Analytics Browser Viewer - 設計書

## 概要

League of Legendsのドラフト状況に基づいて、適切なLoL Analyticsページを自動的にブラウザで開くモダンなアプリケーション。

### 目的
- u.ggのような便利な体験を提供
- LoL Analyticsのデータを**ブラウザ閲覧のみ**で利用（規約遵守）
- リアルタイムでドラフト状況を検知し、関連するページを自動表示

### 主要機能
1. **マッチアップ分析**: 自分のチャンピオン vs 相手のチャンピオンの勝率表示
2. **カウンターピック支援**: 自分/相手のチャンピオンのカウンター情報を表示
3. **ビルドガイド**: 試合中に自分のチャンピオンの最適ビルドを表示
4. **レーン自動推測**: Pick順序とメタ情報からレーンを推測

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
- マッチアップURLの構築（勝率表示用）
  - 例: `/champion/{myChamp}/matchup/{enemyChamp}`
- カウンターピックURLの構築
  - 自分のチャンピオンのカウンター: `/champion/{myChamp}/counters`
  - 相手のチャンピオンのカウンター: `/champion/{enemyChamp}/counters`
- ビルドガイドURLの構築
  - 例: `/champion/{champion}/build`
- ロール別統計URLの構築（レーン推測後）
  - 例: `/champion/{champion}/role/{role}`

**URL例**:
```
# マッチアップページ（勝率表示）
https://lolanalytics.com/champion/Ahri/matchup/Zed

# 自分のチャンピオンのカウンター
https://lolanalytics.com/champion/Ahri/counters

# 相手のチャンピオンのカウンター
https://lolanalytics.com/champion/Zed/counters

# ビルドガイド（試合中）
https://lolanalytics.com/champion/Ahri/build

# ロール別統計
https://lolanalytics.com/champion/Ahri/role/mid
```

**レーン推測ロジック**:
```typescript
class LanePredictor {
  // チャンピオンの主要ロールデータ（Data Dragonから取得）
  private championRoles: Map<string, string[]>;

  // Pick順序とメタ情報からレーンを推測
  predictLane(champion: string, pickOrder: number, team: Champion[]): Lane {
    const possibleRoles = this.championRoles.get(champion);
    const occupiedRoles = team.map(c => c.predictedRole);

    // 1. 既に決まっているロールを除外
    // 2. チャンピオンの主要ロールを優先
    // 3. Pick順序を考慮（例: 1-2番目はTop/Jungleが多い）
    return this.selectBestRole(possibleRoles, occupiedRoles, pickOrder);
  }
}
```

### 3. Browser Controller
**責任**: ブラウザの制御

**機能**:
- ブラウザプロセスの起動
- 新規タブ/ウィンドウの管理
- 既存のタブの再利用（同じチャンピオンなら更新）
- 複数ページの並列表示
- ブラウザの閉じる処理

**技術選択**:
**Playwright**（推奨、モダンで高機能）
- クロスブラウザサポート
- Puppeteerより20-30%高速
- より良いAPI設計
- 自動待機機能

**実装アプローチ**:
```typescript
// アプローチ1: CDP経由で既存ブラウザに接続（軽量）
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = await browser.newPage();
await page.goto(url);

// アプローチ2: システムコマンド（最も軽量、推奨）
// macOS
exec(`open "${url}"`);
// Linux
exec(`xdg-open "${url}"`);
// Windows
exec(`start "" "${url}"`);
```

**タブ管理戦略**:
```typescript
class TabManager {
  private tabs: Map<string, Page> = new Map();

  async openOrUpdate(type: 'matchup' | 'counter' | 'build', url: string) {
    const existingTab = this.tabs.get(type);
    if (existingTab) {
      await existingTab.goto(url); // 既存タブを更新
    } else {
      const newTab = await browser.newPage();
      await newTab.goto(url);
      this.tabs.set(type, newTab);
    }
  }
}
```

---

## データフロー

### チャンピオン選択フェーズ
```
1. ユーザーがLoLクライアントでチャンピオン選択を開始
   ↓
2. LCU MonitorがWebSocketでイベントを受信
   ↓
3. イベントをパースして必要な情報を抽出
   - チャンピオン名
   - Ban/Pick状態
   - 味方/敵チーム
   - Pick順序
   ↓
4. Lane Predictorがレーンを推測
   - 既存のPick状況
   - チャンピオンの主要ロール
   - Pick順序のパターン
   ↓
5. URL Builderが適切なLoL Analytics URLを構築
   【自分がPick/Hoverした時】
   ┌─ マッチアップページ（vs 相手のレーナー）
   ├─ 自分のチャンピオンのカウンターページ
   └─ ビルドガイドページ

   【相手がPickした時】
   └─ 相手のチャンピオンのカウンターページ
   ↓
6. Browser Controllerがブラウザで該当URLを開く
   - 既存タブを再利用（同じチャンピオンなら更新）
   - 複数ページを別タブで開く
   ↓
7. ユーザーがブラウザでLoL Analyticsを閲覧
```

### 試合中フェーズ
```
1. ユーザーがLoLクライアントでゲームを開始
   ↓
2. In-Game API Monitorがゲーム開始を検知
   ↓
3. 自分のチャンピオンを特定
   ↓
4. ビルドガイドページを自動的に開く
   https://lolanalytics.com/champion/{myChamp}/build
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
チャンピオン選択中に自動的に以下のページを開く：

**自分がチャンピオンをHover/Pickした時**:
1. マッチアップページ（vs 相手のレーナー）
   - 勝率、キルレート、レーン優位性などが確認できる
2. 自分のチャンピオンのカウンターページ
   - どのチャンピオンが苦手か確認
3. ビルドガイドページ（Lock-in時）
   - アイテムビルド、ルーン、スキルオーダー

**相手がチャンピオンをPickした時**:
1. 相手のチャンピオンのカウンターページ
   - カウンターピックの選択肢を確認

**試合開始時**:
1. 自分のチャンピオンのビルドページ
   - 試合中にアイテムビルドを参照

#### 2. 手動モード
CLIからコマンドを入力してページを開く：
```bash
> matchup ahri zed        # Ahri vs Zedのマッチアップ
> counters ahri           # Ahriのカウンター
> counter-of zed          # Zedのカウンター
> build ahri              # Ahriのビルドガイド
> open ahri               # Ahri個別ページ
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

## 技術スタック（2025年モダン構成）

### ランタイム
**Bun** (推奨 🚀)
- **4.8倍高速**: Node.jsより圧倒的に速い起動・実行速度
- **TypeScriptネイティブ**: トランスパイル不要で直接実行
- **All-in-one**: ランタイム、パッケージマネージャー、バンドラー、テストランナーを統合
- **npm互換**: 既存のnpmパッケージをそのまま使用可能
- パッケージインストールが10-20倍高速

**理由**: パフォーマンスが重要で、TypeScriptをネイティブサポートするため

### プログラミング言語
**TypeScript 5.x**
- 型安全性による保守性向上
- IntelliSenseによる開発効率化
- リファクタリングの容易さ

### 主要ライブラリ

```json
{
  "dependencies": {
    "ws": "^8.18.0",              // WebSocket通信（LCU API）
    "playwright": "^1.48.0",      // モダンなブラウザ自動化（Puppeteerより高速・高機能）
    "commander": "^12.1.0",       // CLI構築
    "chalk": "^5.3.0",            // ターミナル色付け
    "ora": "^8.1.0",              // ローディングスピナー
    "zod": "^3.23.8",             // スキーマバリデーション（設定ファイル用）
    "tsx": "^4.19.0"              // TypeScript実行（開発用、Bunでは不要）
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",   // 高速Linter & Formatter（ESLint + Prettierの代替）
    "@types/ws": "^8.5.0",
    "@types/node": "^20.0.0",
    "bun-types": "^1.0.0"
  }
}
```

### ツール選定理由

#### Biome（Linter & Formatter）
- **ESLint + Prettierより100倍高速**（Rust製）
- 設定が簡単（ゼロコンフィグ対応）
- 統一されたツールチェーン

#### Playwright（ブラウザ自動化）
- **Puppeteerより20-30%高速**
- クロスブラウザサポート（Chrome, Firefox, Safari）
- 自動待機機能（安定性向上）
- より良いデバッグツール

**実装方針**: フル機能は不要なため、軽量な使い方のみ
```typescript
// 既存ブラウザの新規タブで開く（軽量）
import { chromium } from 'playwright';

async function openInBrowser(url: string) {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = await browser.newPage();
  await page.goto(url);
}

// または、さらにシンプルにシステムコマンドで開く
import { exec } from 'child_process';
exec(`open "${url}"`); // macOS
exec(`xdg-open "${url}"`); // Linux
exec(`start "" "${url}"`); // Windows
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
    "features": {
      "matchup": {
        "enabled": true,
        "trigger": "pick"  // "hover" | "pick" | "lock-in"
      },
      "myCounters": {
        "enabled": true,
        "trigger": "hover"
      },
      "enemyCounters": {
        "enabled": true,
        "trigger": "pick"
      },
      "buildGuide": {
        "enabled": true,
        "trigger": "lock-in",  // チャンピオン選択時
        "inGame": true         // 試合開始時にも開く
      }
    }
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
- [ ] Bunプロジェクトのセットアップ
- [ ] LCU API接続（WebSocket）
- [ ] チャンピオン選択イベントの検知
- [ ] 基本的なURL構築
  - [ ] マッチアップURL
  - [ ] カウンターURL
  - [ ] ビルドURL
- [ ] ブラウザ起動（システムコマンド）
- [ ] Data Dragonからチャンピオンデータ取得

### Phase 2: 自動化とレーン推測
- [ ] WebSocketでのリアルタイム監視
- [ ] レーン推測ロジックの実装
  - [ ] チャンピオンの主要ロールデータ取得
  - [ ] Pick順序分析
  - [ ] チーム構成からの推測
- [ ] 自動的なページ遷移
  - [ ] 自分のPick時: マッチアップ + 自分のカウンター
  - [ ] 相手のPick時: 相手のカウンター
- [ ] エラーハンドリング

### Phase 3: UX改善
- [ ] ターミナルUIの実装（chalk + ora）
- [ ] 設定ファイルのサポート（Zodバリデーション）
- [ ] ロギング機能
- [ ] 起動時の自動接続
- [ ] タブの再利用と管理（Playwright使用）

### Phase 4: 試合中機能
- [ ] In-Game API監視
- [ ] 試合開始検知
- [ ] ビルドページの自動表示
- [ ] 試合終了時のクリーンアップ

### Phase 5: 高度な機能
- [ ] 複数のアナリティクスサイト対応（u.gg, op.gg, lolalytics等）
- [ ] レーン推測精度向上（機械学習的アプローチ）
- [ ] カスタムURLテンプレート
- [ ] プラグインシステム

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
