# LoL Viewer Next (PoC)

Electron + TypeScript + React で LoL Viewer を作り直す PoC。設計は [`../docs/design/next-architecture.md`](../docs/design/next-architecture.md)。

Python 版とは完全に独立している（`next/` の中で閉じた pnpm workspace）。
Python 版のワークフローは `next/**` だけの変更では動かず、この PoC 専用の CI は [`.github/workflows/next-ci.yml`](../.github/workflows/next-ci.yml)。

## クイックスタート

```bash
cd next
pnpm install
pnpm web:dev        # ブラウザで UI（モックの試合シナリオを再生できる）
pnpm storybook      # 全 UI 状態のカタログ
pnpm desktop:start  # Electron アプリ（LoL クライアントがあれば本物に接続する）
```

League Client なしで、Electron を偽の LCU につないで動かす場合:

```bash
pnpm fake-lcu --speed 1           # 起動すると LOL_LCU_LOCKFILE=... が表示される
LOL_LCU_LOCKFILE=<表示されたパス> pnpm desktop:start
```

## チェック（AI Agent も人間もこれを通す）

| コマンド | 内容 |
|---|---|
| `pnpm typecheck` | 全パッケージの型チェック |
| `pnpm test` | core の reducer、URL、偽 LCU → 接続部 → Hub の結合テスト、Hub サーバのセキュリティ |
| `pnpm storybook:build && pnpm e2e:storybook` | 全 story を Chromium で描画し `e2e/screenshots/storybook/*.png` に保存 |
| `pnpm desktop:build && xvfb-run -a pnpm e2e:electron` | Electron 本体を偽 LCU で動かす。外部 WebView の位置・表示を検証し、画面全体のスクショとメモリを `e2e/screenshots/electron/` に保存 |
| `LOL_VIEWER_EXE=<exe> pnpm e2e:electron` | パッケージ済みの exe で同じ E2E を回す（Windows CI で使用） |

## 構成

```
packages/protocol   zod スキーマ: LCU ペイロード、MatchState、外部ビューのコマンド、URL 許可リスト
packages/core       純粋ロジック: reducer (LcuEvent -> MatchState)、URL ビルダー、自動ビューア、シナリオ
packages/lcu        🔴 読み取り専用の LCU クライアント（GET + WAMP 購読のみ）
packages/hub        状態ストア + 購読用サーバ（127.0.0.1 / トークン / Origin・Host 検証）
tools/fake-lcu      シナリオを LCU と同じプロトコルで再生する偽サーバ
scenarios/          試合のイベント列（JSONL）。テスト・Storybook・E2E で共用
apps/web            React UI。Electron・ブラウザ・Storybook で同じものが動く
apps/desktop        🔴 Electron main / preload / ExternalViewManager / electron-builder
e2e/                Playwright（Storybook スクショ、Electron E2E）
```

## PoC で確認できたこと

1. **1 ウィンドウに複数の外部 WebView を並べられる**（iframe なし）
   - `WebContentsView` を 1〜3 枚、UI 側のスロットにぴったり重ねられる。レイアウト変更・ウィンドウのリサイズ・新しい試合のあとも追従する（E2E で座標を突き合わせて検証）。
   - HTML のモーダルを開くと全ビューを隠し、閉じると戻る。
2. **データの流れが League Client なしで全部テストできる**: シナリオ → 偽 LCU（HTTP + WAMP）→ 本物の接続部 → core → Hub → UI。
3. **Windows なしで UI を確認できる**: Storybook の全 story と Electron 本体のスクショを Linux で生成できる。
4. **パッケージ化**: electron-builder で作った exe（asar）でも同じ E2E が通る。Linux と、Windows CI（`windows-latest`）の両方で確認済み。

### 計測メモ

| 項目 | Windows（CI, packaged exe） | Linux（Xvfb, ソフトウェア描画） |
|---|---|---|
| 外部ビュー 0 枚のメモリ（全プロセス合計） | 約 290 MB | 約 530 MB |
| lolalytics 3 枚を読み込んだあと | 約 1.0 GB | 約 1.35 GB |
| インストーラ（NSIS, 未署名） | 約 121 MB | — |

lolalytics は広告などを含む重いページで、1 枚あたり 250〜300MB ほど増える。同時に開いておく数の上限と、キャッシュする数（`MAX_CACHED = 4`）の調整は今後の課題。
Windows CI の runner は画面が 1024×768 なので、スクショの右側は切れている。

## 安全性（設計書 §6 のうち実装済みのもの）

- LCU には GET と購読しかできない（汎用の `request()` は存在しない）。偽 LCU は書き込み要求を記録し、E2E で「0 件」を確認している。
- TLS 検証を緩めるのは LCU へのループバック接続だけ（Python 版のようにプロセス全体では緩めない）。
- 外部ビュー: preload なし、sandbox、専用 session。`https` の許可ホスト（lolalytics.com / u.gg）以外への遷移やポップアップは既定ブラウザに回す。
- アプリ本体のウィンドウ: sandbox、contextIsolation、ナビゲーション禁止。IPC は送り元フレームを確認し、zod で検証する。本番ビルドは CSP を強制する。
- Hub サーバ: 127.0.0.1 にだけ bind、トークン必須、`Origin` と `Host` を検証（DNS rebinding 対策）。テスト済み。

## まだやっていないこと

- 実際の LCU（https/wss、Riot の自己署名証明書）での接続確認。Windows 実機で人間が `pnpm desktop:start` する必要がある。
- 実際の試合の録画ツール（`tools/recorder`）
- 自動更新、コード署名、Python 版からの設定の引き継ぎ
- Storybook の画像差分比較（今はスクショを保存するだけ。基準画像を CI 環境で作る仕組みが必要）
- チャンピオン表を Data Dragon から自動生成する（今は PoC 用の 13 体だけ）
- CODEOWNERS とブランチ保護による 🔴 ゾーンの強制
