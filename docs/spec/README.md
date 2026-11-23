# 仕様ドキュメント（docs/spec）

LoL Viewer の仕様を、このディレクトリでまとめて管理する。新版（`next/`、Electron 版）の設計・仕様・決定事項・移植の記録を置く。旧版（PyQt6 / Python 版）の機能棚卸し（legacy-inventory 01〜04）は削除した。内容は git のタグ `v0.34.0` の `docs/spec/legacy-inventory/` に残っている。

## 構成

| パス | 内容 | 更新方針 |
|---|---|---|
| [decisions.md](./decisions.md) | 移植方針の決定事項（M-xxx）と未決事項（Q-xxx） | 決まるたびに追記する。過去の決定は消さずに「改訂」を追記する |
| [new-app-design.md](./new-app-design.md) | 新版（`next/`、Electron 版）の設計: 構成、MatchState と Workspace の規則、新しい UI | 設計を変えたら更新する |
| [new-app-spec.md](./new-app-spec.md) | 新版の機能仕様（実装に基づく）と移植チェック表 | 実装を変えたら更新する。設計書と食い違うときは、実装を書いて差異に挙げる |
| [live-matchup-design.md](./live-matchup-design.md) | 試合中のゴールド差と対面表の補正（Live Client Data API、Feature Flag）の設計。決定 M-025〜M-029 の案を含む | 実装の手順書。実装を終えたら new-app-spec.md に反映し、この文書は設計の記録として残す |
| [progress.md](./progress.md) | 新版への移植の進み具合（インベントリのチェックリストとの対応） | 作業のたびに更新する |

## 運用ルール
- 仕様や移植に関するドキュメントはすべてこのディレクトリに置く。旧版の `docs/features.md`、`docs/architecture.md`、旧版の設計書は削除した（git のタグ `v0.34.0` にある）。
- 旧インベントリ（タグ `v0.34.0`）と decisions.md が食い違う場合は、**decisions.md を優先**する。
- 新しいドキュメント（新版の仕様や設計、移植の進み具合など）を追加するときは、このディレクトリに置き、上の表に追記する。
