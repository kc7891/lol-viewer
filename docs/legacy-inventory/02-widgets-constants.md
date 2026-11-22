# 機能インベントリ B: widgets/* と constants.py

> 統合版の索引・全体概要は [README.md](./README.md) を参照。

対象: `widgets/viewer_widget.py`, `widgets/viewer_list_item.py`, `widgets/matchup_widgets.py`, `widgets/status_widget.py`, `widgets/webview_utils.py`, `widgets/__init__.py`, `constants.py`。設計意図として `docs/design/matchup-list.md`, `docs/design/window-design.md` も参照した。`main_window.py` / `champion_data.py` / `lcu_detector.py` は、ウィジェットがどう使われているかを確認する範囲でだけ読んだ（詳細は別担当）。

行番号はすべて現行コードのもの。（要確認）は、コードから断定できない点や Qt の既定動作に依存する点に付けている。

---

## 0. 先に押さえておくべき事実（移植時の落とし穴）

1. **WebEngine プロファイルの設定はコードベースのどこにも無い。** `QWebEngineProfile` / `QWebEngineSettings` / `QWebEnginePage` のサブクラス、UA 変更、Cookie 永続化、キャッシュパス、JS/CSS 注入、`createWindow`、`acceptNavigationRequest`、`downloadRequested`、コンテキストメニューのカスタマイズ、ズーム、戻る/進む の実装は、widgets にも main_window にも存在しない（grep で確認）。`QWebEngineView()` はすべて既定のまま生成している（`widgets/viewer_widget.py:305`, `main_window.py:338`）。そのため実際の挙動は Qt WebEngine 6.11 の既定動作で決まる（§7.3）。
2. **戻る/進む/ズーム/リロードのボタンは UI に無い。** リロード用の `refresh_button` はあるが非表示で（`viewer_widget.py:295-299`）、`refresh_page()` を外から呼ぶ箇所も無い。テストからは呼ばれる。
3. **自動補完付きの QLineEdit（EN/JP の QCompleter）は非表示ウィジェット。** `champion_input` と `opponent_champion_input` は `setVisible(False)`（`viewer_widget.py:270, 278`）。ユーザーが実際に触る検索は、セレクターパネルの前方一致フィルタ（§2.6）の方。QCompleter は初めてセレクターを開いたときに遅延初期化されるが、入力欄が見えないため UI からは事実上使われない（要確認）。
4. **サイドバー項目は渡された `display_name` を無視する。** `ViewerListItemWidget.__init__(display_name, ...)` は `init_ui(display_name)` に渡すものの、中では使っていない（`viewer_list_item.py:29-80`）。そのため main_window が付ける `[Hidden] ` 接頭辞（`main_window.py:2210-2211`）や、`get_display_name()` の `| picked` / `| vs X` は画面に出ない。表示されるのは `current_champion.title()` と `current_page_type.upper()` だけ。
5. **チャンピオン名の表記揺れ。** セレクターで選ぶと champions.json のキー（例 `leesin`, `monkeyking`）が入る。LCU 検出からは Data Dragon の id（例 `LeeSin`、`MonkeyKing` は `Wukong` に置換、`lcu_detector.py:285`）が入る。このためサイドバー名は `Leesin` のように `.title()` した形になり、`Lee Sin` にはならない（`viewer_list_item.py:56`）。Wukong は経路によって URL が `wukong` にも `monkeyking` にもなる（要確認: lolalytics / u.gg が `monkeyking` を受け付けるか）。
6. **`get_ui_sizes()` の docstring と実装が食い違う。** docstring は既定が `"small"` と書くが、引数の既定値は `"medium"`（`constants.py:198-200`）。未知の名前を渡したときのフォールバックは `"small"`。

---

## 1. constants.py

### 1.1 バージョン
| 定数 | 値 | 用途 |
|---|---|---|
| `__version__` | `"0.33.1"`（`constants.py:6`） | アプリのバージョン。`main.py:5`、設定画面の "Current version: …"（`main_window.py:691`）、Updater（`main_window.py:2489, 2562`）で使う。pyproject のコメントによると、リリース時にこの値が書き換えられる（`pyproject.toml:5`）。 |

### 1.2 URL / URL テンプレート（文字列は正確に記載）
| 定数 | 正確な値 | プレースホルダ | 用途 |
|---|---|---|---|
| `DEFAULT_BUILD_URL` | `https://lolalytics.com/lol/{name}/build/`（`constants.py:9`） | `{name}` | Build ページ。QSettings キー `build_url` の既定値（`main_window.py:136`） |
| `DEFAULT_COUNTER_URL` | `https://lolalytics.com/lol/{name}/counters/`（`constants.py:10`） | `{name}` | Counter ページ。キー `counter_url`（`main_window.py:138`） |
| `DEFAULT_MATCHUP_URL` | `https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}`（`constants.py:11-14`。2 つの文字列リテラルの連結） | `{champion_name1}` `{champion_name2}` `{lane_name}`（2 回出現） | 対面指定時の Build ページ。キー `matchup_url`（`main_window.py:137`） |
| `DEFAULT_ARAM_URL` | `https://u.gg/lol/champions/aram/{name}-aram`（`constants.py:15`） | `{name}` | ARAM ページ（u.gg）。キー `aram_url`（`main_window.py:139`） |
| `DEFAULT_LIVE_GAME_URL` | `https://u.gg/lol/lg-splash`（`constants.py:16`） | なし | Live Game タブの WebView。キー `live_game_url`（`main_window.py:140`）。空のときのフォールバックにも使う（`main_window.py:1788`） |

- 5 つの URL はどれも設定画面で上書きでき、"Reset" で既定値に戻せる（`main_window.py:1994-2011`。別担当の範囲）。

### 1.3 UI グリフ
- `CLOSE_BUTTON_GLYPH = "×"`（U+00D7、`constants.py:20`）。ビューアのヘッダーの閉じるボタン（`viewer_widget.py:132`）、セレクターパネルの閉じるボタン（`viewer_widget.py:359, 602`）、サイドバーの「全部閉じる」ボタン（`main_window.py:1153`）で使う。コメントは「アプリ全体で統一する」意図（`constants.py:18-19`）。
- `viewer_list_item.py:21, 188` には別に `CLOSE_GLYPH = "×"` があり、同じ文字が重複定義されている。

### 1.4 機能フラグ
- `FEATURE_FLAG_DEFINITIONS: dict = {}`（`constants.py:24`）。**現在は空。** 仕組みだけが残っている。
  - 永続化キーは QSettings の `feature_flags/<key>`（`constants.py:23`, `main_window.py:1808, 1864, 1883`）。
  - 各エントリは `{"default": bool, ...}` を想定（`main_window.py:900, 1806-1808`）。辞書が空でないときだけ設定画面にフラグ用 UI が出る（`main_window.py:867, 1075`）。リセット機能あり（`main_window.py:1878`）。定義に無いキーを掃除する処理もある（`main_window.py:1820-1840`）。

### 1.5 ARAM 判定用キュー ID
- `ARAM_QUEUE_IDS = {450, 65, 100, 720}`（`constants.py:31`）。450 が現行の ARAM、残りはレガシーや特殊版。
- `ARAM_MAYHEM_QUEUE_IDS = {2400, 2401, 2403, 2405, 3240, 3270}`（`constants.py:32`）。ARAM: Mayhem 用。Riot の queues.json には無い ID で、出典は CommunityDragon の `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/queues.json`（`constants.py:28-30`）。
- 使用箇所は `main_window.py:196-198`（ARAM 系モードの判定。真になると自分のチャンピオン検出時に Build ではなく ARAM を開く、`main_window.py:2314-2325`）。`viewer_widget.py:18` でも import しているが使っていない。

### 1.6 UI サイズプリセット `UI_SIZE_PRESETS`（`constants.py:38-195`）
- 3 段階: `"small"`（元のハードコード値、`constants.py:39-90`）、`"medium"`（`:91-142`）、`"large"`（`:143-194`）。
- 選択値は QSettings `("LoLViewer","LoLViewer")` の `display/ui_size` に保存し、既定は `"medium"`。設定のコンボボックスは Small/Medium/Large で、"Requires restart to take effect."（`main_window.py:1931-1936`, 799, 830 付近）。
- `get_ui_sizes(size_name="medium")`: 未知の名前なら `"small"` を返す（`constants.py:198-200`）。

全トークン（small / medium / large）と主な使用箇所:

| トークン | small | medium | large | 使用箇所 |
|---|---|---|---|---|
| font_base | 9pt | 11pt | 13pt | main_window |
| font_small | 8pt | 10pt | 11pt | セレクターパネルの見出し "SELECT CHAMPION/LANE"（`viewer_widget.py:347, 590`） |
| font_title | 11pt | 13pt | 15pt | **未使用** |
| font_section | 12pt | 14pt | 17pt | main_window |
| font_page_title | 18pt | 22pt | 25pt | main_window |
| font_pill | 9pt | 11pt | 13pt | ヘッダーの pill と "vs" ラベル（`viewer_widget.py:108, 160`） |
| font_mode_btn | 9pt | 11pt | 13pt | Build/Counter/ARAM タブ（`viewer_widget.py:210, 223`） |
| font_selector_item | 9pt | 11pt | 13pt | セレクターの検索欄（`viewer_widget.py:382`） |
| font_lane_item | 10pt | 12pt | 14pt | レーンリストの項目（`viewer_widget.py:630`） |
| font_settings_input / label | 10pt | 12pt | 14pt | 設定画面 |
| font_settings_desc | 9pt | 11pt | 13pt | 設定画面 |
| font_settings_version | 11pt | 13pt | 15pt | 設定画面 |
| font_sidebar_item | 12px | 14px | 17px | サイドバー項目の名前（`viewer_list_item.py:61, 228`） |
| font_sidebar_type | 9px | 11px | 13px | サイドバー項目の種別ラベル、LCU ステータス（`viewer_list_item.py:74, 239`, `status_widget.py:49, 61`） |
| font_matchup_title | 8pt | 10pt | 11pt | マッチアップのレーン名と VS（`main_window.py:1341`） |
| font_matchup_name | 9pt | 11pt | 13pt | マッチアップのチャンピオン名、⧉ ボタン |
| padding_btn | 4px 10px | 5px 12px | 6px 14px | モードタブ（`viewer_widget.py:209`） |
| padding_pill | 3px 8px 3px 4px | 4px 10px 4px 5px | 5px 12px 5px 6px | ヘッダーの pill（`viewer_widget.py:107`） |
| padding_primary_btn | 8px 16px | 10px 20px | 12px 24px | main_window |
| padding_search | 6px 8px | 7px 10px | 8px 12px | セレクターの検索欄（`viewer_widget.py:381`） |
| padding_selector_item | 5px 8px | 6px 10px | 7px 12px | チャンピオンリストの項目（`viewer_widget.py:408`） |
| padding_lane_item | 8px 12px | 10px 14px | 12px 16px | レーンリストの項目（`viewer_widget.py:629`） |
| padding_settings_input | 8px | 10px | 12px | 設定画面 |
| icon_size_header | 28 | 34 | 40 | **未使用** |
| icon_size_sidebar | 30 | 36 | 42 | サイドバー項目のアイコン（`viewer_list_item.py:38`） |
| icon_size_selector | 28 | 34 | 40 | チャンピオンリストのアイコン（`viewer_widget.py:397, 431`） |
| icon_size_pill | 20 | 24 | 28 | pill とクイックピックのアイコン（`viewer_widget.py:152, 513`） |
| icon_size_matchup | 24 | 28 | 34 | マッチアップ行のアイコン |
| icon_size_sidebar_btn | 20 | 24 | 28 | サイドバー項目の −/+/× ボタン（`viewer_list_item.py:87`） |
| icon_size_close_btn | 24 | 28 | 34 | ビューアの × ボタン（`viewer_widget.py:133, 360, 603`） |
| font_sidebar_btn | 14px | 17px | 20px | サイドバー項目のボタン |
| font_close_btn | 16px | 19px | 22px | ビューアの × ボタン |
| height_control_bar | 36 | 42 | 50 | モードタブ行（`viewer_widget.py:201`） |
| height_header | 44 | 52 | 60 | ビューアのヘッダー（`viewer_widget.py:125`） |
| height_lcu_status | 48 | 56 | 64 | LCU ステータス（`status_widget.py:25`） |
| height_matchup_row | 33 | 40 | 46 | マッチアップ行 |
| height_matchup_title | 24 | 28 | 34 | マッチアップのタイトル行 |
| width_matchup_lane | 44 | 52 | 60 | マッチアップのレーン名の幅 |
| height_dot_container | 30 | 36 | 42 | LCU ステータスの内側コンテナ |
| width_dot_indicator | 10 | 12 | 14 | LCU の ● の幅 |
| height_dot_indicator | 30 | 36 | 42 | LCU の ● の高さ |
| width/height_tab_dot_indicator | 8 | 10 | 12 | 設定タブの赤ドット（新バージョン通知） |
| icon_size_checkbox | 16 | 20 | 24 | 設定画面のチェックボックス |
| min_width_combobox | 100 | 120 | 140 | 設定画面 |
| height_matchup_btn | 18 | 22 | 26 | マッチアップの ⧉ ボタン |
| border_radius | 4px | 5px | 6px | pill、タブ、リスト、検索欄 |
| border_radius_lg | 6px | 7px | 8px | **未使用** |
| margin_mode_btn | 3px 2px | 4px 3px | 4px 3px | モードタブ（`viewer_widget.py:216`） |

- 未使用のトークンは `font_title`, `icon_size_header`, `border_radius_lg` の 3 つ（grep で確認）。
- QSettings の組織名とアプリ名はどちらも `"LoLViewer"`。

---

## 2. ChampionViewerWidget（`widgets/viewer_widget.py`）

### 2.1 シグナル・クラス定数・状態
- シグナル
  - `close_requested = pyqtSignal(object)`（`:39`）。ヘッダーの × で `self` を渡して emit（`:149`）。main_window の `close_viewer` に接続（`main_window.py:2092`）。
  - `champion_updated = pyqtSignal(object)`（`:40`）。`open_build/open_counter/open_aram` で URL を設定するたびに emit（`:926, 950, 974`）。サイドバーの再描画に使う（`main_window.py:2093, 2195-2197`）。
- `QUICK_OPPONENT_MAX = 5`（`:43`）。クイックピックボタンの最大数。
- クラス属性の既定値 `_quick_opponent_buttons = ()` と `_quick_opponent_ids = ()`（`:48-49`）。`__new__` だけで作ったテスト用インスタンス向け。
- コンストラクタ `__init__(viewer_id, champion_data=None, is_picked=False, main_window=None)`（`:51`）。インスタンス状態:
  - `viewer_id`: 連番 ID（`main_window.next_viewer_id`）
  - `current_champion`: 小文字化した名前（`:902` など）
  - `current_opponent_champion`
  - `current_page_type`: `"build"` / `"counter"` / `"aram"`。初期値は `""`。コメントには "build"/"counter" とだけ書かれている（`:57`）。
  - `selected_mode_index`: 0=Build, 1=Counter, 2=ARAM。チャンピオン未入力でも保持する（`:58-60`）
  - `current_url`: 最後にアプリが設定した URL（リフレッシュと QR 用、`:61`）
  - `is_picked`: LCU のピック検出から作られたかどうか（`:62`）。サイドバーで上に並べる、表示名に `picked` を付ける、に使う。
  - `main_window`: URL テンプレート・QR 設定・マッチアップデータの参照元
  - `_active_selector_target`: `"champion"` / `"opponent"`（`:326`）
  - `_completer_initialized`（`:281`）
  - `_qr_overlay`（`:321`）
- 最小幅は 300、初期幅は 500（`:329-330`）。
- テスト用の静的ヘルパー `get_lolalytics_build_url(name)` と `get_lolalytics_counter_url(name)` は既定テンプレートの `{name}` を置換するだけ（`:67-75`）。

### 2.2 UI サイズの解決
- `_get_ui_sizes()`: `main_window` が無ければ `"small"`、あれば QSettings の `display/ui_size`（既定 `"medium"`）（`:77-82`）。
- ビューアは生成時に読んだサイズで固定される。設定変更後に作ったビューアは新しいサイズで出るため、既存ビューアとサイズが混在しうる（要確認）。

### 2.3 レイアウト（docstring の図は `:87-95`）
上から縦に積む:
1. **ヘッダー**（`:122-196`）: 背景 `#141b24`、高さは `height_header` で固定、余白 (6,6,6,4)、間隔 4。左から順に `[×] [Lane▾] [Champion▾] vs [Opponent▾] [quick×5] <stretch>`。すべて左寄せで、右側に stretch。
2. **コントロールバー**（`:198-264`）: 背景 `#0d1117`、高さは `height_control_bar`、余白 (4,0,4,0)、間隔 0。`[Build][Counter][ARAM] <stretch>`。
3. **非表示の互換ウィジェット**（`:266-299`）: `champion_input`、`opponent_champion_input`、`lane_selector`（QComboBox）、`refresh_button`。
4. **コンテンツ用の QStackedWidget** `viewer_content_stack`（`:301-318`）
   - page 0: WebView（`NullWebView` か `QWebEngineView`、背景色 `#0d1117`）
   - page 1: チャンピオンセレクターパネル
   - page 2: レーンセレクターパネル
   - 初期表示は page 0。

設計書（window-design.md）では「Header はアイコン＋"Champion vs Opponent" テキスト」「Control bar の右側に pill と ×」と書かれているが、**現行の実装は pill と × をヘッダー側の左寄せに置いている**。どちらを移植するかは要判断。設計書の原則「すべてのボタン・セレクターはコンパクトにする」「ヘッダー右上の別ウィンドウアイコンは不要」はそのまま有効。

### 2.4 ヘッダーのコントロール
- **共通の pill スタイル**（`:105-120`）: padding は `padding_pill`、font は `font_pill`、背景 `#1c2330`、文字 `#e2e8f0`、枠 `1px #222a35`、角丸は `border_radius`、文字は左揃え。hover 時は背景 `#222a35`、枠 `#00d6a1`。
- **閉じるボタン ×**（`:131-150`）: サイズは `icon_size_close_btn` の正方形。カーソルは PointingHand。背景透明・枠なし・色 `#888`。hover 時は色 `#e0342c`（背景は透明のまま）。tooltip は "Close this viewer"。クリックで `close_requested.emit(self)`。
- **Lane pill** "Lane ▾"（`:169-171`）。アイコンなし。クリックでレーンセレクターパネルを開閉する（§2.7）。
- **Champion pill** "Champion ▾"（`:153-156`）。アイコンサイズは `icon_size_pill`。クリックでチャンピオンセレクター（対象 champion）を開く。選択後は「英語名 ▾」とチャンピオンアイコンを表示（`_update_champion_selector_btn`, `:750-755`）。名前が解決できなければ `champ_id.capitalize()`、空なら "Champion"。
- **"vs" ラベル**（`:158-162`）: `font_pill`、色 `#6d7a8a`、margin 0 2px、中央揃え。
- **Opponent pill** "Opponent ▾"（`:164-167`）。クリックでセレクター（対象 opponent）を開く。選択後は「英語名 ▾」とアイコン。"None" を選ぶと "Opponent ▾" に戻り、アイコンも消える（`:726-731`）。
- **クイックピックボタン ×5**（`:179-191`。§2.5）。
- 末尾に `addStretch()`（`:193`）。
- グリフ `▾` は U+25BE。

### 2.5 対面クイックピック（CURRENT MATCHUP の敵を 1 クリックで選ぶ）
- ボタンは `QuickPickButton`（§5.3）。pill スタイル、アイコンサイズ `icon_size_pill`、最小幅は `pill_icon + 12`、カーソル PointingHand。初期状態は非表示（`:181-190`）。
- データ源は `main_window._matchup_data` の敵側の列（行の順、`(ally, enemy)` タプル）（`:479-494`）。
  - 空の敵は飛ばす。名前は `_resolve_champion_id`（`champion_data.get_champion(name)["id"].lower()`。英語名・id・日本語名を正規化する、`:472-477`）で champions.json のキーに変換する。
  - 重複は除き、最大 5 件。
- `refresh_opponent_quick_picks()`（`:496-523`）
  - **現在 Opponent に選ばれているチャンピオンは除外する**（隣の pill に同じものが出ているため）。
  - 表示名は英語名（`set_full_text`）。tooltip は `"Set {display} as opponent"`。アイコンは非同期で読み込む。
  - 余ったボタンは非表示にし、アイコンとテキストをクリアする。
  - 呼ばれるタイミング: ヘッダー構築時、`_update_header_display()`（チャンピオン/対面選択、各 open_*）、main_window のマッチアップ更新時（`main_window.py:1462-1475`）。
- クリック時 `_on_quick_opponent_clicked(i)`（`:525-536`）: 対面欄にその id を入れ、pill を更新し、クイックピックを再計算（自分自身は除外される）し、WebView ページに戻す。チャンピオンが入力済みなら選択中のモードで再遷移する。

### 2.6 チャンピオンセレクターパネル（stack page 1）
- 構成（`:332-423`）: 背景 `#1c2330`、余白 (12,8,12,8)、間隔 6。
  - 見出し行: 中央に "SELECT CHAMPION"（`font_small`、bold、色 `#6d7a8a`、letter-spacing 1px、padding 2px 0）、右端に ×（`icon_size_close_btn`、色 `#6d7a8a`、hover で `#e2e8f0`、bold）。× を押すと page 0 に戻る。
  - 検索欄 `QLineEdit`: placeholder は "Search..."。padding は `padding_search`、font は `font_selector_item`、背景 `#141b24`、文字 `#e2e8f0`、枠 `1px #222a35`、フォーカス時の枠 `#00d6a1`。`textChanged` でフィルタ、`installEventFilter(self)` で Esc を拾う。
  - `QListWidget`: 背景 `#141b24`、枠なし、角丸あり、outline なし。項目の padding は `padding_selector_item`、hover 時 `#1c2330`、選択時は背景 `#00d6a1`・文字 `#0d1117`。アイコンサイズは `icon_size_selector`。
- **リストの中身**（`_populate_champion_list`, `:425-454`）: 全チャンピオンを **champions.json のキー（id 小文字）の昇順** で並べる（`sorted(self.champion_data.champions.items())`）。英語名順ではない。例えば Wukong（キー `monkeyking`）は M の位置に来る。表示テキストは英語名、`UserRole` にキー。アイコンは共有画像キャッシュから非同期に設定し、`KeepAspectRatio` + `SmoothTransformation` でスケールする。C++ 側のオブジェクトが既に破棄されていたときの RuntimeError は握りつぶす。
- **"None" 項目**（`_refresh_none_item`, `:705-719`）: 対象が opponent のときだけ先頭に "None"（`UserRole=""`）を挿入し、champion のときは取り除く。"None" はフィルタに関係なく常に表示（`:553-556`）。
- **フィルタ規則**（`_filter_champion_list`, `:538-573`）
  - 検索語は `strip().lower()`。
  - opponent モードで検索語が空のとき: **候補 ID に含まれるものだけ表示**。候補は CURRENT MATCHUP の敵 ID（最大 5）で、それが空なら他のビューアで開いているチャンピオン名を小文字化したもの（`main_window.get_open_champion_suggestions(exclude_viewer=self)`）（`:456-470`, `main_window.py:2233-`）。候補がどちらも無ければ "None" だけが見える。
  - 検索語があるとき（両モード共通）: **前方一致（startswith）**。対象は英語の表示名（小文字）、キー、日本語名（`japanese_name` の小文字）。どれか 1 つに一致すれば表示。部分一致ではない。並び順は変えない。
  - champion モードで検索語が空のとき: 全件表示。
- **開く処理**（`_open_champion_selector(target)`, `:681-703`）: 最初に `_ensure_completer_initialized()` を呼ぶ（§2.10）。対象を記録し、"None" を出し入れし、page 1 に切り替え、検索欄をクリアしてフォーカスし、空文字でフィルタする。既に page 1 を開いていても閉じない（トグルしない）。対象を切り替えて検索をリセットするだけ。
- **項目をクリック**（`_on_champion_list_item_clicked`, `:721-744`）
  - opponent の "None": 対面欄・`current_opponent_champion`・pill をクリア。
  - opponent の通常項目: 対面欄にキーを入れ、pill を更新。
  - champion: チャンピオン欄にキーを入れ、pill を更新。
  - その後、ヘッダーを再同期し、page 0 に戻す。チャンピオンが入力済みなら `open_selected_mode()`。つまり**対面だけ変えた場合でも、チャンピオンがあれば即座に再遷移する**。

### 2.7 レーンセレクターパネル（stack page 2）
- 構成（`:575-649`）: 見出し "SELECT LANE" と ×、項目は `("None",""), ("Top","top"), ("Jungle","jungle"), ("Mid","middle"), ("Bot","bottom"), ("Support","support")`。項目の padding は `padding_lane_item`、font は `font_lane_item`。それ以外のスタイルはチャンピオンリストと同じ。下に stretch。
- Lane pill を押すと開閉をトグルする（page 2 を表示中なら page 0、それ以外なら page 2、`:684-690`）。
- 項目をクリック（`:651-666`）: 非表示コンボボックス `lane_selector` を同じ値に合わせ、pill の文字を「表示名 ▾」にする（None なら "Lane ▾"）。page 0 に戻り、チャンピオンが入力済みなら再遷移する。
- **非表示のコンボボックス `lane_selector`**（`:283-292`）: 表示名と値は `Lane/""`, `Top/top`, `JG/jungle`, `Mid/middle`, `Bot/bottom`, `Sup/support`。URL を組み立てるときはここの `currentData()` を読む。main_window は LCU 検出時や ⧉ ボタン時にこのコンボと `_lane_selector_btn`（文字を `{"top":"Top","jungle":"Jungle","middle":"Mid","bottom":"Bot","support":"Support"}` で決める）と `_lane_list_widget` の選択を外から直接操作する（`main_window.py:1724-1739, 2326-2351`）。
- レーンの内部値は lolalytics の `lane=` クエリにそのまま使う: `top`, `jungle`, `middle`, `bottom`, `support`。

### 2.8 モードタブ（Build / Counter / ARAM）
- スタイル（`:206-236`）
  - 未選択: 背景透明、文字 `#6d7a8a`、hover 時は背景 `#1c2330`・文字 `#e2e8f0`。
  - `:checked`: bold、背景 `#00d6a1`、文字 `#0d1117`。
  - 別に `mode_tab_checked` スタイル（hover 時 `#00efb3`）を `_mode_tab_style_active` として保持しているが、**どこでも適用していない**。実際は 3 つとも unchecked スタイルに `:checked` 擬似状態を付けたもので見た目を切り替えている。
- `QButtonGroup` は排他（`:253-260`）。ID 0/1/2。初期は Build。
- `_set_selected_mode_index(i)`（`:821-833`）: int に変換できない値や範囲外の値は 0 にする。チェック状態だけ変え、遷移はしない。
- `_on_mode_button_clicked(i)`（`:835-844`）: モードを設定し、セレクターが開いていれば page 0 に戻す。チャンピオンが空なら何もしない（警告も出さない）。入力済みなら `open_selected_mode()`。
- `open_selected_mode()`（`:884-891`）: 1 なら counter、2 なら aram、それ以外は build。

### 2.9 ページ種別と URL の組み立て
共通の流れ（`open_build` `:893-926`、`open_counter` `:928-950`、`open_aram` `:952-974`）:
1. 自分のモードタブを選択状態にする。
2. `champion_input.text().strip().lower()` が空なら `QMessageBox.warning(self, "Input Error", "Please enter a champion name.")` を出して終了。
3. `current_champion` と `current_page_type` を設定し、ヘッダーを再同期し、Champion pill を更新する。
4. URL を組み立てて `current_url` に保存し、QR があれば `set_url` し、`web_view.setUrl(QUrl(url))` を呼び、`champion_updated` を emit する。

URL の規則:
- **Build**（`get_build_url`, `:1010-1021`）: テンプレートは `main_window.build_url`（無ければ `DEFAULT_BUILD_URL`）。`{name}` を小文字の名前に置換する。レーンがあれば **`?lane={lane}` を末尾に足す**（テンプレートに既に `?` があっても `?` で足す）。
- **Build ＋ 対面あり**（`open_build` の `:910-916`、`get_matchup_url` `:1036-1047`）: 対面欄が空でなければ matchup テンプレートを使う（`main_window.matchup_url` が truthy ならそれ、無ければ既定値）。`{champion_name1}` は自分（小文字）、`{champion_name2}` は対面（小文字）、`{lane_name}` はレーン。**レーンが無いときは空文字になり、`?lane=&vslane=` が残る。**`current_opponent_champion` も設定する。対面が空なら `current_opponent_champion=""` にして通常の Build にする。
- **Counter**（`get_counter_url`, `:1023-1034`）: `counter_url` テンプレートと `?lane=`。**対面は使わない。**
- **ARAM**（`get_aram_url`, `:1057-1067`）: `aram_url` テンプレート。名前は**小文字化してスペースを除去**する（u.gg 互換のため）。レーンは使わない。`logger.info("Opening ARAM page for …")` を出す。
- 他の URL ではスペースを除去しない。LCU からの名前は Data Dragon の id（スペースなし）なので、実害は無い想定（要確認）。
- **URL エンコードはしない**（単純な文字列置換）。

### 2.10 自動補完（バイリンガル EN/JP。`champion_data.py` の機能をビューアが呼び出す）
- 遅延初期化 `_ensure_completer_initialized()`（`:668-679`）: 「UI のフリーズを避けるため」、初めてセレクター（champion/opponent/lane のどれでも）を開いたときに 1 回だけ `setup_champion_input(champion_input)` と `setup_opponent_champion_input(opponent_champion_input, suggestion_provider=self._get_open_champion_suggestions)` を呼ぶ。
- `ChampionCompleter`（`champion_data.py:453-567`）
  - モデルは全チャンピオンを**英語名の昇順**で並べ、表示文字列は `"{English} - {Japanese}"`。
  - `CaseInsensitive`、`PopupCompletion`、**`MatchContains`（部分一致）**、最大 10 件表示。
  - `pathFromIndex` は champion id（キー）を返すので、選ぶと欄にキーが入る。別のモデルが差し替えられているときは表示テキストを返す。
  - ポップアップは最小 200×350。スタイルは背景 `#2b2b2b`、文字白、枠 `#0d7377`、選択 `#0d7377`、hover `#3a3a3a`、項目 padding 8px・高さ 30px・下線 `#3a3a3a`。旧テーマ色のまま残っている。
  - 画像付きのデリゲート `ChampionItemDelegate`（40px 画像＋英語名＋0.7 不透明の日本語名）は**無効化されている**（`champion_data.py:478-480`）。
- 対面欄のコンテキスト候補 `_OpponentContextCompleterController`（`champion_data.py:605-693`）
  - 空の欄を左クリックすると、文脈候補（CURRENT MATCHUP の敵、無ければ他ビューアのチャンピオン名）を重複除去・順序保持で `QStringListModel` に差し替え、ポップアップを開く（`QTimer.singleShot(0)`）。テストや offscreen 環境では開かない。
  - 文字を入力すると、ポップアップを閉じて全チャンピオンのモデルに戻す。候補を選んだ後も次の tick で戻す。
- `ChampionData.search()`（部分一致、英語名順、表示は "EN (JP)"）と `get_champion()`（キー完全一致→英語名/日本語名の完全一致、大小無視）は名前解決に使う（`champion_data.py:72-130`）。
- 前提: 上の入力欄は非表示なので、UI から QCompleter が使われるのは事実上ない（§0-3、要確認）。それでも機能として存在する。非表示の欄で Enter（`returnPressed`）を押すと `open_selected_mode` が呼ばれる（`:269, 277`）。

### 2.11 キーボードとマウスの扱い
- `keyPressEvent`: **Esc** でセレクターパネル（page 1/2）が開いていれば閉じて page 0 に戻し、accept する（`:853-859`）。
- `eventFilter`: 検索欄など子ウィジェットでの Esc も拾って同じ動作をする（`:876-882`）。
- `mousePressEvent`: セレクターパネルが開いているとき、**パネルの矩形の外**（ヘッダーやコントロールバーの、ボタン以外の地の部分）をクリックすると閉じる（`:861-874`）。子ボタンのクリックはボタン側が消費するので、この処理には来ない。
- 他のショートカット（Ctrl+R、F5、Alt+←、ズーム等）は**無い**（`QShortcut` / `QKeySequence` は grep で 0 件）。

### 2.12 リフレッシュ
- `refresh_page()`（`:976-983`）: `current_url` があればそれを `setUrl` し直す（ページ内で遷移していても元の URL に戻る）。無ければ `web_view.reload()`。ログを出す。
- 呼び出し元は非表示の `refresh_button`（"⟳"、tooltip "Refresh page"）だけ。UI からは使えない。

### 2.13 表示名（サイドバー用）
- `get_display_name()`（`:985-1008`）: チャンピオンが空なら `"(Empty)"`。そうでなければ `[Champion.title(), page_type, "picked"(is_picked のとき), "vs {英語名}"(対面があるとき)]` を `" | "` で連結する。コメントによると "View #n" は表示しない方針（回帰修正）。
- 現状 `ViewerListItemWidget` はこの結果を使っていない（§0-4）。

### 2.14 表示/非表示・その他
- ビューア自身は `show/hide` を独自処理しない。非表示の管理は main_window の `hide_viewer` と `hidden_viewers`、サイドバー項目のトグルが行う。
- 安全策として、`setUrl()` と `hide()` は同じイベントループ tick で呼ばないこと、シグナル起点のビューア生成は `QTimer.singleShot(0)` で次の tick に回すこと（`main_window.py:2140-2158`。Chromium がクラッシュするため）。移植先でも同種の制約があるか要確認。
- `_set_label_champion_icon`（`:787-802`）は呼び出し元が無いデッドコード。
- 未使用の import が多い（`os`, `QTimer`, `QByteArray`, `QApplication`, `QScrollArea`, `QTabWidget`, `QCheckBox`, `QFrame`, `QPixmap`, `__version__`, `ARAM_*`, `log`）。

### 2.15 ビューア内の QR オーバーレイ
- 生成するのは `main_window.qr_overlay_enabled`（QSettings `display/qr_code_overlay`、既定 True）のとき（`:320-323`, `main_window.py:149`）。`_install_qr_overlay(self, self.web_view)` で、ビューア自身を親、WebView を位置合わせの対象にする。
- URL を設定するたび（open_*）に `set_url(url)` を呼ぶ。ページ内でリンクをたどっても QR は更新されない（`urlChanged` に接続していない）。
- 設定を切り替えると即座に反映する（オーバーレイを生成するか削除する。生成時は `current_url` を再設定、`main_window.py:1898-1929`）。

---

## 3. QrCodeOverlay（`widgets/webview_utils.py:55-171`）
- 対象ウィジェットの**右下に浮かぶ QR コード**。親コンテナの子として作り、対象（WebView）と兄弟の関係で重ねる。マウスイベントは透過しない（`:68`）。
- 構成
  - QR 画像のコンテナ: 背景 `#e2e8f0`、角丸 6px、内側余白 6px、画像は中央揃え（`:77-86`）。
  - その下に右寄せのトグルボタン "QR": 32×32 固定、背景 `rgba(13,17,23,200)`、文字 `#e2e8f0`、枠 `1px #222a35`、角丸 4px、9pt bold、hover 時 `rgba(28,35,48,220)`（`:89-98`）。
- 画像サイズは `_QR_SIZE = 120` px（`:58`）。segno で `segno.make(url)` → PNG（scale=4, border=1）→ QPixmap → 120×120 に KeepAspectRatio/Smooth でスケール（`:116-129`）。
- `set_url(url)`（`:108-135`）
  - 前回と同じ URL なら何もしない。
  - 空文字なら隠す。
  - 生成に失敗したら（segno が無い等）debug ログを出して隠す。
  - 成功したら `show()` して位置を再計算。
  - URL が設定されるまでは非表示（`:101`）。
- トグル `_toggle()`（`:139-143`）: 折りたたみ状態を反転し、QR 画像コンテナを出し入れする（ボタンは常に表示）。tooltip は "Hide QR code" と "Show QR code" を切り替える。ボタンの文字は常に "QR"。**折りたたみ状態は永続化しない**（ビューアごと、セッション内のみ）。折りたたみ中に URL が変わってもコンテナは隠れたまま。
- 位置 `_reposition()`（`:145-157`）: `adjustSize()` した後、対象の右下を親の座標系に写像し、margin 10px（+1 補正）で右下に置く。対象の左上より外にははみ出さない。対象の Resize/Move を eventFilter で監視して追従する（`:159-165`）。
- Live Game ページにも同じオーバーレイがあり、live_game_url を表示する（`main_window.py:344-347`）。
- セレクターパネル（page 1/2）を開いているときもオーバーレイは見えたまま重なっている可能性がある（`raise_` やスタックの切り替えに連動した非表示処理は無い。要確認）。

---

## 4. ViewerListItemWidget / PendingPickListItemWidget（`widgets/viewer_list_item.py`）

### 4.1 ViewerListItemWidget（サイドバー Viewers タブの 1 行、`:18-182`）
- 構成（`:29-123`）: QHBoxLayout、余白 (8,6,8,6)、間隔 8。
  - **アイコン**: `icon_size_sidebar` の正方形、背景 `#1c2330`、角丸 6px。`parent_window.champion_data.get_champion(current_champion)` の `image_url` を `parent_window._sidebar_image_cache` から読み込み、非同期のコールバックで後から設定する（`:161-182`）。名前が無い、または解決できなければ空のプレースホルダ。
  - **テキスト**（縦並び、間隔 1、stretch 1）
    - 名前: `current_champion.strip().title()`。空なら `"(Empty)"`。色 `#e2e8f0`、`font_sidebar_item`、bold。
    - 種別: `current_page_type.upper()`。**空なら "BUILD"**。色 `#6d7a8a`、`font_sidebar_type`。
  - **表示トグルボタン**: ビューアが表示中なら `−`（U+2212、tooltip "Hide viewer"）、非表示なら `+`（"Show viewer"）。`icon_size_sidebar_btn` の正方形、色 `#6d7a8a`、hover で `#00d6a1`、bold、`font_sidebar_btn`、カーソル PointingHand。
  - **閉じるボタン ×**: tooltip "Close viewer"。色 `#6d7a8a`、hover で `#e0342c`、PointingHand。
- **ホバー時だけ表示**: `enterEvent` でトグルと × を表示し、`leaveEvent` で隠す（`:135-145`）。
- トグルの動作（`:147-155`）: 表示中なら `parent_window.hide_viewer(viewer)`。非表示なら `viewer.show()` して `hidden_viewers` から外し、`update_viewers_list()`。
- 閉じる: `parent_window.close_viewer(viewer)`（`:157-159`）。
- `sizeHint()`: 高さは最低でも `icon_size_sidebar + 12`（`:125-133`）。main_window は `adjustSize()` の後に `item.setSizeHint(item_widget.sizeHint())` を呼ぶ（`main_window.py:2219-2221`）。
- **選択時のスタイルは main_window の QListWidget 側**（`main_window.py:1199-1226`）: 背景 `#090e14`。項目の左に 3px の透明ボーダー。hover 時は背景 `#171e28`。選択時は背景 `#141b24` と**左ボーダー 3px `#00d6a1`**。フォーカス枠は無し、`NoFocus`。ダブルクリックで表示/非表示を切り替える（`main_window.py:1228, 2166-`）。並び順は is_picked のビューアが先、残りは元の順（`main_window.py:2203-2206`）。
- 受け取った `display_name` 引数は未使用（§0-4）。非表示状態は −/+ のグリフにしか表れない（ホバーしないと見えない）。

### 4.2 PendingPickListItemWidget（まだビューアを作っていない敵ピック、`:185-336`）
- レイアウトとスタイルは ViewerListItem と同じ。名前は `champion_name.strip().title()`（空なら "(Empty)"）、**種別は固定で "COUNTER"**。
- ホバー時に `+`（tooltip "Open viewer"、hover で `#00d6a1`）と `×`（tooltip "Remove"、hover で `#e0342c`）を表示。
- `+` は `parent_window.materialize_enemy_viewer(champion_name)`、`×` は `parent_window.remove_pending_pick(champion_name)`（`:265-267, 287-289`）。
- サイドバーではビューア項目の後に並ぶ（`main_window.py:2224-2231`）。

---

## 5. マッチアップ関連ウィジェット（`widgets/matchup_widgets.py`）

### 5.1 DraggableMatchupLabel（`:6-54`）
- QLabel のサブクラス。行インデックスと side（`"ally"` / `"enemy"`）を持つ。
- `drag_enabled` が False なら普通の QLabel と同じ。`set_drag_enabled(True)` でカーソルが OpenHand になる。main_window は**常に有効にしている**（`main_window.py:1663-1673`）。
- 左ボタンを押して、`QApplication.startDragDistance()` 以上動かすとドラッグを開始する（`:28-43`）。
- MIME タイプは `application/x-lol-matchup-dnd`、データは `"{row_index}:{side}"` の UTF-8（`:12, 48`）。ドラッグ画像はラベルを `grab()` したもので、ホットスポットは中央。`MoveAction`（`:45-54`）。

### 5.2 MatchupRowWidget（`:57-107`）
- ドロップを受け付ける行ウィジェット。`setAcceptDrops(True)` は main_window 側で呼ぶ（`main_window.py:1671-1673`）。
- `dragEnterEvent`: MIME が一致し、**ドラッグ元と別の行**なら受け入れ、ハイライトを付ける。ハイライトは `background rgba(0,214,161,0.12)`、`border 1px rgba(0,214,161,0.35)`、角丸 2px。元のスタイルシートは退避しておく（`:60-81`）。
- `dragMoveEvent`: MIME が一致すれば受け入れる。`dragLeaveEvent` と `dropEvent` でスタイルを元に戻す。
- `dropEvent`: 同じ行なら無視。そうでなければ `main_window._matchup_dnd_drop(source, target, side)` を呼ぶ（`:93-107`）。main_window 側は**同じ side 同士でのスワップ**（ally なら味方だけ、enemy なら敵だけを 2 行間で入れ替える）をして UI を更新する（`main_window.py:1646-1661`）。
- 行の構成（main_window が組み立てる。参考、`main_window.py:1355-1421`）: `[レーン名] [味方アイコン] [味方名(DnD)] [VS] [敵名(DnD, 右寄せ)] [敵アイコン] [⧉]`。行の間に 1px の区切り線 `rgba(34,39,47,128)`。行の余白は左右 4、間隔 4。名前が空なら "-"。⧉ の tooltip は "Open matchup in viewer"。レーンの表示名は Top/Jungle/Mid/Bot/Support で、内部値は top/jungle/middle/bottom/support。
- **設計書との差**: matchup-list.md にある **↑↓ 並べ替えボタン（左右に縦並びで 12×10px）は現行の行 UI には無い**。並べ替えはドラッグ&ドロップだけ（敵のスワップ用関数 `_matchup_swap_enemies` は main_window に残っている、`main_window.py:1632` 付近）。設計書のタイトル行 "CURRENT MATCHUP" / "Refresh" / "Ally vs Enemy"（Ally `#0078f5`、vs `#6d7a8a`、Enemy `#e0342c`）とデータ管理の規則は別担当（main_window）の範囲。

### 5.3 QuickPickButton（`:110-191`）
- **はみ出すラベルを省略記号（…）で詰める** pill ボタン。QPushButton は通常はみ出しを切り捨てるだけなので、幅・アイコン・ラベルが変わるたびに省略表示を計算し直す。
- 状態は `_full_text`（元のラベル）と `_full_width`（全文表示に必要な幅）。
- サイズポリシーは `(Maximum, Fixed)`。レイアウトが詰まれば縮むが、自然な幅より広がらない（`:136`）。
- `sizeHint()` は幅 `_full_width`、高さは通常の sizeHint（`:152-153`）。
- `_measure()`: 一時的に全文を `setText` して、スタイルが計算した sizeHint の幅を記録し、元の文字に戻す（`:166-175`）。理由: フォントメトリクスとパディングを自前で足すと、プラットフォームによって 1〜2px ずれ、"Zed" が "Z..." になってしまう。sizeHint の中からは呼ばない（レイアウトの再入を避けるため）。
- 再計算のきっかけ: `set_full_text`、`setIcon`（アイコンは非同期で後から来るため）、`resizeEvent`、`changeEvent`（FontChange / StyleChange）（`:139-164`）。
- `_apply_elided_text()`（`:177-191`）
  - 幅が `_full_width` 以上なら全文を表示。
  - 足りなければ、`chrome = _full_width - horizontalAdvance(全文)` を非テキスト部分の幅とみなし、残り幅で `ElideRight` する。
  - **1 文字も入らないときは "…" だけを出さず、空文字にしてアイコンだけ見せる**（`:188-190`）。
  - 省略文字は `"…"`（U+2026、`:130`）。

---

## 6. LCUConnectionStatusWidget（`widgets/status_widget.py`）
- サイドバー下部に置く Riot API（LCU）接続状態の表示（`main_window.py:161, 179, 277`）。detector の `connection_status_changed` を `set_status` に接続する。
- 見た目（`:22-69`）: 高さは `height_lcu_status` で固定、背景 `#090e14`、上辺に `1px solid #1c2330`、左右余白 10。内側コンテナは高さ `height_dot_container`、間隔 6。
  - ●（U+25CF）: サイズは `width_dot_indicator` × `height_dot_indicator`、中央揃え。
  - テキスト: stretch 1。フォントはどちらも `font_sidebar_type`。
- 状態と文言・色（`:97-114`）

| status | テキスト | 色（● と文字の両方） |
|---|---|---|
| `"connecting"`（初期値） | `Riot API: Connecting` → アニメーションで `Connecting.` / `..` / `...` | `#6d7a8a` |
| `"connected"` | `Riot API: Connected` | `#00d6a1` |
| `"disconnected"` | `Riot API: Disconnected` | `#e0342c` |

- 初期表示のテキストは `"Riot API: Connecting"`（ドットなし、`:58`）。
- ドットのアニメーション: `QTimer` で 500ms 間隔（`:17-20`）。connecting 中だけ `"."*n` を n=1→2→3→1 と循環させる（`:90-95`）。`set_status("connecting")` で n=1 に戻し、`"Connecting."` にする。タイマーは常に動いており、他の状態では何もしない。
- 未知の status 文字列が来たら、`current_status` だけ更新して表示は変えない。
- `update_sizes(sz)`（`:116-128`）でプリセットの再適用ができるが、**どこからも呼ばれていない**。さらに `self._sz = get_ui_sizes()` は常に medium（`:14`）なので、small/large を選んでいても、最初の `set_status` 以降は文字サイズが medium の値になる（不具合候補）。

---

## 7. webview_utils（`widgets/webview_utils.py`）

### 7.1 `_webengine_disabled()`（`:12-22`）
次のどれかに当てはまれば WebEngine を使わず `NullWebView` にする。
- 環境変数 `LOL_VIEWER_DISABLE_WEBENGINE == "1"`
- `QT_QPA_PLATFORM` が `offscreen` か `minimal`
- `PYTEST_CURRENT_TEST` が設定されている

使用箇所はビューア（`viewer_widget.py:305`）と Live Game（`main_window.py:338`）。

### 7.2 NullWebView（`:25-52`）
- WebEngine が使えない環境（ヘッドレス/CI）向けの代替 QWidget。ラベル "Web view disabled (headless mode)"（色 `#6d7a8a`、padding 10px、折り返しあり）を出す。
- 互換 API: `page()` は自分自身を返す。`setBackgroundColor()` は何もしない。`setUrl(url)` は `_last_url` に保存する（テストで検証に使う）。`reload()` は何もしない。

### 7.3 WebEngine の設定（**明示的な設定は無い**）
| 項目 | 実装 | 実際の挙動（Qt 既定） |
|---|---|---|
| プロファイル | 指定なし（既定のプロファイル） | Qt6 の `QWebEngineProfile.defaultProfile()` は off-the-record なので、Cookie・キャッシュ・localStorage が**再起動後に残らない**可能性が高い（要確認）。lolalytics の同意ダイアログやログイン状態が毎回リセットされうる。 |
| HTTP キャッシュ / 保存先パス | 未設定 | 既定（メモリのみ、要確認） |
| 永続 Cookie | 未設定 | 既定 |
| User-Agent | 未設定 | QtWebEngine 既定の UA（"QtWebEngine/6.11" を含む Chrome 系、要確認） |
| JS / CSS 注入、広告除去 | **無し** | — |
| 外部リンク / 新しいウィンドウ / ポップアップ | `createWindow` は未実装 | `target=_blank` や `window.open` は**開かない**（Qt 既定、要確認） |
| ナビゲーションの制限 | 無し | WebView 内で任意のサイトに遷移できる |
| コンテキストメニュー | カスタマイズ無し | Qt 既定の右クリックメニュー（戻る/進む/再読み込み/コピー/リンクのコピー/ページ保存 等）がそのまま出る（要確認）。**戻る/進むは実質このメニューからしか使えない**。 |
| ダウンロード | `downloadRequested` 未接続 | ダウンロードは受理されない（要確認） |
| ズーム | 未実装 | Ctrl+ホイールなど Chromium 既定のズームが効くか（要確認） |
| 背景色 | `page().setBackgroundColor(#0d1117)`（`viewer_widget.py:306`, `main_window.py:339`） | 読み込み中の白いちらつきを防ぐ |
| URL 変化の追跡 | `urlChanged` / `titleChanged` / `loadFinished` 未接続 | 内部状態（`current_url`、QR、サイドバー）はアプリが設定した URL のままで、ページ内の遷移は反映されない |

- WebEngine のバージョンは PyQt6-WebEngine 6.11.x に固定している。4 つの PyQt6 ホイールの major.minor を揃える必要がある（`pyproject.toml:34-47`）。QR 生成には `segno>=1.6.6` を使う（`pyproject.toml:62`）。

### 7.4 `_install_qr_overlay(container, web_view)`（`:168-171`）
- `QrCodeOverlay(container, web_view)` を作って返すだけ。

### 7.5 `widgets/__init__.py`
- `LCUConnectionStatusWidget`, `NullWebView`, `QrCodeOverlay`, `_install_qr_overlay`, `_webengine_disabled`, `ViewerListItemWidget`, `PendingPickListItemWidget`, `ChampionViewerWidget`, `DraggableMatchupLabel`, `MatchupRowWidget`, `QuickPickButton` を再エクスポートする（`__all__`、`:8-20`）。

---

## 8. 残すべきビジュアル仕様（カラーパレットとフォント）
- 色トークン（実装から集約）
  - `#0d1117`: WebView とコントロールバーの背景、アクセント上の文字色
  - `#141b24`: ビューアのヘッダー背景、検索欄とリストの背景、サイドバー選択行の背景
  - `#1c2330`: pill の背景、セレクターパネルの背景、リストの hover、サイドバーのアイコン地、LCU 上辺の線
  - `#222a35`: pill と検索欄の枠、pill の hover 背景
  - `#090e14`: サイドバー、LCU ステータス、マッチアップの背景
  - `#171e28`: サイドバー行の hover
  - `#e2e8f0`: 主要な文字、QR の地
  - `#c1c9d4`: 二次的な明るい文字（マッチアップの hover、設計書のタイトル）
  - `#6d7a8a`: ミュートした文字（vs、未選択タブ、見出し、ボタン、Connecting）
  - `#888`: ヘッダーの × の通常色
  - `#00d6a1`: アクセント（選択タブ、選択項目、フォーカス枠、pill の hover 枠、Connected、サイドバーの左ボーダー、+/− の hover）
  - `#00efb3`: アクセントの hover（未使用のスタイル内だけ）
  - `#e0342c`: 危険・敵（× の hover、Disconnected、設計書の Enemy）
  - `#0078f5`: 設計書の Ally 色
  - `rgba(0,214,161,0.12)` / `rgba(0,214,161,0.35)`: DnD のハイライト
  - `rgba(34,39,47,128)`: 行の区切り線
  - `rgba(13,17,23,200)` / `rgba(28,35,48,220)`: QR ボタン
  - 旧テーマが残っているのは QCompleter のポップアップだけ（`#2b2b2b`, `#0d7377`, `#3a3a3a`）。
- 固定サイズ: QR 画像 120px（+余白 6）、QR ボタン 32×32、QR の外側マージン 10px、ビューア最小幅 300 / 初期幅 500、サイドバー項目の高さ ≥ アイコン + 12、角丸（アイコン地 6px、QR 6px、QR ボタン 4px、DnD ハイライト 2px）。
- フォントファミリーの指定は無い（OS 既定）。サイズは §1.6 のプリセット。
- 設計書（window-design.md）: ウィンドウ初期サイズ 1600×900、サイドバー最小 150px・既定 200px（QSettings に保存、QSplitter でリサイズ可）、サイドバーのタブは Live Game / Viewers（既定）/ Settings（別担当）。

---

## 移植チェックリスト

### constants
- [ ] バージョン文字列 `0.33.1` を単一の箇所で管理する（設定画面の表示、アップデータ、リリース時の自動書き換え）
- [ ] 既定の Build URL `https://lolalytics.com/lol/{name}/build/`
- [ ] 既定の Counter URL `https://lolalytics.com/lol/{name}/counters/`
- [ ] 既定の Matchup URL `https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}`
- [ ] 既定の ARAM URL `https://u.gg/lol/champions/aram/{name}-aram`
- [ ] 既定の Live Game URL `https://u.gg/lol/lg-splash`
- [ ] 5 つの URL テンプレートをユーザーが上書きでき、既定値に戻せる（設定キー build_url / matchup_url / counter_url / aram_url / live_game_url）
- [ ] 閉じるグリフ "×" をアプリ全体で統一する
- [ ] 機能フラグの仕組み（定義辞書、既定値、`feature_flags/<key>` に保存、設定画面に UI、リセット、未定義キーの掃除。現在の定義は空）
- [ ] ARAM のキュー ID {450, 65, 100, 720} で ARAM を判定する
- [ ] ARAM: Mayhem のキュー ID {2400, 2401, 2403, 2405, 3240, 3270} で判定する
- [ ] ARAM 系キューのときは、自分のピック検出で Build ではなく ARAM ページを開く
- [ ] UI サイズプリセット small / medium / large と全トークンの値（§1.6 の表）
- [ ] UI サイズを `display/ui_size` に保存する（既定 medium、未知の値は small にフォールバック、変更は再起動後に反映）
- [ ] ビューアに main_window が無いときは small を使う（テスト用の挙動。移植するか要判断）

### ChampionViewerWidget: 構造と状態
- [ ] ビューアごとに 3 段構成: ヘッダー / モードタブ行 / コンテンツ（WebView、チャンピオンセレクター、レーンセレクターを切り替え）
- [ ] ビューアの最小幅 300px、初期幅 500px
- [ ] ビューア状態: id、チャンピオン、対面、ページ種別、選択モード、現在の URL、is_picked
- [ ] モードはチャンピオン未入力でも選択・保持できる
- [ ] `close_requested` 相当のイベント（ヘッダーの × でビューアを閉じる）
- [ ] `champion_updated` 相当のイベント（ページを開くたびにサイドバーを更新）

### ChampionViewerWidget: ヘッダー
- [ ] ヘッダーの × ボタン（色 #888、hover で #e0342c、tooltip "Close this viewer"）
- [ ] ヘッダーの並び: × → Lane → Champion → vs → Opponent → クイックピック ×5、すべて左寄せ
- [ ] Lane pill（"Lane ▾"、選択後は "Top ▾" など）
- [ ] Champion pill（初期は "Champion ▾"、選択後は英語名＋アイコン＋▾）
- [ ] Opponent pill（初期は "Opponent ▾"、選択後は英語名＋アイコン＋▾、None で元に戻る）
- [ ] pill の共通スタイル（背景 #1c2330、枠 #222a35、hover で枠 #00d6a1、左揃え、角丸）
- [ ] 名前が解決できないときの pill 表示は capitalize した名前
- [ ] チャンピオンアイコンを非同期に読み込み、共有キャッシュを使う（破棄済みウィジェットへの設定は無視）

### ChampionViewerWidget: クイックピック
- [ ] CURRENT MATCHUP の敵を最大 5 件、1 クリックで対面に設定できるボタン
- [ ] 敵の名前を正規化（英語名・id・日本語名から champions のキーへ）、重複除去、行順を維持
- [ ] 現在の対面に選ばれているチャンピオンはクイックピックから除く
- [ ] tooltip は "Set {name} as opponent"、使わないボタンは非表示
- [ ] マッチアップ更新・対面変更・ページを開いたときにクイックピックを再計算する
- [ ] クイックピックを押したら WebView に戻し、チャンピオンがあれば即座に再遷移する
- [ ] クイックピックのラベルは幅に合わせて "…" で省略し、1 文字も入らなければアイコンだけにする（QuickPickButton）

### ChampionViewerWidget: モードタブ
- [ ] Build / Counter / ARAM の排他タブ（選択時は #00d6a1 地に #0d1117 文字・太字、未選択は #6d7a8a、hover で #1c2330 地）
- [ ] タブを押したらセレクターを閉じ、チャンピオンがあれば即座に遷移する（空なら何もしない）
- [ ] 不正なモード index は 0（Build）にフォールバック

### ChampionViewerWidget: チャンピオンセレクター
- [ ] "SELECT CHAMPION" 見出し、× ボタン、検索欄（"Search..."）、アイコン付きリスト
- [ ] リストは champions のキー順に全チャンピオン（表示は英語名、値はキー）
- [ ] 対面モードのときだけ先頭に "None" 項目を出す（常に表示）
- [ ] 対面モードで検索語が空なら、CURRENT MATCHUP の敵だけ表示（無ければ他ビューアのチャンピオン）
- [ ] 検索は大小無視の前方一致で、英語名・キー・日本語名のどれかに一致すれば表示
- [ ] チャンピオンモードで検索語が空なら全件表示
- [ ] セレクターを開くたびに検索欄をクリアしてフォーカスする（既に開いていても再初期化、トグルしない）
- [ ] 項目を選んだら pill を更新して WebView に戻し、チャンピオンがあれば再遷移する（対面だけ変えた場合も）
- [ ] None を選んだら対面を解除する
- [ ] セレクターのスタイル（パネル #1c2330、リストと検索欄 #141b24、選択 #00d6a1、フォーカス枠 #00d6a1）

### ChampionViewerWidget: レーン
- [ ] "SELECT LANE" パネル（None / Top / Jungle / Mid / Bot / Support）
- [ ] Lane pill でパネルを開閉トグルする
- [ ] レーン値 top / jungle / middle / bottom / support を URL の `lane=` に使う
- [ ] レーンを選んだら pill を更新して WebView に戻し、チャンピオンがあれば再遷移する
- [ ] 外部（LCU 検出、マッチアップの ⧉）からレーン・pill 表示・リスト選択を設定できる

### ChampionViewerWidget: URL とナビゲーション
- [ ] Build URL: テンプレートの {name} を小文字名に置換し、レーンがあれば `?lane=` を付ける
- [ ] 対面ありの Build は Matchup テンプレートを使う（{champion_name1}/{champion_name2}/{lane_name}。レーンが空でも置換する）
- [ ] Counter URL: テンプレートと `?lane=`（対面は使わない）
- [ ] ARAM URL: 名前を小文字化してスペースを除去、レーンは使わない
- [ ] チャンピオン未入力でページを開こうとしたら警告 "Input Error" / "Please enter a champion name."
- [ ] ページを開くたびに現在の URL を保存し、QR を更新し、サイドバーを更新する
- [ ] リフレッシュは保存した元の URL を開き直す（無ければ reload）。UI に出すかは要判断（現状は非表示）
- [ ] URL エンコードをせず、単純な置換で組み立てる（互換性の観点で要確認）
- [ ] Wukong / MonkeyKing などチャンピオン名の正規化（移植時に統一する、要確認）

### ChampionViewerWidget: 自動補完・キー操作・その他
- [ ] バイリンガル自動補完（"English - Japanese" 表示、部分一致、大小無視、最大 10 件、選ぶとキーが入る、英語名順）
- [ ] 対面欄が空のままクリックしたら文脈候補（マッチアップの敵、無ければ他ビューアのチャンピオン）を出し、入力を始めたら全チャンピオンに戻す
- [ ] 自動補完は初めてセレクターを開いたときに遅延初期化する（性能対策）
- [ ] 入力欄で Enter を押したら選択中のモードで開く（現状は入力欄が非表示）
- [ ] Esc でセレクターパネルを閉じる（検索欄にフォーカスがあっても）
- [ ] セレクターパネルの外側をクリックしたらパネルを閉じる
- [ ] サイドバー用の表示名 "Champion | type | picked | vs Opponent"、空なら "(Empty)"（現状は未使用）
- [ ] WebView の背景色を #0d1117 にする（読み込み中のちらつき防止）
- [ ] ヘッドレス環境では WebView を代替表示に切り替える

### QR オーバーレイ
- [ ] WebView 右下に QR コード（現在の URL）を浮かせて表示する（120px、白っぽい地 #e2e8f0、角丸 6、余白 6、外側マージン 10）
- [ ] "QR" トグルボタン（32×32）で QR 画像を折りたたむ/戻す（tooltip "Hide QR code" / "Show QR code"）
- [ ] URL が無い、または生成に失敗したらオーバーレイを隠す
- [ ] 同じ URL なら再生成しない
- [ ] 対象のリサイズ/移動に追従して位置を再計算する（左上にはみ出さない）
- [ ] 設定 `display/qr_code_overlay`（既定オン）を即時に反映する（全ビューアと Live Game）
- [ ] Live Game ページにも QR を出す
- [ ] 折りたたみ状態は保存しない（現仕様）

### サイドバー項目
- [ ] ビューア行: アイコン（角丸 6、地 #1c2330）＋太字の名前（title case、空なら "(Empty)"）＋種別（大文字、空なら BUILD）
- [ ] ホバー時だけ −/+ の表示トグルボタンと × の閉じるボタンを出す
- [ ] −/+ でビューアの表示/非表示を切り替える（tooltip "Hide viewer" / "Show viewer"）
- [ ] × でビューアを閉じる（tooltip "Close viewer"）
- [ ] 行の高さは最低でもアイコン + 12px
- [ ] 選択行は左に 3px #00d6a1 のボーダー＋背景 #141b24、hover は #171e28
- [ ] ダブルクリックで表示/非表示を切り替える
- [ ] is_picked のビューアを上に並べる
- [ ] 非表示のビューアを示す表示（現状は [Hidden] 接頭辞が渡されているのに表示されない。移植で直すか要判断）
- [ ] 保留中の敵ピック行（種別は "COUNTER"、ホバーで + "Open viewer"・× "Remove"）

### マッチアップ
- [ ] 味方名・敵名をドラッグ&ドロップして、同じ側同士で 2 行の中身を入れ替える
- [ ] ドラッグ中は hover した行をハイライトする（rgba(0,214,161,.12) の地、.35 の枠）。ドラッグ元の行には出さない
- [ ] 一定距離動かしたらドラッグ開始、ドラッグ画像はラベルのスナップショット、カーソルは OpenHand
- [ ] 行: レーン名、味方アイコン、名前、VS、敵名、敵アイコン、⧉（このマッチアップでビューアを開く）
- [ ] ↑↓ ボタンでの並べ替え（設計書にあるが現行 UI には無い。要判断）

### LCU ステータス
- [ ] "Riot API: Connecting…"（ドットが 500ms ごとに 1→3 で循環、色 #6d7a8a）
- [ ] "Riot API: Connected"（#00d6a1）
- [ ] "Riot API: Disconnected"（#e0342c）
- [ ] ●インジケーターとテキストを同じ色にする
- [ ] サイドバー下部に置き、背景 #090e14、上辺に #1c2330 の線
- [ ] UI サイズプリセットの反映（現状は medium に固定される不具合あり）

### WebEngine
- [ ] セッション（Cookie・ストレージ）の永続性をどうするか決める（現状は Qt 既定で、おそらく揮発。要確認）
- [ ] 新しいウィンドウ / target=_blank / 外部リンクの扱いを決める（現状は Qt 既定で開かない。要確認）
- [ ] 右クリックメニュー（現状は Chromium 既定のメニュー。戻る/進む/再読み込みはここからだけ使える）
- [ ] ダウンロード（現状は未対応）
- [ ] ページ内の遷移を現在の URL・QR・サイドバーに反映しない（現仕様。改善するかは要判断）
- [ ] URL の設定とビューアの非表示を同じ tick で行わない、ビューアの自動生成を遅延させる、といったクラッシュ回避策が移植先でも必要か確認する
