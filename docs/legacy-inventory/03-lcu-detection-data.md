# C. LCU 連携・チャンピオン検知・チャンピオンデータ 機能インベントリ

> 統合版の索引・全体概要は [README.md](./README.md) を参照。

対象: `lcu_detector.py`（1155行）, `champion_data.py`（715行）, `champions.json`, `champion_lane.csv`, `design/build-detect.md`, `plan-champion-lane-integration.md`, `scripts/fetch_champions.py`, `.github/workflows/update-champions.yml`, 関連テスト。
参照は `ファイル:行`。コードから読み取った事実を優先し、推測は（要確認）と明記。

---

## 0. 全体像（要点）

- LCU 接続は **プロセスのコマンドライン解析のみ**（psutil）。lockfile・WebSocket・Live Client Data API（127.0.0.1:2999）は **設計書にあるだけで実装なし**。
- 通信は `requests` の **同期 HTTPS GET**（`verify=False`、timeout 2 秒）を **Qt メインスレッド上の QTimer** から実行。専用スレッドなし。
- 検知は **ポーリング**（基本 2 秒、クライアントがないときは 60 秒まで指数バックオフ、10 体揃った後は「ウォッチモード」で 5 秒/15 秒）。
- 使う LCU エンドポイントは 3 つ: `/lol-gameflow/v1/session`, `/lol-champ-select/v1/session`, `/lol-summoner/v1/current-summoner`。外部は Data Dragon（ID→名前マップ）だけ。
- UI へは Qt シグナル 6 種（うち `matchup_pairs_updated` は宣言だけで一度も emit されない）。
- `champion_data.py` は champions.json の読み込み、検索（部分一致）、QCompleter による補完、アイコンのメモリ/ディスクキャッシュ（SHA-256 ファイル名、アトミック書き込み、起動時 prune）を担当する。
- `champion_lane.csv` は **アプリ実行時には読まれない**。GitHub Actions が週 1 回 champions.json を生成するときに `lanes` フィールドとして埋め込む。

---

## 1. LCU 接続（`LCUConnectionManager`）

### 1.1 状態
- `port: Optional[str]`, `password: Optional[str]`, `connected: bool`（`lcu_detector.py:48-53`）。初期化時にログ出力。

### 1.2 クライアントの発見（プロセススキャン）
- `_get_lcu_credentials_from_process()`（`lcu_detector.py:77-98`）
  - `psutil.process_iter(['name', 'cmdline'])` で全プロセスを列挙する。
  - 名前が `LeagueClientUx.exe` **または** `LeagueClientUx`（拡張子なし。macOS など向けと思われる）のものだけを見る（`:81`）。
  - `cmdline` のリストを空白で連結し、正規表現で 2 つの値を取り出す:
    - ポート: `--app-port=(\d+)`（`:85`）
    - 認証トークン: `--remoting-auth-token=([\w-]+)`（`:87`）。英数字・`_`・`-` のみ。
  - 両方見つかった最初のプロセスで `{'port': str, 'password': str}` を返す（`:89-94`）。port は **文字列のまま**保持する。
  - 例外（AccessDenied、`cmdline` が None で join 失敗など）は try 全体で捕捉され、**残りのプロセスを見ずに None を返す**（`:95-98`）。権限のないプロセスが先に出てくるとスキャン全体が失敗する可能性がある（要確認・潜在バグ）。
- `is_client_running()`（`:100-108`）
  - `psutil.process_iter(['name'])` で、名前が `LeagueClient.exe` **または** `LeagueClientUx.exe` のものがあれば True。
  - **拡張子なしの名前（`LeagueClientUx`/`LeagueClient`）は含まれない**。そのため Windows 以外では `is_client_running()` が常に False になり、`_check_champion` は接続まで進まない（`:1032-1043`）。実質 Windows 専用（要確認）。
  - 例外時はログを出して False。
- `connect()`（`:55-75`）: 資格情報を取れたら `port`/`password` を設定して `connected=True`、取れなければ `connected=False`。例外時も False。
- **lockfile 方式（`LeagueClient:<PID>:<PORT>:<PASSWORD>:<PROTOCOL>`）は未実装**。代替案として `design/build-detect.md:96-131` に記載があるだけ。
- **Windows 固有 API（WMI、win32api など）は使っていない**。psutil のみ。

### 1.3 認証
- `get_auth_header()`（`:122-126`）: `"riot:" + password` を Base64 にして `Basic <b64>` を作る。ユーザー名は固定で `riot`。
- テストは `Basic ` で始まることだけを検証している（`tests/test_lcu_detector.py:75-82`）。

### 1.4 HTTPS リクエスト
- `make_request(endpoint)`（`:128-152`）
  - `connected` が False、または port/password が空なら、リクエストせずに None（`:130-131`。テスト `test_make_request_not_connected`）。
  - URL は `https://127.0.0.1:{port}{endpoint}`。ホストは固定で `127.0.0.1`（localhost 名ではない）。
  - ヘッダーは `Authorization` だけ。メソッドは GET のみ（POST/PUT/PATCH は使わない）。
  - `verify=False`（Riot の自己署名証明書のため）、`timeout=2`（`:138`）。
  - 証明書警告の抑制は **このリクエストに限定**する。`_allow_self_signed_cert()` コンテキストマネージャー（`:26-39`）が `warnings.catch_warnings()` の中で `InsecureRequestWarning` だけを無視する。プロセス全体の `urllib3.disable_warnings()` は**意図的に使わない**（他のリモート HTTPS の警告を消さないため。docstring `:28-36`）。
  - 応答の扱い:
    - 200: `response.json()` を返す。
    - 200 以外（例: champ select 外での 404）: debug ログを出して None。**切断扱いにはしない**（`:142-144`）。
    - `requests.exceptions.RequestException`（接続拒否・タイムアウトなど）: `disconnect(reason)` して None（`:145-148`）。requests 2.27 以降は JSON デコード失敗（`requests.JSONDecodeError`）も RequestException のサブクラスなので切断扱いになる（要確認）。
    - その他の例外: error ログ、`disconnect`、None（`:149-152`）。
- `disconnect(reason="")`（`:110-120`）: 接続中だった場合だけ `Disconnected from LCU[: reason]` をログに出し、`connected/port/password` をリセットする。

### 1.5 再接続・バックオフ・ポーリング間隔（`ChampionDetectorService`）
| 定数/属性 | 値 | 用途 | 行 |
|---|---|---|---|
| `base_interval_ms` | 2000（`start(interval_ms)` で上書き。main_window は `start(interval_ms=2000)`） | 通常ポーリング | `:812`, `:945`, `main_window.py:383` |
| `max_interval_ms` | 60000（`max(interval, max_interval)`） | バックオフの上限 | `:813`, `:946` |
| `paused_interval_ms` | 5000 | ウォッチモード（ロビー/ChampSelect など） | `:815` |
| `in_game_watch_interval_ms` | 15000 | ウォッチモード（試合中系フェーズ） | `:816` |
| `WATCH_GAME_ID_CHECK_EVERY` | 4 tick | ウォッチ中の ChampSelect で gameId を確認する頻度（5 秒間隔なので約 20 秒ごと） | `:792` |
| `WATCH_SLOW_PHASES` | `GameStart, InProgress, WaitingForStats, PreEndOfGame, EndOfGame` | 15 秒間隔を使うフェーズ | `:791` |
| HTTP timeout | 2 秒（LCU）、10 秒（Data Dragon） | | `:138`, `:273`, `:279` |

- `_increase_backoff()`（`:986-995`）: クライアントプロセスがないとき、間隔を 2 倍にする（上限 max）。2→4→8→16→32→60 秒。
- `_reset_backoff()`（`:997-1002`）: プロセスがあり、ウォッチモードでなければ基本間隔に戻す（`:1046-1047`）。
- `_set_timer_interval(ms)`（`:974-984`）: 0 以下なら base を使う。値が変わったらログを出す。`running` の間は `timer.start(ms)` で再起動する（このとき次回発火までのカウントもリセットされる）。
- プロセスはあるが `connect()` に失敗した場合（例: LeagueClient.exe はあるが Ux がまだない）: 状態は `connecting` のまま、基本間隔で再試行する（`:1050-1056`）。
- 接続中に HTTP 例外が起きると `connected=False` になり、次の tick でプロセス再スキャンと再接続を行う（ポートやトークンの変更もこれで追従する）。

### 1.6 スレッドモデル
- `QTimer`（`:805-806`）の timeout で `_check_champion` を **GUI スレッド上で同期実行**する。HTTP は blocking（最長 2 秒 × 複数リクエスト）。専用のワーカースレッドや asyncio はない。
- 再入ガード: `is_checking` が True ならスキップ（`:1017-1019`）。`finally` で解除（`:1137-1138`）。
- `QCoreApplication.instance()` がなければ、自分で `QCoreApplication([])` を作る（テスト/ヘッドレス用、`:796-800`）。
- ChampionDetector の生成時に Data Dragon を **同期で取得**する（最大 10 秒 × 2）。これは MainWindow の `__init__` の中（`main_window.py:153`）なので、**起動時に UI がブロックされる**。

### 1.7 接続ステータス
- 値は `"connecting"`, `"connected"`, `"disconnected"` の 3 種（`:788`）。
- 初期値は `last_connection_status = "connecting"`（`:809`）。初期状態ではシグナルを出さない。
- `_set_connection_status(status)`（`:827-833`）: 値が変わったときだけ `connection_status_changed.emit(status)` する（重複は抑止）。
- 遷移のタイミング:
  - プロセスなし → `disconnected`（`:1041`）
  - プロセスあり・未接続 → `connecting` → `connect()` を試す（`:1051`）
  - 接続済み → `connected`（`:1059`）
  - 検知の途中で接続が切れた → `connecting`（`:1075`, `:1129-1130`）
  - 手動接続 → `connecting`（`:971`）
- UI 側（`widgets/status_widget.py:97-114`）の表示: `Riot API: Connected`（#00d6a1）/ `Riot API: Disconnected`（#e0342c）/ `Riot API: Connecting.`（#6d7a8a、ドットのアニメーション付き）。接続は `main_window.py:179`。

### 1.8 手動接続・開始・停止
- `start(interval_ms=2000, max_interval_ms=60000)`（`:937-951`）: `running=True`、`check_count=0`、`_polling_paused=False`、base/max/current を設定してタイマーを開始する。
- `stop()`（`:953-957`）: `running=False`、`timer.stop()`。`main_window.py:2592`（終了時）で呼ばれる。
- `manual_connect_attempt()`（`:959-972`）: 未起動なら `start()` して終了。起動済みならバックオフをリセットし、タイマーが止まっていれば再開し、ステータスを `connecting` にして `_check_champion(force=True)` を即時実行する。
  - UI 側（`main_window.py:2031-2048`）: ボタンを無効化して「Connecting...」と表示し、1.5 秒後に元に戻す。
- `force` 引数はデバッグログを出すだけで、`is_checking` ガードは迂回しない（`:1015-1016`）。
- 環境変数 `LOL_VIEWER_DISABLE_LCU_SERVICE=1`、または `PYTEST_CURRENT_TEST` があるとサービスを開始しない（`main_window.py:45-51, 379-383`）。

---

## 2. 使用エンドポイントと抽出フィールド

### 2.1 LCU（`https://127.0.0.1:{port}`、Basic 認証）
| エンドポイント | 呼び出し元 | 抽出フィールド |
|---|---|---|
| `GET /lol-gameflow/v1/session` | `GamePhaseTracker.update_phase()`（`:172`）。毎 tick（ウォッチモードでも 1 回） | `phase`（なければ `'None'`）。レスポンス全体を `last_session_data` にキャッシュ。`gameData.queue`（int / `{id}` / `{queueId}`）→ queueId（`:200-218`）。`gameData.queue.gameMode` → `queue.mode` → `gameData.gameMode` の順で gameMode（`:220-233`）。`gameData.teamOne[]` / `gameData.teamTwo[]` の各 `championId`, `summonerId`（`:630-655`, `:687-755`） |
| `GET /lol-champ-select/v1/session` | `detect_champion_and_enemies()`（`:314`）、`detect_champion()`（`:426`、旧ヘルパーで本体からは未使用）、`_watch_game_id_changed()`（`:871`） | `gameId`（falsy なら 0）、`timer.internalNowInEpochMs`（OFF 時のヒューリスティック用）、`localPlayerCellId`、`myTeam[].cellId / championId / assignedPosition / summonerId`、`theirTeam[].championId`（**配列の順序 = ピック順として扱う**） |
| `GET /lol-summoner/v1/current-summoner` | `_fetch_current_summoner_id()`（`:766`）。InProgress で summonerId が未キャッシュのとき | `summonerId` |

- **使っていないもの**: `bans.myTeamBans/theirTeamBans`、`actions[]`（ピック/バンのターン・確定状態）、`championPickIntent`、`timer.phase`、`puuid`、WebSocket（WAMP `OnJsonApiEvent_*`）、Live Client Data API `https://127.0.0.1:2999/liveclientdata/allgamedata`。いずれも `design/build-detect.md` に構想として書かれているだけ（`:41-43, :206-210, :230-298, :421-424`）。

### 2.2 外部（Data Dragon）
| URL | 呼び出し元 | 用途 |
|---|---|---|
| `https://ddragon.leagueoflegends.com/api/versions.json` | `ChampionDetector._load_champion_map()`（`:272-274`） | `versions[0]` を最新版として使う |
| `https://ddragon.leagueoflegends.com/cdn/{ver}/data/en_US/champion.json` | 同上（`:278-279`） | `data` の各エントリについて `{int(v['key']): k}`。値 k は Data Dragon の ID（例: `AurelionSol`, `MonkeyKing`） |
| `champions.json` 内の `image_url`（`https://ddragon.leagueoflegends.com/cdn/16.21.1/img/champion/{Id}.png`） | `ChampionImageCache._download_image()`（`champion_data.py:261-265`、QNetworkAccessManager） | アイコン画像 |

- 名前のエイリアス: `CHAMPION_NAME_ALIASES = {"MonkeyKing": "Wukong"}` を適用する（`:283-289`）。アプリ内のチャンピオン名は Data Dragon の **ID 形式**（スペースや記号なし。例 `AurelionSol`, `Belveth`, `Nunu`）で、Wukong だけ表示名になる。
- 失敗した場合（ネットワーク不通など）は `champion_map = {}` になり、**リトライしない**。そのプロセスの間は名前解決が全滅し、チャンピオン検知シグナルが一切出ない（`:292-294`）。
- テスト: `test_load_champion_map_success`（`tests/test_lcu_detector.py:185-210`）が `{'Ashe': {'key':'22'}}` → `{22: 'Ashe'}` を検証している。

---

## 3. ゲームフェーズ追跡（`GamePhaseTracker`）

- 初期 `current_phase = "None"`（文字列。テスト `test_initial_phase`）、`last_session_data = None`（`:158-164`）。
- `update_phase()`（`:169-198`）
  - 成功（truthy な dict）: キャッシュを更新し、`phase` が変わったら info ログ。
  - 失敗（None/空）:
    - 現在が `_ACTIVE_GAME_PHASES = {ChampSelect, InProgress, GameStart, Reconnect, WaitingForStats}`（`:167`）のどれかなら、**フェーズもキャッシュもそのまま保持**する（一時的な失敗で状態を消さない。テスト `test_update_phase_no_response_during_game_keeps_phase`）。
    - それ以外なら `last_session_data=None`、`current_phase="None"`（テスト `..._outside_game_resets`。Lobby → None）。
  - 例外時は現在のフェーズを返す。
- `is_in_champ_select()` / `is_in_game()`（`:235-241`）: 定義はあるが本体からは未使用（テストのみ）。
- `get_queue_id()` / `get_queue_game_mode()` は前述のとおりキャッシュから読むだけ（追加のリクエストはしない）。
- サービスの公開 API: `get_current_queue_id()` / `get_current_game_mode()`（`:1140-1155`）
  - 未接続なら None。
  - キャッシュがなければ `update_phase()` を 1 回呼ぶ（**フェーズ状態が変わる副作用あり**）。
  - main_window の `_is_aram_like_mode()`（`main_window.py:184-205`）で使われる。queueId が `ARAM_QUEUE_IDS={450,65,100,720}` / `ARAM_MAYHEM_QUEUE_IDS={2400,2401,2403,2405,3240,3270}`（`constants.py:31-32`）に含まれるか、gameMode が `"ARAM"`（大文字小文字を無視）なら ARAM ページを開く。

想定しているフェーズ文字列: `None`, `Lobby`, `Matchmaking`, `ReadyCheck`（コードでは「その他」として扱う）, `ChampSelect`, `GameStart`, `InProgress`, `Reconnect`, `WaitingForStats`, `PreEndOfGame`, `EndOfGame`。

---

## 4. チャンピオン検知ロジック（`ChampionDetector`）

### 4.1 内部状態（`:247-266`）
`current_champion_id/name/lane`, `current_summoner_id`, `detected_enemy_champions:set[int]`, `_cached_matchup_pairs`, `_matchup_pairs_locked`, `_last_champ_select_timer`, `new_match_detection_enabled=True`, `_prev_phase`, `_last_champ_select_game_id`, `_cached_allies`, `_cached_enemies`, `_summoner_id_fetch_failures`, `champion_map`。

### 4.2 `detect_champion_and_enemies()` → `(own_result, new_enemy_names, matchup_info)`（`:296-414`）
戻り値:
- `own_result`: `(champion_name, lane)`。未検知なら None。
- `new_enemy_names`: **この tick で新たに見つかった**敵の名前のリスト。
- `matchup_info`: dict または None。None のとき UI は更新しない。

フェーズ別の動作:

**(a) `ChampSelect`**（`:313-372`）
1. `/lol-champ-select/v1/session` を取得する。失敗したら `(None, [], None)`。
2. 新セッション判定（後述 §5）。新セッションなら `_matchup_pairs_locked=False`、`_cached_matchup_pairs/_cached_allies/_cached_enemies=[]`（`:337-342`）。**`detected_enemy_champions` と `current_champion_*` はここではクリアしない**（§9 の潜在バグ参照）。
3. 自分のチャンピオン: `_detect_own_champion_from_data()`（`:463-502`）
   - `localPlayerCellId` が None なら None。
   - `myTeam` から `cellId == localPlayerCellId` の行を探す。`summonerId` が truthy ならキャッシュする（InProgress でのチーム判定に使う）。
   - レーンは `assignedPosition.lower()`。`utility` → `support` に変換する。空なら `""`。結果の値は `top/jungle/middle/bottom/support/""`。
   - `championId > 0` なら `(id, lane)` を返す。
   - **ホバーとロックを区別しない**。`championId` が 0 より大きければ採用する（`actions[].completed` や `championPickIntent` は見ない）。LCU では自分のピックターン中のホバーでも `championId` が入ることがあるため、ホバーを変えるたびに検知される可能性がある（要確認）。ARAM のベンチ交換でも変わる。
   - 名前が champion_map にない場合、`current_champion_name` は None になる。ID とレーンは更新される（`:350-353`）。
   - 一度検知すると、`championId` が 0 に戻っても状態はクリアしない。
4. 敵の新規ピック: `_detect_enemy_champions_from_data()`（`:504-531`）。`theirTeam` を順に見て、`championId>0` かつ ID が `detected_enemy_champions` にまだなく、名前を解決できたものを set に追加して返す（**ID 単位の重複排除**）。
5. 味方一覧: `get_allies_from_data()`（`:533-555`）。`myTeam` 順に `championId>0` かつ名前を解決できたものを `(name, lane)` で並べる。lane の変換は自分の場合と同じ。
6. 敵一覧: `get_enemies_from_data()`（`:557-575`）。`theirTeam` 順（ピック順）に名前を並べる。
7. `matchup_info = {"allies": [(name, lane)...], "enemies": [name...], "phase": "ChampSelect", "is_new_session": bool}`。`own_result` は `current_champion_name` があれば `(name, current_lane)`。

**(b) `InProgress`**（`:374-388`）
- `_prev_phase='InProgress'`。
- `own_result` は ChampSelect でキャッシュした値（**試合中に自分のチャンピオンを新たに判定する手段はない**。アプリを試合途中で起動した場合や切断後は、自分のチャンピオンは不明のまま）。
- `allies = get_allies_from_gamedata()`, `enemies = get_enemies_from_gamedata()`（`:577-628`）
  - キャッシュ済みの gameflow セッションの `gameData.teamOne/teamTwo` を使う（追加リクエストはしない）。
  - チーム判定 `_get_teams_from_gamedata()`（`:630-655`）: `current_summoner_id` がなければ `/lol-summoner/v1/current-summoner` を取得する（3 回連続で失敗したら以後は試さない。カウンターは切断時に 0 に戻る。`:757-777`）。summonerId が teamOne に含まれなければ teamTwo を味方とみなす。**summonerId が不明なら teamOne を味方と仮定する**。
  - 味方の lane は常に `""`（gameData には位置情報を使っていない）。
  - キャッシュとのマージ: 新しい結果が空でない、またはキャッシュが空なら置き換える。そうでなければキャッシュを返す（遅れて読み込まれるデータや一時的な欠落への対策）。
  - データがない（セッションなし、またはチームが両方空）ならキャッシュを返す。
- `matchup_info = {"allies", "enemies", "phase": "InProgress", "is_new_session": False}`。敵の新規検知リストは空（**InProgress では `enemy_champion_detected` は出ない**）。
- コメントによると、この経路は ARAM やブラインドピックで、ChampSelect 中に敵が見えなかったケースを補うためのもの（`:376-377`）。

**(c) `None` / `Lobby`**（`:390-404`）
- 自分のチャンピオン（ID/名前/レーン）、summonerId、`detected_enemy_champions`、`_last_champ_select_timer`、`_last_champ_select_game_id` をリセットする。`_prev_phase` にフェーズを記録する。
- **戻り値の matchup は None**。UI の対戦リストは前の試合のまま残る（次の ChampSelect まで）。
- `_cached_allies/_cached_enemies/_cached_matchup_pairs/_matchup_pairs_locked` は **ここではリセットしない**。新セッションか切断のときにリセットされる。

**(d) その他のフェーズ**（Matchmaking, ReadyCheck, GameStart, Reconnect, WaitingForStats, PreEndOfGame, EndOfGame など、`:406-410`）
- 状態は保持し、`_prev_phase` だけ更新する。`own_result` はキャッシュ値、matchup は None。

**例外時**: `(None, [], None)`（`:412-414`）。

### 4.3 旧/未使用の API
- `detect_champion()`（`:416-461`）: 自分のチャンピオンだけを返す後方互換ヘルパー。本体からは呼ばれず、テスト（`tests/test_lcu_detector.py:212-258`）が ChampSelect/InProgress/None の挙動を固定している。
- `get_matchup_pairs_from_data()`（`:657-685`）: myTeam[i] と theirTeam[i] を位置で組にして最大 5 ペア。未ピックは `""`。
- `get_matchup_pairs_from_gamedata()`（`:687-755`）: teamOne/teamTwo から組を作り、キャッシュと位置ごとにマージ（空でない値を優先）。10 体すべて揃ったら `_matchup_pairs_locked=True` にして、以後は API を読まずにキャッシュを返す。
- これらと `matchup_pairs_updated` シグナル（`:785`、legacy）は **どこからも呼ばれず、emit もされない**。移植時に機能として残すかどうかは判断が必要。
- `import time` は未使用（`:9`）。

---

## 5. 新規試合検知（new-match detection）

- スイッチは `new_match_detection_enabled`。**既定値は ON**（Detector `:258`、Service `:820`。テスト `test_switch_defaults_to_on`、`tests/test_new_match_reset.py:56-59`）。
- `set_new_match_detection(enabled)`（`:835-846`）で Service と Detector の両方を設定する。OFF にしたときにウォッチモード中なら、ウォッチ状態と `_polling_paused` を解除する。**タイマー間隔は変えず**、次の tick で通常経路が base に戻す（テスト `test_turning_off_in_watch_keeps_timer_and_next_tick_restores_base`）。**本番コードでこれを呼ぶ箇所はない**（常に ON。UI のフラグもない。`tests/test_new_match_reset.py:41-43` で `auto_reset_on_new_match` フラグが存在しないことを確認している）。
- **ON の判定**（`:321-327`）: 次のどちらかなら新セッション。
  1. 直前に detector が見たフェーズ `_prev_phase` が `ChampSelect` 以外だった（初回 None を含む。Lobby → ChampSelect、起動直後の ChampSelect など）。
  2. ChampSelect が続いている中で、`gameId` が 0 でなく、前回の 0 でない gameId と異なる（ドッジ後すぐ次の試合に入った場合など）。
  - `gameId` が 0 になった場合は新セッションとみなさない（テスト `test_zero_game_id_does_not_trigger_new_session`）。0 でない値だけを `_last_champ_select_game_id` に記録する（`:334-335`）。
- **OFF（旧ヒューリスティック）**（`:328-332`）: `_last_champ_select_timer == 0` または `timer.internalNowInEpochMs` が前回より小さければ新セッション。gameId の変化だけでは新セッションにならない。Lobby/None でタイマーが 0 に戻るので、次の ChampSelect は新セッションになる（テスト `test_off_uses_legacy_timer_heuristic`）。
- `_prev_phase` はウォッチモードの tick でも更新される（`:899`）。そのため、ウォッチ中に InProgress を経由してから ChampSelect に戻ると、実際の detector が `is_new_session=True` を返す（テスト `test_real_detector_reports_new_session_after_watch`）。
- **Service 側の処理**（`:1079-1085`）: `is_new_session` が True かつスイッチが ON なら、`last_champion/last_lane=None`（同じチャンピオンでも `champion_detected` が再度出るように）→ `new_match_started.emit()` → `matchup_data_updated.emit(info)` の**順番**で出す（テスト `test_new_match_started_emitted_before_matchup_data`、`test_champ_select_again_after_game_resumes_and_emits_new_match`）。
  - スイッチ OFF では `new_match_started` を出さず、`last_champion` も保持する。ただし `matchup_data_updated` の info には `is_new_session=True` が入るので、UI 側で対戦リストはクリアされる（テスト `test_no_new_match_signal_and_last_champion_kept`）。
- UI 側の受け手（参考）: `on_new_match_started` は全ビューアを閉じて対戦リストをクリアする（`main_window.py:1504-1508`。テスト `tests/test_new_match_reset.py:45-54` で viewers 0、`_matchup_data` が全部空、`pending_enemy_picks` 空を確認）。`on_matchup_data_updated` は `is_new_session` なら行を初期化してから配置する（`main_window.py:1510-1535`）。

---

## 6. ポーリング 1 tick の処理（`ChampionDetectorService._check_champion`、`:1013-1138`）

1. `is_checking` ガード。`check_count += 1`。10 回に 1 回ログを出す（`:1025-1026`）。
2. `watching = _watch_mode and connected`。ウォッチ中で接続済みなら **プロセススキャンを省略**し、それ以外は `is_client_running()`（`:1031-1032`）。
3. プロセスなし: 接続中なら `disconnect("client closed")` → バックオフを延ばす → `disconnected` → `_clear_champion_state()` → return（`:1035-1043`）。
4. プロセスあり: ウォッチ中でなければバックオフをリセットする。
5. 未接続なら `connecting` にして `connect()`。失敗したら return（`:1050-1056`）。
6. `connected` にする。
7. ウォッチモードなら `_watch_tick()`。False が返ったら return（§7）。
8. `detect_champion_and_enemies()`。
9. `matchup_info` が dict のときだけ: （新セッションかつ ON なら `new_match_started`）→ `matchup_data_updated(info)`。**None や空で UI を消すような emit はしない**（`:1078-1085`）。
   - ChampSelect / InProgress の間は**毎 tick（2 秒ごと）全リストを emit する**。差分ではなく全体を送るので、重複排除は UI 側で行う。
10. 自分のチャンピオン: `(champion, lane)` が前回と違えば `champion_detected(champion, lane)`（**レーンだけが変わった場合も再度出る**。`:1088-1099`）。`own_result` が None で前回値があれば、黙って `last_*` をクリアする（シグナルなし。`:1100-1105`）。
11. 敵: 新規の敵ごとに `enemy_champion_detected(name)` を theirTeam の順に出す（`:1108-1111`）。
12. ChampSelect で allies が 5 以上かつ enemies が 5 以上（10 体揃った）で、まだ一時停止していなければ `_polling_paused=True`。ON ならウォッチモードに入る（5 秒間隔、タイマーは動いたまま）。OFF なら `timer.stop()`（Refresh まで止まる。テスト `test_timer_stops_at_ten_champions`）（`:1113-1126`）。
13. 処理中に接続が切れていれば `connecting`（`:1129-1130`）。
14. 例外はログと traceback を出して握りつぶす。`finally` で `is_checking=False`。

**1 tick 内のシグナル発火順**: `connection_status_changed`（変化時。connecting → connected の 2 回もありうる）→ `new_match_started`（条件付き）→ `matchup_data_updated` → `champion_detected` → `enemy_champion_detected` × n →（必要なら）`connection_status_changed("connecting")`。
- UI 側は `matchup_data_updated` の同期処理と WebEngine 生成が同じスタックで重なるとクラッシュするため、`champion_detected` によるビューア生成を `QTimer.singleShot(0)` で遅延させている（`main_window.py:2138-2147, 2292-2297`）。移植先でも「シグナル → 遅延してビューア生成」という順序制約を意識する必要がある。

### 6.1 シグナル一覧（`:783-788`）
| シグナル | ペイロード | 発火条件 | 受け手 |
|---|---|---|---|
| `champion_detected` | `(str champion_name, str lane)`。lane は `top/jungle/middle/bottom/support/""` | 自分の (名前, レーン) が変化したとき | `main_window.on_champion_detected`（左端に新しいビューアを作り、ARAM なら ARAM ページ、それ以外は lane を設定して build ページ） |
| `enemy_champion_detected` | `str` | ChampSelect で新しい敵 ID を検知（ID 単位で重複排除） | `on_enemy_champion_detected`（pending picks に追加するだけで、ビューアは作らない） |
| `matchup_pairs_updated` | `list[(ally, enemy)]` | **emit されない**（legacy） | なし |
| `matchup_data_updated` | `{"allies": [(name, lane)], "enemies": [name], "phase": "ChampSelect"/"InProgress", "is_new_session": bool}` | ChampSelect / InProgress の毎 tick | `on_matchup_data_updated` |
| `new_match_started` | なし | 新セッションかつスイッチ ON。matchup より先に出る | `on_new_match_started` |
| `connection_status_changed` | `str`: `connecting/connected/disconnected` | 値が変化したとき | `LCUConnectionStatusWidget.set_status` |

---

## 7. ウォッチモード（低負荷モード）と Refresh/再開

- 開始: ChampSelect で 10 体揃った、かつスイッチ ON（`:1121-1123`）。`_enter_watch_mode()`（`:853-857`）は `_watch_mode=True`、カウンターをリセットし、5 秒間隔にする。
- ウォッチ中の tick（`_watch_tick`、`:878-912`）: **gameflow のリクエスト 1 回だけ**。プロセススキャンも champ-select の取得もしない（テスト `test_watch_tick_skips_process_scan_and_detection`）。
  - ChampSelect の場合:
    - その前に ChampSelect 以外のフェーズを見ていれば、ウォッチを抜けて（`_exit_watch_mode`: 状態を解除、`_polling_paused=False`、base 間隔）**同じ tick で通常の検知を実行する**。
    - そうでなければ ChampSelect の tick を数え、4 の倍数のときに `/lol-champ-select/v1/session` の `gameId` が、0 でなく前回と異なるかを確認する。変わっていればウォッチを抜けて通常の検知へ（テスト `test_game_id_change_during_champ_select_exits_watch`）。同じ gameId ならウォッチを続ける（`test_same_game_id_stays_in_watch`）。
    - 間隔は 5 秒。
  - ChampSelect 以外の場合:
    - `_watch_seen_non_champ_select=True`、tick カウンターを 0 に、`detector._prev_phase = phase`。
    - None/Lobby なら detector の自分のチャンピオン、summonerId、敵 set、gameId をリセットする（detector の None/Lobby 処理と同じ内容。ただし `_last_champ_select_timer` はリセットしない）。
    - `WATCH_SLOW_PHASES` なら 15 秒、それ以外（Lobby, None, Matchmaking, ReadyCheck, Reconnect など）は 5 秒（テスト `test_watch_uses_slow_interval_during_game_and_stays_in_watch`）。
- ウォッチ中に接続が切れた場合: `watching=False` になるので通常のプロセススキャンと再接続に戻る（テスト `test_not_connected_falls_back_to_process_scan`）。ただし `_watch_mode` は True のままなので、バックオフのリセットは省略される。クライアントが終了していれば `_clear_champion_state()` でウォッチを解除する（テスト `test_client_closed_leaves_watch_mode`）。
- ウォッチ中は InProgress の gameData によるマージや `matchup_data_updated` を **出さない**（10 体が既知のため）。
- **Refresh**: UI の Refresh ボタン → `main_window._refresh_matchup_list()`（`main_window.py:1496-1502`）が対戦リストをクリアし、`resume_polling()` を呼び、続けて `_check_champion(force=True)` を呼ぶ。
  - `resume_polling()`（`:1004-1011`）は `_polling_paused` が True のときだけ動き、一時停止を解除、ウォッチを解除、base 間隔でタイマーを**再開**する（OFF で停止していたタイマーも動き出す。テスト `test_resume_polling_restarts_stopped_timer`、`test_resume_polling_exits_watch_mode`）。
  - Refresh 直後の tick では `detected_enemy_champions` が残っているので、`enemy_champion_detected` は再発火しない。一方 `matchup_data_updated` はリスト全体を送るので、UI の対戦リストは再構築される。

---

## 8. 切断時のリセット（`_clear_champion_state`、`:914-935`）
- `last_champion/last_lane`、detector の自分のチャンピオン（ID/名前/レーン）、summonerId、敵 set、`_cached_matchup_pairs`、`_matchup_pairs_locked`、`_summoner_id_fetch_failures`、`_cached_allies/_cached_enemies`、`_prev_phase=None`、`_last_champ_select_game_id=0`、ウォッチ状態、`_polling_paused` をすべてリセットする。
- **matchup のシグナルは出さない**ので、UI は既存の表示を保持する（`:935`）。
- 呼ばれるのはプロセスがないときだけ（`:1042`）。プロセスがないことが確認される tick ごとに毎回呼ばれる。HTTP 失敗による切断（プロセスはある）では呼ばれない。

---

## 9. エッジケース・潜在バグ（移植時に要判断）
1. **Data Dragon の読み込み失敗にリトライがない**（`:292-294`）。オフラインで起動すると、そのプロセスの間はチャンピオン名を解決できず、すべての検知が無効になる。champions.json（ローカル）にある `id` からは ID→名前マップを作れない（`key` 数値がない）ので、ローカルにフォールバックできない。
2. **起動時の同期ネットワーク呼び出し**（最大 20 秒）で UI がブロックされる。
3. **非 Windows の扱いが不一致**: 資格情報の取得は `LeagueClientUx` も対象だが、`is_client_running` は `.exe` だけを見る（`:81` と `:104`）。
4. プロセス列挙の途中で 1 回でも例外が起きるとスキャン全体が失敗する（`:95-98`, `:106-107`）。
5. **gameId の変化による新セッション**（ドッジ → 即再マッチなど、Lobby を通らない場合）で、`detected_enemy_champions` と `current_champion_name` がクリアされない。その結果、前の試合の自分のチャンピオンで `champion_detected` が再度出る可能性がある（Service が `last_champion=None` にするため）。また、新しい試合で前と同じ敵チャンピオンが出ても `enemy_champion_detected` が出ない（`:337-342`）。（要確認・潜在バグ）
6. ホバーとロックを区別しないので、ホバーを変えるたびに `champion_detected` → 新しいビューアが作られる可能性がある（要確認）。レーンだけ変わった場合も再度 emit される。
7. 試合中に起動したり、試合中に再接続したりした場合、自分のチャンピオンは検知されない（InProgress はキャッシュだけを返す）。味方/敵の一覧は gameData から取れる。summonerId を取れないと teamOne を味方と仮定するので、敵味方が逆になりうる。
8. ARAM の ChampSelect では敵が見えない（theirTeam が空）ため 10 体揃わず、ウォッチモードに入らない。試合中も 2 秒ごとのポーリングと `matchup_data_updated` が続く（要確認：ARAM の theirTeam の実際の中身）。
9. 200 以外の応答は切断にならない。例外だけが切断になる。JSON デコード失敗も切断扱い（要確認）。
10. `get_current_queue_id/game_mode` は、キャッシュがないと `update_phase()` を呼ぶ副作用がある。
11. Wukong: LCU 側の名前は `Wukong` に正規化されるが、champions.json のキーは `monkeyking` で、`lanes` は**全部 0**（CSV のキーは `wukong` で一致しないため）。`get_champion("Wukong")` は english_name の一致でヒットするが、レーン適性による配置は「最初の空き行」にフォールバックする（§11.3）。
12. `ChampionData` の既定パス `"champions.json"` は **カレントディレクトリからの相対パス**（スクリプト実行時。`champion_data.py:41-43`）。PyInstaller では `sys._MEIPASS` を使う（`:38-40`）。ファイルがなければ警告を出して空の dict。JSON が壊れていれば traceback を出して空の dict（`:53-70`）。
13. アイコンのダウンロードに失敗したときは、待っていたコールバックを呼ばずに破棄する（UI はアイコンなしのまま。再要求すれば再ダウンロードする）。

---

## 10. `champion_data.py`

### 10.1 `ChampionData`（`:27-130`）
- コンストラクタ `ChampionData(data_file="champions.json")`。frozen（PyInstaller）なら `os.path.join(sys._MEIPASS, data_file)`（`:38-43`）。`lol-viewer.spec:17-18` で champions.json を同梱している。
- `load_data()`: UTF-8 の JSON をそのまま `self.champions: Dict[key, dict]` に読み込む。件数と先頭 3 件をログに出す。
- `search(query)`（`:72-106`）:
  - 空のクエリなら `[]`。
  - クエリを lower 化し、english_name（lower）、japanese_name（lower）、**キー（champ_id）** のどれかに部分一致すればヒット。
  - 結果は `{'id', 'english_name', 'japanese_name', 'image_url', 'display_name': "EN (JP)"}` のリストで、english_name 順にソートする。
  - **アプリ本体からは未使用**（呼び出しは見つからない）。テスト（`tests/test_champion_data_basic.py`）は同じロジックを再実装して、`ashe` / `アッシュ` / `ash` で検証している。
- `get_champion(name_or_id)`（`:108-130`）: **アプリ全体の名前解決の中心**。
  1. lower 化した値がキーとして存在すれば、そのエントリを返す（例: `AurelionSol` → `aurelionsol`、`Ashe` → `ashe`）。
  2. 見つからなければ、全エントリの english_name.lower() または japanese_name.lower() との**完全一致**を探す（例: `Wukong`、`Aurelion Sol`、`アッシュ`）。
  3. なければ None。
  - 正規化は lower 化だけ。空白や記号の除去、全角半角の変換（NFKC）、ひらがなとカタカナの同一視はしない。前後の空白は呼び出し側で strip している場合がある（`widgets/viewer_widget.py:476`）。
  - 使われる場所: `main_window.py:1434`（対戦行のアイコン）、`:1576/:1615`（レーン適性）、`widgets/viewer_list_item.py:166,320`、`widgets/viewer_widget.py:476`。

### 10.2 オートコンプリート（`ChampionCompleter`、`:453-567`、`setup_champion_input`、`:569-602`）
- `QStandardItemModel` に全チャンピオンを english_name 順で入れる（`_populate_model`、`:537-561`）。
  - DisplayRole（表示と絞り込みの対象）: `"{english_name} - {japanese_name}"`（`:548`）。テストでは `"EN JP"` 形式で検証しているが、実装は ` - ` 区切り。
  - UserRole = 日本語名、UserRole+1 = image_url、UserRole+2 = champion キー（ID）、UserRole+3 = 英語名。
- 設定: 大文字小文字を区別しない、`PopupCompletion`、`MatchContains`（**部分一致**。英語・日本語のどちらでも、名前の途中からでもヒットする）、最大表示 10 件（`:471-475`）。
- ポップアップ: 最小高さ 200、最小幅 350。`Popup | FramelessWindowHint`。ダークテーマのスタイルシート（背景 #2b2b2b、文字 #fff、枠 #0d7377、選択 #0d7377、hover #3a3a3a、項目の padding 8px、下線 #3a3a3a、高さ 30px。`:482-512`）。
- `pathFromIndex()`（`:514-535`）: 候補を選ぶと、**表示文字列ではなくチャンピオンキー**（例 `aurelionsol`）を入力欄に入れる。モデルが自前のものでない場合（コンテキスト候補の QStringListModel）は、表示文字列をそのまま返す（他のモデルの index に itemFromIndex を呼ぶとクラッシュするため、`:517-520`）。
- 画像付きの `ChampionItemDelegate`（`:375-450`。40px アイコン + 英語名 + 半透明で 1pt 小さい日本語名、行の高さ 50、幅 300）は**実装されているが無効化されている**（`:477-479`）。現在はテキストだけの表示。
- `setup_champion_input(line_edit, champion_data)`: completer を設定する。`textChanged` でデバッグログを出す（`:591-597`）。ビューアごとに作られる（`widgets/viewer_widget.py:674`、デバッグ用の入力 `main_window.py:1008`）。
- `setup_opponent_champion_input(line_edit, champion_data, suggestion_provider)`（`:696-715`）+ `_OpponentContextCompleterController`（`:605-693`）:
  - 入力欄が**空のときに左クリック**すると、`suggestion_provider()` が返す「コンテキスト候補」（例: 他のビューアで開いているチャンピオン）を表示する。
    - 文字列でないもの・空白だけのものを除き、strip して、大文字小文字を無視した重複排除（順序は維持）をする。
    - 空なら何もしない。
    - provider が例外を投げたら空として扱う。
    - `QStringListModel` に差し替え、prefix を `""` にして、`QTimer.singleShot(0, complete)` でポップアップを開く。
    - `PYTEST_CURRENT_TEST` がある、または `QT_QPA_PLATFORM` が offscreen/minimal のときは、モデルの差し替えだけ行ってポップアップは開かない（`:670-673`）。
  - 入力欄に文字があるときのクリック → 通常のチャンピオンモデルに戻す。
  - `textEdited`（ユーザーの入力）→ コンテキスト用のポップアップを閉じて、チャンピオンモデルに戻す。
  - `activated`（候補の確定）→ 次の tick でチャンピオンモデルに戻す。

### 10.3 アイコンの URL とバージョン
- アイコンの URL は **champions.json の `image_url` をそのまま使う**（アプリ内で組み立てない）。形式は `https://ddragon.leagueoflegends.com/cdn/{DDragonVersion}/img/champion/{Id}.png`。現在は全 173 件が `16.21.1`。
- バージョンはデータ生成時（GitHub Actions）に `versions.json[0]` で決まる。アプリ実行時に最新版へ追従する処理はない。

### 10.4 画像キャッシュ（`ChampionImageCache`、`:159-303`）
- **保存先**: `get_icon_cache_dir()`（`:133-156`）
  1. 環境変数 `LOL_VIEWER_ICON_CACHE_DIR` があればそこを使う。
  2. なければ `%LOCALAPPDATA%`（Windows）→ `QStandardPaths.GenericCacheLocation` → `tempfile.gettempdir()` の順に最初に得られたものを base にして、`{base}/LoLViewer/cache/champion_icons`。
  3. `os.makedirs(exist_ok=True)`。
  - `QApplication.setApplicationName()` を使って CacheLocation を得る方式は **意図的に避けている**。アプリ名を設定すると QtWebEngine のプロファイルの場所が変わり、Cookie やログイン状態が消えるため（`:136-141`）。
- **2 層キャッシュ**: メモリ（`dict[url → QPixmap]`、プロセスの間ずっと保持、上限・削除なし）+ ディスク。
- `get_image(url, callback=None)`（`:179-211`）:
  1. メモリにあれば即座に返す。
  2. ディスクにあれば、**同期で**読み込んでメモリに入れて返す（2 回目以降の起動ではダウンロードもコールバックも発生しない）。
  3. どちらにもなく、callback があればダウンロードする。同じ URL がすでにダウンロード中なら、コールバックを追加するだけ（**同じ URL の同時ダウンロードは 1 回にまとめる**）。callback がなければダウンロードしない。
  4. None を返す。
- ファイル名は `sha256(url UTF-8).hexdigest() + ".png"`（`:213-216`）。URL にバージョンが含まれるので、パッチが変わると自然に別ファイルになる。
- ディスクから読み込むとき、壊れたファイル（`QPixmap.load` 失敗または null）は**削除して** miss 扱いにする（`:218-238`。テスト `test_corrupt_cache_file_is_deleted_and_returns_none`）。
- `_save_to_disk`（`:240-259`）: `path + ".tmp"` に書いてから `os.replace` で置き換える（**アトミック**）。受け取った raw バイトを再エンコードせずに保存する。OSError のときはログを出し、tmp を削除する（テスト `test_save_to_disk_leaves_no_tmp_file_behind`）。
- ダウンロード（`:261-265`）: `QNetworkAccessManager.get(QNetworkRequest(QUrl(url)))`。非同期で、`finished` で `_on_image_downloaded` を呼ぶ。リトライ・タイムアウト・ヘッダーの指定はない。
- 完了時の処理 `_on_image_downloaded`（`:267-303`）:
  - エラー → ログ、コールバックは呼ばない。
  - QImage としてデコードできない → ログ、コールバックは呼ばない。
  - 成功 → メモリ、ディスクの順に保存し、待っていたコールバック全部に `callback(pixmap)`。
  - **`finally` で必ず `pending_requests.pop(url)` と `reply.deleteLater()`** を行う。以前はここが成功時だけで、URL が永久に詰まる・コールバックがリークするというバグがあった（テスト `test_network_error_clears_pending_requests_and_allows_retry`、`test_decode_failure_...`）。
- **共有のシングルトン**: `get_shared_image_cache()`（`:306-318`）。QNetworkAccessManager が QApplication を必要とするため、遅延生成する。サイドバー、対戦リスト、全ビューア、completer が同じインスタンスを共有する（テスト `test_multiple_viewers_share_the_same_cache_instance`、`test_get_shared_image_cache_returns_same_instance`）。
- **キャッシュの整理（prune）**: `prune_icon_cache(champion_data, cache_dir=None) -> int`（`:321-372`）
  - 残すのは、現在の champions.json の `image_url` から計算した `sha256.png` だけ。
  - 削除するのは、名前が `^[0-9a-f]{64}\.png(\.tmp)?$`（`:323`）に一致し、残す対象でないファイル（古いパッチのアイコンや残った `.tmp`）。
  - **パターンに合わないファイル**（`notes.txt`, `holiday.png`, `0123.png` など）**は決して消さない**（環境変数が誤った場所を指していたときの安全策。テスト `test_prune_icon_cache_never_touches_unrelated_files`）。
  - 一覧の取得に失敗したら 0。削除に失敗したらログを出して次へ。削除した件数を返し、1 件以上ならログを出す。
  - **起動のたびに無条件で**実行する（`main_window.py:126-132`）。例外は warning にして、起動は止めない。
- テスト `test_prefilled_cache_triggers_zero_downloads_across_viewers`: ディスクに全アイコンがあれば、MainWindow を起動してビューアを 2 つ作ってもダウンロードは 0 回。
- テスト環境では `tests/conftest.py` が `LOL_VIEWER_ICON_CACHE_DIR` を一時ディレクトリに設定する（本物のユーザーキャッシュに触らない）。

### 10.5 ネットワーク呼び出し（champion_data.py）
- アイコンの GET だけ（QtNetwork）。チャンピオンデータの取得やバージョン確認はしない。

---

## 11. データファイル

### 11.1 `champions.json`
- 173 件（最上位の dict）。キーは **Data Dragon ID の lower 化**（全件で `key == id.lower()` が成り立つ）で、アルファベット順。
- 各エントリの構造（全件同じ。キー 5 つ）:
  ```json
  "aatrox": {
    "english_name": "Aatrox",            // 表示名（en_US の name）
    "japanese_name": "エイトロックス",     // ja_JP の name（なければ英語名）
    "image_url": "https://ddragon.leagueoflegends.com/cdn/16.21.1/img/champion/Aatrox.png",
    "id": "Aatrox",                      // Data Dragon ID（大文字小文字を保持）
    "lanes": {"top":5,"jg":0,"mid":0,"bot":0,"sup":0}
  }
  ```
- 英語名がキーと大きく異なるもの: `monkeyking`=Wukong、`nunu`=Nunu & Willump、`renata`=Renata Glasc。記号や空白の違いだけのもの（`belveth`=Bel'Veth、`drmundo`=Dr. Mundo、`jarvaniv`=Jarvan IV など）もある。日本語名には全角記号（`＝`, `・`, `＆`, `Ⅳ`）が入っている。
- アプリが使うフィールド: `english_name`, `japanese_name`, `image_url`, `lanes`（main_window の敵/味方の配置）。キー（completer が返す ID、`get_champion` の検索）。`id` は直接使っている箇所は見当たらない（要確認：他のモジュールで LoLAnalytics の URL 生成に使うかもしれない）。
- **生成方法**: `.github/workflows/update-champions.yml`
  - 毎週月曜 09:00 UTC（cron `0 9 * * 1`）または手動実行。
  - インライン Python で `versions.json[0]` → en_US と ja_JP の `champion.json` → キーは `champ_id.lower()`（**monkeyking はそのまま**）→ CSV の `lanes` をマージ（CSV がない、または値が不正な行は 0 埋めかスキップ）→ `champions.json`（`ensure_ascii=False, indent=2`）。
  - バージョンと件数を含めて、`automated/update-champions` ブランチで PR を作る（ラベル `automated`, `data-update`）。
- `scripts/fetch_champions.py` は**別の手動生成スクリプト**。公式サイト（en-us/ja-jp champions ページ）のスクレイピングを試し、失敗すると Data Dragon にフォールバックする。フォールバック時だけ `monkeyking` → `wukong` のキーに変換して lanes をマージする（`scripts/fetch_champions.py:213-238`）。スクレイピングが成功した経路では `lanes` を付けない。**現在の champions.json は workflow で生成された形式**（monkeyking キー）。2 つの生成器の結果が一致しない点に注意。
- PyInstaller の spec に同梱されている（`lol-viewer.spec:18`）。`scripts/check_build.py` はビルド前に存在を確認する。

### 11.2 `champion_lane.csv`
- ヘッダーは `name,top,jg,mid,bot,sup`。173 行。名前の重複はない。
- `name` は champions.json のキーと同じ形式（lower 化した DDragon ID）。**ただし 1 件だけ例外で `wukong`**。champions.json 側は `monkeyking` なので一致しない。その結果 monkeyking の lanes は全部 0（`plan-champion-lane-integration.md:64-70` にも「JSON 側でも wukong として扱う必要がある」と書かれているが、workflow では未対応）。
- 値は 0〜5 の整数（適性スコア。5 = メイン）。分布は 0: 669、5: 173、4: 18、3: 4、2: 1。
- 複数のレーンを持つチャンピオンは 18 体（例: ahri top4/mid5、jarvaniv top3/jg5/sup4、pantheon top4/jg3/mid2/sup5、locke top4/jg5/mid5）。missfortune だけ 5 がない（mid3/bot4）。
- **アプリ実行時には読まない**（同梱もされていない）。champions.json の `lanes` を通じてだけ使われる。
- レーン適性の使い方（参考。main_window の範囲だが、データの意味として記載）: `INDEX_TO_LANE_JSON = ["top","jg","mid","bot","sup"]`（行 0〜4）。
  - 敵は空いている行の中で適性スコアが最も高い行に置く。同点なら上の行。データがなければ最初の空き行（`main_window.py:1590-1630`）。
  - レーンがない味方も同じ方法で置く（`:1563-1588`）。
  - LCU のレーンを持つ味方は `LANE_TO_INDEX = {"top":0,"jungle":1,"middle":2,"bottom":3,"support":4}` の行に優先して置く（`:1486, 1546-1561`）。
  - LCU の `assignedPosition` と CSV のキー名は体系が異なる（`jungle`/`jg` など）ので、マッピングを維持する必要がある。

### 11.3 `plan-champion-lane-integration.md`
- CSV を champions.json に統合する計画書。`load_lane_data` の追加、CSV にないものは 0 埋め、`lanes` オブジェクト形式、wukong↔monkeyking の特殊マッピング、`check_build.py` への lanes 検査の追加（任意）、`ChampionData` が新しいフィールドを使えるようにする（任意）。
- 実装状況: lanes の埋め込みは済み。wukong のマッピングは fetch_champions.py のフォールバック経路だけで、workflow では未対応。check_build.py の lanes 検査は未確認（要確認）。`ChampionData` に lanes 専用の API はなく、dict を直接参照している。

---

## 12. 設計書（`design/build-detect.md`）と実装の差分
| 設計書の内容 | 実装 |
|---|---|
| プロセスの cmdline から port/token を取得（`:61-94`） | 実装済み（同一コード） |
| lockfile による代替手段（`:96-131`） | **未実装** |
| `urllib3.disable_warnings` をグローバルに適用 | 呼び出し単位の抑制に変更済み |
| WebSocket（WAMP、`OnJsonApiEvent_*`）でのリアルタイム検知（`:230-298`, Phase 6 🔄） | **未実装**（ポーリングのみ） |
| Live Client Data API `127.0.0.1:2999/liveclientdata/allgamedata`（`:421-424`） | **未実装**（InProgress は gameflow の gameData で代替） |
| Ban 情報の取得（`:43`, `:1090-1100`） | **未実装** |
| フェーズに応じた間隔（1/3/5 秒、`:977-990`） | 別方式: 2 秒 + バックオフ + ウォッチ 5/15 秒 |
| フェーズのキャッシュ 5 秒（`:992-1010`） | 未実装（gameflow のレスポンスをキャッシュする方式は別途ある） |
| 自分のチャンピオンでビルドページを自動で開く（Phase 4 ✅） | 実装済み（UI 側） |
| 敵 5 体のカウンターページを自動で開く（Phase 5 ✅） | 現在は「pending picks に積んで、ユーザー操作で開く」方式に変わっている（`main_window.py:2361-2371`、Chromium のクラッシュ対策） |
| 認証情報はメモリだけ、ログに出さない（`:1042-1045`） | トークンはログに出していない（port だけ出力）。ただし接続の `reason` に URL が含まれる可能性はある（要確認） |

---

## 13. ログ出力
- `log()`（logger.py。コンソールと、debug 版の exe またはスクリプト実行時は `lol_viewer_debug.log`）と、標準の `logging.getLogger(__name__)` の 2 系統を併用している。
- `[LCU]` プレフィックスで出すもの: 接続/切断、ステータス変化、間隔の変更、10 tick ごとのポーリング状況、チャンピオンの検知/変化/クリア、敵の検知、ウォッチモードへの出入り。
- `[ChampionData]` / `[ChampionImageCache]` / `[prune_icon_cache]` / `[ChampionCompleter]` / `[Autocomplete]` などのプレフィックスもある。

---

## 移植チェックリスト

### LCU 接続
- [ ] プロセス列挙で `LeagueClientUx.exe` / `LeagueClientUx` を探し、cmdline から `--app-port=(\d+)` と `--remoting-auth-token=([\w-]+)` を抽出する
- [ ] クライアントの起動判定は `LeagueClient.exe` / `LeagueClientUx.exe` の存在で行う（非 Windows 名を含めるかは要判断）
- [ ] プロセス列挙での例外（権限など）に耐える。現状はスキャン全体が失敗するので、改善するかを判断する
- [ ] Basic 認証 `riot:<token>`（Base64）
- [ ] `https://127.0.0.1:<port>` への GET。自己署名証明書を許可する（verify 無効）。証明書警告の抑制は LCU 呼び出しに限定する
- [ ] LCU リクエストのタイムアウトは 2 秒
- [ ] 200 以外 → None（切断しない）。ネットワーク例外や JSON 例外 → 切断して認証情報をクリア
- [ ] 未接続のときはリクエストを送らない
- [ ] 接続ステータス 3 種 `connecting/connected/disconnected`。初期値は connecting。変化したときだけ通知する
- [ ] ステータスの遷移規則（プロセスなし → disconnected、プロセスあり未接続 → connecting、接続後 → connected、処理中に切断 → connecting）
- [ ] 基本ポーリング 2 秒（start 引数で変更可能）
- [ ] クライアントがないときは指数バックオフ（×2、上限 60 秒）。クライアントを見つけたら基本間隔に戻す（ウォッチ中は除く）
- [ ] 接続が切れたら、次の tick でプロセスを再スキャンして再接続する（ポートやトークンの変化に追従する）
- [ ] ポーリングの再入防止（実行中の tick があればスキップ）
- [ ] 手動接続（Connect ボタン）: 未起動なら開始、起動済みならバックオフをリセットし、タイマーを再開し、connecting を通知して即時チェック
- [ ] ボタンを「Connecting...」にして無効化し、1.5 秒後に戻す（UI 側）
- [ ] `start(interval, max_interval)` / `stop()`。アプリ終了時に stop
- [ ] 環境変数 `LOL_VIEWER_DISABLE_LCU_SERVICE=1`（またはテスト中）ではサービスを開始しない
- [ ] Qt イベントループがなければ自前で作る（ヘッドレス/テスト用）。新しい技術スタックでの相当処理
- [ ] （改善候補）HTTP をメインスレッドから外す。現在は GUI スレッドで同期実行している

### Data Dragon / 名前解決
- [ ] 起動時に `versions.json[0]` → `cdn/{ver}/data/en_US/champion.json` を取得し、`int(key) → id` のマップを作る（timeout 10 秒）
- [ ] 名前のエイリアス `MonkeyKing → Wukong`
- [ ] 失敗したら空のマップになる（リトライなし）。改善として、ローカルへのフォールバックやリトライを検討する
- [ ] アプリ内のチャンピオン名は DDragon ID 形式（Wukong を除く）であることを維持する

### ゲームフェーズ
- [ ] `/lol-gameflow/v1/session` で `phase` を取得する（なければ "None"）。レスポンス全体をキャッシュする
- [ ] アクティブなフェーズ（ChampSelect/InProgress/GameStart/Reconnect/WaitingForStats）では、取得に失敗してもフェーズとキャッシュを保持する
- [ ] それ以外のフェーズで取得に失敗したら "None" にしてキャッシュを破棄する
- [ ] queueId の抽出（`gameData.queue` が int / `{id}` / `{queueId}`）
- [ ] gameMode の抽出（`queue.gameMode` → `queue.mode` → `gameData.gameMode`）
- [ ] `get_current_queue_id/game_mode`: 未接続なら None、キャッシュがなければ 1 回取得する
- [ ] ARAM の判定に使う（queueId が ARAM / Mayhem の集合に含まれる、または gameMode が "ARAM"）。ARAM なら ARAM ページを開く（UI 側）

### チャンピオンセレクトでの検知
- [ ] `/lol-champ-select/v1/session` を毎 tick 取得する
- [ ] 自分の特定: `myTeam` の中で `cellId == localPlayerCellId` の行。`championId > 0` なら検知
- [ ] 自分の行から `summonerId` をキャッシュする（試合中のチーム判定用）
- [ ] レーン: `assignedPosition.lower()`、`utility → support`、なければ ""
- [ ] ホバーとロックを区別しない現在の挙動を維持するか判断する（要確認）
- [ ] 一度検知した自分のチャンピオンは、championId が 0 になっても保持する
- [ ] 敵の新規ピック: `theirTeam` の順に `championId > 0` のものを見て、ID 単位で重複排除して通知する
- [ ] 味方一覧 `(name, lane)`（ピック済みのみ、myTeam 順）
- [ ] 敵一覧 `name`（ピック済みのみ、theirTeam 順 = ピック順）
- [ ] 名前を解決できない ID は除外する
- [ ] `matchup_data` の dict `{"allies", "enemies", "phase", "is_new_session"}` を毎 tick 全体で通知する

### 試合中（InProgress）
- [ ] 自分のチャンピオンは ChampSelect のキャッシュを返す（試合中に新たに判定しない）
- [ ] キャッシュ済み gameflow の `gameData.teamOne/teamTwo` から味方と敵の一覧を作る（lane は常に ""）
- [ ] 自分のチームは summonerId で判定する（teamOne に含まれなければ teamTwo）。不明なら teamOne を味方と仮定する
- [ ] summonerId が未取得なら `/lol-summoner/v1/current-summoner` で取得する（3 回連続で失敗したら停止。切断時にカウンターをリセット）
- [ ] 一覧のマージ（新しい結果が空ならキャッシュを維持する）
- [ ] InProgress では敵の新規通知を出さない。matchup は phase="InProgress"、is_new_session=False で通知する
- [ ] ARAM やブラインドピック（ChampSelect で敵が見えない場合）を試合中のデータで補う

### その他のフェーズ
- [ ] None/Lobby: 自分のチャンピオン、summonerId、敵の既知 set、タイマー、gameId をリセットする。matchup は通知しない（前の試合の一覧を残す）
- [ ] None/Lobby で自分のチャンピオンをクリアしても通知しない（内部の last だけクリア）
- [ ] その他のフェーズ（Matchmaking/ReadyCheck/GameStart/WaitingForStats/EndOfGame など）: 状態を保持し、matchup は通知しない

### 新規試合検知
- [ ] スイッチは既定で ON（本番で OFF にする手段はない。内部のフォールバック）
- [ ] ON: 前回のフェーズが ChampSelect 以外から ChampSelect に入ったら新セッション
- [ ] ON: ChampSelect 継続中に gameId が 0 でなく前回と異なる値に変わったら新セッション（0 は無視、0 でない値だけ記録）
- [ ] OFF: `timer.internalNowInEpochMs` が 0 からの開始、または巻き戻ったら新セッション（gameId は無視）
- [ ] 新セッションでは対戦キャッシュとロックをリセットする
- [ ] 新セッション（ON）では last_champion/lane をリセットし、`new_match_started` を `matchup_data_updated` より**先に**通知する
- [ ] OFF では new_match_started を出さず、last_champion を保持する（matchup の is_new_session は true のまま渡す）
- [ ] UI: 新しい試合で全ビューアを閉じ、対戦リストと pending picks をクリアする
- [ ] UI: is_new_session の matchup を受けたら行を初期化してから配置する
- [ ] （潜在バグの判断）gameId の変化による新セッションで、敵の既知 set と自分のチャンピオンをクリアするか

### シグナル / イベント
- [ ] `champion_detected(name, lane)`: (名前, レーン) が変化したときに通知（レーンだけの変化でも通知）
- [ ] `enemy_champion_detected(name)`: 新しい敵ごとに、ピック順で通知
- [ ] `matchup_data_updated(dict)`: ChampSelect / InProgress の毎 tick。None や空でクリアする通知は出さない
- [ ] `new_match_started()`
- [ ] `connection_status_changed(str)`
- [ ] 1 tick 内の発火順（status → new_match → matchup → champion → enemies → status）を維持する
- [ ] champion_detected を受けたビューア生成は次のイベントループに遅延させる（WebView クラッシュ対策、UI 側）
- [ ] legacy の `matchup_pairs_updated` と位置ペアの API（10 体揃ったらロック）は未使用。移植するか判断する

### 10 体揃った後の一時停止・ウォッチモード・Refresh
- [ ] ChampSelect で味方 5 以上かつ敵 5 以上になったら一時停止する
- [ ] ON: ウォッチモード（5 秒間隔、gameflow だけ 1 リクエスト、接続中はプロセススキャンを省略、detect を省略）
- [ ] OFF: タイマーを完全に止め、Refresh まで再開しない
- [ ] ウォッチ中: ChampSelect 以外のフェーズを経てから ChampSelect に戻ったら、ウォッチを抜けて同じ tick で通常検知を行う
- [ ] ウォッチ中: ChampSelect の 4 tick ごとに champ-select の gameId を確認し、変わっていればウォッチを抜ける
- [ ] ウォッチ中: GameStart/InProgress/WaitingForStats/PreEndOfGame/EndOfGame は 15 秒間隔、それ以外は 5 秒間隔
- [ ] ウォッチ中: detector の前回フェーズを更新する。None/Lobby では自分のチャンピオンなどをリセットする
- [ ] ウォッチ中に接続が切れたら、通常のプロセススキャンと再接続に戻る。クライアントが終了したらウォッチを解除する
- [ ] `resume_polling()`: 一時停止中だけ、一時停止とウォッチを解除し、基本間隔でタイマーを再開する
- [ ] Refresh ボタン: 対戦リストをクリア → resume_polling → 即時チェック
- [ ] ON/OFF の切り替え: OFF にしたときウォッチ中なら解除し、次の tick で基本間隔に戻す

### 切断時
- [ ] クライアントプロセスがなくなったら、チャンピオン、敵 set、各キャッシュ、ロック、summonerId の取得失敗カウンター、前回フェーズ、gameId、ウォッチ、一時停止をすべてリセットする
- [ ] 切断時に matchup をクリアする通知は出さない（UI は表示を保持する）

### champion_data
- [ ] champions.json を読み込む（スクリプト実行時はカレントディレクトリからの相対パス、パッケージ版は同梱パス）。ファイルがない、または壊れていれば空の dict で起動を続ける
- [ ] `get_champion`: キー（lower）の完全一致 → 英語名/日本語名（lower）の完全一致 → None
- [ ] `search`: 英語名/日本語名/キーへの部分一致（大文字小文字を区別しない）、英語名順、`display_name "EN (JP)"`（本体では未使用）
- [ ] オートコンプリート: 全チャンピオンを英語名順に、`"EN - JP"` で部分一致（大文字小文字を区別しない）、最大 10 件表示
- [ ] 補完で確定したら、入力欄には**チャンピオンキー**（lower ID）を入れる
- [ ] 補完ポップアップの見た目（最小 200×350、ダークスタイル、枠なしのポップアップ）
- [ ] 対戦相手の入力欄: 空のときに左クリックするとコンテキスト候補（他のビューアで開いているチャンピオンなど）を表示する（strip、空を除外、大文字小文字を無視した重複排除で順序維持、空ならポップアップを出さない、provider の例外に耐える）
- [ ] 対戦相手の入力欄: 入力したら通常の候補に戻してコンテキスト用ポップアップを閉じる。確定したら次の tick で通常モデルに戻す
- [ ] テストやヘッドレス環境ではポップアップを開かない
- [ ] （無効化中）アイコン付きの補完項目の描画（40px アイコン + 英語名 + 薄い日本語名、行の高さ 50）。復活させるか判断する
- [ ] デバッグ用の入力欄にも補完を付ける

### アイコンキャッシュ
- [ ] アイコンの URL は champions.json の `image_url`（DDragon の CDN、バージョン付き）をそのまま使う
- [ ] 保存先: `LOL_VIEWER_ICON_CACHE_DIR` → `%LOCALAPPDATA%` → OS の汎用キャッシュ → 一時ディレクトリ、の下の `LoLViewer/cache/champion_icons`。自動で作成する
- [ ] アプリ名の設定によって WebView のプロファイル（Cookie・ログイン）の場所が変わらないようにする
- [ ] メモリキャッシュ（URL → 画像、プロセスの間ずっと保持）
- [ ] ディスクキャッシュ: ファイル名は `sha256(url).png`。ディスクにあれば同期で即座に返す
- [ ] 壊れたキャッシュファイルは削除して再ダウンロードに回す
- [ ] アトミックな書き込み（`.tmp` → rename）。raw バイトをそのまま保存する。書き込みに失敗したら tmp を掃除する
- [ ] 同じ URL へのダウンロード中の要求はまとめる（コールバックを追加するだけ）
- [ ] callback なしで呼ばれたときはダウンロードしない
- [ ] ダウンロードの失敗やデコードの失敗ではコールバックを呼ばない。ただし処理中の印は必ず解除して、次回は再試行できるようにする
- [ ] プロセス全体で 1 つのキャッシュインスタンスを共有する（遅延生成）
- [ ] 起動のたびに prune する: 現在の champions.json にない `^[0-9a-f]{64}\.png(\.tmp)?$` のファイルだけを削除し、それ以外のファイルには触れない。失敗しても起動は止めない
- [ ] アイコンがすべてキャッシュ済みなら、起動してビューアを開いてもダウンロードは 0 回

### データ生成・データファイル
- [ ] champions.json の構造（キー = lower 化した DDragon ID、english_name / japanese_name / image_url / id / lanes{top,jg,mid,bot,sup}）
- [ ] 週 1 回の自動更新（GitHub Actions: DDragon の最新版、en_US と ja_JP、CSV のレーンをマージ、PR を作成）
- [ ] 日本語名がなければ英語名で代用する
- [ ] champion_lane.csv（name,top,jg,mid,bot,sup、0〜5 のスコア）を生成時にマージする。CSV にないチャンピオンは全部 0
- [ ] Wukong のキーの不一致（CSV は `wukong`、JSON は `monkeyking`）を修正する（現在は lanes が全部 0）
- [ ] 2 つの生成器（workflow と scripts/fetch_champions.py）の差異を解消する
- [ ] レーン適性スコアを使った対戦行への配置（敵 / レーンのない味方は最高スコアの空き行、同点は上の行、データがなければ最初の空き行）。行とキーの対応は `top,jg,mid,bot,sup`。LCU のレーン名（top/jungle/middle/bottom/support）と行の対応
- [ ] champions.json をアプリのパッケージに同梱する。ビルド前に存在を確認する

### 未実装（設計書のみ。移植対象外だが記録として）
- [ ] （参考）lockfile による認証情報の取得
- [ ] （参考）LCU WebSocket（WAMP）によるイベント駆動の検知
- [ ] （参考）Live Client Data API（127.0.0.1:2999）
- [ ] （参考）Ban 情報の取得
