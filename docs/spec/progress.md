# 新版への移植の進み具合

[旧機能インベントリ](./legacy-inventory/README.md) の各チェックリストが、新版（`next/`）でどうなったかをまとめる。
設計は [new-app-design.md](./new-app-design.md)、判断は [decisions.md](./decisions.md)。

凡例: ✅ 実装済み（テストあり） / 🔶 一部 / ⏳ 未着手 / ➖ 移植しない（理由の決定番号）

テスト: core / lcu / hub / desktop の単体テスト（Vitest）、Storybook の全 story のスクショと操作の E2E、Electron 本体を偽 LCU で動かす E2E（外部ビューの位置・表示、2 試合目のリセットなど）。

最終更新: 2026-11-22

## 1. 機能

| 領域 | 状態 | 新版での実装 | 備考 |
|---|---|---|---|
| ウィンドウ（タイトル、1600×900、アイコン） | ✅ | `apps/desktop/src/main.ts` | |
| ページ切り替え（Viewers 既定 / Live Game / Settings） | ✅ | Top bar | 旧版のサイドバーのタブを置き換え（M-008） |
| サイドバー幅の保存 | ✅ | Settings `sidebarWidth` | |
| LCU 接続状態の表示 | ✅ | Top bar | |
| Live Game（起動時に読み込む、Refresh、QR） | ✅ | Live Game ページ | 右クリックメニューではなくバーのボタン。Refresh は設定した URL を開き直す（旧版と同じ） |
| ビューアの追加 / 全部閉じる / 上限 20 / ID 単調増加 | ✅ | `core/workspace.ts` | |
| 追加時の幅の均等割り、幅の変更 | ✅ | ペイン列 | |
| ビューアの表示 / 非表示、閉じる | ✅ | Workspace `toggleHidden` | 行に状態は出さない（M-006） |
| サイドバーの行（アイコン・名前・種別、picked を上に） | ✅ | | |
| Lane / Champion / Opponent の選択、モード（Build/Counter/ARAM） | ✅ | Viewer pane | セレクターはアイコンのグリッドに変更 |
| チャンピオン検索（英語・日本語・キー） | ✅ | `core/search.ts` | 前方一致を優先し、部分一致も出す（改善） |
| Opponent 候補（対面表の敵 → 他のビューア）と None | ✅ | `opponentSuggestions` | |
| クイックピック（敵 最大 5） | ✅ | `quickPicks` | アイコンボタンに変更 |
| URL の組み立て（Build / Matchup / Counter / ARAM、`?lane=`） | ✅ | `core/urls.ts` | Wukong は `wukong`（M-004） |
| CURRENT MATCHUP（5 行、配置規則、DnD、⧉、Refresh） | ✅ | Workspace | ↑↓ は移植しない（M-005） |
| Cooldowns（PoC で追加した機能） | ✅ | Sidebar | 旧版にはない |
| LCU 接続（プロセスのコマンドライン、lockfile、Basic 認証、TLS はループバックだけ緩める） | ✅ | `packages/lcu` | |
| 再接続とバックオフ（上限 60 秒）、手動 Reconnect | ✅ | `startLcuConnector` | |
| ポーリング間隔、ウォッチモード、10 体そろった後の一時停止 | ➖ | | WAMP 購読に置き換え（M-010） |
| 検知: 自分のピック、敵ピック、新しい試合、試合中のチーム、ARAM | ✅ | `core/reducer.ts` | |
| 自分のピック → picked ビューア（左端、変化のたびに追加） | ✅ | Workspace | M-002 |
| 敵ピック → 保留リスト → Counter ビューア | ✅ | Workspace | |
| 新しい試合で全ビューアを閉じる | ✅ | Workspace | M-001 |
| Settings: URL 5 つ（保存・検証・リセット） | ✅ | Settings ページ | 保存失敗で値を変えない（M-016）。https 以外は保存させない。ホストは自由（M-023）。保存すると開いているビューアも開き直す（M-021） |
| Settings: UI サイズ（すぐ反映）、QR | ✅ | | M-012、M-009 |
| Settings: Feature Flag の仕組み | ✅ | `core/settings.ts` | 定義が空なので画面には出さない |
| Settings: Debug（対面表へ手動追加） | ✅ | | |
| QR | ✅ | ペインの QR ボタン | 常時表示はしない（M-009） |
| 外部ページ: 許可ホスト外は既定ブラウザ、ポップアップ、右クリックメニュー、戻る/進む | ✅ | `ExternalViewManager` | M-013 |
| チャンピオンデータの生成（1 本化、Wukong、レーン適性のマージ、週次更新） | ✅ | `tools/champion-data` | M-004、M-015 |
| アイコンのキャッシュ | ➖ | Data Dragon の CDN を `<img>` で読む（Chromium の HTTP キャッシュに任せる） | 独自のディスクキャッシュは作らない（M-017） |
| 試合データの記録（PoC で追加した機能） | ✅ | `packages/recorder` | |

## 2. 配布・運用

| 領域 | 状態 | 備考 |
|---|---|---|
| インストーラ（ユーザー単位、ワンクリック） | ✅ | PoC で Windows CI まで確認済み（`next-ci.yml`） |
| バージョン表示 | ✅ | `app.getVersion()`（Settings > Version） |
| 更新確認・自動更新 | ✅ | `apps/desktop/src/updater.ts`、`update-core.ts`、Settings > Version、Top bar の点。Windows CI で 0.0.1 → 0.0.2 の更新（確認 → ダウンロード → サイレントで入れ替え → 再起動）を確認済み |
| リリースの自動化（Conventional Commits → タグ → Release → インストーラ） | 🔶 | 実装済み（`next-release.yml`、`next-windows.yml`、`tools/release`。タグ `app-vX.Y.Z`、prerelease、固定の `app-latest`。旧版 `release.yml` は `v[0-9]*` だけを見る）。ビルドと検証は Windows CI で確認済み。公開ジョブ（タグ、Release、`app-latest`）は main で初回実行するまで未確認 |
| ログ（デバッグ時のファイル出力） | ✅ | `--debug` / `LOL_VIEWER_DEBUG=1` / 実行ファイル名に debug。起動ごとに 1 ファイル、最新 10 個を残す |
| 多重起動の防止 | ✅ | 2 つ目の起動は既存のウィンドウを前面に出して終了する |
| メニューバー | ✅ | 出さない（旧版と同じ。既定メニューの Reload で UI が再読み込みされるのを防ぐ） |
| commit-msg フック、Dependabot、Actions の SHA 固定 | ✅ | リポジトリ共通のものを使う。Dependabot は `next/` の npm もセキュリティ更新だけ対象（通常の更新は手動）。`next/` 向けの定期的な脆弱性監査は無い |

## 3. 実機で確認が必要なこと

CI と Linux の Xvfb では確かめられないもの。Windows 実機で人間が確認する。

- 本物の League Client への接続（プロセスのコマンドラインからの接続情報の取得、https/wss、自己署名証明書）。
- 実際の試合での自動検知（ホバー、ロック、ドッジ、ARAM、試合中のチーム補完）。
- u.gg の表示。検証環境（データセンターの IP）からは Cloudflare に「blocked」と表示されるため、Live Game と ARAM ページの見た目はまだ確認できていない。lolalytics は Electron の E2E で実ページの表示まで確認済み。
