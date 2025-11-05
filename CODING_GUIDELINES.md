# コーディング規約

## 概要

このプロジェクトは**保守性**と**再利用性**を最優先に設計されています。
以下のガイドラインに従って、クリーンで理解しやすく、拡張可能なコードを書いてください。

---

## 基本原則

### 1. SOLID原則の遵守

#### Single Responsibility Principle（単一責任の原則）
- 各クラス・関数は1つの責任のみを持つ
- 「このクラスが変更される理由は1つだけ」を常に意識

```typescript
// ❌ Bad: 複数の責任を持つ
class LCUManager {
  connect() { /* LCU接続 */ }
  parseEvent() { /* イベント解析 */ }
  buildURL() { /* URL構築 */ }
  openBrowser() { /* ブラウザ起動 */ }
}

// ✅ Good: 責任を分離
class LCUConnector {
  connect() { /* LCU接続のみ */ }
}

class ChampSelectEventParser {
  parse(event: LCUEvent) { /* イベント解析のみ */ }
}

class URLBuilder {
  buildMatchupURL(champ1: string, champ2: string) { /* URL構築のみ */ }
}

class BrowserController {
  open(url: string) { /* ブラウザ起動のみ */ }
}
```

#### Open/Closed Principle（開放/閉鎖の原則）
- 拡張に対して開いている、修正に対して閉じている
- 新機能追加時に既存コードを変更しない

```typescript
// ✅ Good: 拡張可能な設計
interface AnalyticsSite {
  buildMatchupURL(champ1: string, champ2: string): string;
  buildCounterURL(champ: string): string;
  buildBuildURL(champ: string): string;
}

class LoLAnalyticsSite implements AnalyticsSite {
  buildMatchupURL(champ1: string, champ2: string) {
    return `https://lolanalytics.com/champion/${champ1}/matchup/${champ2}`;
  }
  // ...
}

class UGGSite implements AnalyticsSite {
  buildMatchupURL(champ1: string, champ2: string) {
    return `https://u.gg/lol/champions/${champ1}/matchups/${champ2}`;
  }
  // ...
}

// 新しいサイトを追加するときは実装を増やすだけ（既存コード不変）
class OPGGSite implements AnalyticsSite { /* ... */ }
```

#### Liskov Substitution Principle（リスコフの置換原則）
- 派生クラスは基底クラスの代替可能であるべき

#### Interface Segregation Principle（インターフェース分離の原則）
- クライアントは使用しないインターフェースに依存すべきでない

```typescript
// ❌ Bad: 巨大なインターフェース
interface EventHandler {
  onBan(event: BanEvent): void;
  onPick(event: PickEvent): void;
  onHover(event: HoverEvent): void;
  onLockIn(event: LockInEvent): void;
  onGameStart(event: GameStartEvent): void;
  onGameEnd(event: GameEndEvent): void;
}

// ✅ Good: 小さく分離されたインターフェース
interface ChampSelectEventHandler {
  onBan(event: BanEvent): void;
  onPick(event: PickEvent): void;
  onHover(event: HoverEvent): void;
}

interface GameEventHandler {
  onGameStart(event: GameStartEvent): void;
  onGameEnd(event: GameEndEvent): void;
}
```

#### Dependency Inversion Principle（依存性逆転の原則）
- 上位モジュールは下位モジュールに依存すべきでない
- 両者は抽象に依存すべき

```typescript
// ✅ Good: DIパターン
class App {
  constructor(
    private lcuConnector: ILCUConnector,
    private urlBuilder: IURLBuilder,
    private browserController: IBrowserController
  ) {}

  // 抽象（インターフェース）に依存、具体実装には依存しない
}

// 使用例
const app = new App(
  new LCUWebSocketConnector(),
  new LoLAnalyticsURLBuilder(),
  new PlaywrightBrowserController()
);
```

### 2. DRY（Don't Repeat Yourself）
- 同じロジックを複数箇所に書かない
- 共通化できるものは関数・クラスに抽出

```typescript
// ❌ Bad: 重複コード
function openMatchupPage(champ1: string, champ2: string) {
  const url = `https://lolanalytics.com/champion/${champ1}/matchup/${champ2}`;
  exec(`open "${url}"`);
}

function openCounterPage(champ: string) {
  const url = `https://lolanalytics.com/champion/${champ}/counters`;
  exec(`open "${url}"`);
}

// ✅ Good: 共通化
function openURL(url: string) {
  exec(`open "${url}"`);
}

function openMatchupPage(champ1: string, champ2: string) {
  const url = urlBuilder.buildMatchupURL(champ1, champ2);
  openURL(url);
}

function openCounterPage(champ: string) {
  const url = urlBuilder.buildCounterURL(champ);
  openURL(url);
}
```

### 3. KISS（Keep It Simple, Stupid）
- シンプルな解決策を優先
- 過度に複雑な実装は避ける

```typescript
// ❌ Bad: 過度に複雑
class ChampionNameResolver {
  private cache: Map<number, Promise<string>>;
  private pendingRequests: Set<number>;

  async resolve(id: number): Promise<string> {
    if (this.pendingRequests.has(id)) {
      return this.waitForPending(id);
    }
    // 複雑なキャッシュロジック...
  }
}

// ✅ Good: シンプル
class ChampionNameResolver {
  private cache = new Map<number, string>();

  async resolve(id: number): Promise<string> {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }
    const name = await this.fetchFromDataDragon(id);
    this.cache.set(id, name);
    return name;
  }
}
```

### 4. YAGNI（You Aren't Gonna Need It）
- 今必要でない機能は実装しない
- 将来的に必要になったら追加する

```typescript
// ❌ Bad: 今は不要な機能
class Config {
  enableMachineLearning: boolean;  // Phase 5の機能
  enablePluginSystem: boolean;     // Phase 5の機能
  enableGUI: boolean;              // Phase 4の機能
}

// ✅ Good: 今必要な機能のみ
class Config {
  enableAutoOpen: boolean;
  enableNotifications: boolean;
}
```

---

## TypeScript規約

### 型定義

#### 1. 型を明示する
```typescript
// ❌ Bad: 型推論に頼りすぎる
const champions = [];
function getChampion(id) { /* ... */ }

// ✅ Good: 明示的な型定義
const champions: Champion[] = [];
function getChampion(id: number): Champion | undefined { /* ... */ }
```

#### 2. `any`を避ける
```typescript
// ❌ Bad
function parse(data: any): any { /* ... */ }

// ✅ Good: 具体的な型
interface LCUEvent {
  type: string;
  data: unknown;
}

function parse(data: unknown): LCUEvent {
  // 型ガードを使用
  if (isLCUEvent(data)) {
    return data;
  }
  throw new Error('Invalid LCU event');
}

function isLCUEvent(data: unknown): data is LCUEvent {
  return typeof data === 'object' && data !== null && 'type' in data;
}
```

#### 3. 型エイリアスとインターフェースの使い分け
- **Interface**: オブジェクトの形状、拡張可能な型
- **Type**: Union、Intersection、プリミティブのエイリアス

```typescript
// Interface: オブジェクト型、拡張予定がある
interface Champion {
  id: number;
  name: string;
  roles: Role[];
}

// Type: Union型、定数型
type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
type EventType = 'ban' | 'pick' | 'hover' | 'lock-in';
```

#### 4. ジェネリクスで再利用性を高める
```typescript
// ✅ Good: 再利用可能な汎用関数
function createCache<K, V>(): Cache<K, V> {
  const map = new Map<K, V>();

  return {
    get: (key: K) => map.get(key),
    set: (key: K, value: V) => map.set(key, value),
    has: (key: K) => map.has(key),
    clear: () => map.clear()
  };
}

const championCache = createCache<number, Champion>();
const urlCache = createCache<string, string>();
```

### Null安全

#### 1. Optional Chaining（`?.`）を活用
```typescript
// ✅ Good
const role = champion?.roles?.[0];
```

#### 2. Nullish Coalescing（`??`）を活用
```typescript
// ✅ Good
const port = config.port ?? 2999;
const timeout = options.timeout ?? 5000;
```

#### 3. Non-null Assertion（`!`）は避ける
```typescript
// ❌ Bad
const champion = champions.find(c => c.id === id)!;

// ✅ Good
const champion = champions.find(c => c.id === id);
if (!champion) {
  throw new Error(`Champion not found: ${id}`);
}
```

---

## ファイル・ディレクトリ構造

### プロジェクト構造
```
lol-viewer/
├── src/
│   ├── core/              # コアロジック
│   │   ├── lcu/           # LCU API関連
│   │   │   ├── connector.ts
│   │   │   ├── event-parser.ts
│   │   │   └── types.ts
│   │   ├── analytics/     # アナリティクスサイト関連
│   │   │   ├── url-builder.ts
│   │   │   ├── sites/
│   │   │   │   ├── lol-analytics.ts
│   │   │   │   ├── ugg.ts
│   │   │   │   └── opgg.ts
│   │   │   └── types.ts
│   │   ├── browser/       # ブラウザ制御
│   │   │   ├── controller.ts
│   │   │   └── tab-manager.ts
│   │   └── prediction/    # レーン推測
│   │       ├── lane-predictor.ts
│   │       └── champion-data.ts
│   ├── utils/             # ユーティリティ
│   │   ├── logger.ts
│   │   ├── config.ts
│   │   └── retry.ts
│   ├── cli/               # CLIインターフェース
│   │   ├── index.ts
│   │   ├── commands.ts
│   │   └── ui.ts
│   ├── types/             # 共通型定義
│   │   ├── champion.ts
│   │   ├── event.ts
│   │   └── config.ts
│   └── index.ts           # エントリーポイント
├── tests/                 # テスト
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── config/                # 設定ファイル
│   └── default.json
├── docs/                  # ドキュメント
│   ├── DESIGN.md
│   ├── CODING_GUIDELINES.md
│   └── API.md
├── package.json
├── tsconfig.json
├── biome.json
└── README.md
```

### ファイル命名規則
- **ファイル名**: `kebab-case.ts`
  - 例: `lane-predictor.ts`, `url-builder.ts`
- **クラス名**: `PascalCase`
  - 例: `LanePredictor`, `URLBuilder`
- **関数・変数名**: `camelCase`
  - 例: `predictLane()`, `buildMatchupURL()`
- **定数**: `SCREAMING_SNAKE_CASE`
  - 例: `MAX_RETRIES`, `DEFAULT_TIMEOUT`
- **型・インターフェース**: `PascalCase`
  - 例: `Champion`, `LCUEvent`, `Config`

---

## クラス設計

### 小さく、責任を明確に
```typescript
// ✅ Good: 小さく明確なクラス
class LCUConnector {
  private ws: WebSocket | null = null;

  async connect(credentials: LCUCredentials): Promise<void> { /* ... */ }
  disconnect(): void { /* ... */ }
  isConnected(): boolean { /* ... */ }
}

class ChampSelectMonitor {
  constructor(private connector: LCUConnector) {}

  async start(): Promise<void> { /* ... */ }
  stop(): void { /* ... */ }
  on(event: string, handler: EventHandler): void { /* ... */ }
}
```

### 依存性注入（DI）
```typescript
// ✅ Good: コンストラクタインジェクション
class Application {
  constructor(
    private lcuConnector: ILCUConnector,
    private urlBuilder: IURLBuilder,
    private browserController: IBrowserController,
    private config: Config
  ) {}

  async run(): Promise<void> {
    await this.lcuConnector.connect();
    // ...
  }
}

// 使用時
const app = new Application(
  new LCUWebSocketConnector(),
  new LoLAnalyticsURLBuilder(),
  new PlaywrightBrowserController(),
  loadConfig()
);
```

### Immutability（不変性）
```typescript
// ✅ Good: 不変なデータ構造
interface Champion {
  readonly id: number;
  readonly name: string;
  readonly roles: readonly Role[];
}

class ChampionList {
  constructor(private readonly champions: readonly Champion[]) {}

  // 新しいインスタンスを返す（元のデータは変更しない）
  add(champion: Champion): ChampionList {
    return new ChampionList([...this.champions, champion]);
  }
}
```

---

## 関数設計

### 1. 純粋関数を優先
```typescript
// ✅ Good: 純粋関数（副作用なし、同じ入力 → 同じ出力）
function buildMatchupURL(baseURL: string, champ1: string, champ2: string): string {
  return `${baseURL}/champion/${champ1}/matchup/${champ2}`;
}

// ❌ Bad: 副作用あり
let lastURL = '';
function buildMatchupURL(champ1: string, champ2: string): string {
  lastURL = `${BASE_URL}/champion/${champ1}/matchup/${champ2}`;  // グローバル変数変更
  return lastURL;
}
```

### 2. 引数は3つ以下
```typescript
// ❌ Bad: 引数が多すぎる
function openPage(
  url: string,
  width: number,
  height: number,
  x: number,
  y: number,
  fullscreen: boolean,
  incognito: boolean
) { /* ... */ }

// ✅ Good: オプションオブジェクトにまとめる
interface BrowserOptions {
  width?: number;
  height?: number;
  position?: { x: number; y: number };
  fullscreen?: boolean;
  incognito?: boolean;
}

function openPage(url: string, options: BrowserOptions = {}) { /* ... */ }
```

### 3. 早期リターン
```typescript
// ✅ Good: 早期リターンでネストを減らす
function predictLane(champion: Champion, team: Champion[]): Role | null {
  if (!champion.roles || champion.roles.length === 0) {
    return null;
  }

  const occupiedRoles = team.map(c => c.predictedRole).filter(Boolean);
  if (occupiedRoles.length >= 5) {
    return null;
  }

  const availableRoles = champion.roles.filter(r => !occupiedRoles.includes(r));
  return availableRoles[0] ?? null;
}

// ❌ Bad: ネストが深い
function predictLane(champion: Champion, team: Champion[]): Role | null {
  if (champion.roles && champion.roles.length > 0) {
    const occupiedRoles = team.map(c => c.predictedRole).filter(Boolean);
    if (occupiedRoles.length < 5) {
      const availableRoles = champion.roles.filter(r => !occupiedRoles.includes(r));
      if (availableRoles.length > 0) {
        return availableRoles[0];
      }
    }
  }
  return null;
}
```

---

## エラーハンドリング

### 1. カスタムエラークラス
```typescript
// ✅ Good: 意味のあるエラークラス
class LCUConnectionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'LCUConnectionError';
  }
}

class ChampionNotFoundError extends Error {
  constructor(public readonly championId: number) {
    super(`Champion not found: ${championId}`);
    this.name = 'ChampionNotFoundError';
  }
}

// 使用例
try {
  await lcuConnector.connect();
} catch (error) {
  if (error instanceof LCUConnectionError) {
    logger.error('Failed to connect to LCU:', error.message);
    // リトライロジック
  } else {
    throw error;
  }
}
```

### 2. Result型パターン（関数型アプローチ）
```typescript
// ✅ Good: 成功/失敗を型で表現
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

async function fetchChampion(id: number): Promise<Result<Champion>> {
  try {
    const champion = await fetch(`/api/champions/${id}`);
    return { ok: true, value: champion };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// 使用例
const result = await fetchChampion(123);
if (result.ok) {
  console.log(result.value.name);
} else {
  console.error(result.error.message);
}
```

### 3. リトライロジック
```typescript
// ✅ Good: 汎用的なリトライ関数
async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;
    delayMs: number;
    backoff?: 'linear' | 'exponential';
  }
): Promise<T> {
  const { maxAttempts, delayMs, backoff = 'exponential' } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = backoff === 'exponential'
        ? delayMs * Math.pow(2, attempt - 1)
        : delayMs * attempt;

      await sleep(delay);
    }
  }

  throw new Error('Unreachable');
}

// 使用例
const credentials = await retry(
  () => getLCUCredentials(),
  { maxAttempts: 4, delayMs: 2000, backoff: 'exponential' }
);
```

---

## 非同期処理

### 1. async/awaitを使用（Promiseのthen/catchは避ける）
```typescript
// ✅ Good: async/await
async function initialize() {
  try {
    const credentials = await getLCUCredentials();
    await lcuConnector.connect(credentials);
    await champSelectMonitor.start();
  } catch (error) {
    logger.error('Initialization failed:', error);
  }
}

// ❌ Bad: then/catch
function initialize() {
  getLCUCredentials()
    .then(credentials => lcuConnector.connect(credentials))
    .then(() => champSelectMonitor.start())
    .catch(error => logger.error('Initialization failed:', error));
}
```

### 2. 並列実行にはPromise.all
```typescript
// ✅ Good: 並列実行
async function openMultiplePages(urls: string[]) {
  await Promise.all(urls.map(url => browserController.open(url)));
}

// ❌ Bad: 直列実行（遅い）
async function openMultiplePages(urls: string[]) {
  for (const url of urls) {
    await browserController.open(url);
  }
}
```

### 3. リソースのクリーンアップ
```typescript
// ✅ Good: try-finally
class App {
  async run() {
    try {
      await this.initialize();
      await this.start();
    } finally {
      await this.cleanup();  // 必ず実行される
    }
  }

  private async cleanup() {
    await this.lcuConnector.disconnect();
    await this.browserController.close();
  }
}
```

---

## テスト

### 1. AAA（Arrange-Act-Assert）パターン
```typescript
import { describe, it, expect } from 'bun:test';

describe('URLBuilder', () => {
  it('should build matchup URL correctly', () => {
    // Arrange: 準備
    const builder = new LoLAnalyticsURLBuilder('https://lolanalytics.com');

    // Act: 実行
    const url = builder.buildMatchupURL('Ahri', 'Zed');

    // Assert: 検証
    expect(url).toBe('https://lolanalytics.com/champion/Ahri/matchup/Zed');
  });
});
```

### 2. テストは独立させる
```typescript
// ✅ Good: 各テストが独立
describe('LanePredictor', () => {
  it('should predict top lane for top-focused champion', () => {
    const predictor = new LanePredictor();
    const result = predictor.predict('Darius', [], 1);
    expect(result).toBe('top');
  });

  it('should skip occupied roles', () => {
    const predictor = new LanePredictor();
    const team = [{ name: 'Darius', predictedRole: 'top' }];
    const result = predictor.predict('Garen', team, 2);
    expect(result).not.toBe('top');
  });
});

// ❌ Bad: テストが依存
let predictor: LanePredictor;

it('should initialize predictor', () => {
  predictor = new LanePredictor();  // 次のテストに影響
});

it('should predict lane', () => {
  const result = predictor.predict('Darius', [], 1);  // 前のテストに依存
  expect(result).toBe('top');
});
```

### 3. モック・スタブを活用
```typescript
// ✅ Good: 外部依存をモック化
import { mock } from 'bun:test';

describe('Application', () => {
  it('should open browser when champion is picked', async () => {
    // モックを作成
    const mockBrowser = {
      open: mock(() => Promise.resolve())
    };

    const app = new Application(
      mockLCUConnector,
      mockURLBuilder,
      mockBrowser as any,
      mockConfig
    );

    await app.handlePickEvent({ championName: 'Ahri' });

    // モックが呼ばれたか検証
    expect(mockBrowser.open).toHaveBeenCalledTimes(1);
  });
});
```

---

## ログ

### 1. ログレベルを適切に使う
```typescript
logger.error('Failed to connect to LCU');  // エラー
logger.warn('Retrying connection...');     // 警告
logger.info('Connected to LCU');           // 情報
logger.debug('Received event:', event);    // デバッグ
```

### 2. 構造化ログ
```typescript
// ✅ Good: 構造化されたログ
logger.info('Champion picked', {
  championName: 'Ahri',
  role: 'mid',
  team: 'ally'
});

// ❌ Bad: 文字列連結
logger.info('Champion picked: Ahri, role: mid, team: ally');
```

---

## コメント

### 1. コードで説明できることはコメント不要
```typescript
// ❌ Bad: 不要なコメント
// チャンピオン名を取得
const name = champion.name;

// ✅ Good: コメント不要、コードが明確
const championName = champion.name;
```

### 2. "なぜ"を説明するコメント
```typescript
// ✅ Good: "なぜ"を説明
// LCU APIは自己署名証明書を使用するため、検証を無効化
const agent = new https.Agent({ rejectUnauthorized: false });

// ❌ Bad: "何を"を説明（コードを読めばわかる）
// HTTPSエージェントを作成
const agent = new https.Agent({ rejectUnauthorized: false });
```

### 3. JSDoc for 公開API
```typescript
/**
 * チャンピオンのレーンを推測します
 *
 * @param championName - チャンピオン名
 * @param team - 現在のチーム構成
 * @param pickOrder - Pick順序（1-5）
 * @returns 推測されたレーン、または不明な場合はnull
 *
 * @example
 * ```typescript
 * const lane = predictor.predict('Ahri', team, 3);
 * console.log(lane); // 'mid'
 * ```
 */
predictLane(championName: string, team: Champion[], pickOrder: number): Role | null {
  // 実装
}
```

---

## パフォーマンス

### 1. 不要な計算を避ける
```typescript
// ✅ Good: メモ化
class ChampionDataCache {
  private cache = new Map<number, Champion>();

  async get(id: number): Promise<Champion> {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    const champion = await this.fetch(id);
    this.cache.set(id, champion);
    return champion;
  }
}
```

### 2. 遅延初期化
```typescript
// ✅ Good: 必要になったときに初期化
class DataDragonClient {
  private _championData: Map<number, Champion> | null = null;

  async getChampionData(): Promise<Map<number, Champion>> {
    if (!this._championData) {
      this._championData = await this.fetchChampionData();
    }
    return this._championData;
  }
}
```

---

## セキュリティ

### 1. ユーザー入力のバリデーション
```typescript
// ✅ Good: Zodでバリデーション
import { z } from 'zod';

const ConfigSchema = z.object({
  browser: z.object({
    type: z.enum(['chromium', 'firefox', 'webkit']),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(2160)
  }),
  lolAnalytics: z.object({
    baseUrl: z.string().url(),
    autoOpenDelay: z.number().min(0).max(10000)
  })
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(data: unknown): Config {
  return ConfigSchema.parse(data);  // バリデーション＋型安全
}
```

### 2. シークレット情報のハードコード禁止
```typescript
// ❌ Bad
const API_KEY = 'sk_live_1234567890abcdef';

// ✅ Good: 環境変数から取得
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY is required');
}
```

---

## Git規約

### コミットメッセージ
```
<type>: <subject>

<body>

<footer>
```

**Type:**
- `feat`: 新機能
- `fix`: バグ修正
- `refactor`: リファクタリング
- `docs`: ドキュメント
- `test`: テスト
- `chore`: ビルド、ツール設定等

**例:**
```
feat: add lane prediction logic

Implement lane predictor that analyzes champion roles, pick order,
and team composition to predict the most likely lane assignment.

Closes #123
```

### ブランチ戦略
- `main`: 安定版
- `develop`: 開発版
- `feature/<name>`: 機能開発
- `fix/<name>`: バグ修正

---

## まとめ

このガイドラインに従うことで：
- ✅ **保守性**: 他の開発者（未来の自分）が理解しやすい
- ✅ **再利用性**: モジュール化されたコードは別プロジェクトでも使える
- ✅ **拡張性**: 新機能追加が容易
- ✅ **テスト可能性**: ユニットテストが書きやすい
- ✅ **安全性**: 型安全性とエラーハンドリングで堅牢なコード

**常に「Clean Code」を意識しましょう！**
