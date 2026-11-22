# 移植方針の決定事項

旧版（PyQt6 版 `v0.33.1`）から新版へ移植するときの判断を記録する。
[旧機能インベントリ](./legacy-inventory/README.md) で「要判断」としていた項目のうち、決まったものをここに書く。
新しく決めたことは末尾に追記する。決定を覆すときは、元の項目を消さずに「改訂」を追記する。

| ID | 決定 | 区分 | 関連する旧インベントリの項目 |
|---|---|---|---|
| M-001 | 新しい試合が始まったら、手動で開いたものも含めて全ビューアを閉じる | 旧仕様を維持 | README §5.2 B12 / 01 §7.4 |
| M-002 | 自分のピックやレーンが変わるたびに「picked」ビューアを追加する（重複を排除しない） | 旧仕様を維持 | README §5.2 B11 / 01 §7.2 / 03 §4.2 |
| M-003 | 旧版のユーザーデータや環境は引き継がない | 新版の方針 | README §4 / 04 §4.4 |
| M-004 | Wukong の内部表現は `wukong` に統一する。`MonkeyKing` は Riot 公式 API とのやり取りでだけ使う | 新版の方針（旧版の意図を明文化） | README §5.2 B2/B3 / 03 §9-11 |
| M-005 | 対面表の ↑↓ 並べ替えボタンは移植しない（ドラッグ&ドロップだけ） | 旧仕様を維持（事実確認済み） | README §5.1 D4 |

---

## M-001 新しい試合で全ビューアを閉じる
- 旧版の挙動（`main_window.py:1504-1508`）をそのまま仕様にする。
- 新しい ChampSelect が始まると、全ビューア（ユーザーが手で開いたものを含む）、CURRENT MATCHUP、保留中の敵ピックをクリアする。

## M-002 ピックやレーンが変わるたびに picked ビューアを追加する
- 旧版の挙動（`main_window.py:2299-2355`、`lcu_detector.py:1088-1099`）をそのまま仕様にする。
- チャンピオンセレクト中に（ホバーを含む）チャンピオンやレーンが変わるたびに、左端へ新しい picked ビューアを作る。前のビューアは残す。
- 試合中にはピックが変わらないので、これで問題はない。ホバーとロックの区別も不要。

## M-003 旧版のデータを引き継がない
旧版のユーザーデータ、インストール環境との互換は考えない。そのため次の作業は**不要**になる。
- QSettings（`HKCU\Software\LoLViewer\LoLViewer`）の設定値（カスタム URL、UI サイズ、QR 設定、サイドバー幅など）の読み込みや変換。
- アイコンキャッシュ（`%LOCALAPPDATA%\LoLViewer\cache\champion_icons`）の保存先や形式との互換。
- WebEngine のプロファイル（Cookie など）の引き継ぎ。旧版で `setApplicationName` を呼ばずに保存先を固定していた配慮（03 §10.4）も、移植の要件にしない。
- Inno Setup の AppId（`{8F7A2B3C-...}`）の引き継ぎ。旧版の上から入れるアップグレードや、旧版のアンインストール連携も考えない。
- 旧版の自動更新（nightly.link / GitHub Releases）から新版へ乗り換える経路。

一方、**機能としての挙動**は引き続き移植の対象になる。設定項目と既定値、キャッシュの仕組み、アンインストール時の挙動などがこれに当たる。保存場所や形式は新版で自由に決めてよい。

## M-004 Wukong の扱い
### 方針
- アプリ内部のキー、表示サイト（lolalytics / u.gg）の URL、レーン適性データ（`champion_lane.csv`）では `wukong` を使う。
- `MonkeyKing` を使うのは Riot 公式 API との境界だけにする。境界で**一度だけ** `wukong` と相互に変換する。
  - Data Dragon: `champion.json` のキーと `id` が `MonkeyKing`（数値 key は `62`）。アイコンの URL も `.../img/champion/MonkeyKing.png` でなければならない。
  - LCU: `championId` は数値の `62`。旧版は Data Dragon の対応表で ID を `MonkeyKing` に変換し、そのあと `Wukong` に読み替えている（`lcu_detector.py:283-289`）。

### 旧版の実際の挙動（2026-11-22 に確認）
旧版の**意図**は上の方針と同じだった。LCU 側の正規化（PR #108）と、`fetch_champions.py` でキーを `wukong` に変えている処理（`scripts/fetch_champions.py:240-242`）がその証拠になる。ただし実装は、経路によって `monkeyking` が漏れている。

| 経路 | 入る値 | 結果 |
|---|---|---|
| LCU で検知（自分・味方・敵） | `MonkeyKing` を `Wukong` に読み替え | URL は `wukong`（正しい） |
| アイコン | `champions.json` の `image_url`（`MonkeyKing.png`） | 正しい |
| チャンピオンセレクターで選ぶ | `champions.json` のキー | リポジトリの json（週次の workflow が生成）はキーが `monkeyking` なので、URL が `monkeyking` になる（誤り）。リリースビルドは `fetch_champions.py` が json を作り直すのでキーが `wukong` になる（スクレイピング経路を使わなかった場合） |
| クイックピックで選ぶ | `_resolve_champion_id()` が `id` フィールド（`MonkeyKing`）を小文字にした値 | **どのビルドでも** URL が `monkeyking` になる（誤り）。`widgets/viewer_widget.py:472-477` |
| レーン適性で配置 | `champions.json` の `lanes` | リポジトリの json ではキーが CSV の `wukong` と一致せず、全部 0（誤り）。リリースビルドでは正しい |
| テスト | `tests/test_viewer_quick_opponent.py:101-105, 311-326` | 誤った `"Wukong"` → `"monkeyking"` の挙動を正として固定している |

lolalytics での確認（curl、2026-11-22）: `/lol/wukong/build/`、`/lol/ahri/vs/wukong/build/`、`/lol/wukong/counters/` はいずれも 200。`monkeyking` に置き換えた URL はいずれも 404。u.gg は bot 判定で 403 になり、確認できなかった（要確認）。

### 新版での要件
- チャンピオンデータを生成する処理は 1 つにする。キーは `wukong` に変え、Data Dragon の ID（`MonkeyKing`）は境界の変換用の別フィールドとして持つ。アイコン URL は Data Dragon の ID で組み立てる。
- 名前解決（LCU の ID、英語名、日本語名、キー）は、どの経路でも内部キー `wukong` を返す。
- 回帰テスト: セレクター、クイックピック、LCU 検知のどの経路でも URL に `wukong` が入ること。レーン適性が top=5 になること。

## M-005 ↑↓ 並べ替えボタンを移植しない
- PR #114 で ↑↓ ボタン（`_matchup_move_ally` / `_matchup_move_enemy`）とそのテストを意図的に削除し、ドラッグ&ドロップ（#112）に置き換えている。
- 設計書 `docs/design/matchup-list.md` と `docs/features.md` に残っている ↑↓ の記述は古い。
- 使われずに残っている `_matchup_swap_enemies` も移植しない。

---

## 未決事項

| ID | 内容 | 背景 |
|---|---|---|
| Q-001 | サイドバーの各行に、非表示状態や対面（`vs X`）を表示するか | 下記 |

### Q-001 サイドバー行の表示内容
- 旧版では `ChampionViewerWidget.get_display_name()` が `"Ahri | build | picked | vs Zed"` のような文字列を作る。非表示のビューアには、さらに `main_window` が `"[Hidden] "` を前に付けて、サイドバーの行ウィジェットに渡している（`main_window.py:2209-2211`）。
- しかし行ウィジェット（`ViewerListItemWidget`）はこの文字列を**使わず**、`current_champion.title()`（例 `Ahri`）と種別（`BUILD` など）の 2 行だけを表示している（`widgets/viewer_list_item.py:29-80`）。
- PR #114（2026-03-01）は `get_display_name()` に `vs <対面>` を追加した。ところが、行ウィジェットはその前のサイドバー再デザイン（#72 系）の時点で既にこの文字列を無視していた（#116 の差分に、無視したままのコードが前後の文脈として写っている）。そのため `vs X` は**画面に出たことがない可能性が高い**。
- その結果、旧版では次のことがサイドバーから分からない。
  - ビューアが非表示になっていること。ホバーしたときに出る −/+ のグリフでしか判別できない。
  - Build ビューアの対面が誰か。
- 新版でこれらを表示するかを決める必要がある。
