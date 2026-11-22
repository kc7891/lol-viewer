# 新版への移植の進み具合

[旧機能インベントリ](./legacy-inventory/README.md) の各チェックリストが、新版（`next/`）でどうなったかをまとめる。
設計は [new-app-design.md](./new-app-design.md)、判断は [decisions.md](./decisions.md)。

凡例: ✅ 実装済み（テストあり） / 🔶 一部 / ⏳ 未着手 / ➖ 移植しない（理由の決定番号）

最終更新: 2026-11-22

## 1. 機能

| 領域 | 状態 | 新版での実装 | 備考 |
|---|---|---|---|
| ウィンドウ（タイトル、1600×900、アイコン） | 🚧 | `apps/desktop/src/main.ts` | |
| ページ切り替え（Viewers 既定 / Live Game / Settings） | 🚧 | Top bar | 旧版のサイドバーのタブを置き換え（M-008） |
| サイドバー幅の保存 | 🚧 | Settings `sidebarWidth` | |
| LCU 接続状態の表示 | 🚧 | Top bar | |
| Live Game（起動時に読み込む、Refresh、QR） | 🚧 | Live Game ページ | 右クリックメニューではなくバーのボタン |
| ビューアの追加 / 全部閉じる / 上限 20 / ID 単調増加 | 🚧 | `core/workspace.ts` | |
| 追加時の幅の均等割り、幅の変更 | 🚧 | ペイン列 | |
| ビューアの表示 / 非表示、閉じる | 🚧 | Workspace `toggleHidden` | 行に状態は出さない（M-006） |
| サイドバーの行（アイコン・名前・種別、picked を上に） | 🚧 | | |
| Lane / Champion / Opponent の選択、モード（Build/Counter/ARAM） | 🚧 | Viewer pane | セレクターはアイコンのグリッドに変更 |
| チャンピオン検索（英語・日本語・キー） | 🚧 | `core/search.ts` | 前方一致を優先し、部分一致も出す（改善） |
| Opponent 候補（対面表の敵 → 他のビューア）と None | 🚧 | `opponentSuggestions` | |
| クイックピック（敵 最大 5） | 🚧 | `quickPicks` | アイコンボタンに変更 |
| URL の組み立て（Build / Matchup / Counter / ARAM、`?lane=`） | 🚧 | `core/urls.ts` | Wukong は `wukong`（M-004） |
| CURRENT MATCHUP（5 行、配置規則、DnD、⧉、Refresh） | 🚧 | Workspace | ↑↓ は移植しない（M-005） |
| Cooldowns（PoC で追加した機能） | 🚧 | Sidebar | 旧版にはない |
| LCU 接続（プロセスのコマンドライン、lockfile、Basic 認証、TLS はループバックだけ緩める） | 🚧 | `packages/lcu` | |
| 再接続とバックオフ（上限 60 秒）、手動 Reconnect | 🚧 | `startLcuConnector` | |
| ポーリング間隔、ウォッチモード、10 体そろった後の一時停止 | ➖ | | WAMP 購読に置き換え（M-010） |
| 検知: 自分のピック、敵ピック、新しい試合、試合中のチーム、ARAM | 🚧 | `core/reducer.ts` | |
| 自分のピック → picked ビューア（左端、変化のたびに追加） | 🚧 | Workspace | M-002 |
| 敵ピック → 保留リスト → Counter ビューア | 🚧 | Workspace | |
| 新しい試合で全ビューアを閉じる | 🚧 | Workspace | M-001 |
| Settings: URL 5 つ（保存・検証・リセット） | 🚧 | Settings ページ | 保存失敗で値を変えない（M-016） |
| Settings: UI サイズ（すぐ反映）、QR | 🚧 | | M-012、M-009 |
| Settings: Feature Flag の仕組み | 🚧 | `core/settings.ts` | 定義が空なので画面には出さない |
| Settings: Debug（対面表へ手動追加） | 🚧 | | |
| QR | 🚧 | ペインの QR ボタン | 常時表示はしない（M-009） |
| 外部ページ: 許可ホスト外は既定ブラウザ、ポップアップ、右クリックメニュー、戻る/進む | 🚧 | `ExternalViewManager` | M-013 |
| チャンピオンデータの生成（1 本化、Wukong、レーン適性のマージ、週次更新） | 🚧 | `tools/champion-data` | M-004、M-015 |
| アイコンのキャッシュ | 🔶 | Data Dragon の CDN を `<img>` で読む（Chromium の HTTP キャッシュ） | 旧版の独自ディスクキャッシュは不要と判断（予定） |
| 試合データの記録（PoC で追加した機能） | ✅ | `packages/recorder` | |

## 2. 配布・運用

| 領域 | 状態 | 備考 |
|---|---|---|
| インストーラ（ユーザー単位、ワンクリック） | ✅ | PoC で Windows CI まで確認済み（`next-ci.yml`） |
| バージョン表示 | 🚧 | `app.getVersion()` |
| 更新確認・自動更新 | ⏳ | 新版のリリース経路（タグ、Release、electron-updater）と一緒に決めて実装する |
| リリースの自動化（Conventional Commits → タグ → Release → インストーラ） | ⏳ | 旧版の `release.yml` と衝突しない形が必要 |
| ログ（デバッグ時のファイル出力） | ⏳ | |
| 多重起動の防止 | ⏳ | |
| commit-msg フック、Dependabot、Actions の SHA 固定 | 🔶 | リポジトリ共通のものをそのまま使う |
