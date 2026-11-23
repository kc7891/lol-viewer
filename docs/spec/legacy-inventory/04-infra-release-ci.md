# D. インフラ / 配布 / 自動更新 / CI/CD / 開発フロー 機能インベントリ

> 統合版の索引・全体概要は [README.md](./README.md) を参照。

対象: `updater.py`, `logger.py`, `main.py`（＋実体の `main_window.py:main()` / `setup_logging()`）, `lol-viewer.spec`, `lol-viewer-debug.spec`, `lol-viewer.iss`, `pyproject.toml`, `requirements*.txt`, `.github/workflows/*.yml`, `.github/dependabot.yml`, `scripts/*.py`, `.githooks/commit-msg`, `setup-hooks.sh/.bat`, `DEV.md`, `CONTRIBUTING.md`, `README.md`, `.gitignore`, `assets/`, 指定テスト群。

行番号はすべて調査時点（HEAD `2084540`）のもの。

---

## 1. 自動更新（Auto-update）

### 1.1 バージョンの決まり方
- アプリの現在バージョンは `constants.py:6` の `__version__ = "0.33.1"` だけが正。`main.py:5` は再エクスポートするだけ。`main_window.py:22-23` で import し、`Updater(__version__, ...)` に渡す（`main_window.py:2489`, `2562`）。
- `pyproject.toml:1-8` によると `[project]` テーブルは意図的に置いていない。理由は第二のバージョン情報源を作らないため。
- リリース時のバージョンは **最新の git タグが正**（`release.yml:82-85`）。CI が `constants.py` を sed で書き換えてコミットする（`release.yml:122-146`）。DEV.md:288-290 にも「手で編集するな」とある。
- `lol-viewer.iss:5` の `MyAppVersion "0.2.2"` は古い値のまま放置されている。ビルド時に CI が `constants.__version__` で置換する（`release.yml:279-297`, `windows-build.yml:46-53`）。
- 文書のずれ: DEV.md:221 には「`main.py` のバージョンを bump」、release.yml:289 のエラーメッセージには「main.py has $version」とあるが、実際に書き換わるのは `constants.py`。

### 1.2 更新チェック先
- **チェック**: GitHub Releases API `https://api.github.com/repos/kc7891/lol-viewer/releases/latest`（`updater.py:22-23`）。`requests.get(..., timeout=5)` を認証なし（レート制限 60 回/時）で呼び、User-Agent はライブラリ既定のまま（`updater.py:59`）。
- **ダウンロード**: 通常は **nightly.link** `https://nightly.link/kc7891/lol-viewer/workflows/release/main/lol-viewer-setup.zip`（`updater.py:35`, `151-152`）。
  - 理由（`updater.py:24-34`）: GitHub Release アセットのダウンロードは日本・アジアから極端に遅い（約 130MB で 3 時間以上）。nightly.link なら CDN で数分で終わる。
  - 既知のリスクとしてコメントに明記されている: nightly.link が返すのは main ブランチで最後に成功した release ワークフロー run の artifact なので、Release 版と一致しないことがある。検出したバージョンより古いものを落とす可能性がある。
  - 補足: release.yml がアップロードする artifact は `lol-viewer-setup.exe`（artifact 名 `lol-viewer-setup`、`release.yml:318-323`）。nightly.link はこれを zip で包んで配信する。`retention-days: 90` なので、**90 日リリースがないと nightly.link の URL が切れる**可能性がある（要確認）。
- **Release アセットを使う分岐**: 環境変数 `PYTEST_CURRENT_TEST` があるとき、または `LOL_VIEWER_USE_RELEASE_ASSETS=1` のとき（`updater.py:136-149`）。
  - `sys.argv[0]` の名前に `debug` が含まれれば `lol-viewer-debug.exe`、なければ `lol-viewer.exe` のアセットを優先し、見つからなければもう一方へフォールバックする。どちらも無ければ `None`。
  - 実際の Release に上がるのは `lol-viewer-setup.zip` だけ（`release.yml:310-316`）。そのため **この分岐は本番では常に `None`** を返し、「Could not find download URL」になる（要確認だが、コードを読む限りそうなる）。

### 1.3 バージョン比較
- `tag_name` から先頭の `v` を `lstrip('v')` で除き、`packaging.version.parse` で current と比較する。`latest > current` のときだけ更新ありと判定（`updater.py:63-79`）。
- 戻り値は `(has_update, release_info)`。同じか古い場合も、チェック自体が成功していれば `release_info` を返す（`updater.py:82-84`）。UI はこれで最新バージョンを表示する。
- `tag_name` が空 → `(False, None)`（`updater.py:65-67`）。`RequestException` → warning ログ＋`(False, None)`、その他の例外（InvalidVersion など）→ error ログ＋`(False, None)`（`updater.py:86-91`）。

### 1.4 UI の流れ（main_window 側）
- **起動時の自動チェック**: `QTimer.singleShot(100, self.check_latest_version)`（`main_window.py:327-328`）。**プロンプトは出さない**。表示と赤ドットの更新だけを行う。
  - README.md:44 と DEV.md:179-182 の「起動時に更新を促す」は実装と合わない。プロンプトが出るのは手動の「Check for Updates」ボタンからだけ。
- **Settings タブを開いたとき**にも `QTimer.singleShot(100, check_latest_version)`（`main_window.py:1750-1752`）。ただし重複防止フラグがある。`_latest_version_check_inflight` / `_done` / `_force`（`main_window.py:166-169`, `2478-2485`, `2550-2552`）。**1 セッション 1 回**しか走らない（`_force=True` にしている箇所はどこにもない）。
- テストやヘッドレス時は抑止される: `PYTEST_CURRENT_TEST` または `_ui_dialogs_disabled()` が真（`LOL_VIEWER_DISABLE_DIALOGS=1`、`QT_QPA_PLATFORM` が offscreen/minimal）のとき（`main_window.py:54-62`, `2474-2476`）。
- 結果の表示（Settings ページ、`main_window.py:690-752`, `2493-2548`）:
  - 「Current version: X」ラベル、「Latest version: Checking...」→ 判明したバージョン、取得できなければ `Unable to check`、例外時は `Error`。
  - status_label: `✓ New version available!`（#00d6a1）、`✓ You have the latest version`（#22c55e）、`⚠ Could not connect to update server`（#e0342c）、`✗ Error: ...`。
  - **Settings タブの「●」新バージョンインジケータ**: 赤 #e0342c のグリフを QPixmap に描いた QIcon。UI サイズプリセットに追従し、キャッシュされる（`main_window.py:2418-2470`, `1250-1252`）。
- **手動更新**: 「Check for Updates」ボタン → `check_for_updates()`（`main_window.py:729-752`, `2554-2587`）。
  - 実行中はボタンが無効化され「Checking...」表示。`Updater.check_and_update()` で全フローを実行する。戻ってきたら `_latest_version_check_done=False` にして再チェックし、インジケータを最新状態に揃える。
  - 更新の UI ダイアログの親は `self.settings_page`。
- 注意: チェックもダウンロードも **GUI スレッドで同期的に** 動く（`requests.get` timeout 5 秒 / 300 秒）。

### 1.5 プロンプト
- `QMessageBox.question`、タイトル「Update Available」。本文は現在バージョン、最新バージョン、リリースノート（`body` の先頭 200 文字＋`...`）。Yes/No の 2 択で既定は Yes（`updater.py:103-122`）。文言は英語のみ。
- No → ログ「User declined update」→ False（`updater.py:410-412`）。「次回から表示しない」「このバージョンをスキップ」「自動チェックを無効化」の **設定はない**。

### 1.6 ダウンロード
- 拡張子は URL の末尾が `.exe` なら `.exe`、それ以外は `.zip`（`updater.py:190`）。
- `QProgressDialog`: キャンセル不可、WindowModal、タイトル「Downloading Installer」、即時表示。文言は「Downloading installer...\nThis may take a few minutes.」で、進行中は「x.x MB / y.y MB (p%)」（`updater.py:193-230`）。content-length が無いと進捗は更新されない。
- `requests.get(stream=True, timeout=300)`、8192 バイトずつ `NamedTemporaryFile(delete=False)` に書く（`updater.py:205-221`）。
- 失敗すると `QMessageBox.critical("Download Failed", ...)` を出して `None` を返す（`updater.py:238-245`）。一時ファイルは削除されない。

### 1.7 インストール
- `apply_update`（`updater.py:309-394`）の流れ:
  1. 現在の exe を決める: frozen なら `sys.executable`、そうでなければ `sys.argv[0]`。`.exe` で終わらなければ「Update Downloaded … Please extract and run the installer manually.」と案内して終了（`updater.py:318-331`）。
  2. zip から、`__MACOSX` 以外で最初に見つかる `.exe` を `tempfile.mkdtemp()` に展開する（`_extract_exe_from_zip`、`updater.py:247-286`）。失敗すると「Failed to extract installer from zip file.」。
  3. インストール先: 現在の exe があるディレクトリ（`_get_installation_dir`、`updater.py:288-307`）。
  4. 「Update Ready」情報ダイアログ: インストーラのウィザードに従うよう案内し、「The application will close now.」と伝える（`updater.py:351-357`）。
  5. 引数は `[setup.exe, '/NORESTART', '/DIR=<install_dir>']`。`/DIR` の値は前後の `"` を strip してから渡す。値の中に引用符を埋め込むと `D:\D:\...` のようにドライブが二重になるバグがあったため（`updater.py:359-378`）。
     - **`/SILENT` や `/VERYSILENT` は付けない**。そのためウィザードが表示される。DEV.md:182 の「silent mode」は実装と合わない。
     - **`/CLOSEAPPLICATIONS` も付けない**。Vanguard のクラッシュを避けるため（`updater.py:363`）。
     - 言語は `.iss` の `UsePreviousLanguage=yes` で前回の選択が引き継がれる（`updater.py:362`）。
  6. `subprocess.Popen(installer_args)` → `sys.exit(0)`（`updater.py:381-384`）。
  7. 再起動は Inno の `[Run]` の postinstall が担う（`lol-viewer.iss:60-63`）。
- 失敗すると `QMessageBox.critical("Update Failed", ...)`。ダウンロード済みファイルのパスを示し、手動実行を案内する（`updater.py:386-394`）。
- 呼ばれていない古いコード: `_create_update_script`（exe を置き換える .bat、`timeout /t 2` → `move /y` → `start`）。今はテスト専用（`updater.py:154-174`）。
- `.iss:36` のコメント「updater.py checks for running League/Vanguard processes before applying updates」に対応する **実装はない**（要確認。コメントだけ残っている）。

### 1.8 フロー全体（`check_and_update`、`updater.py:396-431`）
check → 更新なしなら False → prompt で No なら False → URL を取得、無ければ warning「Could not find download URL for the update.」で False → download、失敗なら False → apply（成功すると exit）。

---

## 2. ロギング

ロギングは **2 系統が並行して動いている**。

### 2.1 標準 `logging`（`main_window.py:65-109` の `setup_logging()`）
- デバッグ判定: `os.path.basename(sys.argv[0])` に `debug` が含まれるか（大文字小文字は無視）（`main_window.py:68-69`）。
- レベル: debug なら DEBUG、それ以外は INFO（root logger、`main_window.py:72`, `81-82`）。
- 書式: `'%(asctime)s - %(name)s - %(levelname)s - %(message)s'`、datefmt は `'%Y-%m-%d %H:%M:%S'`（`main_window.py:75-78`）。
- コンソール（stdout）ハンドラは常に付く（`main_window.py:85-88`）。
- ファイルハンドラは debug のときだけ: `<main_window.py のあるディレクトリ>/logs/lol_viewer_YYYYmmdd_HHMMSS.log`。起動ごとに新しいファイルを作り、ローテーションも古いファイルの削除もしない（`main_window.py:91-103`）。
  - 注意（要確認）: debug ビルドは onefile なので、`__file__` は一時展開ディレクトリ `_MEIPASS` 配下を指すはず。その場合ログは終了時に消える。
- 利用モジュール: `main_window`, `updater`, `lcu_detector`, `widgets/viewer_widget`, `widgets/webview_utils`（`logging.getLogger(__name__)`）。

### 2.2 独自 `logger.py`（`log()` 関数）
- frozen のとき: `sys.executable` の名前に `debug` が含まれれば有効（`logger.py:16-21`）。スクリプト実行時は常に有効（`logger.py:22-25`）。
- ファイル: `<exe のあるディレクトリ、またはリポジトリのディレクトリ>/lol_viewer_debug.log`。**起動ごとに `'w'` で上書き**し、ヘッダ（`=== LoL Viewer Debug Log ===`、開始時刻、パス）を書く（`logger.py:31-43`）。ローテーションはない。
- 行の形式は `[HH:MM:SS.mmm] message`。毎回 append で開き直す。print も常に行う（`logger.py:48-63`）。
- ファイルを作れなければ警告を print して無効化する（`logger.py:44-46`）。
- 遅延生成のシングルトン `get_logger()` と `log()`（`logger.py:66-80`）。
- 利用モジュール: `lcu_detector`（29 箇所、import に失敗したら print にフォールバック、`lcu_detector.py:17-23`）、`champion_data`（26 箇所）。`main_window` と `viewer_widget` は import しているが呼んでいない。

### 2.3 debug ビルドとの違い
- `lol-viewer-debug.exe`: console=True（コンソール窓が出る）、両方のロガーがファイル出力。DEV.md:3-36 には、ログで champion 読み込み数や補完モデル件数を確認するトラブルシュート手順がある。
- `lol-viewer.exe`（リリース）: windowed、ファイルログなし、INFO 以上が stdout へ（見えない）。
- **CI は debug ビルドを作っていない**（release.yml と windows-build.yml がビルドするのは `lol-viewer.spec` だけ）。

### 2.4 アプリが参照する環境変数（今回の範囲で見つかったもの）
| 変数 | 効果 | 参照箇所 |
|---|---|---|
| `LOL_VIEWER_DISABLE_WEBENGINE=1` | QWebEngineView の代わりに NullWebView を使う | `widgets/webview_utils.py:12-22` |
| `LOL_VIEWER_DISABLE_LCU_SERVICE=1` | LCU ポーリングを無効化 | `main_window.py:45-51` |
| `LOL_VIEWER_DISABLE_DIALOGS=1` | モーダルダイアログと更新チェックを抑止 | `main_window.py:54-62` |
| `LOL_VIEWER_USE_RELEASE_ASSETS=1` | DL 元を nightly.link から Release アセットへ切り替える | `updater.py:136` |
| `LOL_VIEWER_ICON_CACHE_DIR` | アイコンのディスクキャッシュ先を上書き | `champion_data.py:147` |
| `PYTEST_CURRENT_TEST` | 上記の無効化を全部オン、DL 元は Release アセット | 各所 |
| `QT_QPA_PLATFORM=offscreen/minimal` | WebEngine とダイアログを無効化 | `webview_utils.py:17`, `main_window.py:60`, `champion_data.py:672` |
| `LOCALAPPDATA` | アイコンキャッシュの基点 `%LOCALAPPDATA%\LoLViewer\cache\champion_icons` | `champion_data.py:151-154` |

---

## 3. エントリポイントとプロセス全体の設定

- `main.py:1-9`: `constants.__version__` と `main_window.MainWindow, main` を import して `main()` を呼ぶだけ。
- `main_window.py:2596-2619` の `main()`:
  1. `setup_logging()` を呼び、開始バナーを出す。
  2. `QApplication(sys.argv)`。
  3. `MainWindow()` を作り、`show()`、`sys.exit(app.exec())`。
  4. 例外が起きたら `logger.exception` → `sys.exit(1)`。
- **やっていないこと**（コードを確認済み。新スタックで必要かは別途判断）:
  - Qt の ApplicationAttribute 設定、High-DPI の明示設定（Qt6 の既定挙動に任せている）、`QTWEBENGINE_CHROMIUM_FLAGS` などの WebEngine フラグ、`QWebEngineProfile` のカスタマイズ。
  - 多重起動の防止。
  - AppUserModelID。
  - `setApplicationName` / `setOrganizationName`。呼ばないのは意図的で、QStandardPaths の位置が変わってしまうため（`champion_data.py:136-141`）。
  - コマンドライン引数の解釈、`sys.excepthook`。
- ウィンドウ: タイトル「LoL Viewer」、初期サイズ 1600x900、アイコンは `assets/icons/main-icon.png`（`get_resource_path` で `sys._MEIPASS` か CWD を基点に解決、`main_window.py:205-224`）。
- 設定の保存先は `QSettings("LoLViewer", "LoLViewer")`（`main_window.py:135`）。Windows ではレジストリ `HKCU\Software\LoLViewer\LoLViewer` になる。アンインストール後も残る（`.iss:67`）。
- 終了時は `closeEvent` で `champion_detector.stop()`（`main_window.py:2589-2593`）。
- ヘッドレス実行のレシピ（CI・テストで使用）: `QT_QPA_PLATFORM=offscreen`, `QT_OPENGL=software`, `QTWEBENGINE_DISABLE_SANDBOX=1`, `QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --disable-gpu"`, `LOL_VIEWER_DISABLE_*=1`, `xvfb-run`（`python-tests.yml:29-50`, 各テストの先頭）。

---

## 4. パッケージング

### 4.1 PyInstaller: リリース版（`lol-viewer.spec`）
- エントリは `main.py`（`spec:14`）。
- datas（`spec:17-20`）: `champions.json` → `.`、`assets/icons/main-icon.png` → `assets/icons`。`champion_lane.csv` は同梱しない（lanes は json に埋め込み済み）。
- hiddenimports（`spec:21-42`）: `lcu_detector`, `psutil`, `requests`, `urllib3`（`.util`, `.util.retry`, `.exceptions`）, `champion_data`, `logger`, `updater`, `constants`, `main_window`, `widgets`（`.status_widget`, `.webview_utils`, `.viewer_list_item`, `.viewer_widget`, `.matchup_widgets`）, `packaging`, `packaging.version`。
  - `segno` は hiddenimports に入っていない。静的 import で拾われるはず（要確認）。
- **onedir** 構成（`exclude_binaries=True` ＋ COLLECT、`spec:59`, `76-85`）。VC++ 再頒布パッケージを不要にするため全 DLL を同梱する（DEV.md:138）。
- 出力: `dist/lol-viewer/lol-viewer.exe` ＋ `_internal/`。
- `console=False`（windowed）、`upx=False`、`uac_admin=False`、アイコンは `assets/icons/app_icon.ico`（`spec:60-73`）。

### 4.2 PyInstaller: デバッグ版（`lol-viewer-debug.spec`）
- datas と hiddenimports はリリース版と同じ。
- **onefile**（binaries/zipfiles/datas を EXE に直接入れる、COLLECT なし、`debug.spec:55-76`）。
- 名前 `lol-viewer-debug`、`console=True`、`upx=True`、`runtime_tmpdir=None`、アイコンは同じ。
- 実行ファイル名の `debug` がそのままロギングのスイッチになっている（§2）。

### 4.3 アセット（`assets/icons/`）
- `app_icon.ico`: 16x16 と 24x24 などを含む 4 サイズ。exe、セットアップ、アンインストール表示のアイコン。
- `main-icon.png`: 1024x1024 RGB。ウィンドウアイコン。

### 4.4 Inno Setup（`lol-viewer.iss`）
- AppName「LoL Viewer」、Publisher「kc7891」、URL は GitHub リポジトリ、ExeName `lol-viewer.exe`（`iss:4-8`）。
- **AppId `{8F7A2B3C-4D5E-6F7A-8B9C-0D1E2F3A4B5C}`**（`iss:13`）。アップグレードの同一性判定に使われる。新版では引き継がない（M-003）。
- `DefaultDirName={autopf}\LoL Viewer`、ディレクトリ選択ページを表示（`DisableDirPage=no`）、グループ名は「LoL Viewer」、グループ選択ページは非表示（`iss:20-23`）。
- 権限は **`PrivilegesRequired=lowest` ＋ `PrivilegesRequiredOverridesAllowed=dialog`**（`iss:32-33`）。既定は非管理者のユーザー単位インストールで、`{autopf}` は `%LOCALAPPDATA%\Programs\LoL Viewer` になる。ダイアログで全ユーザー向けも選べる。
- x64 のみ（`ArchitecturesAllowed/InstallIn64BitMode=x64`）。
- 出力: `installer_output/lol-viewer-setup.exe`、LZMA の solid 圧縮（`iss:24-27`）。
- `SetupIconFile=assets\icons\app_icon.ico`、`UninstallDisplayIcon={app}\lol-viewer.exe`。
- **`CloseApplications=no`**: Vanguard のクラッシュ対策（`iss:35-37`）。`RestartApplications` は二重起動を避けるため使わない（`iss:38-39`）。`UsePreviousLanguage=yes`（`iss:41`）。
- 言語は English と Japanese（`iss:43-45`）。
- タスク: デスクトップアイコン（既定はオフ、`iss:47-48`）。
- Files: `dist\lol-viewer\*` を `{app}` へ再帰的にコピー（ignoreversion）（`iss:50-52`）。
- アイコン（ショートカット）: スタートメニューに本体とアンインストール、任意でデスクトップ（`iss:55-58`）。
- Run: インストール後に起動（`nowait postinstall`、`skipifsilent` なし）。サイレントインストールでも再起動される（`iss:60-63`）。
- UninstallDelete: `{app}` を丸ごと削除、`{localappdata}\LoLViewer\cache` も削除。QSettings（レジストリ）は意図的に残す（`iss:65-68`）。

### 4.5 配布物
- Release アセット: `lol-viewer-setup.zip`（中身は `lol-viewer-setup.exe`、`release.yml:304-316`）。
- nightly.link: artifact `lol-viewer-setup`（中身は exe、nightly.link が zip に包む）。README.md:24-35 では「Fast Download」として案内している。
- 対応 OS: Windows 10/11 64bit、追加ソフト不要（README.md:37-40）。
- `.gitignore` で `dist/`, `build/`, `installer_output/`, `*.zip`, `*.zip.part*`, `*.part[a-z][a-z]`, `release/`, `*.log`, `logs/`, `*.manifest`, `.claude/settings.local.json` などを除外（`.gitignore:1-49`）。CONTRIBUTING.md:201-211 は exe をコミットしない方針。「50MB を超える場合は分割 zip ＋結合 bat」という古いルールも残っている。

### 4.6 依存関係（`pyproject.toml` / `requirements*.txt`）
- PEP 735 の `[dependency-groups]` だけで定義し、`[project]` は置かない（`pyproject.toml:1-25`）。
- **runtime**（`pyproject.toml:33-63`）:
  - PyQt6, PyQt6-Qt6, PyQt6-WebEngine, PyQt6-WebEngine-Qt6 をすべて `>=6.11.0,<6.12` に固定。
    - 理由: 4 つの wheel の major.minor が揃っていないと、Windows で `DLL load failed ... procedure not found` になる。上限 `<6.12` は WebEngine 6.12 が未リリースのため。上限は 4 つまとめて上げる。`tests/test_dependency_lock.py` でこの整合を強制している（`pyproject.toml:34-47`）。
  - `requests>=2.33.0`（GHSA-gc5v-m9x4-r6x2）、`urllib3>=2.7.0`（GHSA-qccp-gfcp-xxvc、プロキシ経由のリダイレクトで認証ヘッダが漏れる問題。LCU リクエストに直接関係する）。
  - `psutil>=7.2.2`（LCU のプロセス検出）、`packaging>=26.0`（updater のバージョン比較）、`segno>=1.6.6`（QR コード）。
- **dev**（`pyproject.toml:66-78`）: runtime を include（外すと pip-audit の対象から黙って漏れる）、`pytest>=9.0.3`（GHSA-6w46-j5rx-g56g）、`pytest-qt>=4.5.0`、`pyinstaller>=6.22.3`、`beautifulsoup4>=4.15.0`（fetch_champions 用）。
- **ci**（`pyproject.toml:91-100`）: runtime を含まない（軽量にするため）。`requests`, `packaging`, `pip-audit>=2.9.0`, `uv>=0.12.0`（ロックを生成するツール自体もハッシュで固定する）。
- 主な固定バージョン（`requirements.txt`）:

  | パッケージ | バージョン |
  |---|---|
  | pyqt6 | 6.11.0 |
  | pyqt6-qt6 | 6.11.2 |
  | pyqt6-webengine | 6.11.0 |
  | pyqt6-webengine-qt6 | 6.11.2 |
  | pyqt6-sip | 13.13.0 |
  | requests | 2.34.2 |
  | urllib3 | 2.8.0 |
  | psutil | 7.2.2 |
  | packaging | 26.3 |
  | segno | 1.6.6 |
  | pyinstaller | 6.22.3 |
  | pytest | 9.2.0 |
  | pytest-qt | 4.5.0 |
  | beautifulsoup4 | 4.15.0 |

  - `requirements-ci.txt`: pip-audit 2.10.1、uv 0.13.7 など。
- ロック生成コマンド: `uv pip compile --universal --generate-hashes --python-version 3.11 --group dev|ci -o ...`（`pyproject.toml:16-17`）。`--universal` は必須（テストは Linux、ビルドは Windows）。`pyproject.toml` を入力引数として渡してはいけない（CONTRIBUTING.md:262-286）。
- Python は 3.11（全ワークフロー共通。CONTRIBUTING では 3.11 以上）。

---

## 5. CI/CD（GitHub Actions）

全 action をコミット SHA で固定し、行末に `# vX.Y.Z` のコメントを付けている（CONTRIBUTING.md:332-338）。更新は Dependabot が担う。

### 5.1 `release.yml` 「Automatic Release」
- トリガー: main への push、main 向け PR（**dry-run**、`DRY_RUN = event_name == 'pull_request'`）、`workflow_dispatch`（入力 `version_type`: patch/minor/major）（`release.yml:3-22`）。
- **job `release`**（ubuntu、`contents: write`）:
  1. 全履歴を checkout し、`requirements-ci.txt` をハッシュ検証付きでインストール（`:35-47`）。
  2. bump 種別を決める（`:49-77`）。手動実行なら入力値。それ以外は「最新タグ..HEAD」のコミットメッセージ本文全体を見る。
     - `grep -qiE "BREAKING CHANGE|!:"` → major（大文字小文字無視、本文のどこにあっても該当）。
     - `^feat(\(.*\))?:` → minor。
     - それ以外 → patch。
  3. 最新タグ（無ければ `v0.0.0`）から `packaging` で新バージョンを計算（`:79-109`）。
  4. タグ `v<new>` がすでにあれば以降をスキップ（`:111-120`）。
     - 補足（2026-11-22 修正）: `constants.py` がすでに新しい版になっている場合（前回の run が bump コミットを push したあと、タグの push で失敗した場合）は、コミットを省略して現在の HEAD にタグを付ける。以前は「nothing to commit」で失敗し続けていた（v0.33.1 のタグ push が GitHub 側の一時エラーで失敗した 2026-11-03 以降、リリースが止まっていた）。
  5. `constants.py` を sed で書き換え、書き換わったか確認（`:122-137`、PR の dry-run でもここまでは実行）。
  6. （dry-run でなければ）以下を順に実行（`:139-198`）:
     - github-actions[bot] として `chore: bump version to X` をコミットして main へ push。
     - SHA を出力。
     - 注釈付きタグ `vX`（`Release vX`）を作って push。
     - リリースノートを生成: `## What's Changed` ＋ 前のタグ..HEAD の `* %s (%h)` ＋ Full Changelog の比較リンク。
     - softprops/action-gh-release で Release を作成（draft=false、prerelease=false）。
  7. dry-run のサマリ、または通常のサマリを出力。
- **job `build-installer`**（windows-latest、`needs: release`、タグが無く PR でない場合だけ）（`:233-344`）:
  1. version bump コミットの SHA を checkout し、SHA の一致を検証。
  2. Python 3.11、`requirements.txt` をハッシュ検証付きでインストール。
  3. **`python scripts/fetch_champions.py` でビルド時に champions.json を作り直す**（`:268-271`）。リポジトリにコミットされている json は上書きされる。
  4. `scripts/check_build.py` → `pyinstaller lol-viewer.spec`。
  5. `constants.__version__` と期待するバージョンを照合（一致しなければ失敗）→ `.iss` の `MyAppVersion` を置換。
  6. Minionguyjpro/inno-setup-action でインストーラを作る → `Compress-Archive` で zip 化 → Release にアップロード（zip）→ `actions/upload-artifact` で `lol-viewer-setup`（exe、90 日保持）を上げる（nightly.link 用）。
- 補足:
  - `GITHUB_TOKEN` で push した bump コミットではワークフローは再起動しない（GitHub の仕様）。
  - champions 更新 PR や lock 更新 PR を main にマージするだけでも patch リリースが走る（非 conventional なメッセージは patch 扱い）。
  - DEV.md:228 では「マージから約 10 分」。

### 5.2 `windows-build.yml` 「Windows Build」
- トリガー: main 向け PR だけ（`:3-5`）。
- 手順: 依存をインストール → **Qt WebEngine の import スモークテスト**（`from PyQt6 import QtCore, QtWebEngineCore, QtWebEngineWidgets`。Linux のテストでは WebEngine を無効にしているため、DLL の不整合はここでしか検出できない、`:26-30`）→ `fetch_champions.py` → `check_build.py` → `pyinstaller lol-viewer.spec` → `.iss` のバージョンを置換（照合なし）→ Inno → zip → artifact `lol-viewer-setup`（zip、90 日保持、`:66-71`）。
- `permissions: contents: write` が付いているが、使われていない（コメントには「Required for uploading to releases」とある）。

### 5.3 `python-tests.yml` 「Python Tests」
- トリガー: main 向け PR、main への push、**毎週月曜 00:00 UTC**（新しく公開された脆弱性を検出するため）、手動（`:3-12`）。
- **job `tests`**（ubuntu、20 分）: pip cache あり → apt で `xvfb libegl1 libgl1` → `requirements.txt` をハッシュ検証付きでインストール → ヘッドレス用の環境変数（§3）を付けて `xvfb-run -a pytest -q`（`:15-50`）。
- **job `audit`**（独立。tests が赤でも報告させるため）: `pip-audit --disable-pip -r requirements.txt -r requirements-ci.txt`（`:54-72`）。

### 5.4 `update-champions.yml` 「Update Champion Data」
- トリガー: **毎週月曜 09:00 UTC（日本時間 18:00）**、手動（`:3-7`）。
- `requirements-ci.txt` を入れ、**インラインの Python で Data Dragon から取得する**（`scripts/fetch_champions.py` とは別のコード、`:29-108`）:
  - `api/versions.json[0]` で最新パッチを得る → `cdn/<v>/data/en_US/champion.json` と `ja_JP` を取得。
  - key は `champ_id.lower()`。**MonkeyKing はそのまま `monkeyking`** になる。
  - 値は `{english_name, japanese_name（ja が無ければ en）, image_url: cdn/<v>/img/champion/<id>.png, id}`。
  - `champion_lane.csv`（`name,top,jg,mid,bot,sup`）を key で突き合わせて `lanes` を付ける。不正な行は飛ばし、無い場合や CSV 自体が無い場合は全 0。
  - `champions.json` に `ensure_ascii=False, indent=2` で書き出し、`version.txt`（パッチと件数）も書く。
- peter-evans/create-pull-request で PR を作る: ブランチ `automated/update-champions`、タイトル `Update Champion Data to v<patch>`、ラベル `automated` と `data-update`、英語の本文（`:119-148`）。
  - `GITHUB_TOKEN` で作った PR では checks が自動起動しない。

### 5.5 `lock-refresh.yml` 「Refresh Dependency Locks」
- トリガー: **毎週月曜 06:00 UTC**（Dependabot の週次実行の後）、手動（`:11-16`）。
- `requirements-ci.txt` から uv を入れる → `uv pip compile --universal --generate-hashes --upgrade ...` を dev と ci で実行 → PyQt6 の整合チェック（`tests.test_dependency_lock` の 2 関数を直接呼ぶ。失敗したら PR を作らない）→ `name==version` 行の差分だけを集める → 差分があれば PR（`:28-112`）。
- PR: ブランチ `automated/refresh-locks`、`chore(deps): refresh dependency locks`、日本語の本文に diff を載せ、「checks を走らせるには close → reopen」と案内する。

### 5.6 `dependabot.yml`
- pip（`/`、毎週月曜）: **`open-pull-requests-limit: 0`** でバージョン更新 PR を止め、security update だけ届くようにしている。prefix は `chore(deps)`。グループは `pyqt`（`PyQt6`, `PyQt6-*`）と `tooling`（pytest*, pyinstaller, beautifulsoup4, pip-audit）（`dependabot.yml:20-48`）。
- github-actions（毎週月曜）: prefix `chore(actions)`、全 action を 1 グループ `actions` にまとめる（`:50-60`）。
- 担当の分け方（CONTRIBUTING.md:296-320）: ルーチンの更新は lock-refresh、脆弱性対応は Dependabot（`>=` の下限を上げるだけ。実際に反映するには lock-refresh を手動実行する）、Actions は Dependabot。

### 5.7 チャンピオンデータ生成スクリプト `scripts/fetch_champions.py`（ビルド時と開発者が使う）
1. まず公式サイト `https://www.leagueoflegends.com/en-us/champions/` と `ja-jp` を BeautifulSoup でスクレイプする（`:124-130`）。
   - `champions` という文字列を含む script タグから、正規表現 `(\[.*?\]|\{.*?\})` で JSON を抜き出すか、`__NEXT_DATA__` を読む（`:13-59`）。
   - `id` と `name` を持つ dict を再帰的に探して `{name, image}` を集める（`:62-114`）。
   - 1 件以上取れたらそれを使う。この場合 **`lanes` が付かず**、image も Data Dragon 以外になる（`:146-159`）。スクレイプが実際に何を返すかは要確認。
2. 例外が出るか 0 件なら、**Data Dragon にフォールバック**する（`:201-272`）。
   - インライン版とほぼ同じだが、**`monkeyking` を `wukong` に改名する**（`:240-242`）。
   - `champion_lane.csv` から lanes を取り込み（`load_lane_data`、`:164-198`）、CSV に無いものは全 0 にしてログを出す。
3. 結果を `champions.json` に保存（`:275-288`）。終了コードは 0 か 1。

- **不整合（要確認）**: リポジトリの champions.json（週次ワークフローの生成物）は key が `monkeyking` で lanes が全 0（CSV 側は `wukong,5,0,0,0,0`）。一方リリースビルドでは fetch_champions.py が再生成するので key は `wukong` になる可能性がある。`tests/test_viewer_quick_opponent.py:101-105` は `"Wukong" → "monkeyking"` を固定しており、`lcu_detector.py:283-285` は `MonkeyKing → Wukong` のエイリアスを持つ。
- 現在の champions.json は 173 件、パッチ 16.21.1。

### 5.8 その他のスクリプト
- `scripts/check_build.py`: `main.py`, `champion_data.py`, `logger.py`, `champions.json`, 両方の spec があるか、json として読めて件数があるかを確認する。失敗なら exit 1（`:10-76`）。CI のビルド前に実行。
- `scripts/clean_build.py`: `build/` と `dist/` を削除（`:10-30`、`*.spec~` は定義されているが未使用）。

---

## 6. 開発フロー

- **commit-msg フック**（`.githooks/commit-msg`）:
  - `^Merge branch` と `^Revert` で始まるものは素通し（`:14-22`）。
  - 正規表現 `^(feat|fix|docs|style|refactor|test|chore|ci|perf)(\(.+\))?: .{3,}$` に `grep -E` で照合する。行単位なので、**どれか 1 行が合えば通る**（`:26-28`）。
  - 拒否するときは種別の説明と bump ルール（feat→minor、それ以外→patch、本文に `BREAKING CHANGE:` があれば major）を表示（`:29-66`）。
- `setup-hooks.sh`: `chmod +x` してから `git config core.hooksPath .githooks`。`setup-hooks.bat`: Windows 版、最後に pause。
- CONTRIBUTING.md:
  - Python 3.11 以上。クローン後にフックを必ず導入し、`pip install -r requirements.txt` → `python main.py`。ブランチ名は `feature/...`。
  - PEP 8、型ヒント、docstring。
  - Conventional Commits 必須。破壊的変更は `!` か `BREAKING CHANGE:`。
  - 古い記述: 手動ビルドの `pyinstaller --onefile --windowed`（:85-92）、プロジェクト構成（:94-108）、「テストは実装中」（:189-197）。
  - 依存関係の更新ルール（:233-338）。
- DEV.md:
  - **Feature Flags の運用**（:68-92）: 定義は `constants.FEATURE_FLAG_DEFINITIONS`、保存先は QSettings `feature_flags/<key>`、Settings 下部に UI。既定は OFF、OFF でもアプリが使えること。flag で分けられない変更（起動パス、updater の中核フローなど）は依頼者に確認する。
  - ビルド手順（:94-171）、Auto-Update の説明（:173-298、一部は実装と合わない）、`python tests/quick_test_update.py`。
- claude.md: AI 生成だけで作られたプロジェクト。Windows ユーザーを想定し、テストを通してからコミットする。

---

## 7. テストスイートの振る舞い仕様（指定ファイル）

| ファイル | 固定している振る舞い |
|---|---|
| `tests/test_updater.py` | 新しいバージョンなら `(True, info)`。同じか古いバージョンでも `release_info` を返す（UI 表示用）。例外なら `(False, None)`。テスト中は Release アセットから `sys.argv[0]` に応じて通常版か debug 版の exe URL を選び、無ければ `None`。`_create_update_script` は timeout と move を含む .bat を生成する。 |
| `tests/test_update_check.py` | 名前は test_ だが、モックなしで **実際の GitHub API を叩く** 手動確認用スクリプト（current=0.1.0）。アサーションは無く、pytest でも収集されて実行される。結果の出し分けは「更新あり（DL URL も確認）」「`release_info is None` は接続失敗」「最新」。 |
| `tests/quick_test_update.py` | Qt を使わず API に直接アクセスする手動確認。アセットの名前、サイズ、DL 数とリリースノート 300 文字を表示。`test_` で始まらないので収集されない。DEV.md で案内されている。 |
| `tests/test_dependency_lock.py` | `requirements.txt` に PyQt6 系 4 パッケージが全部固定されていて、major.minor が一致していること。lock-refresh.yml からも直接呼ばれる。 |
| `tests/conftest.py` | テストセッション中は `LOL_VIEWER_ICON_CACHE_DIR` を一時ディレクトリに向け、利用者の実際のアイコンキャッシュに触れない。終了時に削除する。 |
| `tests/test_main.py` | build と counter の URL は `https://lolalytics.com/lol/{name}/build/` と `/counters/`（大文字はそのまま）。Viewer のボタン表記は Build と Counter、プレースホルダに "Champion name"、表示名は `(Empty)` かチャンピオン名。ChampionData は英語・日本語・部分一致・大文字小文字無視で検索でき、必須フィールドは english_name, japanese_name, image_url, id。MainWindow はタイトル "LoL Viewer"、1600x900、初期 viewer 0、add/close/hide/close_all が動き、上限は MAX_VIEWERS=20。Opponent 欄は空のときクリックすると他の viewer で開いているチャンピオンの候補に切り替わり、補完は champion id を挿入する。 |
| `tests/test_chromium_timing.py` | AST 検査: `on_champion_detected` は add_viewer、hide_viewer、open_*、setUrl を直接呼ばず、`_schedule_auto_viewer_creation` を経由すること。`_create_ally_viewer` は hide_viewer を直接呼ばないこと。実行時の検査: 敵を検出したら viewer を作らず `pending_enemy_picks` に積む、味方の検出は `QTimer.singleShot(0)` で遅延させる、materialize で pending から除く、新セッションで pending をクリアする（PR #103〜105 のクラッシュ対策）。 |
| `tests/test_live_game_refresh.py` | Live Game タブを右クリックするとメニュー項目は "Refresh" の 1 つだけで、設定済み URL（無ければ DEFAULT_LIVE_GAME_URL）を再読み込みする。他のタブと無効な index では None を返す。タブバーは CustomContextMenu。 |
| `tests/test_matchup_features.py` | matchup URL テンプレートの既定値とカスタム値。開いているチャンピオン候補は重複を除き自分を除外する。matchup の 5 行: 味方はレーン別に配置、レーン不明なら順番に、埋まっていれば最初の空き行、敵はレーン適性で配置。繰り返し emit しても重複しない、空や部分的な信号では消さない、新セッションと Refresh で全クリア。ブラインドピックの空き行埋め、敵の swap、クリア。DnD は同じ側どうしの入れ替えだけで、同じ行・範囲外・不明な側では何もしない。デバッグ用の追加（空きが無ければ何もしない、Refresh でクリア）。 |
| `tests/test_viewer_quick_opponent.py` | Viewer のヘッダは Lane が先頭（close / Lane / Champion / vs / Opponent / quick-pick 最大 5 個）。quick-pick は CURRENT MATCHUP の敵だけから作り、行順を保ち、空行は飛ばし、重複を除き、5 個まで。`Wukong` は `monkeyking` に解決する。古い detector の名前は混ぜない。Refresh 直後は他タブのフォールバックを使う。選択中の Opponent のボタンは隠して残りを左に詰め、None に戻すと再表示する。index の整合を保つ。ボタンは自然幅で、ラベルは省略表示（前方一致で短くなる）、伸びすぎない。 |
| `tests/test_completer_ui.py` | pytest のテストではない（test_ 関数が無い）。補完を手で確かめる GUI。ChampionData を読み込み、`setup_champion_input` で英語・日本語の補完を設定し、入力のたびに一致件数を表示する。 |

---

## 8. 移植チェックリスト

- [ ] 単一のバージョン値（現在は `constants.__version__`）をアプリ内に埋め込み、Settings に「Current version」として表示する
- [ ] git タグを正とするセマンティックバージョニング（vX.Y.Z）
- [ ] 起動から約 100ms 後に非同期で最新バージョンを確認する（プロンプトは出さない）
- [ ] Settings タブを開いたときにも確認する（1 セッション 1 回に重複を抑える。実行中の重複も防ぐ）
- [ ] 確認先は GitHub Releases API の `/releases/latest`（tag_name から `v` を除く）。タイムアウトは 5 秒
- [ ] PEP 440 互換の比較（latest > current のときだけ更新あり）。確認成功時は最新でもリリース情報を返す
- [ ] 確認に失敗したら「Latest version: Unable to check」と「⚠ Could not connect to update server」を出す。例外時は「Error」
- [ ] 「Latest version: X」と「✓ New version available!」/「✓ You have the latest version」を色分けして表示する
- [ ] 新しいバージョンがあるとき、Settings タブに赤い「●」インジケータを付ける（UI サイズに追従）
- [ ] 手動の「Check for Updates」ボタン（実行中は無効化して「Checking...」表示、終わったら再確認して表示を揃える）
- [ ] 更新プロンプト（現在と最新のバージョン、リリースノート先頭 200 文字、Yes/No、既定は Yes）
- [ ] 拒否した場合は何もしない（スキップや無効化の設定は現状なし。新しく作るかは要判断）
- [ ] ダウンロード元は nightly.link（アジア向けの高速 DL）。環境変数で GitHub Release アセットに切り替えられる
- [ ] nightly.link と Release のバージョンがずれるリスクへの対処（要検討。現状は許容）
- [ ] キャンセル不可のモーダル進捗ダイアログ（MB と % を表示）。タイムアウトは 300 秒、ストリーミング DL
- [ ] DL 失敗時に「Download Failed」ダイアログ
- [ ] zip から setup exe を展開する（`__MACOSX` は除外）。失敗時はエラーダイアログ
- [ ] スクリプト実行時（exe でないとき）は自動適用せず、手動実行を案内する
- [ ] 「Update Ready」の案内を出してからインストーラを起動し、`/NORESTART /DIR=<現在のインストール先>` を渡す（引用符を埋め込まない）
- [ ] `/CLOSEAPPLICATIONS` は付けない（Vanguard 対策）。現状はサイレントフラグも付けていないのでウィザードが出る
- [ ] インストーラを起動したらアプリを即座に終了し、インストーラ側で再起動する
- [ ] 前回のインストール言語を引き継ぐ（UsePreviousLanguage）
- [ ] 起動失敗時に「Update Failed」ダイアログを出す（DL したファイルのパスを示す）
- [ ] League/Vanguard の実行中チェック（.iss のコメントに書かれているだけで未実装。要確認・要判断）
- [ ] テスト、ヘッドレス、ダイアログ無効化の環境では更新チェックを抑止する
- [ ] 標準ロガー: INFO（debug 時は DEBUG）をコンソールへ。debug 時は `logs/lol_viewer_<timestamp>.log` へ起動ごとに新規出力
- [ ] 独自ロガー: debug exe かスクリプト実行時に `lol_viewer_debug.log` を exe の隣へ（起動ごとに上書き、ヘッダとミリ秒タイムスタンプ付き）
- [ ] 実行ファイル名に `debug` を含むかでデバッグモードを切り替える
- [ ] ログのローテーションなし（新しい実装で方針を決める）
- [ ] 環境変数: LOL_VIEWER_DISABLE_WEBENGINE / DISABLE_LCU_SERVICE / DISABLE_DIALOGS / USE_RELEASE_ASSETS / ICON_CACHE_DIR、PYTEST_CURRENT_TEST、QT_QPA_PLATFORM による無効化
- [ ] Web ビューを使わない代替表示（ヘッドレスや CI 向けの NullWebView 相当）
- [ ] エントリポイント: ロガー初期化 → アプリ生成 → メインウィンドウ（タイトル "LoL Viewer"、1600x900、アイコン main-icon.png）→ イベントループ。未処理例外はログに出して exit 1
- [ ] 終了時に LCU 検出サービスを止める
- [ ] 設定は QSettings("LoLViewer","LoLViewer")、Windows ではレジストリ。アンインストール後も残す
- [ ] アイコンのディスクキャッシュ `%LOCALAPPDATA%\LoLViewer\cache\champion_icons`（アンインストール時に削除）
- [x] ~~app/org 名を設定していない現状の保存パスとの互換~~ 旧データを引き継がないので不要（M-003）
- [ ] 多重起動の防止、AppUserModelID、High-DPI の明示設定、WebEngine フラグはいずれも現状なし（新スタックで要判断）
- [ ] リリースビルド: onedir、windowed、UPX なし、app_icon.ico、champions.json とアイコン PNG を同梱、VC++ ランタイム不要
- [ ] デバッグビルド: onefile、コンソール付き、UPX あり、exe 名 `lol-viewer-debug`
- [ ] ビルド前チェック（必須ファイルの存在と champions.json の妥当性）
- [ ] ビルド成果物を消すスクリプト（build/ と dist/）
- [x] ~~Windows インストーラ: AppId の引き継ぎ~~ 新しい AppId を使う。旧版からのアップグレードは考えない（M-003）
- [ ] インストーラ: 既定は非管理者のユーザー単位インストール（`{autopf}\LoL Viewer`）。ダイアログで全ユーザー向けに昇格できる。ディレクトリは選べる。x64 のみ
- [ ] インストーラ: 英語と日本語の UI、スタートメニューのショートカットとアンインストールのショートカット、任意のデスクトップアイコン（既定はオフ）
- [ ] インストーラ: インストール後に起動（サイレント時も）。CloseApplications=no、RestartApplications は使わない
- [ ] アンインストール: `{app}` と `%LOCALAPPDATA%\LoLViewer\cache` を削除し、設定は残す
- [ ] 出力名 `lol-viewer-setup.exe` を `lol-viewer-setup.zip` に包んで配布（Release アセット、nightly.link 用の artifact）
- [ ] インストーラのバージョンはビルド時にアプリのバージョンで上書きし、不一致なら失敗させる
- [ ] 依存関係: 直接依存（pyproject の dependency groups）と、ハッシュ固定のクロスプラットフォームロックの 2 層
- [ ] Qt と WebEngine 系パッケージのバージョンをそろえる（相当するものがあれば）、CI で強制する
- [ ] セキュリティ上の下限バージョン（requests、urllib3、pytest）の考え方を引き継ぐ
- [ ] CI: PR と main への push でヘッドレスのテスト（xvfb、offscreen、WebEngine と LCU とダイアログを無効化）
- [ ] CI: 依存の脆弱性監査（pip-audit 相当）をテストとは別ジョブにし、毎週月曜にも定期実行
- [ ] CI: PR ごとに Windows ビルドを試す（WebEngine の import スモークテスト → データ取得 → ビルド → インストーラ → artifact を 90 日保持）
- [ ] リリース: main に push すると Conventional Commits から bump 種別を決める（BREAKING CHANGE や `!:` は major、feat は minor、それ以外は patch）
- [ ] リリース: 手動実行で bump 種別（patch/minor/major）を指定できる
- [ ] リリース: PR では dry-run（バージョン計算と書き換えの確認だけ）
- [ ] リリース: タグがすでにあればスキップ
- [ ] リリース: バージョンファイルを書き換えて bot コミット → push → 注釈付きタグ → 自動のリリースノート（前のタグからのコミット一覧と比較リンク）→ GitHub Release
- [ ] リリース: bump コミットの SHA で Windows ビルドし、SHA とバージョンを照合 → インストーラ zip を Release にアップロード → nightly.link 用の artifact（exe、90 日）
- [ ] リリース時にチャンピオンデータを取得し直してから同梱する（現状は fetch_champions.py）
- [ ] 週次（月曜 09:00 UTC）のチャンピオンデータ自動更新: Data Dragon の最新パッチから en_US と ja_JP を取得し、champion_lane.csv の lanes をマージ → champions.json → PR（automated/update-champions、ラベル automated と data-update）
- [ ] champions.json の形式: key は小文字の id、値は `{english_name, japanese_name, image_url（ddragon の版付き URL）, id, lanes{top,jg,mid,bot,sup}}`
- [ ] Wukong と MonkeyKing の key を統一する: 内部は `wukong`、生成処理は 1 つにする（M-004）
- [ ] 公式サイトのスクレイピング経路（fetch_champions.py）を残すか捨てるか判断（lanes が欠落するリスクあり）
- [ ] 週次（月曜 06:00 UTC）のロック再生成: upgrade で再コンパイル → Qt の整合チェック → バージョン差分を本文に載せて PR（automated/refresh-locks）
- [ ] Dependabot: pip は security update だけ（バージョン更新 PR は 0 件）、グループは pyqt と tooling。github-actions は週次で全体を 1 グループ
- [ ] 全 GitHub Action を SHA で固定（コメントでバージョンを併記）
- [ ] GITHUB_TOKEN で作った自動 PR では checks が起動しない。close して reopen するよう案内する
- [ ] commit-msg フック（Conventional Commits の 9 種別、scope は任意、説明 3 文字以上、Merge と Revert は除外）と、そのセットアップスクリプト（sh と bat）
- [ ] Feature Flag の運用（定義を一か所に集める、設定に保存する、Settings に UI、既定は OFF、flag で分けられない変更は依頼者に確認）
- [ ] README の配布案内（Fast Download は nightly.link、通常は Releases、インストール手順、Windows 10/11 64bit）
- [ ] .gitignore の方針（ビルド成果物、zip、ログ、インストーラ出力をコミットしない）
- [ ] 更新確認用の手動スクリプト（quick_test_update 相当）
- [ ] テストで利用者の実データ（アイコンキャッシュなど）に触れないよう分離する（conftest 相当）
- [ ] §7 のテスト仕様（updater の比較と DL URL の選択、Chromium タイミングの遅延、Live Game の Refresh メニュー、matchup の配置と DnD、quick-pick ヘッダ、補完）を新しいスタックのテストとして書き直す
- [ ] ドキュメントと実装のずれを解消する（「起動時に自動で更新を促す」「サイレント更新」「main.py の bump」「Vanguard のプロセス確認」「Release に exe 添付」は、いずれも実装と合っていない）
