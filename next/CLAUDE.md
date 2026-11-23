# next/ — AI Agent 向けルール

`next/` は LoL Viewer Next（Electron + TypeScript）。以下を守る。

## AI 開発の原則

- このプロジェクトのコード、ドキュメント、テスト、設定は AI アシスタントが生成・保守する。
- AI が自分でできること（実装の確認、テストの実行、動作確認、GitHub Actions とそのログの確認）は、なるべく自分で実行する。
- 実際に動かして確かめるだけでなく、コードやドキュメントを注意深く作り、確認する。事前の設計と実装の正確さで、デバッグの往復を減らす。
- Windows ユーザーを想定する。モダンでシンプルな構成で、最小限で効果の大きい実装にする。できる限りテストを書く。

仕様は `../docs/spec/`（README から読む）。新しく決めたことは `docs/spec/decisions.md` に追記し、移植の進み具合は `docs/spec/progress.md` を更新する。

## ゾーン

- 🟢 自由に変更してよい: `apps/web/`, `packages/core/`, `scenarios/`, `e2e/`, stories, tests
- 🟡 理由を PR に書く: `packages/protocol/`（スキーマを変えたら全層のテストを通す）, `packages/hub/`, `tools/fake-lcu/`
- 🔴 人間のレビュー必須: `apps/desktop/`（main / preload / 権限 / パッケージング）, `packages/lcu/`, `.github/workflows/next-ci.yml`
  - `packages/lcu` に書き込み系（POST/PUT/PATCH/DELETE）の API を足さない
  - 外部ビューに preload や Node 権限を渡さない。iframe は使わない

## データ

- `scenarios/*.jsonl` に入れてよいのは、記録ツールで伏せたデータか合成データだけ。`pnpm test` の個人情報検査（packages/recorder の committed scenarios テスト）が通らないファイルはコミットしない。記録ツールの伏せ方（`packages/recorder/src/mask.ts`）を緩める変更は 🔴 扱い。
- `packages/core/data/champions.json` は生成物。手で編集せず `pnpm champion-data` で作り直す（週次ワークフローも同じコマンドを使う）。

## 完了の定義

```bash
cd next
pnpm typecheck && pnpm test && pnpm storybook:build && pnpm e2e:storybook
pnpm desktop:build && xvfb-run -a pnpm e2e:electron
```

- UI を変えたら、該当する story を追加・更新し、`e2e/screenshots/` の画像を **自分で開いて確認する**。PR には変更前後のスクショを貼る。
- 新しい UI 状態は「シナリオ or fixture → story → 実装」の順で作る。fixture は `apps/web/src/fixtures.ts` のように、本物の reducer を通して作る。

## 配布（インストーラを人に渡す前に必ず）

- 渡すインストーラは、**そのコミットの `next-ci.yml` の windows ジョブ（中身は `next-windows.yml`）が全部成功したもの**に限る。windows ジョブでは次を確認している:
  インストール → 起動して E2E → 起動中の上書きインストール → アンインストール、および一般ユーザー（管理者でない・日本語ユーザー名）でのインストール → 起動 → アンインストール。
- 「exe がビルドできた」「win-unpacked が起動した」だけでは配布可としない。
- CI で確かめられないもの（実際の League Client への接続、SmartScreen の表示、既存の失敗したインストールが残っている環境）は、未確認であることを明記して渡す。
- インストーラの設定（`apps/desktop/electron-builder.yml`）を変えたら、上の windows ジョブが通るまで配らない。

## コミット

- テストを実行して通ってからコミットし、変更内容を確認してから push する。
- コミットメッセージは Conventional Commits（`.githooks/commit-msg` が検査する。`setup-hooks.sh` / `setup-hooks.bat` で有効にする）。
- `next-release.yml` は、最新の `app-v*` タグ以降の `next/` のコミットメッセージからバージョンを決める: `BREAKING CHANGE` / `!:` なら major、`feat:` なら minor、それ以外は patch。利用者に見える機能追加だけを `feat:` にする。
