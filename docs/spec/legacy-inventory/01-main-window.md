# main_window.py 機能インベントリ（移植用）

> 統合版の索引・全体概要は [README.md](./README.md) を参照。

対象: `/home/user/lol-viewer/main_window.py`（2623行、全行読了）
補助参照: `constants.py`, `widgets/viewer_widget.py`, `widgets/viewer_list_item.py`, `widgets/matchup_widgets.py`, `widgets/webview_utils.py`, `lcu_detector.py`, `champion_data.py`（main_window からの呼び出しを理解する範囲のみ）

---

## 0. モジュールレベルの関数・環境変数

| 関数 | 行 | 内容 |
|---|---|---|
| `_lcu_service_disabled()` | main_window.py:45-51 | `LOL_VIEWER_DISABLE_LCU_SERVICE=="1"` または `PYTEST_CURRENT_TEST` が設定されていれば LCU ポーリングを起動しない |
| `_ui_dialogs_disabled()` | main_window.py:54-62 | `LOL_VIEWER_DISABLE_DIALOGS=="1"`、`PYTEST_CURRENT_TEST`、`QT_QPA_PLATFORM in {offscreen, minimal}` のいずれかでモーダルダイアログを抑止（ログ出力に置換） |
| `_webengine_disabled()`（widgets/webview_utils.py:12） | 参照: main_window.py:338 | `LOL_VIEWER_DISABLE_WEBENGINE=="1"` / offscreen / pytest のとき `QWebEngineView` の代わりに `NullWebView` を使用 |
| `setup_logging()` | main_window.py:65-109 | 下記「ロギング」参照 |
| `main()` | main_window.py:2596-2619 | エントリポイント（`main.py` も `main_window.main` を呼ぶだけ） |

### ロギング（setup_logging）
- `sys.argv[0]` の basename に `debug`（大文字小文字無視）が含まれるとデバッグモード（main_window.py:68-69）。例: `lol-viewer-debug.exe`, `debug.py`。
- レベル: デバッグ時 `DEBUG`、通常 `INFO`（main_window.py:72）。
- フォーマット `'%(asctime)s - %(name)s - %(levelname)s - %(message)s'`、日時 `'%Y-%m-%d %H:%M:%S'`（main_window.py:75-78）。
- コンソール（stdout）ハンドラは常時（main_window.py:85-88）。
- デバッグ時のみファイル出力: `os.path.dirname(os.path.abspath(__file__))/logs/lol_viewer_YYYYMMDD_HHMMSS.log`、UTF-8、DEBUG（main_window.py:91-103）。※PyInstaller onefile ビルドでは `__file__` が一時展開ディレクトリを指すため、終了後にログが消える可能性（要確認）。
- 戻り値 `is_debug` を main() がログ出力（main_window.py:2600-2604）。
- `from logger import log` を import しているが main_window.py 内では未使用（main_window.py:39）。

### main()
- setup_logging → `QApplication(sys.argv)` → `MainWindow()` → `show()` → `sys.exit(app.exec())`（main_window.py:2596-2616）。
- 例外は `logger.exception` 後 `sys.exit(1)`（main_window.py:2617-2619）。

---

## 1. MainWindow 初期化（__init__）とスタートアップシーケンス

`MainWindow(QMainWindow)`、`MAX_VIEWERS = 20`（main_window.py:115-116）。

順序（main_window.py:118-179）:
1. 状態初期化: `viewers`（全ビューア）, `hidden_viewers`, `pending_enemy_picks: list[str]`（未オープンの敵ピック）, `next_viewer_id = 0`（main_window.py:120-123）。
2. `ChampionData()` ロード（main_window.py:124）。
3. `prune_icon_cache(champion_data)` — 旧 Data Dragon パッチのアイコンキャッシュ削除。例外は warning ログのみで起動継続（main_window.py:129-132）。
4. `QSettings("LoLViewer", "LoLViewer")` を開き URL 5種を読み込み（main_window.py:135-140）。
5. `cleanup_feature_flag_settings()` — 未定義の feature flag キーを削除（main_window.py:143, 1811-1851）。
6. `load_feature_flags()`（main_window.py:146, 1803-1809）。
7. `display/qr_code_overlay`（bool, 既定 True）読み込み（main_window.py:149）。
8. `ChampionDetectorService()` 生成とシグナル接続（main_window.py:153-157）:
   - `champion_detected(str name, str lane)` → `on_champion_detected`
   - `enemy_champion_detected(str name)` → `on_enemy_champion_detected`
   - `matchup_data_updated(dict)` → `on_matchup_data_updated`
   - `new_match_started()` → `on_new_match_started`
   - （`matchup_pairs_updated` は legacy で未接続）
9. `LCUConnectionStatusWidget()` 生成（main_window.py:161）。
10. 更新チェック重複防止フラグ `_latest_version_check_inflight/done/force`、Settings タブのドットアイコンキャッシュ（main_window.py:164-174）。
11. `init_ui()`（main_window.py:176）。この中の `create_viewers_page()` で **LCU 検出サービス開始 `start(interval_ms=2000)`**（main_window.py:378-383）。
12. UI 構築後に `connection_status_changed(str)` → `connection_status_widget.set_status` を接続（main_window.py:179）。※接続は start 後なので最初期の status emit を取りこぼす可能性あり（要確認）。

init_ui 末尾（main_window.py:314-328）:
- サイドバー幅復元 → `splitterMoved` で保存接続。
- 既定タブ = Viewers（sidebar index 1 / stack index 1）。
- `QTimer.singleShot(0, update_viewers_list)` — 初回表示前に isVisible() が False で `[Hidden]` が付く問題の回避（main_window.py:324-325）。
- `QTimer.singleShot(100, check_latest_version)` — 起動時更新チェック（Settings タブの赤ドット表示用）（main_window.py:327-328）。
- 起動時にビューアは自動生成しない（0個）（main_window.py:376）。ビューア構成の永続化・復元は無い。

---

## 2. ウィンドウ構造

### 2.1 ウィンドウ
- タイトル `"LoL Viewer"`、初期サイズ `1600x900`（main_window.py:218-219）。**ウィンドウ位置/サイズの保存・復元は無い**（saveGeometry 等なし）。
- アイコン: `assets/icons/main-icon.png`（存在時のみ）。パス解決は `get_resource_path`：PyInstaller の `sys._MEIPASS`、なければ `os.path.abspath(".")`（カレントディレクトリ基準）（main_window.py:204-214, 221-224）。
- メニューバー・ツールバー・キーボードショートカットは main_window.py には **無い**（docstring に "toolbar" とあるが実体なし、main_window.py:350）。

### 2.2 レイアウト階層
```
QMainWindow
└ central QWidget / QHBoxLayout (spacing0, margin0)        main_window.py:256-260
  └ main_splitter (QSplitter Horizontal, 非折りたたみ)      main_window.py:280-291
     ├ sidebar_container (minWidth 150, bg #090e14)         main_window.py:269-277
     │  ├ self.sidebar (QTabWidget: Live Game / Viewers / Settings)
     │  └ connection_status_widget (LCU 接続状態, 下部固定)
     └ main_content_stack (QStackedWidget)                  main_window.py:294-309
        ├ [0] live_game_page
        ├ [1] viewers_page
        │   ├ matchup_list_widget（CURRENT MATCHUP 5行, 固定高）
        │   └ viewers_splitter (Horizontal, handleWidth 6, 非折りたたみ)
        └ [2] settings_page (QScrollArea)
```
- サイドバータブの index とスタックの index は 1:1 対応（`on_sidebar_tab_changed` で `setCurrentIndex(index)`、main_window.py:1745-1748）。

### 2.3 サイドバー幅の保存/復元
- 保存: `splitterMoved` 毎に `sidebar_width = sizes()[0]`（int）（main_window.py:2055-2059）。
- 復元: `sidebar_width`（int, 既定 200）→ `setSizes([w, 1600 - w])`（初回 50/50 分割を防ぐため固定値 1600 を使用）（main_window.py:2061-2067）。

### 2.4 サイドバー（create_sidebar, main_window.py:1078-1260）
- QTabWidget。タブアイコンサイズは `width_tab_dot_indicator x height_tab_dot_indicator`（UI サイズプリセット）（main_window.py:1109）。
- **Live Game タブ**（index 0, `live_game_tab_index`）: サイドバー内容は説明ラベル `"Live Game\n\nSelect this tab to view\nu.gg live game splash"` のみ（main_window.py:1111-1128）。
- **Viewers タブ**（index 1）（main_window.py:1130-1231）:
  - ヘッダ行: ラベル `"TABS"`（変数名は windows_label）、右寄せで
    - `×`（`CLOSE_BUTTON_GLYPH`）ボタン tooltip "Close All" → `close_all_viewers`（main_window.py:1153-1172）
    - `+` ボタン tooltip "Add Viewer" → `add_viewer()`（末尾追加）（main_window.py:1174-1194）
  - `viewers_list`（QListWidget, NoFocus）。**ダブルクリック → `toggle_viewer_visibility`**（main_window.py:1198-1229）。
- **Settings タブ**（index 2, `settings_tab_index`）: 説明ラベル `"Settings\n\nSelect this tab to view\napplication settings"`。既定でタブアイコン無し（新バージョン赤ドット用）（main_window.py:1233-1252）。
- タブ切替 → `on_sidebar_tab_changed`（main_window.py:1255）。Settings タブ選択時 `QTimer.singleShot(100, check_latest_version)`（main_window.py:1750-1752）。
- **タブバー右クリック → コンテキストメニュー**（CustomContextMenu）（main_window.py:1257-1260）。Live Game タブ上のみメニュー表示、他タブは何もしない（main_window.py:1754-1784）。メニュー項目は `"Refresh"` 1つ → `refresh_live_game_page`。

---

## 3. Live Game ページ（create_live_game_page, main_window.py:330-347）
- `QWebEngineView`（headless 時 NullWebView）、背景 `#0d1117`、`live_game_url` を **起動時に即ロード**（タブ未選択でも）（main_window.py:338-341）。
- QR オーバーレイ有効時 `_install_qr_overlay(live_game_page, web_view)` + `set_url(live_game_url)`（main_window.py:344-347）。
- リフレッシュ（右クリック→Refresh）: `live_game_url or DEFAULT_LIVE_GAME_URL` を `setUrl` し直す（reload ではなく再オープン）。QR オーバーレイ URL も更新（main_window.py:1786-1792）。
- URL 保存/リセット時にも即 `setUrl(live_game_url)`（main_window.py:1970, 2015）。※この経路では QR オーバーレイの URL は更新されない（不整合、要確認）。
- 自動更新（タイマー）は無い。
- 既定 URL: `https://u.gg/lol/lg-splash`（constants.py:16）。

---

## 4. Viewers ページ

### 4.1 ビューア管理
- **追加 `add_viewer(position=-1, is_picked=False)`**（main_window.py:2069-2115）
  - 上限 `MAX_VIEWERS=20`。超過時 `QMessageBox.warning("Maximum Viewers Reached", "You can only have up to 20 viewers.")`（ダイアログ無効環境ではログ）、`None` 返却（main_window.py:2076-2085）。
  - `ChampionViewerWidget(next_viewer_id, champion_data, is_picked, main_window=self)`、ID は単調増加（再利用なし）（main_window.py:2088-2089）。
  - シグナル: `close_requested → close_viewer`, `champion_updated → update_champion_name`（=サイドバー再描画）（main_window.py:2092-2093, 2195-2197）。
  - position=-1 または len 以上で末尾、他は `insertWidget(position)`（0=最左）（main_window.py:2096-2103）。
  - ビューアが2個以上なら全ビューア幅を `[500]*n` にリセット＝**均等再分配**（ユーザー調整幅は追加の度に失われる）（main_window.py:2106-2110）。
  - サイドバー更新、viewer を返却。
- **クローズ `close_viewer(viewer)`**（main_window.py:2117-2136）: リストから除去 → シグナル切断（例外無視）→ `setParent(None)` → `deleteLater()`。hidden_viewers からも除去。サイドバー更新。
- **全クローズ `close_all_viewers()`**（main_window.py:2282-2290）: 全ビューアを close + `pending_enemy_picks.clear()`。サイドバーの `×` と新マッチ開始時に使用。**確認ダイアログ無し**。
- **非表示 `hide_viewer(viewer)`**（main_window.py:2159-2164）: `viewer.hide()` + hidden_viewers 追加（重複防止）。splitter 内の領域は詰められる。
- **表示切替（ダブルクリック）`toggle_viewer_visibility(item)`**（main_window.py:2166-2193）:
  - 行 index を「picked → regular」並びのビューアに対応付け、visible なら hide / hidden なら show。
  - index がビューア数を超える場合は pending 敵ピック行 → `materialize_enemy_viewer(name)`（ダブルクリックで Counter ビューア生成）。
- ビューア並べ替え（ドラッグ等）は main_window.py には無い（splitter 上の位置は挿入位置でのみ決まる）。

### 4.2 サイドバー一覧 `update_viewers_list()`（main_window.py:2199-2231）
- 毎回 `clear()` して全再構築。
- 並び順: `is_picked=True` のビューアを先頭（元順保持）、その後通常ビューア、最後に pending 敵ピック。※サイドバー順は splitter の左右順と一致しない場合がある。
- 表示名 `viewer.get_display_name()` を計算し、非表示ビューアには `"[Hidden] "` プレフィックスを付けて `ViewerListItemWidget` に渡す（main_window.py:2209-2211）。**ただし `ViewerListItemWidget` はこの引数を使わない**ため、`[Hidden]` / `| picked` / `| vs X` は画面に出ない。実際の表示は `current_champion.title()` と `current_page_type.upper()` のみ（widgets/viewer_list_item.py:29-80、詳細は [02-widgets-constants.md](./02-widgets-constants.md) §0-4）。非表示状態はホバー時の −/+ グリフでしか分からない。
  - 参考（viewer_widget.py:990-1008）: `"(Empty)"` または `"Champion | build|counter|aram | picked | vs Opponent"` を ` | ` 連結。
- 各行 `ViewerListItemWidget(display_name, viewer, self)`、`adjustSize()` してから sizeHint を item に設定（main_window.py:2218-2222）。
  - 参考（viewer_list_item.py）: ホバー時のみ「−/+（Hide/Show）」と「×（Close）」ボタン表示、ページ種別ラベル（BUILD/COUNTER/ARAM、空なら BUILD）、チャンピオンアイコン（`_sidebar_image_cache` 使用）。
- pending 敵ピック行は `PendingPickListItemWidget(name, self)`（main_window.py:2225-2231）。参考: ホバー時「+（Open viewer）」→`materialize_enemy_viewer`、「×（Remove）」→`remove_pending_pick`。

### 4.3 オポーネント候補 `get_open_champion_suggestions(exclude_viewer)`（main_window.py:2233-2280）
- ビューアの対戦相手入力の補完候補として呼ばれる（viewer_widget.py:1049-1055）。
- 優先: CURRENT MATCHUP の敵チャンピオン（空除外、小文字で重複排除、行順）。
- 敵が1体もなければフォールバック: 開いている全ビューア（exclude_viewer 除く）の `current_champion` と `current_opponent_champion` を小文字重複排除で収集。

### 4.4 クイックピック連動
- `update_matchup_list()` の度に全ビューアの `refresh_opponent_quick_picks()` を呼ぶ（例外 RuntimeError/AttributeError は無視）（main_window.py:1467, 1471-1477）。ビューア側でマッチアップ敵を対戦相手クイック選択ボタンに反映。

---

## 5. ビューア種別と URL 合成ルール

URL テンプレートは MainWindow の属性（`build_url`, `counter_url`, `matchup_url`, `aram_url`, `live_game_url`）をビューアが **開く時点で** 参照する（viewer_widget.py:1010-1067）。

| 種別 | 既定テンプレート（constants.py:9-16） | 置換規則 |
|---|---|---|
| Build | `https://lolalytics.com/lol/{name}/build/` | `{name}` ← champion.lower()。lane があれば末尾に `?lane={lane}` を**文字列連結**（テンプレートに既に `?` があっても `?` で連結） |
| Counter | `https://lolalytics.com/lol/{name}/counters/` | 同上（`?lane=` 付加） |
| Matchup | `https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}` | `{champion_name1}` ← 自チャンプ lower, `{champion_name2}` ← 相手 lower, `{lane_name}` ← lane または空文字。matchup_url が空なら既定にフォールバック |
| ARAM | `https://u.gg/lol/champions/aram/{name}-aram` | `{name}` ← lower かつ **スペース除去** |
| Live Game | `https://u.gg/lol/lg-splash` | 置換なし |

- Build ボタン（`open_build`）は対戦相手入力が非空なら Matchup URL、空なら Build URL を使う（viewer_widget.py:910-918）。
- lane 値: `top / jungle / middle / bottom / support`（`MATCHUP_LANE_ORDER`, main_window.py:1263）。表示名マップ `{"top":"Top","jungle":"Jungle","middle":"Mid","bottom":"Bot","support":"Support"}`、ボタン表示は `"{display} ▾"`（main_window.py:1732-1734, 2343-2345）。
- Settings 画面の説明文: "Use {name} as placeholder for champion name, {lane} for lane parameter. For matchup URLs, use {champion_name1}, {champion_name2}, {lane_name}."（main_window.py:431-434）。※`{lane}` プレースホルダーは実装上置換されない（lane はクエリ付加のみ）。説明と実装が不一致（要確認）。

---

## 6. CURRENT MATCHUP リスト（main_window.py:1262-1744）

### 6.1 構造（`_create_matchup_list_widget`, main_window.py:1268-1413）
- 固定高 = `height_matchup_title + 5*height_matchup_row + 5`（セパレータ5本）（main_window.py:1282-1283）、背景 `#090e14`、左右マージン 8。
- タイトル行: 左 `"CURRENT MATCHUP"`（太字）、右に `Refresh` ボタン（枠線付き、tooltip "Clear all matchup data and re-fetch"）→ `_refresh_matchup_list`、さらに右に RichText `Ally`(#0078f5) `vs`(#6d7a8a) `Enemy`(#e0342c)（main_window.py:1290-1329）。
- 各行の前に 1px HLine セパレータ `rgba(34,39,47,128)`（main_window.py:1355-1359）。
- 行 = `MatchupRowWidget(row_index=i, main_window=self)`（ドロップ受け入れ）。左→右: レーンラベル（`Top/Jungle/Mid/Bot/Support`, 固定幅 `width_matchup_lane`）, 味方アイコン, 味方名（`DraggableMatchupLabel side="ally"`, 左寄せ, 空は `-`）, `VS`, 敵名（`DraggableMatchupLabel side="enemy"`, 右寄せ）, 敵アイコン, Open ボタン `⧉`（tooltip "Open matchup in viewer"）（main_window.py:1361-1410）。
- データ: `_matchup_data: list[(ally, enemy)]` 長さ5、初期 `("","")`（main_window.py:1334）。
- 行→レーン: `LANE_TO_INDEX = {top:0, jungle:1, middle:2, bottom:3, support:4}`、champions.json の適性キー `INDEX_TO_LANE_JSON = ["top","jg","mid","bot","sup"]`（main_window.py:1486-1488）。
- ドラッグ＆ドロップは常時有効（`_apply_matchup_dnd_state`, main_window.py:1664-1673）。

### 6.2 アイコン表示（main_window.py:1415-1453）
- `champion_data.get_champion(name)["image_url"]` を共有イメージキャッシュ（`get_shared_image_cache()`）から取得。非同期コールバックでも設定。サイズは label 幅（0 なら 24）、KeepAspectRatio + Smooth。
- 名前空・未知チャンプ・URLなしはアイコンクリア。C++ 削除済み QLabel の RuntimeError を握りつぶす。

### 6.3 描画 `update_matchup_list()`（main_window.py:1455-1469）
- 各行に名前（空は `-`）とアイコンを反映 → クイックピック更新。例外はエラーログ。
- 表示名は入力された文字列そのまま（LCU からの名前/デバッグ入力の生文字列）（要確認: 表示用に整形されるか）。

### 6.4 自動配置ルール `on_matchup_data_updated(data)`（main_window.py:1510-1536）
入力 dict: `{"allies": [(name, lane), ...], "enemies": [name, ...], "phase": str, "is_new_session": bool}`（lcu_detector.py:786）。
- 原則（docstring）: 一度置いた名前は自動では消さない／新規は空スロットのみ／新セッションで全消去。
- `is_new_session` 真 → `_matchup_data` 全クリア + `pending_enemy_picks.clear()`（ビューアは閉じない。閉じるのは `on_new_match_started`）（main_window.py:1525-1527）。
- 非 dict は無視。
- **味方 `_apply_new_allies`**（main_window.py:1538-1588）:
  - 既にいずれかの味方スロットにある名前はスキップ（完全一致・大小区別）。
  - Pass1: lane が有効（LANE_TO_INDEX にある）味方を先に処理。該当レーン行が空ならそこへ、埋まっていれば最初の空き味方スロットへ。
  - Pass2: lane 無し/不正の味方は、空き味方スロットのうち champions.json の `lanes` 適性スコア最大の行へ（同点は行順＝top優先）。適性データ無しなら最初の空き。空き無しで打ち切り。
- **敵 `_apply_new_enemies`**（main_window.py:1590-1630）:
  - 既に敵スロットにある名前はスキップ。空き敵スロットのうち適性スコア最大の行へ（同点は行順、データ無しは最初の空き）。空き無しで打ち切り。
- 味方と敵は独立に配置され、同じ行の相方は保持される。

### 6.5 ユーザー操作
- **Refresh ボタン** `_refresh_matchup_list`（main_window.py:1496-1502）: `clear_matchup_list()`（データと pending 敵ピックを消去）→ `champion_detector.resume_polling()`（全10体検出後の一時停止を解除）→ `champion_detector._check_champion(force=True)` で即時再取得。ビューアは閉じない。
- **D&D スワップ** `_matchup_dnd_drop(source, target, side)`（main_window.py:1646-1662）: 名前ラベルを別の行へドロップ → 同じ側（ally or enemy）の値のみ入れ替え。同一行・範囲外・不正 side は無視。MIME 形式 `"{row}:{side}"`（matchup_widgets.py:93-106）。ドラッグ中ハイライト等は widgets 側（要確認: matchup_widgets.py）。
- **↑↓ 並べ替え**（**PR #114 で意図的に削除済み。移植しない → M-005**）: `_matchup_swap_enemies(index)`（行 index と index+1 の敵のみ交換、末尾行は無視）が存在するが **UI からの呼び出しは無い**（テストのみ使用、main_window.py:1632-1644）。docstring の「Arrows: small vertically-stacked arrows」（main_window.py:1275）も実装に存在しない。移植時に扱いを決める必要あり（要確認）。
- `set_matchup_entry(index, ally, enemy)` 公開 API（未使用）（main_window.py:1479-1483）。
- **Open ボタン ⧉** `_open_matchup_viewer(index)`（main_window.py:1699-1743）:
  - 味方が空なら何もしない。
  - lane = 行位置（0=top…4=support）。
  - `add_viewer()` で **常に新規ビューアを末尾に作成**（既存の同チャンプビューアの再利用・重複排除なし。docstring の "Create (or reuse)" は不正確）。上限時は None で終了。
  - champion_input に味方名、セレクタボタン更新。敵がいれば opponent_champion_input に敵名とセレクタ更新。
  - lane_selector（combo）・`_lane_selector_btn` テキスト・`_lane_list_widget` 選択を同期。
  - `open_build()` → 敵ありなら Matchup URL、なければ Build URL（lane 付き）。`is_picked=False`。
  - 例外はエラーログ。
- **クリア**: `clear_matchup_list()`（main_window.py:1490-1494）。UI 上の専用 Clear ボタンは無く、Refresh / 新マッチで呼ばれる。

### 6.6 デバッグ追加（Settings > Debug、main_window.py:956-1063, 1675-1697）
- 入力欄（placeholder "Champion name (e.g., ahri, lux)"、チャンピオン名オートコンプリート `setup_champion_input`）+ `Add Ally`（青 #0078f5）/ `Add Enemy`（赤 #e0342c）。
- 入力を strip、空なら無視。該当側の最初の空き行（行順）に追加（適性・重複チェック無し、名前検証無し）。
- ステータス表示: `"Added {name} as ally|enemy to row {i}"`（i は 0 始まり）、空き無し `"No empty {side} slot available"`（このとき入力は残る）。成功時入力クリア → 再描画。
- 常時表示（ビルド種別やフラグで隠されない）。

---

## 7. LCU 自動検出との統合

### 7.1 タイミング安全パターン（Chromium クラッシュ回避）
- `_schedule_auto_viewer_creation(name, creator_fn)` = `QTimer.singleShot(0, creator_fn)`。**シグナル起点のビューア生成は必ず次のイベントループに遅延**（detector は matchup_data_updated（レイアウト変更）を同期 emit した直後に champion 検出を emit するため、同一コールスタックで QWebEngineView を生成すると Chromium がクラッシュ。PR #103/#104/#105, docs/architecture.md）（main_window.py:2138-2147）。
- `_open_url_and_hide(viewer, open_fn)`: `setUrl()` と `hide()` を同一 tick で実行しないよう hide を singleShot(0) で遅延（main_window.py:2149-2157）。現在 main_window 内からの呼び出しは無い（テストで制約として検査、tests/test_chromium_timing.py）。
- 敵ピックはそもそもビューアを自動生成せず pending リストに積むだけ（遅延生成）。

### 7.2 自分のピック（Build 自動オープン）
- `on_champion_detected(name, lane)` → 遅延で `_create_ally_viewer`（main_window.py:2292-2297）。
- `_create_ally_viewer`（main_window.py:2299-2355）:
  - 上限到達なら warning ログのみ（ダイアログ無し）で中止。
  - **常に新規ビューアを最左（position=0）に `is_picked=True` で作成**。同名チャンプの既存ビューアとの重複排除は無い（detector 側がチャンプまたはレーンが変化した時のみ emit：lcu_detector.py:1092-1097）。→ ピック変更/レーン変更の度に左端へ新ビューアが増え、旧 picked ビューアも残る。
  - champion_input へ signals ブロックしてテキスト設定。
  - `_is_aram_like_mode()` 真なら `open_aram()`。偽なら lane を lane_selector から探して設定（見つからなければ warning）、見つかった場合のみ `_lane_selector_btn`（"{Display} ▾"）と `_lane_list_widget` 選択を同期 → `open_build()`（対戦相手入力は空なので Build URL）。
  - 例外はエラーログ。
- ARAM 判定 `_is_aram_like_mode()`（main_window.py:181-202）: detector の `get_current_queue_id()` が `ARAM_MAYHEM_QUEUE_IDS={2400,2401,2403,2405,3240,3270}` または `ARAM_QUEUE_IDS={450,65,100,720}` に含まれる、または `get_current_game_mode()` が `"ARAM"`（strip/大文字比較）。取得失敗は (None, None)。

### 7.3 敵ピック（Counter は手動オープン）
- `on_enemy_champion_detected(name)` → `_create_enemy_viewer(name)`（名前に反してビューアは作らない）（main_window.py:2357-2371）。
- `pending_enemy_picks` に未登録なら追加（重複排除はこのリスト内のみ、完全一致）→ サイドバー更新。
- `materialize_enemy_viewer(name)`（main_window.py:2373-2403）: サイドバーで pending 行の `+` クリックまたはダブルクリックで呼ばれる。
  - pending から除去（上限到達時も除去されたまま＝消える）。
  - 上限到達なら warning ログ + サイドバー更新で終了。
  - 位置: picked ビューアが1つでもあれば index 1、無ければ index 0。`is_picked=False`。
  - champion_input に signals ブロックで設定 → `open_counter()`（lane_selector の現在値、新規なので既定値で `?lane=` 付加有無が決まる（要確認: lane_selector 既定値））。
- `remove_pending_pick(name)`: pending から削除 → サイドバー更新（main_window.py:2405-2409）。

### 7.4 新マッチ開始
- `on_new_match_started()`（main_window.py:1504-1508）: **全ビューア（手動で開いたものも含む）を閉じ**、マッチアップリストと pending をクリア。detector 側で `new_match_detection_enabled` 時、`matchup_data_updated` の前に emit（lcu_detector.py:1080-1085）。

### 7.5 手動再接続（Settings > LCU Connection）
- `Retry LCU Connection` ボタン → `manual_connect_lcu()`（main_window.py:2030-2047）: 無効中なら無視、ボタン無効化・テキスト `"Connecting..."` → `processEvents()` → `champion_detector.manual_connect_attempt()` → 1500ms 後 `reset_lcu_connect_button()` で有効化・テキスト復帰（main_window.py:2049-2053）。結果メッセージ表示は無い（状態はサイドバー下部の接続ステータスウィジェットで表示）。

### 7.6 接続ステータス表示
- サイドバー下部 `LCUConnectionStatusWidget`、`connection_status_changed("connecting"|"connected"|"disconnected")` を `set_status` に直結（main_window.py:161, 179, 277）。

---

## 8. Settings ページ（create_settings_page, main_window.py:385-1076）
QScrollArea（枠なし）内、VBox spacing 20、margin 40。タイトル "Settings"。セクション順:

### 8.1 Analytics URLs
| 入力 | QSettings キー | 型 | 既定 | placeholder |
|---|---|---|---|---|
| Build URL | `build_url` | str | `https://lolalytics.com/lol/{name}/build/` | 同例 |
| Matchup URL | `matchup_url` | str | `https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}` | 同例 |
| Counter URL | `counter_url` | str | `https://lolalytics.com/lol/{name}/counters/` | 同例 |
| ARAM URL | `aram_url` | str | `https://u.gg/lol/champions/aram/{name}-aram` | 同例 |
| Live Game URL | `live_game_url` | str | `https://u.gg/lol/lg-splash` | 同例 |
（main_window.py:136-140, 446-556）
- 入力欄は `load_url_settings()` で起動時に値を投入（main_window.py:1074, 1794-1801）。
- **Save URLs**（main_window.py:561-579, 1938-1990）:
  - 全欄 strip → **先にメモリ上の属性へ代入** → 1つでも空なら `"✗ Error: All URLs must be filled"`（赤 #e0342c）で中止。※この時メモリ値は空のまま残り（永続化はされない）、以後開くビューアは空テンプレートを使う（バグ的挙動、要確認）。
  - 形式検証（URL 妥当性・プレースホルダー有無）は無い。
  - 5キー保存 → Live Game を新 URL で即 `setUrl` → `"✓ URLs saved successfully"`（緑 #22c55e）→ info ログ。
  - 既存ビューアは再読込されない（次回オープンから新テンプレート）。
- **Reset to Defaults**（main_window.py:581-600, 1992-2028）: 確認なしで 5 URL を既定値に、入力欄更新、即保存、Live Game 再ロード、`"✓ URLs reset to defaults"`（緑）。
- ステータスラベル `url_status_label`（初期空）。

### 8.2 LCU Connection
- 説明（日本語）「LoLクライアントを後から起動した場合は、下のボタンを押すと即座に接続を再試行します。」+ `Retry LCU Connection`（7.5 参照）（main_window.py:619-672）。

### 8.3 Version Information / 更新
- `Current version: {__version__}`（現在 0.33.1、constants.py:6）（main_window.py:691）。
- `Latest version: Checking...`（初期）（main_window.py:703）。
- ステータスラベル `status_label`（word wrap）。
- `Check for Updates` ボタン（disabled スタイルあり）→ `check_for_updates`（main_window.py:730-752）。

### 8.4 Display Settings
- **UI Size**（QComboBox `Small/Medium/Large`）（main_window.py:784-839）
  - キー `display/ui_size`（str: `small|medium|large`、既定 `medium`）。未知値は combo index 0（Small）表示、`get_ui_sizes` も未知値は small プリセット（constants.py:198-200）。
  - 変更時即保存（main_window.py:1931-1936）。**反映には再起動が必要**（ヒント "Requires restart to take effect."）。
  - 用途: 各所のフォント/パディング/アイコン/行高などのトークン（`get_ui_sizes(...)` を UI 構築時に毎回 QSettings から読む）。
- **QR Code Overlay**（QCheckBox）（main_window.py:841-861）
  - キー `display/qr_code_overlay`（bool, 既定 True）。tooltip "Show a QR code of the current page URL on the bottom-right of each web view"。
  - 変更時即保存し **即時反映** `_apply_qr_overlay_setting`（main_window.py:1898-1929）: 有効化 → Live Game と全ビューアにオーバーレイ設置（未設置のみ）し現在 URL をセット（ビューアは current_url がある場合のみ）。無効化 → hide + deleteLater + None。
  - 新規ビューアは生成時に `main_window.qr_overlay_enabled` を参照（viewer_widget.py:322）。

### 8.5 Feature Flags（main_window.py:865-954, 1803-1896）
- `FEATURE_FLAG_DEFINITIONS`（constants.py:24、現在 **空 dict**）が非空の時のみセクション描画。
- 定義形式: `{key: {"label": str, "description": str, "default": bool}}`。label 無しは key 表示、description は tooltip。
- キー `feature_flags/<key>`（bool、既定 = 定義の default）。
- チェック変更で即保存 + `"✓ Flag '<key>' set to ON|OFF (restart may be required)"`（緑）。
- `Reset Flags to Defaults` ボタン: 全フラグ既定に保存 → チェックボックス再設定 → `"✓ Feature flags reset to defaults"`。
- 起動時 `cleanup_feature_flag_settings()`: `feature_flags` グループ内で定義に無いキーを削除（例外は warning）。**現在定義が空なので永続化済みの全 feature_flags/* が起動毎に削除される**。
- main_window.py 内で `self.feature_flags` を参照して挙動を分岐する箇所は無い（他ファイルで参照の可能性、要確認）。

### 8.6 Debug（6.6 参照）
- "Manually add champions to the Matchup List for testing." 常時表示。

### 8.7 Settings に無いもの
- キャッシュクリア UI、ログレベル切替 UI、言語切替は main_window.py には **無い**。

---

## 9. 更新チェック UI（main_window.py:2418-2587）

### 9.1 自動チェック `check_latest_version()`（main_window.py:2472-2552）
- 呼び出し: 起動 100ms 後、Settings タブ選択 100ms 後、手動更新後。
- `PYTEST_CURRENT_TEST` またはダイアログ無効環境では即 return（ラベルは "Checking..." のまま）。
- 重複防止: inflight 中は return、`done` かつ非 force は return → **実質起動時に1回だけ**（タブ選択時は no-op）。`_latest_version_check_force` を True にする箇所は無い。
- `updater.Updater(__version__, parent_widget=settings_page).check_for_updates()` → `(has_update, release_info)`。**GUI スレッドで同期実行**（ネットワーク待ちで UI がブロックされ得る、要確認: updater 側実装）。
- release_info あり: `Latest version: {tag_name.lstrip('v')}`。has_update → `"✓ New version available!"`（#00d6a1）、なし → `"✓ You have the latest version"`（#22c55e）。Settings タブ赤ドットを has_update に合わせて表示/非表示。
- release_info 無し: `Latest version: Unable to check`、`"⚠ Could not connect to update server"`（赤）、ドット非表示。
- 例外: `Latest version: Error`、`"✗ Error: {e}"`（赤）、ドット非表示。
- finally で inflight=False, done=True。

### 9.2 Settings タブ「新バージョン」インジケータ（main_window.py:2418-2470）
- QPixmap に `●` を色 `#e0342c` で描画（サイズ `width/height_tab_dot_indicator`、フォント px = max(w,h)、アンチエイリアス）→ タブアイコン（ラベルの前）。
- キャッシュキー `(ui_size, color, symbol, w, h, font_px)`。
- 非表示時は空 QIcon。

### 9.3 手動更新 `check_for_updates()`（main_window.py:2554-2587）
- ボタン無効化・"Checking..."、status "Checking for updates..."。
- `Updater.check_and_update()` がダウンロード/適用を含む全フロー（ダイアログ等は updater.py 側）。
- 戻ってきたら（未適用/辞退）`done=False` にして `check_latest_version()` 再実行（ドット同期）。
- 例外は `"✗ Error: {e}"`（赤）。finally でボタン復帰 "Check for Updates"。

---

## 10. 永続化（QSettings、組織/アプリ = "LoLViewer"/"LoLViewer"）

| キー | 型 | 既定 | 読み | 書き |
|---|---|---|---|---|
| `build_url` | str | DEFAULT_BUILD_URL | main_window.py:136 | 1962, 2007 |
| `matchup_url` | str | DEFAULT_MATCHUP_URL | 137 | 1964, 2009 |
| `counter_url` | str | DEFAULT_COUNTER_URL | 138 | 1965, 2010 |
| `aram_url` | str | DEFAULT_ARAM_URL | 139 | 1966, 2011 |
| `live_game_url` | str | DEFAULT_LIVE_GAME_URL | 140 | 1967, 2012 |
| `display/qr_code_overlay` | bool | True | 149 | 1901 |
| `display/ui_size` | str (small/medium/large) | "medium" | 387, 799, 1080, 1279, 1758, 1866, 1886, 1950, 1972, 2017, 2421, 2500, 2523, 2536, 2574 | 1935 |
| `feature_flags/<key>` | bool | 定義の default | 1808 | 1864, 1883（削除: 1842） |
| `sidebar_width` | int | 200 | 2063 | 2059 |

- 永続化されないもの: ウィンドウジオメトリ、開いているビューア/その URL、マッチアップデータ、pending 敵ピック、選択中タブ、ビューア間スプリッタ幅。

---

## 11. シャットダウン
- `closeEvent`: `champion_detector.stop()` のみ → super（main_window.py:2589-2593）。設定の明示保存は無い（各操作時に即保存済み）。ビューアの明示破棄なし。

---

## 12. エラー処理・エッジケース・細部
- 多くのハンドラが try/except で全例外を握りつぶしてログ（matchup 更新 1468、データ処理 1535、matchup オープン 1742、ally 生成 2354、enemy 生成 2402）。
- C++ 側で削除済みウィジェットへの操作を `RuntimeError` で無視（1422, 1429-1446, 1463, 1476, 2126, 2242）。
- 名前比較: マッチアップ配置の重複判定と pending の重複判定は大小区別の完全一致。候補リストは小文字正規化で重複排除。
- 上限 20 は手動追加・自動 ally・敵 materialize・matchup オープンのすべてで適用。手動追加時のみダイアログ。
- 自動 ally ビューアは picked 扱いでサイドバー最上部に並ぶ（"picked" が表示名に付く）。
- `_open_matchup_viewer` / 自動 ally で lane_selector 以外に `_lane_selector_btn`/`_lane_list_widget` も手動同期している（viewer の UI 同期を外部から行っている設計）。
- `update_viewers_list` は全再構築のためホバー状態等はリセットされる。
- Matchup URL は lane が空でも `?lane=&vslane=` の形で残る（テンプレート既定時）。
- `_extract_px(css_value, default_px)`（main_window.py:2411-2416）は未使用ユーティリティ。
- 敵が既に materialize 済みでも detector が同名を再 emit すれば再び pending に入る可能性（detector 側は `detected_enemy_champions` で重複抑止、lcu_detector.py:254）（要確認）。
- 新マッチ時 `close_all_viewers` は手動ビューアも閉じる（ユーザーが開いた任意のタブも消える）。これは仕様（M-001）。

---

## 13. スタイル（要約）
- ダークテーマ: 背景 `#0d1117`、文字 `#e2e8f0`、サイドバー背景 `#090e14`、パネル/入力 `#141b24`、ボーダー `#222a35`、ホバー `#171e28`、セカンダリボタン `#1c2330`。
- アクセント（ティール）: `#00d6a1`（hover `#00efb3`、pressed `#00b888`）。選択タブ背景、プライマリボタン、スプリッタハンドル hover、スクロールバー hover、フォーカス枠、リスト選択の左ボーダー 3px。
- 味方色 `#0078f5`、敵/エラー色 `#e0342c`、成功 `#22c55e`、補助テキスト `#6d7a8a`、ラベル `#c1c9d4`。
- 横スクロールバー: 高さ 12px、handle 角丸 6px（main_window.py:235-252）。
- スプリッタハンドル: `#222a35` 2px、hover ティール（main_window.py:282-290, 362-370）。
- サイドバータブ: padding 8px 16px、選択時ティール背景＋暗文字、下線 2px（main_window.py:1082-1107）。
- 右クリックメニュー: 背景 `#141b24`、選択項目ティール（main_window.py:1760-1774）。
- 入力欄角丸 6px、ボタン角丸 6px、ComboBox 角丸 4px（ドロップダウン選択色ティール）。
- フォント/サイズは全て `UI_SIZE_PRESETS[small|medium|large]` のトークン経由（例: `font_page_title`, `font_section`, `font_settings_*`, `padding_*`, `icon_size_*`, `height_matchup_*`, `width_matchup_lane`, `width/height_tab_dot_indicator`, `font_sidebar_*`, `min_width_combobox`）。

---

## 移植チェックリスト

### 起動・環境
- [ ] `argv[0]` に "debug" を含むとデバッグモード（DEBUG レベル + logs/lol_viewer_YYYYMMDD_HHMMSS.log 出力）、通常は INFO・コンソールのみ
- [ ] ログフォーマット `asctime - name - levelname - message`（日時 `%Y-%m-%d %H:%M:%S`）
- [ ] main() の未捕捉例外をログして exit code 1
- [ ] 環境変数 LOL_VIEWER_DISABLE_LCU_SERVICE / LOL_VIEWER_DISABLE_DIALOGS / LOL_VIEWER_DISABLE_WEBENGINE / PYTEST_CURRENT_TEST / QT_QPA_PLATFORM=offscreen|minimal によるヘッドレス・テスト抑止
- [ ] 起動時に旧パッチのチャンピオンアイコンキャッシュを削除（失敗しても起動継続）
- [ ] 起動時に未定義の feature_flags/* キーを QSettings から削除
- [ ] LCU 検出サービスを 2000ms 間隔で起動
- [ ] 起動時ビューア 0 個（自動生成・復元なし）
- [ ] 既定タブ = Viewers
- [ ] 初回表示後に一覧を再描画（[Hidden] 誤表示回避）
- [ ] 起動 100ms 後に最新バージョンチェック

### ウィンドウ/レイアウト
- [ ] タイトル "LoL Viewer"、初期 1600x900、ウィンドウアイコン assets/icons/main-icon.png（PyInstaller 対応パス解決）
- [ ] 左サイドバー（最小幅150）+ 右コンテンツの水平スプリッタ（折りたたみ不可）
- [ ] サイドバー幅を `sidebar_width`（既定200）で保存/復元
- [ ] サイドバー下部に LCU 接続状態ウィジェット（connecting/connected/disconnected）
- [ ] 3 タブ（Live Game / Viewers / Settings）とコンテンツページの 1:1 切替
- [ ] Live Game・Settings タブのサイドバー内は説明テキストのみ

### Live Game
- [ ] 起動時に Live Game URL を即ロード（既定 https://u.gg/lol/lg-splash）
- [ ] Live Game タブ右クリック → "Refresh" で URL 再オープン（他タブでは右クリックメニューなし）
- [ ] Live Game にも QR オーバーレイ（設定有効時）
- [ ] URL 保存/リセット時に Live Game を即再ロード

### ビューア管理
- [ ] サイドバー "TABS" ヘッダの "+"（Add Viewer: 末尾に追加）
- [ ] サイドバー "×"（Close All: 全ビューアと pending 敵ピックを確認なしで削除）
- [ ] ビューア上限 20、手動追加超過時に警告ダイアログ "Maximum Viewers Reached"
- [ ] ビューア ID は単調増加
- [ ] 追加時に全ビューア幅を均等再分配
- [ ] ビューアクローズ（シグナル切断・破棄・hidden から除去）
- [ ] ビューア非表示/表示（サイドバー行ダブルクリック、ホバー時の −/+ ボタン）
- [ ] 非表示ビューアであることの表示（現状は `[Hidden] ` を付けた名前を渡しているが、行ウィジェットが無視するため画面に出ない）→ 新版でも表示しない（M-006）
- [ ] サイドバー一覧順: picked ビューア → 通常ビューア → pending 敵ピック
- [ ] 一覧行: アイコン・チャンピオン名（title case）・種別ラベル（BUILD/COUNTER/ARAM）・ホバーで操作ボタン（`get_display_name()` の "Champion | type | picked | vs Opponent" は現状未表示）
- [ ] ビューアのチャンピオン変更でサイドバー更新
- [ ] 対戦相手候補: CURRENT MATCHUP の敵（小文字重複排除）、無ければ全ビューアの自/相手チャンプ（自分除外）
- [ ] マッチアップ更新時に全ビューアの対戦相手クイックピックを更新

### URL 合成
- [ ] Build: `{name}`→小文字、lane があれば `?lane=<lane>` を連結
- [ ] Counter: 同上
- [ ] Matchup: `{champion_name1}`/`{champion_name2}` 小文字、`{lane_name}` は lane または空
- [ ] Build 操作時、対戦相手入力ありなら Matchup URL を使用
- [ ] ARAM: `{name}`→小文字かつスペース除去
- [ ] lane 値 top/jungle/middle/bottom/support、表示 Top/Jungle/Mid/Bot/Support + " ▾"
- [ ] テンプレートはビューアを開く時点の設定値を使用

### CURRENT MATCHUP
- [ ] 5 行固定（Top/Jungle/Mid/Bot/Support）、味方アイコン・名前 VS 敵名前・アイコン・⧉ボタン、空は "-"
- [ ] タイトル "CURRENT MATCHUP" + Refresh ボタン + "Ally vs Enemy" 色付き表示
- [ ] 共有キャッシュからのチャンピオンアイコン非同期表示
- [ ] 新セッション（is_new_session）で全行と pending をクリア
- [ ] 一度置いた名前は自動削除しない、空スロットのみ埋める、既存名はスキップ
- [ ] 味方: lane 付きを先に該当レーン行へ（埋まっていれば最初の空き）、lane 無しは champions.json 適性最大の空き行へ（同点は行順）
- [ ] 敵: champions.json 適性最大の空き行へ（同点は行順、データ無しは最初の空き）
- [ ] Refresh: データと pending クリア → ポーリング再開 → 強制即時チェック（ビューアは閉じない）
- [ ] 名前ラベルのドラッグ&ドロップで同じ側（味方同士/敵同士）の行入れ替え
- [ ] ⧉: 行の味方（+敵）+ 行レーンで新規ビューア作成し Build/Matchup を開く（味方空なら無効、重複排除なし）
- [x] ~~（未配線）敵の隣接行スワップ `_matchup_swap_enemies`~~ 移植しない（M-005）
- [ ] Debug: 名前入力（オートコンプリート）+ Add Ally / Add Enemy で最初の空き行に追加、結果メッセージ、成功時入力クリア

### 自動検出連携
- [ ] シグナル起点のビューア生成は次イベントループへ遅延（Chromium クラッシュ回避）
- [ ] setUrl と hide を同一 tick で行わない（hide を遅延）
- [ ] 自チャンプ検出（変化時）→ 最左に picked ビューア新規作成（既存重複排除なし。仕様 → M-002）
- [ ] 自チャンプ: ARAM/ARAM Mayhem（queueId 450,65,100,720 / 2400,2401,2403,2405,3240,3270 または gameMode "ARAM"）なら ARAM ページ、それ以外は lane 設定して Build
- [ ] 自動作成時の上限超過はログのみ
- [ ] 敵チャンプ検出 → ビューアは作らず pending リストに追加（重複排除）
- [ ] pending の "+"/ダブルクリックで Counter ビューアを生成（picked があれば位置1、無ければ0）
- [ ] pending の "×" で削除
- [ ] 新マッチ開始 → 全ビューア（手動含む）を閉じ、マッチアップと pending をクリア（仕様 → M-001）
- [ ] 手動 LCU 再接続ボタン（"Connecting..." 表示・1.5秒無効化）

### Settings
- [ ] 5 つの URL 入力欄（placeholder 例付き）と説明文
- [ ] Save URLs: trim、全欄必須（エラー赤表示）、保存成功を緑表示
- [ ] Reset to Defaults: 確認なしで既定値に戻し保存
- [ ] Version Information: 現在バージョン / 最新バージョン / ステータス
- [ ] Check for Updates（手動フル更新フロー、実行中ボタン無効化、終了後に再チェック）
- [ ] UI Size（Small/Medium/Large、`display/ui_size`、再起動で反映、ヒント表示）
- [ ] QR Code Overlay（`display/qr_code_overlay`、即時に全 Web ビューへ追加/削除）
- [ ] Feature Flags セクション（定義がある時のみ）、個別トグル即保存、Reset Flags to Defaults、ステータス表示
- [ ] Debug セクション常時表示

### 更新チェック
- [ ] 最新版チェックは起動時1回（重複防止フラグ）、Settings タブ選択でも要求（実質 no-op）
- [ ] 新バージョンありで Settings タブに赤い "●" アイコン表示、ステータス "✓ New version available!"
- [ ] 最新時 "✓ You have the latest version"、接続不可 "⚠ Could not connect to update server"、例外 "✗ Error: ..."
- [ ] タグ名の先頭 "v" を除去して表示
- [ ] テスト/ヘッドレス環境では更新チェックしない

### 永続化・終了
- [ ] QSettings キー: build_url, matchup_url, counter_url, aram_url, live_game_url, display/qr_code_overlay, display/ui_size, feature_flags/<key>, sidebar_width
- [ ] 終了時に LCU 検出サービス停止

### スタイル
- [ ] ダークテーマ配色（#0d1117 / #090e14 / #141b24 / #222a35）とティールアクセント #00d6a1、味方青 #0078f5、敵赤 #e0342c、成功緑 #22c55e
- [ ] UI サイズプリセットによるフォント/余白/アイコンサイズのトークン化
- [ ] スプリッタハンドル・スクロールバー・タブ・リスト選択のホバー/選択スタイル

### 既知の不整合（移植時に判断）
- [ ] Save URLs 失敗時にメモリ上の URL が空のまま残る
- [ ] URL 保存時に Live Game の QR オーバーレイ URL が更新されない
- [ ] 説明文の `{lane}` プレースホルダーは実装上置換されない
- [ ] `_latest_version_check_force` は未使用、タブ選択時チェックは実質無効
- [ ] 更新チェックが GUI スレッドで同期実行（要確認）
