# next/ — AI Agent 向けルール

`next/` は Electron + TypeScript の PoC。リポジトリ直下の `claude.md`（Python 版のルール）に加えて、以下を守る。

## ゾーン

- 🟢 自由に変更してよい: `apps/web/`, `packages/core/`, `scenarios/`, `e2e/`, stories, tests
- 🟡 理由を PR に書く: `packages/protocol/`（スキーマを変えたら全層のテストを通す）, `packages/hub/`, `tools/fake-lcu/`
- 🔴 人間のレビュー必須: `apps/desktop/`（main / preload / 権限 / パッケージング）, `packages/lcu/`, `.github/workflows/next-ci.yml`
  - `packages/lcu` に書き込み系（POST/PUT/PATCH/DELETE）の API を足さない
  - 外部ビューに preload や Node 権限を渡さない。iframe は使わない

## データ

- `packages/core/data/champions.json` は生成物。手で編集せず `pnpm champion-data` で作り直す（週次ワークフローも同じコマンドを使う）。

## 完了の定義

```bash
cd next
pnpm typecheck && pnpm test && pnpm storybook:build && pnpm e2e:storybook
pnpm desktop:build && xvfb-run -a pnpm e2e:electron
```

- UI を変えたら、該当する story を追加・更新し、`e2e/screenshots/` の画像を **自分で開いて確認する**。PR には変更前後のスクショを貼る。
- 新しい UI 状態は「シナリオ or fixture → story → 実装」の順で作る。fixture は `apps/web/src/fixtures.ts` のように、本物の reducer を通して作る。

## コミット

- Python 版のリリース判定（`release.yml`）はコミットメッセージを見る。`next/` 以外のファイルと一緒に main に入る場合に備えて、PoC のコミットは `feat(next):` ではなく `chore(next):` / `docs(next):` / `test(next):` を使う。
