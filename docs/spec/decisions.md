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
| M-006 | サイドバーの行には、非表示状態や対面（`vs X`）を表示しない（旧版の見た目どおり、チャンピオン名と種別だけ） | 旧仕様を維持 | README §5.2 B1 / 02 §0-4 |
| M-007 | 新版は `next/`（Electron + TypeScript + React の PoC）を土台にして作る | 新版の方針 | README §1 |
| M-008 | 見た目と操作方法は旧版を再現しない。機能（挙動）は移植し、UI は [new-app-design.md](./new-app-design.md) §4 で新しく設計する | 新版の方針 | 01 / 02 の見た目の指定すべて |
| M-009 | QR は常時重ねて表示せず、ペインの「QR」ボタンで外部ビューと入れ替えて表示する。設定「QR」はボタンの表示/非表示にする | 新版の方針 | 02 §3 |
| M-010 | LCU はポーリングではなく WAMP の購読で受け取る。ポーリング間隔、ウォッチモード、10 体そろった後の一時停止は移植しない。Refresh は全パスの GET し直しで代える | 新版の方針 | 03 §1, §7 |
| M-011 | 対面表・ビューア一覧・保留中の敵ピックは renderer の Workspace（core の純粋 reducer）で持つ。hub の MatchState は LCU の事実だけを持つ | 新版の方針 | 01 §6-7 |
| M-012 | UI サイズの変更はすぐに反映する（再起動を求めない） | 改善 | 02 §1.6 |
| M-013 | ページ内の移動を現在の URL として扱う（QR、既定ブラウザで開く）。戻る/進む/再読み込みをペインに出す | 改善（B15） | 02 §7.3 |
| M-014 | 設定はアプリの `localStorage` に保存する（形式は自由。M-003） | 新版の方針 | 01 §10 |
| M-015 | レーン適性データ（`champion_lane.csv`）は `next/tools/champion-data/` に移し、新版のチャンピオンデータ生成処理（1 つ）でマージする | 新版の方針（M-004 の生成処理の一本化） | 03 §11 |
| M-016 | 旧版の不具合 B4・B5・B13・B19 は再現しない（保存に失敗したら値を変えない、URL を保存したら Live Game を開き直す、UI サイズはどこにも同じに効かせる、Feature Flag の掃除で保存値を消さない） | 改善 | README §5.2 |
| M-017 | チャンピオンアイコンの独自のディスクキャッシュは移植しない。Data Dragon の URL を `<img>` で読み、Chromium の HTTP キャッシュに任せる | 新版の方針 | 03 §10.4 |
| M-018 | 新版のリリースは `app-vX.Y.Z` のタグで、旧版と同じリポジトリの GitHub Releases に出す。旧版の `release.yml` は `v[0-9]*` のタグだけを見るようにする | 新版の方針 | 04 §1, §5 |
| M-019 | 新版の Release は旧版から乗り換えるまで prerelease にする（旧版の更新確認 `/releases/latest` に出さない） | 新版の方針 | 04 §1.2 |
| M-020 | 新版の自動更新は electron-updater の generic provider で、固定の Release `app-latest` の `latest.yml` を見る。起動時は確認だけ、ダウンロードと適用はユーザーの操作で行う | 新版の方針（旧版の UX を維持） | 04 §1 |

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

### 旧版の実際の挙動（2026-11-22 に、旧コードをヘッドレスで実行して確認）
旧版の意図は上の方針と同じで、**リリースビルドでは、通常の経路は正しく `wukong` で lolalytics を開いている**。確認に使った手順は次のとおり。
- リリースビルドと同じ手順で `scripts/fetch_champions.py` を実行して `champions.json` を作った。キーは `wukong`、`id` は `MonkeyKing`、lanes は top=5 になった。
- 旧版の `MainWindow` をヘッドレスで起動し、各経路で実際に開かれる URL を記録した。

| 経路 | リリースビルド（json を作り直したもの） | リポジトリにコミットされた json（開発時に `python main.py` で起動した場合） |
|---|---|---|
| LCU で自分のピックを検知 | `/lol/wukong/build/?lane=top`（正しい） | 正しい |
| セレクターでチャンピオンを選ぶ | `/lol/wukong/build/`（正しい） | `/lol/monkeyking/build/`（404） |
| セレクターで Opponent を選ぶ | `/lol/ahri/vs/wukong/build/`（正しい） | `monkeyking`（404） |
| **クイックピックで Opponent を選ぶ** | **`/lol/ahri/vs/monkeyking/build/`（404）** | `monkeyking`（404） |
| アイコン | `MonkeyKing.png`（正しい） | 正しい |
| レーン適性 | top=5（正しい） | 全部 0（CSV のキー `wukong` と一致しない） |

lolalytics を実際のブラウザ（Playwright）で開いた結果: `/lol/ahri/vs/wukong/build/` は 200 で正しく表示された。`monkeyking` を使った URL は「404 Resource Not Found」になった。

### 注意点（新版で同じ問題を作り込まないために）
1. **旧版の通常の経路は正しい**: リリースビルドでは、LCU で検知した場合もセレクターで選んだ場合も `wukong` になる。
2. **旧版に残っていたバグ（PR #162 で修正済み）**: CURRENT MATCHUP のクイックピックで Wukong を Opponent に設定すると、URL が `monkeyking` になり 404 になっていた（リリースビルドでも発生）。
   - 原因: `_resolve_champion_id()`（`widgets/viewer_widget.py:472-477`）が、`champions.json` のキーではなく `id` フィールド（Data Dragon の ID の `MonkeyKing`）を小文字にして返している。
   - キーと `id` を小文字にしたものが異なるのは Wukong だけなので、他のチャンピオンでは表面化しない。
   - 修正: `ChampionData.get_champion_key()` を追加し、`_resolve_champion_id()` が champions.json のキーを返すようにした。テスト `test_wukong_quick_pick_opens_wukong_matchup_url` と `test_quick_pick_id_matches_selector_key_for_every_champion` を追加した。
3. **json が 2 種類あった（PR #162 で修正済み）**: リポジトリの `champions.json`（週次の workflow が作る）はキーが `monkeyking` のままだった。正しくなっていたのは、リリースビルドの直前に `fetch_champions.py` が作り直していたからにすぎず、開発時に起動するとセレクターとレーン適性も壊れていた。
   - 修正: `update-champions.yml` の生成処理にも `monkeyking` → `wukong` の改名を入れ、コミット済みの `champions.json` のキーを `wukong`（lanes は CSV どおり top=5）に直した。データの形を固定するテスト `test_wukong_uses_wukong_key_and_monkeyking_only_for_data_dragon` を追加した。
   - 修正後、旧コードをヘッドレスで再実行し、上の表のすべての経路が `wukong` になることを確認した。
   - 生成処理が 2 つある状態（B3）自体は残っている。新版では 1 つにする。
4. **テストが誤った値を固定していた**: `tests/test_viewer_quick_opponent.py` は `"Wukong"` → `"monkeyking"` を正としていた。PR #162 で、リリースビルドと同じ形（キー `wukong`）の json を使って `wukong` を期待するテストに直した。
5. 移植のときは「`id`（Data Dragon の ID）」と「内部キー」を取り違えないこと。URL には必ず内部キー（`wukong`）を使う。

### 新版での要件
- チャンピオンデータを生成する処理は 1 つにする。キーは `wukong` に変え、Data Dragon の ID（`MonkeyKing`）は境界の変換用の別フィールドとして持つ。アイコン URL は Data Dragon の ID で組み立てる。
- 名前解決（LCU の ID、英語名、日本語名、キー）は、どの経路でも内部キー `wukong` を返す。
- 回帰テスト: セレクター、クイックピック、LCU 検知のどの経路でも URL に `wukong` が入ること。レーン適性が top=5 になること。

## M-005 ↑↓ 並べ替えボタンを移植しない
- PR #114 で ↑↓ ボタン（`_matchup_move_ally` / `_matchup_move_enemy`）とそのテストを意図的に削除し、ドラッグ&ドロップ（#112）に置き換えている。
- 設計書 `docs/design/matchup-list.md` と `docs/features.md` に残っている ↑↓ の記述は古い。
- 使われずに残っている `_matchup_swap_enemies` も移植しない。

---

## M-006 サイドバーの行に非表示状態や対面を表示しない（旧 Q-001）
- 旧版では `ChampionViewerWidget.get_display_name()` が `"Ahri | build | picked | vs Zed"` のような文字列を作る。非表示のビューアには、さらに `main_window` が `"[Hidden] "` を前に付けて、サイドバーの行ウィジェットに渡している（`main_window.py:2209-2211`）。
- しかし行ウィジェット（`ViewerListItemWidget`）はこの文字列を**使わず**、`current_champion.title()`（例 `Ahri`）と種別（`BUILD` など）の 2 行だけを表示している（`widgets/viewer_list_item.py:29-80`）。
- PR #114（2026-03-01）は `get_display_name()` に `vs <対面>` を追加した。ところが、行ウィジェットはその前のサイドバー再デザイン（#72 系）の時点で既にこの文字列を無視していた（#116 の差分に、無視したままのコードが前後の文脈として写っている）。そのため `vs X` は**画面に出たことがない可能性が高い**。
- その結果、旧版では次のことがサイドバーから分からない。
  - ビューアが非表示になっていること。ホバーしたときに出る −/+ のグリフでしか判別できない。
  - Build ビューアの対面が誰か。
- **決定（2026-11-22）: 表示しない。** 旧版の画面どおり、チャンピオン名と種別（BUILD/COUNTER/ARAM）の 2 行にする。`get_display_name()` 相当の文字列（`picked`、`vs X`、`[Hidden]`）は移植しない。

---

## M-007〜M-016 新版の方針（2026-11-22）
- 理由と詳細は [new-app-design.md](./new-app-design.md) に書いた。要点だけここに残す。
- **M-009（QR）**: Electron の外部ビュー（WebContentsView）はネイティブで最前面に描かれるので、HTML の QR を上に重ねられない。旧版のように常に見せるには外部ビューを縮めるしかなく、ページが狭くなる。そこでボタンで切り替える形にした。
- **M-010（WAMP）**: イベントが来たときだけ処理するので、ポーリング間隔やウォッチモード（10 体そろった後に間隔を延ばす仕組み）は目的ごと不要になる。検知の規則（新しい試合、自分のピック、敵ピック、試合中のチーム）は MatchState の reducer で旧版どおりに再現する。
- **M-011（Workspace）**: 「一度置いたら自動で消さない」「ドラッグで入れ替えたら保持する」といった対面表の規則は、ユーザー操作の履歴に依存する。LCU の事実（MatchState）と分けて renderer 側の純粋 reducer に置くと、どちらも単体でテストできる。

---

## 未決事項

現在なし。
