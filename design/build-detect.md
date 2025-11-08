# タスク5: チャンピオン自動検知機能の設計

## 概要

TODO項目5の実装：
「LoLのゲーム内で自分が使っているチャンピオンを検知し、このアプリ内でそのチャンピオンのビルドページが自動で開かれるようにする」

## 目的

プレイヤーがLoL（League of Legends）のゲーム中に使用しているチャンピオンを自動的に検知し、そのチャンピオンのビルドページ（LoLAnalytics）をアプリ内で自動的に開く機能を実装する。

---

## アプローチの選択肢

### 1. **LCU API (League Client Update API)** ⭐ 推奨
- **概要**: LoLクライアントがローカルで提供する公式REST API
- **メリット**:
  - Riot Gamesが許可している方法
  - チャンピオン選択フェーズとゲーム中の両方で使用可能
  - WebSocketによるリアルタイムイベント通知が可能
  - 豊富なゲーム情報を取得可能
- **デメリット**:
  - 非公式サポート（将来的に変更される可能性あり）
  - ポート番号とパスワードの動的取得が必要

### 2. **Live Client Data API** ⭐ 推奨（併用）
- **概要**: ゲーム中のみ利用可能なローカルAPI
- **メリット**:
  - 認証不要
  - シンプルなエンドポイント
  - インゲーム情報に特化
- **デメリット**:
  - ゲーム中のみ利用可能（チャンピオン選択フェーズでは使えない）
  - 自己署名証明書の処理が必要

### 3. **Riot Games公式API**
- **概要**: Webベースの公式API
- **メリット**: 公式サポート
- **デメリット**:
  - リアルタイム検知には不向き
  - APIキーとレート制限
  - 試合後のデータ取得が主目的

### 4. **ログファイル解析**
- **メリット**: 追加認証不要
- **デメリット**:
  - リアルタイム性に欠ける
  - ログフォーマットの変更リスク
  - 信頼性が低い

### 5. **メモリ読み取り**
- **却下理由**: Riot Games利用規約（ToS）違反の可能性が高い

---

## 推奨実装アプローチ

**LCU API単独アプローチ** ⭐ **最適解**

チャンピオン選択時に確定したチャンピオンはゲーム中変わらないため、**LCU APIのみで十分**です。

### 実装方針

1. **チャンピオン選択の監視**: LCU APIを使用
   - `/lol-champ-select/v1/session` でチャンピオン選択を検知
   - WebSocketイベントでリアルタイム更新（推奨）
   - **自分のチャンピオン**: `myTeam[localPlayerCellId].championId`
   - **相手のチャンピオン**: `theirTeam[]` から全員取得可能 → タスク7で利用
   - **Ban情報**: `bans.myTeamBans` / `bans.theirTeamBans`

2. **状態管理**: `/lol-gameflow/v1/session` でゲームフェーズを監視
   - `ChampSelect`: チャンピオン選択中 → ここで検知
   - `InProgress`: ゲーム中 → 選択済みチャンピオンを保持
   - `None`: メインメニュー → 状態をリセット

3. **Live Client Data API**: オプション（非推奨）
   - ゲーム中のリアルタイムステータス取得には有用
   - チャンピオン検知には不要（選択時に確定済み）

---

## LCU API 詳細

### 認証方法

#### 1. Lockfileからの取得（推奨）

**Lockfileの場所**:
- Windows: `C:\Riot Games\League of Legends\lockfile`
- または: `%LocalAppData%\Riot Games\Riot Client\Config\lockfile`

**Lockfileのフォーマット**:
```
LeagueClient:<PID>:<PORT>:<PASSWORD>:<PROTOCOL>
```

例:
```
LeagueClient:12345:54321:abcdefghijklmnop:https
```

**解析方法**:
```python
def read_lockfile():
    lockfile_path = r"C:\Riot Games\League of Legends\lockfile"
    with open(lockfile_path, 'r') as f:
        data = f.read().split(':')
        return {
            'process': data[0],
            'pid': data[1],
            'port': data[2],
            'password': data[3],
            'protocol': data[4]
        }
```

#### 2. プロセスコマンドラインからの取得（代替手段）

**Windows**:
```bash
wmic PROCESS WHERE name='LeagueClientUx.exe' GET commandline
```

コマンドライン引数から以下を抽出:
- `--app-port=<PORT>`
- `--remoting-auth-token=<PASSWORD>`

**認証ヘッダーの作成**:
```python
import base64

def create_auth_header(password):
    username = "riot"
    credentials = f"{username}:{password}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return f"Basic {encoded}"
```

### 基本リクエスト

```python
import requests
import urllib3

# 自己署名証明書の警告を無視
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def make_lcu_request(port, password, endpoint):
    base_url = f"https://127.0.0.1:{port}"
    headers = {
        'Authorization': create_auth_header(password)
    }
    response = requests.get(
        f"{base_url}{endpoint}",
        headers=headers,
        verify=False  # 自己署名証明書を許可
    )
    return response.json()
```

### 主要エンドポイント

#### 1. ゲームフロー状態の取得
```
GET /lol-gameflow/v1/session
```

**レスポンス例**:
```json
{
  "phase": "InProgress",  // None, Lobby, ChampSelect, GameStart, InProgress, WaitingForStats
  "gameData": {
    "queue": {
      "gameMode": "CLASSIC"
    }
  }
}
```

#### 2. チャンピオン選択セッション（最重要）
```
GET /lol-champ-select/v1/session
```

**レスポンス例**:
```json
{
  "localPlayerCellId": 0,
  "myTeam": [
    {
      "cellId": 0,
      "championId": 22,
      "championPickIntent": 22,
      "summonerId": 12345,
      "spell1Id": 4,
      "spell2Id": 14,
      "assignedPosition": "bottom"
    }
  ],
  "theirTeam": [
    {
      "cellId": 0,
      "championId": 51,
      "summonerId": 67890
    },
    {
      "cellId": 1,
      "championId": 238,
      "summonerId": 67891
    }
  ],
  "bans": {
    "myTeamBans": [157, 555, 221],
    "theirTeamBans": [234, 875, 350],
    "numBans": 6
  },
  "timer": {
    "phase": "BAN_PICK",
    "adjustedTimeLeftInPhase": 30000
  }
}
```

**重要フィールド**:
- `localPlayerCellId`: 自分のcellId（myTeamから自分を特定）
- `myTeam[]`: 自分のチームの全情報
- `theirTeam[]`: **相手チームの全情報** → タスク7で使用！
- `bans`: Ban情報（championIdの配列）
- `championId`: チャンピオンのID（Data Dragonで名前に変換可能）

#### 3. 現在のサモナー情報
```
GET /lol-summoner/v1/current-summoner
```

### WebSocketイベント監視

#### 接続方法

**エンドポイント**:
```
wss://127.0.0.1:<PORT>/
```

**プロトコル**: WAMP 1.0（WebSocket Application Messaging Protocol）

**接続例（Python）**:
```python
import websocket
import json
import ssl

def on_message(ws, message):
    data = json.loads(message)
    if len(data) >= 3:
        opcode = data[0]
        if opcode == 8:  # Event
            event_type = data[1]
            event_data = data[2]
            print(f"Event: {event_type}")
            print(f"Data: {event_data}")

def connect_websocket(port, password):
    ws_url = f"wss://127.0.0.1:{port}/"
    headers = {
        'Authorization': create_auth_header(password)
    }

    ws = websocket.WebSocketApp(
        ws_url,
        header=headers,
        on_message=on_message
    )

    # 自己署名証明書を許可
    ws.run_forever(sslopt={"cert_reqs": ssl.CERT_NONE})
```

#### イベントの購読

**購読メッセージの送信**:
```python
# すべてのイベントを購読
subscribe_message = [5, "OnJsonApiEvent"]
ws.send(json.dumps(subscribe_message))

# 特定のエンドポイントのみ購読
subscribe_champ_select = [5, "OnJsonApiEvent_lol-champ-select_v1_session"]
ws.send(json.dumps(subscribe_champ_select))
```

**WAMP 1.0 Opcodes**:
- `5`: Subscribe（購読）
- `6`: Unsubscribe（購読解除）
- `8`: Event（イベント通知）

#### 主要イベント

1. **OnJsonApiEvent**: すべてのJSON APIイベント
2. **OnJsonApiEvent_lol-champ-select_v1_session**: チャンピオン選択の変更
3. **OnJsonApiEvent_lol-gameflow_v1_session**: ゲームフロー状態の変更
4. **OnSummonerSelectedChampion**: プレイヤーがチャンピオンを選択
5. **OnChampSelectTurnToPick**: ピック/バンのターン
6. **OnSessionUpdated**: セッション更新

---

## Live Client Data API 詳細

> **注意**: チャンピオン検知にはLCU APIで十分なため、このAPIは**オプション**です。
> ゲーム中のリアルタイム統計情報（HP、ゴールド、レベルなど）を取得したい場合のみ使用してください。

### 基本情報

- **ベースURL**: `https://127.0.0.1:2999/liveclientdata/`
- **認証**: 不要
- **利用可能時期**: ゲーム中のみ（チャンピオン選択中は利用不可）
- **証明書**: 自己署名証明書（SSL検証をスキップする必要あり）
- **用途**: ゲーム中のリアルタイム統計（チャンピオン検知には不要）

### 主要エンドポイント

#### 1. アクティブプレイヤー情報（最重要）
```
GET https://127.0.0.1:2999/liveclientdata/activeplayer
```

**レスポンス例**:
```json
{
  "abilities": {
    "Passive": {...},
    "Q": {...},
    "W": {...},
    "E": {...},
    "R": {...}
  },
  "championStats": {
    "abilityPower": 0,
    "armor": 36,
    "armorPenetrationFlat": 0,
    "attackDamage": 61.11,
    "currentHealth": 580,
    "maxHealth": 580
  },
  "currentGold": 500,
  "level": 1,
  "summonerName": "PlayerName"
}
```

#### 2. 全ゲームデータ
```
GET https://127.0.0.1:2999/liveclientdata/allgamedata
```

**レスポンス例**:
```json
{
  "activePlayer": {
    "summonerName": "PlayerName"
  },
  "allPlayers": [
    {
      "championName": "Ashe",
      "isBot": false,
      "isDead": false,
      "items": [...],
      "level": 1,
      "position": "BOTTOM",
      "rawChampionName": "game_character_displayname_Ashe",
      "summonerName": "PlayerName",
      "team": "ORDER"
    }
  ],
  "gameData": {
    "gameMode": "CLASSIC",
    "gameTime": 45.5,
    "mapName": "Map11",
    "mapNumber": 11
  }
}
```

**重要**: `allPlayers`配列から`activePlayer.summonerName`と一致するプレイヤーを見つけることで、チャンピオン名を取得できます。

#### 3. その他のエンドポイント

```
GET /liveclientdata/activeplayername       # プレイヤー名のみ
GET /liveclientdata/activeplayerabilities  # アビリティ情報
GET /liveclientdata/activeplayerrunes      # ルーン情報
GET /liveclientdata/playerlist             # 全プレイヤーリスト
GET /liveclientdata/gamestats              # ゲーム統計
GET /liveclientdata/eventdata              # ゲームイベント
```

### リクエスト実装例

```python
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def get_current_champion():
    """
    ゲーム中のチャンピオン名を取得
    """
    try:
        # 全ゲームデータを取得
        response = requests.get(
            "https://127.0.0.1:2999/liveclientdata/allgamedata",
            verify=False,
            timeout=5
        )

        if response.status_code == 200:
            data = response.json()
            active_player_name = data['activePlayer']['summonerName']

            # 全プレイヤーからアクティブプレイヤーを探す
            for player in data['allPlayers']:
                if player['summonerName'] == active_player_name:
                    champion_name = player['championName']
                    return champion_name

        return None
    except requests.exceptions.RequestException:
        # ゲーム中でない場合は接続エラー
        return None
```

---

## 実装アーキテクチャ

### 全体構成

```
┌─────────────────────────────────────────┐
│         lol-viewer Application          │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐  │
│  │   Champion Detection Service      │  │
│  ├───────────────────────────────────┤  │
│  │ • LCU Connection Manager          │  │
│  │ • Live Client Monitor             │  │
│  │ • Game Phase Tracker              │  │
│  │ • Event Listener (WebSocket)      │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │   UI Controller                   │  │
│  ├───────────────────────────────────┤  │
│  │ • WebView Manager                 │  │
│  │ • Auto-open LoLAnalytics          │  │
│  └───────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
           │                    │
           ▼                    ▼
    ┌──────────┐         ┌──────────────┐
    │ LCU API  │         │ Live Client  │
    │(Dynamic  │         │  Data API    │
    │  Port)   │         │  (Port 2999) │
    └──────────┘         └──────────────┘
```

### 状態遷移図

```
┌─────────┐  Client Start   ┌──────────────┐  Enter Queue   ┌──────────────┐
│  Idle   │ ───────────────→│ Connected to │ ──────────────→│ Champ Select │
│  State  │                 │     LCU      │                │    Phase     │
└─────────┘                 └──────────────┘                └──────────────┘
                                                                    │
                                                                    │ Lock In
                                                                    ▼
┌─────────┐  Game End    ┌──────────────┐  Game Start    ┌──────────────┐
│  Stats  │ ←───────────│  In Progress │ ←──────────────│ Game Loading │
│  Screen │             │   (In-Game)  │                │              │
└─────────┘             └──────────────┘                └──────────────┘
```

### モジュール構成

#### 1. **LCUConnectionManager**
```python
class LCUConnectionManager:
    """LCU APIへの接続を管理"""

    def __init__(self):
        self.port = None
        self.password = None
        self.connected = False

    def connect(self):
        """Lockfileからポートとパスワードを取得して接続"""
        pass

    def is_client_running(self):
        """LoLクライアントが起動しているか確認"""
        pass

    def get_auth_header(self):
        """認証ヘッダーを返す"""
        pass
```

#### 2. **GamePhaseTracker**
```python
class GamePhaseTracker:
    """ゲームフェーズを追跡"""

    def __init__(self, lcu_manager):
        self.lcu_manager = lcu_manager
        self.current_phase = "None"

    def update_phase(self):
        """現在のゲームフェーズを更新"""
        # GET /lol-gameflow/v1/session
        pass

    def is_in_champ_select(self):
        return self.current_phase == "ChampSelect"

    def is_in_game(self):
        return self.current_phase == "InProgress"
```

#### 3. **ChampionDetector**
```python
class ChampionDetector:
    """チャンピオン検知のメインロジック"""

    def __init__(self, lcu_manager, phase_tracker):
        self.lcu_manager = lcu_manager
        self.phase_tracker = phase_tracker
        self.current_champion = None

    def detect_champion(self):
        """現在のチャンピオンを検知"""
        if self.phase_tracker.is_in_champ_select():
            return self._detect_from_champ_select()
        elif self.phase_tracker.is_in_game():
            return self._detect_from_live_client()
        return None

    def _detect_from_champ_select(self):
        """チャンピオン選択画面から検知（LCU API）"""
        # GET /lol-champ-select/v1/session
        pass

    def _detect_from_live_client(self):
        """ゲーム中から検知（Live Client Data API）"""
        # GET https://127.0.0.1:2999/liveclientdata/allgamedata
        pass
```

#### 4. **ChampionEventListener**
```python
class ChampionEventListener:
    """WebSocketでリアルタイムイベントを監視"""

    def __init__(self, lcu_manager, on_champion_changed):
        self.lcu_manager = lcu_manager
        self.on_champion_changed = on_champion_changed
        self.ws = None

    def start(self):
        """WebSocket接続を開始"""
        pass

    def stop(self):
        """WebSocket接続を停止"""
        pass

    def _handle_event(self, event_data):
        """イベント処理"""
        pass
```

#### 5. **AutoOpenController**
```python
class AutoOpenController:
    """チャンピオン検知時に自動でページを開く"""

    def __init__(self, webview_manager):
        self.webview_manager = webview_manager
        self.last_champion = None

    def on_champion_detected(self, champion_name):
        """チャンピオンが検知されたときの処理"""
        if champion_name != self.last_champion:
            self.last_champion = champion_name
            url = f"https://lolalytics.com/lol/{champion_name.lower()}/build/"
            self.webview_manager.open_url(url)
```

---

## 実装フロー

### 1. アプリケーション起動時

```python
def initialize_champion_detection():
    # 1. LCU接続マネージャーを初期化
    lcu_manager = LCUConnectionManager()

    # 2. LoLクライアントの起動を監視（バックグラウンドスレッド）
    while True:
        if lcu_manager.is_client_running():
            if lcu_manager.connect():
                print("LoLクライアントに接続しました")
                break
        time.sleep(5)  # 5秒ごとにチェック

    # 3. ゲームフェーズトラッカーを開始
    phase_tracker = GamePhaseTracker(lcu_manager)

    # 4. チャンピオン検知器を初期化
    detector = ChampionDetector(lcu_manager, phase_tracker)

    # 5. WebSocketイベントリスナーを開始
    listener = ChampionEventListener(
        lcu_manager,
        on_champion_changed=handle_champion_change
    )
    listener.start()

    return detector
```

### 2. チャンピオン検知ループ

**方法A: ポーリング方式（シンプル）**
```python
def polling_loop(detector, auto_open_controller):
    while True:
        champion = detector.detect_champion()
        if champion:
            auto_open_controller.on_champion_detected(champion)
        time.sleep(2)  # 2秒ごとにチェック
```

**方法B: イベント駆動方式（推奨）**
```python
def event_driven_detection(listener, detector, auto_open_controller):
    def on_game_event(event):
        # ゲームフェーズが変更されたら
        if event.type == "gameflow_changed":
            champion = detector.detect_champion()
            if champion:
                auto_open_controller.on_champion_detected(champion)

        # チャンピオン選択が変更されたら
        elif event.type == "champ_select_updated":
            champion = detector.detect_champion()
            if champion:
                auto_open_controller.on_champion_detected(champion)

    listener.on_event = on_game_event
    listener.start()
```

### 3. エラーハンドリング

```python
def robust_detection():
    try:
        # LCU APIを試す
        champion = detect_from_lcu()
        if champion:
            return champion
    except ConnectionError:
        pass

    try:
        # Live Client Data APIを試す
        champion = detect_from_live_client()
        if champion:
            return champion
    except ConnectionError:
        pass

    # どちらも失敗した場合
    return None
```

---

## 技術的課題と解決策

### 1. **ポート番号の動的変更**

**問題**: LCU APIのポートはクライアント起動ごとに変わる

**解決策**:
- Lockfileを定期的に読み取る
- ファイル監視（`watchdog`ライブラリ）でLockfileの変更を検知
- プロセスコマンドラインからポートを取得

```python
import psutil

def get_lcu_port_from_process():
    for proc in psutil.process_iter(['name', 'cmdline']):
        if proc.info['name'] == 'LeagueClientUx.exe':
            cmdline = ' '.join(proc.info['cmdline'])
            # --app-port=12345 を抽出
            match = re.search(r'--app-port=(\d+)', cmdline)
            if match:
                return int(match.group(1))
    return None
```

### 2. **自己署名証明書**

**問題**: LCU APIとLive Client Data APIは自己署名証明書を使用

**解決策**:
- `requests`ライブラリで`verify=False`を使用
- SSL警告を無視: `urllib3.disable_warnings()`
- または、Riot Gamesのルート証明書を取得して検証

```python
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# リクエスト時
requests.get(url, verify=False)
```

### 3. **チャンピオンIDから名前への変換**

**問題**: LCU APIはチャンピオンIDを返す（例: `22`）

**解決策**: Data Dragon APIを使用してチャンピオンデータを取得

```python
import requests

def load_champion_data():
    """Data DragonからチャンピオンデータをDL"""
    url = "https://ddragon.leagueoflegends.com/cdn/13.24.1/data/en_US/champion.json"
    response = requests.get(url)
    data = response.json()

    # ID -> 名前のマッピングを作成
    champion_map = {}
    for champ_name, champ_data in data['data'].items():
        champ_id = int(champ_data['key'])
        champion_map[champ_id] = champ_name

    return champion_map

# 使用例
champion_map = load_champion_data()
champion_name = champion_map.get(22)  # "Ashe"
```

**最新バージョンの取得**:
```python
def get_latest_version():
    url = "https://ddragon.leagueoflegends.com/api/versions.json"
    response = requests.get(url)
    versions = response.json()
    return versions[0]  # 最新バージョン
```

### 4. **クライアント未起動時の処理**

**問題**: LoLクライアントが起動していない場合の検知

**解決策**:
- プロセス監視でクライアント起動を検知
- バックグラウンドスレッドで定期的にチェック
- 接続失敗時は再接続を試みる

```python
def wait_for_client():
    print("LoLクライアントの起動を待機中...")
    while True:
        if is_lol_client_running():
            print("LoLクライアントを検知しました")
            return True
        time.sleep(5)

def is_lol_client_running():
    for proc in psutil.process_iter(['name']):
        if proc.info['name'] in ['LeagueClient.exe', 'LeagueClientUx.exe']:
            return True
    return False
```

### 5. **複数試合の連続プレイ**

**問題**: 試合終了後、次の試合で新しいチャンピオンを検知

**解決策**:
- ゲームフェーズの遷移を監視
- `WaitingForStats` → `None` → `ChampSelect` の流れを追跡
- 前回のチャンピオンをクリアして新しい検知を待つ

```python
def on_phase_changed(new_phase):
    global current_champion

    if new_phase == "None":
        # ゲーム終了、チャンピオンをクリア
        current_champion = None
    elif new_phase == "ChampSelect":
        # 新しいチャンピオン選択開始
        detect_new_champion()
```

---

## 統合実装例

### 完全な実装サンプル

```python
import requests
import urllib3
import json
import time
import base64
from threading import Thread

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class LoLChampionDetector:
    def __init__(self):
        self.lcu_port = None
        self.lcu_password = None
        self.current_champion = None
        self.champion_map = self.load_champion_map()
        self.running = False

    def load_champion_map(self):
        """チャンピオンIDと名前のマッピングを読み込み"""
        try:
            version_url = "https://ddragon.leagueoflegends.com/api/versions.json"
            version = requests.get(version_url).json()[0]

            champion_url = f"https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json"
            data = requests.get(champion_url).json()

            return {int(v['key']): k for k, v in data['data'].items()}
        except Exception as e:
            print(f"チャンピオンデータの読み込みエラー: {e}")
            return {}

    def read_lockfile(self):
        """Lockfileを読み取ってポートとパスワードを取得"""
        lockfile_path = r"C:\Riot Games\League of Legends\lockfile"
        try:
            with open(lockfile_path, 'r') as f:
                data = f.read().split(':')
                self.lcu_port = data[2]
                self.lcu_password = data[3]
                return True
        except FileNotFoundError:
            return False

    def make_lcu_request(self, endpoint):
        """LCU APIリクエストを送信"""
        if not self.lcu_port or not self.lcu_password:
            return None

        auth = base64.b64encode(f"riot:{self.lcu_password}".encode()).decode()
        headers = {'Authorization': f'Basic {auth}'}
        url = f"https://127.0.0.1:{self.lcu_port}{endpoint}"

        try:
            response = requests.get(url, headers=headers, verify=False, timeout=5)
            if response.status_code == 200:
                return response.json()
        except Exception:
            pass
        return None

    def get_gameflow_phase(self):
        """現在のゲームフェーズを取得"""
        data = self.make_lcu_request("/lol-gameflow/v1/session")
        if data:
            return data.get('phase', 'None')
        return 'None'

    def detect_from_champ_select(self):
        """チャンピオン選択画面から検知"""
        data = self.make_lcu_request("/lol-champ-select/v1/session")
        if not data:
            return None

        local_player_cell_id = data.get('localPlayerCellId')
        if local_player_cell_id is None:
            return None

        # 自分のチームから自分のセルを探す
        for player in data.get('myTeam', []):
            if player.get('cellId') == local_player_cell_id:
                champion_id = player.get('championId', 0)
                if champion_id > 0:
                    return self.champion_map.get(champion_id)

        return None

    def detect_champion(self):
        """現在のチャンピオンを検知（LCU API単独）"""
        phase = self.get_gameflow_phase()

        if phase == 'ChampSelect':
            # チャンピオン選択中 - LCU APIから取得
            champion = self.detect_from_champ_select()
            if champion:
                # 選択されたチャンピオンを記憶（ゲーム中も使用）
                self.current_champion = champion
            return champion

        elif phase == 'InProgress':
            # ゲーム中 - 選択時のチャンピオンを保持
            return self.current_champion

        elif phase == 'None' or phase == 'Lobby':
            # メインメニュー/ロビー - 状態をリセット
            self.current_champion = None
            return None

        return self.current_champion

    def start_monitoring(self, callback):
        """監視を開始"""
        self.running = True

        def monitor_loop():
            while self.running:
                # Lockfileを読み取る
                self.read_lockfile()

                # チャンピオンを検知
                champion = self.detect_champion()

                # 変更があればコールバックを呼ぶ
                if champion and champion != self.current_champion:
                    self.current_champion = champion
                    callback(champion)

                time.sleep(2)

        thread = Thread(target=monitor_loop, daemon=True)
        thread.start()

    def stop_monitoring(self):
        """監視を停止"""
        self.running = False

# 使用例
def on_champion_detected(champion_name):
    print(f"チャンピオン検知: {champion_name}")
    url = f"https://lolalytics.com/lol/{champion_name.lower()}/build/"
    print(f"自動で開くURL: {url}")
    # ここでWebViewを開く処理を実装

if __name__ == "__main__":
    detector = LoLChampionDetector()
    detector.start_monitoring(on_champion_detected)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        detector.stop_monitoring()
```

---

## Qt/PySideへの統合

### QTimerを使用した実装

```python
from PySide6.QtCore import QTimer, QObject, Signal
from PySide6.QtWidgets import QApplication

class ChampionDetectorService(QObject):
    champion_detected = Signal(str)  # チャンピオン名を通知

    def __init__(self):
        super().__init__()
        self.detector = LoLChampionDetector()
        self.timer = QTimer()
        self.timer.timeout.connect(self.check_champion)
        self.last_champion = None

    def start(self):
        """検知を開始（2秒ごと）"""
        self.timer.start(2000)

    def stop(self):
        """検知を停止"""
        self.timer.stop()

    def check_champion(self):
        """チャンピオンをチェック"""
        self.detector.read_lockfile()
        champion = self.detector.detect_champion()

        if champion and champion != self.last_champion:
            self.last_champion = champion
            self.champion_detected.emit(champion)

# メインウィンドウでの使用
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.detector_service = ChampionDetectorService()
        self.detector_service.champion_detected.connect(self.on_champion_detected)
        self.detector_service.start()

    def on_champion_detected(self, champion_name):
        """チャンピオンが検知されたときの処理"""
        url = f"https://lolalytics.com/lol/{champion_name.lower()}/build/"
        self.webview.load(url)  # WebViewでURLを開く
```

---

## テスト方法

### 1. LCU接続テスト

```python
def test_lcu_connection():
    detector = LoLChampionDetector()
    if detector.read_lockfile():
        print(f"✓ Lockfile読み取り成功")
        print(f"  ポート: {detector.lcu_port}")
        print(f"  パスワード: {detector.lcu_password[:4]}...")
    else:
        print("✗ Lockfileが見つかりません")

    phase = detector.get_gameflow_phase()
    print(f"✓ ゲームフェーズ: {phase}")
```

### 2. チャンピオン選択テスト

```python
def test_champ_select():
    detector = LoLChampionDetector()
    detector.read_lockfile()

    # チャンピオン選択画面に入ってから実行
    champion = detector.detect_from_champ_select()
    if champion:
        print(f"✓ 検知成功: {champion}")
    else:
        print("✗ チャンピオンが検知されませんでした")
```

### 3. ゲーム中テスト

```python
def test_in_game():
    detector = LoLChampionDetector()

    # ゲーム中に実行
    champion = detector.detect_from_live_client()
    if champion:
        print(f"✓ 検知成功: {champion}")
    else:
        print("✗ ゲームが開始されていません")
```

### 4. 統合テスト

```python
def integration_test():
    print("=== 統合テスト開始 ===")

    def callback(champion):
        print(f"[コールバック] チャンピオン検知: {champion}")

    detector = LoLChampionDetector()
    detector.start_monitoring(callback)

    print("監視中... (Ctrl+Cで停止)")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        detector.stop_monitoring()
        print("\n=== テスト終了 ===")
```

---

## パフォーマンス最適化

### 1. ポーリング間隔の調整

```python
# 状態に応じてポーリング間隔を変更
def adaptive_polling():
    phase = get_gameflow_phase()

    if phase in ['ChampSelect', 'InProgress']:
        return 1  # 1秒（アクティブ時）
    elif phase == 'Lobby':
        return 3  # 3秒（待機時）
    else:
        return 5  # 5秒（非アクティブ時）
```

### 2. キャッシング

```python
class CachedDetector:
    def __init__(self):
        self.cache = {}
        self.cache_duration = 5  # 5秒間キャッシュ

    def get_gameflow_phase(self):
        now = time.time()
        if 'phase' in self.cache:
            cached_time, cached_value = self.cache['phase']
            if now - cached_time < self.cache_duration:
                return cached_value

        phase = self._fetch_gameflow_phase()
        self.cache['phase'] = (now, phase)
        return phase
```

### 3. 非同期処理

```python
import asyncio
import aiohttp

async def async_detect_champion():
    async with aiohttp.ClientSession() as session:
        # 並行してLCUとLive Clientをチェック
        tasks = [
            fetch_lcu_data(session),
            fetch_live_client_data(session)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if result and not isinstance(result, Exception):
                return result
        return None
```

---

## セキュリティとプライバシー

### 1. **ローカル処理のみ**
- すべての処理はローカルで完結
- 外部サーバーへのチャンピオン情報送信なし
- Data Dragon APIのみ利用（公開データ）

### 2. **認証情報の取り扱い**
- パスワードはメモリ上でのみ保持
- ログに記録しない
- ファイルに保存しない

### 3. **利用規約の遵守**
- Riot Games Developer Policyに準拠
- メモリ改ざんは行わない
- ゲームプレイに影響を与えない

---

## 今後の拡張可能性

### 1. タスク7への応用 ✅
「LoLのBanPick画面で相手が選択したチャンピオン5体のカウンターページを自動で開く」

**完全実装可能！** 同じ`/lol-champ-select/v1/session`エンドポイントで取得可能。

**実装方法**:
```python
def detect_enemy_champions():
    """相手チーム5体のチャンピオンを検知"""
    data = make_lcu_request("/lol-champ-select/v1/session")
    enemy_champions = []

    # theirTeamから相手全員のチャンピオンIDを取得
    for player in data.get('theirTeam', []):
        champion_id = player.get('championId', 0)
        if champion_id > 0:
            champion_name = champion_map.get(champion_id)
            if champion_name:
                enemy_champions.append(champion_name)

    return enemy_champions

def auto_open_counter_pages():
    """相手5体のカウンターページを自動で開く"""
    enemy_champions = detect_enemy_champions()

    # 各チャンピオンのカウンターページを開く
    for champion in enemy_champions:
        url = f"https://lolalytics.com/lol/{champion.lower()}/counters/"
        open_new_webview(url)

    print(f"{len(enemy_champions)}体のカウンターページを開きました")
```

**Ban情報も取得可能**:
```python
def get_ban_info():
    """Ban情報を取得"""
    data = make_lcu_request("/lol-champ-select/v1/session")
    bans = data.get('bans', {})

    my_bans = [champion_map.get(cid) for cid in bans.get('myTeamBans', [])]
    their_bans = [champion_map.get(cid) for cid in bans.get('theirTeamBans', [])]

    return my_bans, their_bans
```

### 2. ビルド推奨機能
- 相手チームの構成を分析
- LoLAnalyticsから推奨ビルドを取得
- アイテムビルドの自動提案

### 3. 統計表示
- 勝率、ピック率の表示
- 過去の試合履歴
- パフォーマンストラッキング

---

## 参考リンク

### 公式ドキュメント
- [Riot Developer Portal](https://developer.riotgames.com/)
- [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)
- [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api)

### コミュニティドキュメント
- [LCU API Documentation](https://lcu.kebs.dev/)
- [Riot API Libraries](https://riot-api-libraries.readthedocs.io/en/latest/lcu.html)
- [HextechDocs](https://hextechdocs.dev/) ※現在503エラー

### ライブラリ
- [league-connect (Node.js)](https://www.npmjs.com/package/league-connect)
- [lcu-driver (Python)](https://lcu-driver.readthedocs.io/)
- [lcu-sharp (C#)](https://github.com/bryanhitc/lcu-sharp)

### サンプルコード
- [LCU Connection Examples](https://github.com/Pupix/lcu-connector)
- [Champion Select Session Example](https://gist.github.com/xadamxk/8cb5d21d24bb78d63c5241e97087bb23)

---

## まとめ

タスク5「チャンピオン自動検知機能」とタスク7「相手5体のカウンター表示」は、**LCU API単独**で完全に実装可能です。

### 重要ポイント（改定版）

1. **LCU API単独で十分** - Live Client Data APIは不要
2. **`/lol-champ-select/v1/session`** - このエンドポイント1つで全てのデータを取得
   - 自分のチャンピオン: `myTeam[localPlayerCellId].championId`
   - 相手のチャンピオン: `theirTeam[].championId`（タスク7で使用）
   - Ban情報: `bans.myTeamBans` / `bans.theirTeamBans`
3. **WebSocketイベント**でリアルタイム検知（推奨）
4. **Lockfile**からポートとパスワードを動的取得
5. **Data Dragon**でチャンピオンID→名前変換

### なぜLCU APIだけで十分？

✅ チャンピオンは選択時に確定し、ゲーム中は変わらない
✅ チャンピオン選択フェーズで全情報（自分・相手・Ban）が揃う
✅ シンプルな実装で保守性が高い
✅ 認証が1箇所のみ（Live Client Data APIは別途SSL処理が必要）

### 実装の優先順位（改定版）

1. ✅ **Phase 1**: Lockfile読み取りとLCU接続
2. ✅ **Phase 2**: ゲームフェーズ検知（`/lol-gameflow/v1/session`）
3. ✅ **Phase 3**: チャンピオン選択での検知（`/lol-champ-select/v1/session`）
4. ✅ **Phase 4**: 自分のチャンピオンでビルドページを自動オープン（タスク5）
5. ✅ **Phase 5**: 相手5体でカウンターページを自動オープン（タスク7）
6. 🔄 **Phase 6**: WebSocketイベント統合（リアルタイム更新）
7. 🔄 **Phase 7**: エラーハンドリングと最適化

このドキュメントに基づいて実装を進めることで、シンプルかつ堅牢なチャンピオン自動検知機能を構築できます。
