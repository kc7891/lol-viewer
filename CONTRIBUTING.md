# Contributing to LoL Viewer Next

開発は `next/`（Electron + TypeScript の pnpm workspace）で行います。

## セットアップ

```bash
git clone https://github.com/kc7891/lol-viewer.git
cd lol-viewer

# Git hooks（必須）: コミットメッセージを Conventional Commits に強制します
bash setup-hooks.sh     # Linux / Mac
setup-hooks.bat         # Windows

cd next
pnpm install
```

## コミットメッセージ

`type(scope): message` の形式です（type: feat, fix, docs, style, refactor, test, chore, ci, perf）。`next-release.yml` がこのメッセージからリリースのバージョンを決めます（`feat:` は minor、`!:` / `BREAKING CHANGE` は major、それ以外は patch）。

## 開発の進め方

- コマンド、構成、チェック一覧: [next/README.md](next/README.md)
- AI Agent 向けのルール（変更してよい範囲、完了の定義、配布前の確認）: [next/CLAUDE.md](next/CLAUDE.md)
- 仕様と決定事項: [docs/spec/](docs/spec/README.md)

コミットの前に `cd next && pnpm typecheck && pnpm test` を通してください。
