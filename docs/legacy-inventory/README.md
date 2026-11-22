# 旧 LoL Viewer 機能インベントリ（技術刷新・移植用）

旧実装（PyQt6 / Python 版、`v0.33.1`、HEAD `2084540`）にある機能・挙動・インフラをすべて洗い出したドキュメントです。
新しい技術スタックへ移植するときに、機能の漏れを防ぐためのチェックリストとして使います。

- 調査範囲: リポジトリ内のアプリコード全体（`main.py`, `main_window.py`, `widgets/*`, `constants.py`, `lcu_detector.py`, `champion_data.py`, `updater.py`, `logger.py`）、データファイル、ビルド/インストーラ定義、GitHub Actions、スクリプト、テスト、既存ドキュメント、マージ済み PR の一覧（#48〜#159）。
- 根拠はコード。各項目に `file:LINE` を付けています（行番号は HEAD `2084540` 時点）。
- ドキュメントと実装が食い違う場合は**実装を正**としています。食い違いは §5 にまとめました。
- コードだけでは断定できない点（Qt の既定動作など）は **（要確認）** としています。

## 詳細ドキュメント

| ファイル | 範囲 | 末尾のチェックリスト |
|---|---|---|
| [01-main-window.md](./01-main-window.md) | ウィンドウ構造、サイドバー、Live Game、ビューア管理、URL 合成、CURRENT MATCHUP、自動検出との連携、Settings 画面、更新チェック UI、QSettings、終了処理 | 約 100 項目 |
| [02-widgets-constants.md](./02-widgets-constants.md) | `constants.py`（URL・キュー ID・UI サイズプリセットの全トークン）、ビューア（ヘッダー、セレクター、クイックピック、モードタブ）、QR オーバーレイ、サイドバー行、マッチアップの DnD、LCU ステータス、WebEngine の設定状況 | 約 110 項目 |
| [03-lcu-detection-data.md](./03-lcu-detection-data.md) | LCU 接続（プロセス検出・認証・HTTPS）、使用エンドポイント、フェーズ追跡、チャンピオン検知、新規試合検知、ウォッチモード、シグナル、`champion_data`（名前解決・補完・アイコンキャッシュ）、データファイル | 約 120 項目 |
| [04-infra-release-ci.md](./04-infra-release-ci.md) | 自動更新、ロギング、エントリポイント、PyInstaller / Inno Setup、依存関係の固定、CI/CD の全ワークフロー、データ自動更新、開発フロー、テストが固定している振る舞い | 約 75 項目 |

移植の作業では、まずこの README の §2「機能カタログ」で全体を押さえてください。そのうえで各詳細ファイル末尾の「移植チェックリスト」（`- [ ]`）を 1 項目ずつ消化します。

---

## 1. 旧アプリの全体像

- **何をするアプリか**: League of Legends のチャンピオン情報サイト（lolalytics.com / u.gg）を、アプリ内に埋め込んだブラウザで複数並べて表示する Windows 向けデスクトップアプリ。League Client（LCU）を検出して、チャンピオンセレクトのピックに合わせて自動でページを開き、対面表（CURRENT MATCHUP）を作る。
- **技術スタック**: Python 3.11、PyQt6 + PyQt6-WebEngine 6.11（4 つの wheel の minor を揃えて固定）、requests、psutil、segno（QR）、packaging。配布は PyInstaller（onedir）と Inno Setup。
- **モジュール構成**
  | モジュール | 役割 |
  |---|---|
  | `main.py` → `main_window.main()` | エントリポイント、ロギングの初期化 |
  | `main_window.py`（約 2600 行） | `MainWindow`: サイドバー、3 つのページ、ビューア管理、マッチアップ表、Settings、更新チェック UI |
  | `widgets/viewer_widget.py` | `ChampionViewerWidget`: 1 枚のブラウザペイン（ヘッダー、セレクター、モードタブ、WebView） |
  | `widgets/viewer_list_item.py` | サイドバーの行（ビューア行、保留中の敵ピック行） |
  | `widgets/matchup_widgets.py` | マッチアップ表の DnD ラベルと行、省略表示付きのクイックピックボタン |
  | `widgets/status_widget.py` | LCU 接続ステータスの表示 |
  | `widgets/webview_utils.py` | QR オーバーレイ、ヘッドレス用の `NullWebView` |
  | `lcu_detector.py` | LCU 接続、フェーズ追跡、チャンピオン検知、ポーリングサービス（Qt シグナル） |
  | `champion_data.py` | champions.json の読み込み、名前解決、バイリンガル補完、アイコンのメモリ/ディスクキャッシュ |
  | `updater.py` | GitHub Releases による更新確認、nightly.link からのダウンロード、インストーラの起動 |
  | `constants.py` | バージョン、既定 URL、ARAM のキュー ID、UI サイズプリセット、Feature Flag の定義 |
  | `logger.py` | 独自のデバッグログ（標準 `logging` と並行して動く） |

---

## 2. 機能カタログ（ユーザーから見える機能）

各見出しの末尾に、詳細ドキュメントの参照先を書いています。

### 2.1 ウィンドウとナビゲーション → 01 §2
- 「LoL Viewer」というタイトルのウィンドウ。初期サイズは 1600×900（位置とサイズは保存しない）。
- 左側にサイドバー（最小幅 150、幅は `sidebar_width` に保存）、右側にコンテンツ。間は QSplitter。
- サイドバーのタブは **Live Game / Viewers（既定）/ Settings** の 3 つ。サイドバー下部に LCU 接続ステータス（`Riot API: Connecting…` / `Connected` / `Disconnected`。Connecting はドットのアニメーション付き）。
- メニューバー、ツールバー、キーボードショートカットは無い（ビューア内の Esc を除く）。

### 2.2 Live Game ページ → 01 §3
- Live Game URL（既定 `https://u.gg/lol/lg-splash`）を起動時に読み込む WebView。
- サイドバーの Live Game タブを右クリックすると、「Refresh」メニュー（設定済みの URL を開き直す）。
- QR オーバーレイあり。

### 2.3 ビューア（チャンピオンのブラウザペイン）→ 01 §4〜5, 02 §2
- サイドバーの Viewers タブのヘッダーに「TABS」、**+**（末尾に追加）、**×**（全部閉じる。確認なし）。上限は 20 枚。起動時は 0 枚（復元しない）。
- 追加するたびに、全ビューアの幅を均等に再分配する。
- 各ビューアの構成
  - ヘッダー: `[×] [Lane▾] [Champion▾] vs [Opponent▾] [クイックピック×最大5]`
  - モードタブ: **Build / Counter / ARAM**（排他）
  - コンテンツ: WebView、チャンピオンセレクターパネル、レーンセレクターパネルを切り替える
- **チャンピオンセレクター**: 検索欄で大文字小文字を区別しない**前方一致**（英語名・キー・日本語名のどれか）。アイコン付きのリストを champions.json のキー順に並べる。Opponent 用には先頭に「None」を置く。Opponent で検索欄が空のときは、CURRENT MATCHUP の敵（無ければ他のビューアのチャンピオン）だけを表示する。
- **レーンセレクター**: None / Top / Jungle / Mid / Bot / Support。
- **クイックピック**: CURRENT MATCHUP の敵（最大 5 体）を 1 クリックで Opponent に設定する。今の Opponent と同じボタンは隠す。ラベルは幅に応じて「…」で省略する。
- 選択を変えたり、タブやクイックピックを押したりすると、**チャンピオンが入力済みなら即座にページを開き直す**。
- Esc やパネルの外側をクリックすると、セレクターを閉じる。
- **URL の組み立て**（02 §2.9。テンプレートはすべて Settings で変更できる）
  | 種別 | 既定テンプレート | 規則 |
  |---|---|---|
  | Build | `https://lolalytics.com/lol/{name}/build/` | `{name}` は小文字の名前。レーンがあれば `?lane=<lane>` を末尾に足す |
  | Build＋Opponent | `https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}` | Opponent が入力されていればこちらを使う。レーンが空でも `?lane=&vslane=` が残る |
  | Counter | `https://lolalytics.com/lol/{name}/counters/` | `?lane=` を付ける。Opponent は使わない |
  | ARAM | `https://u.gg/lol/champions/aram/{name}-aram` | 小文字にしてスペースを除去。レーンは使わない |
  - レーンの値は `top / jungle / middle / bottom / support`。URL エンコードはしない。
- **サイドバーの行**: アイコン、チャンピオン名（title case）、種別（BUILD/COUNTER/ARAM）。ホバーすると **−/+**（表示/非表示）と **×**（閉じる）が出る。行のダブルクリックでも表示/非表示を切り替える。並び順は「ピックで自動生成したもの → 通常のもの → 保留中の敵ピック」。

### 2.4 CURRENT MATCHUP（対面表）→ 01 §6, 02 §5
- Viewers ページの上部に、5 行固定（Top/Jungle/Mid/Bot/Support）の `[レーン] [味方アイコン] 味方名 VS 敵名 [敵アイコン] [⧉]`。
- タイトル行は「CURRENT MATCHUP」、**Refresh** ボタン（表をクリア → ポーリング再開 → 即時取得）、色付きの「Ally vs Enemy」。
- **自動配置の規則**: 一度置いた名前は自動では消さない。空いている枠だけを埋める。新しいセッションでは全部消去する。
  - 味方: LCU のレーン情報がある味方を先に、そのレーンの行へ置く。レーンが無い味方はレーン適性スコアが最も高い空き行へ置く。
  - 敵: レーン適性スコア（`champions.json` の `lanes`）が最も高い空き行へ置く。同点なら上の行。
- **ドラッグ&ドロップ**: 味方同士、敵同士で 2 行の中身を入れ替える。ドラッグ中は行をハイライトする。
- **⧉**: その行の味方（と敵）、その行のレーンで新しいビューアを開く（Build または Matchup）。
- Settings > Debug から、味方や敵を手で追加できる。

### 2.5 LCU 自動検出 → 01 §7, 03 §1〜8
- LeagueClientUx のプロセスのコマンドラインからポートとトークンを取り出し、`https://127.0.0.1:<port>` に Basic 認証で GET する（自己署名証明書を許可）。
- ポーリングは 2 秒間隔。クライアントがないときは 60 秒まで指数バックオフ。10 体そろった後は「ウォッチモード」に入る（5 秒、試合中は 15 秒、gameflow を 1 回だけ取得）。
- 使うエンドポイントは `/lol-gameflow/v1/session`、`/lol-champ-select/v1/session`、`/lol-summoner/v1/current-summoner`。ID と名前の対応は Data Dragon から取得する。
- **自分のピック** → 左端に「picked」ビューアを自動で作り、Build を開く（レーン付き）。ARAM 系のキュー（450, 65, 100, 720 / Mayhem の 2400, 2401, 2403, 2405, 3240, 3270）なら ARAM ページを開く。
- **敵のピック** → ビューアは自動で作らない。サイドバーの「保留中の敵ピック」に並べ、+ かダブルクリックで Counter ビューアを作る（Chromium のクラッシュ対策）。
- **新しい試合**（ChampSelect に入る、または gameId が変わる）→ **すべてのビューアを閉じ**（手動で開いたものも含む）、対面表と保留リストをクリアする。
- 試合中（InProgress）は gameflow の `gameData.teamOne/teamTwo` から味方と敵を補う（ブラインドピックや ARAM 向け）。
- Settings の「Retry LCU Connection」で手動で再接続できる。

### 2.6 Settings → 01 §8〜9
- **Analytics URLs**: Build / Matchup / Counter / ARAM / Live Game の 5 つ。Save（全部入力必須）と Reset to Defaults（確認なし）。
- **LCU Connection**: 再接続ボタン。
- **Version Information**: 現在のバージョン、最新のバージョン、ステータス、「Check for Updates」（確認 → プロンプト → ダウンロード → インストーラ起動）。新しいバージョンがあれば Settings タブに赤い ●。
- **Display Settings**: UI Size（Small/Medium/Large。再起動後に反映）、QR Code Overlay（既定オン。即座に反映）。
- **Feature Flags**: 仕組みはあるが、現在は定義が空なので表示されない。
- **Debug**: 対面表への手動追加。

### 2.7 QR オーバーレイ → 02 §3
- 各 WebView と Live Game の右下に、今の URL の QR コード（120px）を出す。「QR」ボタンで折りたたむ。設定で全体のオン/オフを即座に切り替える。

### 2.8 自動更新 → 04 §1
- 起動直後に GitHub Releases の `/releases/latest` を確認する。表示と ● を更新するだけで、プロンプトは出さない。
- 手動の「Check for Updates」から、Yes/No のプロンプト → nightly.link から zip をダウンロード（進捗ダイアログ）→ setup.exe を `/NORESTART /DIR=<現在の場所>` で起動 → アプリを終了 → インストーラが再起動する。

### 2.9 配布・運用（ユーザーには見えないが移植が必要）→ 04 §4〜6
- Inno Setup のインストーラ（AppId `{8F7A2B3C-4D5E-6F7A-8B9C-0D1E2F3A4B5C}`、既定はユーザー単位、英語と日本語、アンインストール時にアイコンキャッシュを削除し、設定は残す）。
- main に push すると、Conventional Commits から版を決めて自動リリースする（タグ、Release、Windows ビルド、nightly.link 用の artifact）。
- 週次の自動処理: チャンピオンデータの更新 PR（Data Dragon + `champion_lane.csv`）、依存ロックの再生成 PR、脆弱性監査、Dependabot（Actions、pip は security のみ）。
- commit-msg フック（Conventional Commits を必須にする）。

---

## 3. 外部依存（URL・API・データ）

| 種別 | 宛先 | 用途 | 参照 |
|---|---|---|---|
| 表示サイト | `lolalytics.com`（build / counters / vs） | ビューアの Build / Counter / Matchup | 02 §1.2 |
| 表示サイト | `u.gg`（ARAM、`lg-splash`） | ARAM、Live Game | 02 §1.2 |
| LCU | `https://127.0.0.1:<port>`（Basic `riot:<token>`） | ゲームフェーズ、チャンピオンセレクト、サモナー | 03 §2.1 |
| Data Dragon | `ddragon.leagueoflegends.com/api/versions.json`、`cdn/<v>/data/en_US/champion.json` | 起動時に ID と名前の対応表を作る | 03 §2.2 |
| Data Dragon | `cdn/<v>/img/champion/<Id>.png` | チャンピオンアイコン | 03 §10.3 |
| GitHub API | `api.github.com/repos/kc7891/lol-viewer/releases/latest` | 更新確認 | 04 §1.2 |
| nightly.link | `nightly.link/kc7891/lol-viewer/workflows/release/main/lol-viewer-setup.zip` | 更新のダウンロード | 04 §1.2 |
| データ | `champions.json`（173 件: `english_name`, `japanese_name`, `image_url`, `id`, `lanes{top,jg,mid,bot,sup}`） | 名前解決、アイコン、レーン適性 | 03 §11 |
| データ | `champion_lane.csv`（0〜5 の適性スコア） | **実行時には読まない**。データ生成時にマージする | 03 §11.2 |

## 4. ユーザーデータ（移行時に引き継ぐか判断が必要）

| 保存先 | 中身 | 参照 |
|---|---|---|
| QSettings `("LoLViewer","LoLViewer")`（Windows では `HKCU\Software\LoLViewer\LoLViewer`） | `build_url`, `matchup_url`, `counter_url`, `aram_url`, `live_game_url`, `display/ui_size`（既定 medium）, `display/qr_code_overlay`（既定 true）, `sidebar_width`（既定 200）, `feature_flags/<key>` | 01 §10 |
| `%LOCALAPPDATA%\LoLViewer\cache\champion_icons\<sha256(url)>.png` | アイコンのディスクキャッシュ（起動時に古いものを掃除、アンインストール時に削除） | 03 §10.4 |
| WebEngine の既定プロファイル | Cookie やストレージ（Qt の既定ではおそらく揮発。要確認） | 02 §7.3 |
| ログ | debug ビルドだけ: `logs/lol_viewer_<ts>.log`、`lol_viewer_debug.log` | 04 §2 |

**保存されないもの**: ウィンドウの位置とサイズ、開いていたビューアとその URL、対面表、保留中の敵ピック、選択中のタブ、ビューア間の幅。

---

## 5. 移植時に判断が必要な事項（ドキュメントと実装の食い違い、潜在的な不具合）

旧版の「仕様」として**そのまま再現するか、直すか**を決める必要がある項目です。

### 5.1 ドキュメントや設計書にあるが、実装が無い・違う
| # | 内容 | 実装の実態 | 参照 |
|---|---|---|---|
| D1 | README と DEV.md の「起動時に更新を促す」 | 起動時は表示と ● だけ。プロンプトは手動ボタンからだけ | 04 §1.4 |
| D2 | DEV.md の「サイレント更新」 | `/SILENT` が付いていないので、ウィザードが表示される | 04 §1.7 |
| D3 | `.iss` のコメント「updater が League/Vanguard の実行中を確認する」 | そのような確認処理は無い | 04 §1.7 |
| D4 | 設計書（matchup-list.md）の ↑↓ 並べ替えボタン | UI には無く、DnD だけ。`_matchup_swap_enemies` はテストからしか呼ばれない | 01 §6.5, 02 §5.2 |
| D5 | window-design.md の「pill と × はコントロールバーの右側」 | ヘッダーの左側に寄せている | 02 §2.3 |
| D6 | Settings の説明文にある `{lane}` プレースホルダー | 置換されない（レーンはいつも `?lane=` を末尾に足す） | 01 §5 |
| D7 | build-detect.md の lockfile / WebSocket / Live Client API（2999）/ Ban 取得 | どれも未実装（ポーリングだけ） | 03 §12 |
| D8 | build-detect.md の「敵 5 体の Counter ページを自動で開く」 | 保留リストに積んで、ユーザー操作で開く方式に変わった | 03 §12 |
| D9 | docs/features.md の「↑↓」、architecture.md の行の高さ 50px など | 実装と違う（行の高さはプリセットで 33/40/46） | 02 §1.6 |
| D10 | DEV.md の「main.py の版を上げる」 | 実際に書き換えるのは `constants.py` | 04 §1.1 |

### 5.2 実装上の不具合・不整合（要判断）
| # | 内容 | 参照 |
|---|---|---|
| B1 | **サイドバーの行が表示名を使わない**: `[Hidden]` の接頭辞や `vs X` が画面に出ない。非表示状態は −/+ のグリフでしか分からない。（PR #114「show counter champ name as tab label」で入った表示が後で失われた可能性がある。要確認） | 02 §0-4 |
| B2 | **Wukong のキーが合っていない**: CSV は `wukong`、週次の workflow が作る json は `monkeyking`（lanes がすべて 0）。リリースビルドでは `fetch_champions.py` が `wukong` に作り直す。LCU は `Wukong` に正規化し、セレクターはキーの `monkeyking` を使う → URL が揺れる | 03 §9-11, 04 §5.7 |
| B3 | チャンピオンデータの生成処理が 2 つあり、結果が違う（workflow のインライン Python と `scripts/fetch_champions.py`。後者は公式サイトのスクレイピングを先に試し、成功すると `lanes` が欠ける） | 03 §11.1, 04 §5.7 |
| B4 | Save URLs で空欄があると、保存は失敗するのに、メモリ上の URL は空のまま残る | 01 §8.1 |
| B5 | URL を保存しても、Live Game の QR は古い URL のまま | 01 §3 |
| B6 | 更新確認は 1 セッションに 1 回だけ（`_force` を一度も True にしない）。Settings タブを開いても何も起きない | 01 §9.1 |
| B7 | **すべての HTTP が GUI スレッド上で同期実行**される（LCU は 2 秒、Data Dragon は 10 秒×2 を起動時に、更新確認は 5 秒、ダウンロードは 300 秒） | 03 §1.6, 04 §1.4 |
| B8 | Data Dragon の取得に失敗するとリトライしない → そのプロセスの間はチャンピオンを検知できない | 03 §9-1 |
| B9 | `is_client_running` が `.exe` の名前しか見ないので、実質 Windows 専用。プロセス列挙で 1 回でも例外が起きるとスキャン全体が失敗する | 03 §1.2 |
| B10 | ドッジなどで gameId だけが変わる新セッションのとき、敵の既知集合と自分のチャンピオンがクリアされない | 03 §9-5 |
| B11 | ホバーとロックを区別しない。チャンピオンやレーンが変わるたびに、新しい「picked」ビューアが増える（古いものも残る）。⧉ も毎回新しいビューアを作る | 01 §7.2, 03 §4.2 |
| B12 | 新しい試合になると、ユーザーが手で開いたビューアも閉じる | 01 §7.4 |
| B13 | LCU ステータスの UI サイズが medium に固定される（`update_sizes` が呼ばれない） | 02 §6 |
| B14 | 自動補完（QCompleter）付きの入力欄は非表示で、実際には使われていない。リロードボタンも非表示 | 02 §0-2,3 |
| B15 | WebEngine の設定が一切ない（プロファイル、Cookie の永続化、UA、`createWindow`、ダウンロード、ズーム）。戻る/進むは既定の右クリックメニューからだけ。ページ内で移動しても current_url、QR、サイドバーに反映されない | 02 §7.3 |
| B16 | nightly.link の artifact は 90 日で期限切れになる。Release アセットを使う経路（`lol-viewer.exe` を探す）は本番の Release に該当するファイルが無いので機能しない | 04 §1.2 |
| B17 | ログが 2 系統あり、debug の onefile ビルドではログが一時ディレクトリに出て消える可能性がある。CI は debug ビルドを作っていない | 04 §2 |
| B18 | `tests/test_update_check.py` が本物の GitHub API を呼んでいて、アサーションが無い | 04 §7 |
| B19 | Feature Flag の定義が空なので、起動するたびに保存済みの `feature_flags/*` がすべて削除される | 01 §8.5 |

### 5.3 移植先で同等の配慮が必要か確認するもの
- **Chromium のタイミング制約**: シグナルを受けてから WebView を作る処理は次の tick に遅らせる。`setUrl` と `hide` を同じ tick で呼ばない（PR #103〜#105 のクラッシュ）。`tests/test_chromium_timing.py` が AST で検査している。→ 01 §7.1
- **アプリ名を設定しない**: `setApplicationName` を呼ぶと WebEngine プロファイルやキャッシュの保存先が変わり、Cookie が失われる、という理由で意図的に呼んでいない。→ 03 §10.4
- **Vanguard 対策**: インストーラは `CloseApplications=no`、updater は `/CLOSEAPPLICATIONS` を使わない。→ 04 §1.7, §4.4
- **PyQt6 と WebEngine の minor を揃える**（DLL load failed 対策）。→ 04 §4.6

---

## 6. 移植しなくてよい・使われていないもの（記録のため）
- `matchup_pairs_updated` シグナル、位置でペアを作る API（`get_matchup_pairs_*`）、`detect_champion()`、`ChampionData.search()`、`_matchup_swap_enemies`、`set_matchup_entry`、`_open_url_and_hide`（テストでだけ使う）、`_set_label_champion_icon`、`_create_update_script`、`_extract_px`、画像付きの補完デリゲート（無効化済み）、未使用の UI トークン（`font_title`, `icon_size_header`, `border_radius_lg`）、`mode_tab_checked` スタイル。→ 02 §2.14, 03 §4.3, 04 §1.7
- 設計書だけにある機能（D7）。

---

## 7. PR 履歴との突き合わせ（漏れの確認）

マージ済み PR のタイトルから機能を拾い、本インベントリで扱っていることを確認しました。

| PR | 機能 | 記載箇所 |
|---|---|---|
| #48 | ゲームモードの検出（ARAM） | 01 §7.2, 03 §3 |
| #50, #64 | Matchup Build（Opponent 指定の Build URL） | 02 §2.9 |
| #52, #55, #62 | タブの自動オープン、起動時のビューアは 0 枚 | 01 §1, §7 |
| #57 | ARAM タブ | 02 §2.8 |
| #60, #61, #94, #101 | Opponent 候補（対面表の敵を優先） | 01 §4.3, 02 §2.6 |
| #63, #110 | サイドバーの × とホバー時の −/+ | 02 §4.1 |
| #65, #69, #76, #79, #87 | CURRENT MATCHUP 表 | 01 §6 |
| #66, #71 | QR オーバーレイ（Feature Flag から Display 設定に昇格） | 02 §3 |
| #80 | ダークテーマの配色 | 01 §13, 02 §8 |
| #81, #95 | ユーザーの並びを保持する、少しずつ埋める、Refresh ボタン | 01 §6.4-6.5 |
| #88 | サイドバーのヘッダーに +/× | 01 §2.4 |
| #90 | 一時的な API 失敗のときにフェーズと対面表を保持する | 03 §3 |
| #91 | オーバーレイの位置、セレクターのキー/マウス操作 | 02 §2.11, §3 |
| #92, #112 | 味方と敵を別々に入れ替える DnD | 02 §5 |
| #93 | ⧉ でレーンセレクターを同期する | 01 §6.5 |
| #97, #98, #99, #100, #124 | 週次のデータ更新、レーン適性による配置（敵、ブラインドピックの味方） | 03 §11, 04 §5.4 |
| #102 | Qt ウィジェットのライフサイクルでのエラー処理（RuntimeError を握りつぶす） | 01 §12 |
| #103, #104, #105, #109, #128, #134 | Chromium のクラッシュ対策、敵ビューアを後から作る | 01 §7.1, §7.3 |
| #107 | 10 体そろったらポーリングを止める（現在はウォッチモード） | 03 §7 |
| #108 | MonkeyKing を Wukong に正規化 | 03 §2.2 |
| #114 | Counter の対面名をタブのラベルに出す → **現状は表示されない**（B1） | 02 §0-4 |
| #116, #117, #119 | UI サイズプリセット、セレクターの配置 | 02 §1.6, §2.3 |
| #123 | 自動補完の遅延初期化 | 02 §2.10 |
| #130, #133 | Settings タブの更新通知ドット | 01 §9.2 |
| #139, #140, #144 | ナビゲーションの改善（クイックピック、アイコンキャッシュの最適化）、チャンピオンボタン | 02 §2.5, 03 §10.4 |
| #145 | Live Game の右クリック Refresh | 01 §3 |
| #149, #154 | 新しい試合での自動リセット、ウォッチモード（標準機能に昇格） | 03 §5, §7 |
| #59, #98, #106, #131, #132, #141, #143, #151, #152 | CI、リリース、依存関係の運用 | 04 §5 |

PR #127 より前の git 履歴は書き換えられているため、それより古い PR の差分は追えません。タイトルからの推定です。

---

## 8. 既存ドキュメントとの関係
- `docs/features.md`、`docs/architecture.md`、`docs/design/*.md`、`design/build-detect.md`、`DEV.md`、`CONTRIBUTING.md` は旧版のドキュメントです。一部は実装と違います（§5.1）。
- 移植の基準には、本インベントリ（コードに基づくもの）を使ってください。
