# LoL Viewer（新版 / Electron）

Electron + TypeScript + React で作り直している LoL Viewer の新版。PoC から始まり、旧版（PyQt6 版）の機能を移植している。

- 仕様と移植の資料は [`../docs/spec/`](../docs/spec/README.md)（まず README から読む）。新版の設計は [`new-app-design.md`](../docs/spec/new-app-design.md)、進み具合は [`progress.md`](../docs/spec/progress.md)。
- 当初の構成案は [`../docs/design/next-architecture.md`](../docs/design/next-architecture.md)。

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
| `LOL_VIEWER_EXE=<exe> pnpm e2e:electron` | パッケージ済みの exe で同じ E2E を回す。Windows CI ではインストーラで実際にインストールしたアプリに対して実行し、起動中の上書きインストールとアンインストールも確認する |

## 構成

```
packages/protocol   zod スキーマ: LCU ペイロード、MatchState、外部ビューのコマンド、URL 許可リスト
packages/core       純粋ロジック: reducer (LcuEvent -> MatchState)、workspace (ビューア一覧・対面表・保留中の敵ピック)、URL、設定、検索、シナリオ
packages/lcu        🔴 読み取り専用の LCU クライアント（GET + WAMP 購読のみ）
packages/hub        状態ストア + 購読用サーバ（127.0.0.1 / トークン / Origin・Host 検証）
tools/fake-lcu      シナリオを LCU と同じプロトコルで再生する偽サーバ
tools/champion-data Data Dragon からチャンピオン表（ID・名前・URL 名・レーン適性・スキルのクールダウン）を生成
packages/recorder   実際の League Client の試合データを記録（個人情報は保存前に伏せる）
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
- 外部ビュー: preload なし、sandbox、専用 session。`https` 以外は読み込まない（ホストは自由）。既知の分析サイト（lolalytics.com / u.gg / op.gg）かそのビューと同じサイト以外への遷移や、ポップアップは既定ブラウザに回す。
- アプリ本体のウィンドウ: sandbox、contextIsolation、ナビゲーション禁止。IPC は送り元フレームを確認し、zod で検証する。本番ビルドは CSP を強制する。
- Hub サーバ: 127.0.0.1 にだけ bind、トークン必須、`Origin` と `Host` を検証（DNS rebinding 対策）。テスト済み。

## チャンピオンデータ（自動生成）

`packages/core/data/champions.json` は **手で編集しない**。Data Dragon から生成する:

```bash
pnpm champion-data                      # 最新パッチで再生成
pnpm champion-data --version 16.22.1    # パッチを指定
```

- 中身: League Client が送ってくる数値 ID、英語名・日本語名、lolalytics/u.gg の URL 名（`MonkeyKing` → `wukong` のみ例外）、レーン適性（`tools/champion-data/champion_lane.csv` の 0〜5。手で編集する入力ファイル）、Q/W/E/R のランク別の基本クールダウン。
- 更新: [`.github/workflows/next-champion-data.yml`](../.github/workflows/next-champion-data.yml) が毎週木曜に再生成し、変化があれば PR を出す。PR 本文にクールダウンの変更点の表が入る。
- アプリは同梱した JSON を読むだけで、実行時には通信しない。
- 生成した URL 名は、全 173 体が lolalytics で 200 を返すことを確認済み（2026-11, patch 16.23.1）。

### クールダウン表示

- マッチアップの右に、選んだチャンピオンの Q/W/E/R のランク別の基本クールダウンを表示する（デフォルトは自分のレーンの対面。マッチアップのチャンピオンをクリックで切り替え）。
- Wiki と同じ静的な参考情報。タイマーではなく、試合中のレベルとも連動しない。スキルヘイストは反映しない。
- Data Dragon にクールダウンがないスキル（パッシブ、チャージ式など。例: Gangplank E）は「—」と表示する。変身チャンピオン（Jayce など）はランク数が 6 や 1 になるが、Data Dragon の値をそのまま出している。

## 試合データの記録

推測ではなく実際の League Client のデータでテストするための仕組み。

**アプリから（おすすめ）**: Settings → 「試合を記録」→「記録を開始」→ プレイ（プラクティスツール、通常の試合など）→「記録を停止」。
保存先は `ドキュメント\LoL Viewer Next\recordings\session-YYYYMMDD-HHMMSS.jsonl`（「記録フォルダを開く」で開ける）。

**コマンドから**: LoL を起動している PC で `pnpm record`（Ctrl+C で停止。`recordings/` に保存）。

- 記録するもの: ゲームフローのフェーズ、ゲームフローのセッション、チャンプセレクトのセッション（LCU。読み取りと購読のみ）、試合中のプレイヤー一覧（公式の Live Client Data API、3 秒ごと、変化したときだけ）。記録を始めた時点の状態も最初に記録するので、チャンプセレクトの途中から始めても再生できる。
- 個人情報: PUUID、サモナー ID・名、Riot ID（ゲーム名・タグ）、プロフィールアイコンなどは、**ファイルに書く前に** `player-1` のような仮名に置き換える（1 つの記録の中では同じ人は同じ仮名）。
- 形式: `scenarios/*.jsonl` と同じ。そのまま偽の LCU で再生でき、テストや Storybook に使える。

記録をテストに取り込む手順:

1. ファイルを `scenarios/` にコピーする（例: `scenarios/practice-tool.jsonl`）。
2. `pnpm test` を実行する。`scenarios/` の全ファイルに個人情報が残っていないかを自動で検査する（残っていると失敗する）。
3. そのシナリオを使うテスト（reducer の期待値、Storybook の fixture、E2E）を足す。

## インストーラ

- ワンクリック・ユーザー単位のインストール（`%LOCALAPPDATA%\Programs\lol-viewer-next`）。管理者権限は不要で、インストール先は選べない。
- 以前の「インストール先を選べる」形式では、管理者権限なしのまま `D:\Program Files` のような保護されたフォルダを選べてしまい、ファイルの書き込みに失敗していた（「終了できません」「初期ファイルの作成エラー」）。
- 未署名のため、初回起動時に SmartScreen の警告が出る。

## まだやっていないこと

[`docs/spec/progress.md`](../docs/spec/progress.md) を参照。主なもの:

- 実際の LCU（https/wss、Riot の自己署名証明書、プロセスのコマンドラインからの接続情報の取得）での接続確認。Windows 実機で人間が確認する必要がある。
- 更新確認・自動更新と、新版のリリース経路
- コード署名
- Storybook の画像差分比較（今はスクショを保存するだけ）
