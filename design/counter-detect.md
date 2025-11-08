# チャンピオンセレクト自動検知機能 設計ドキュメント

## 概要

TODO.md の項目7「LoLのBanPick画面で相手が選択したチャンピオン5体のカウンターページを自動で開く」機能の実装設計書。

## 目的

League of Legends のチャンピオンセレクト画面で、相手チームが選択したチャンピオンを自動検知し、それぞれのカウンターページ（https://lolalytics.com/lol/{champion}/counters/）をアプリ内で自動的に開く。

## 実装方法の調査結果

### 方法1: League Client API (LCU API) を使用【推奨】

#### LCU API とは

- League Client Update の略称で、League of Legends クライアントが内部的に使用しているローカルREST API
- クライアントと同じマシン上で動作するアプリケーションから、チャンピオンセレクト情報などをリアルタイムで取得可能
- 公式にはサポートされていないが、Riot Gamesが承認したエンドポイントのみ使用可能

#### 接続方法

##### 1. 認証情報の取得

LoLクライアントが起動時に生成する `lockfile` から接続情報を取得：

**ファイルパス:**
- Windows: `C:\Riot Games\League of Legends\lockfile`
- macOS: `/Applications/League of Legends.app/Contents/LoL/lockfile`

**フォーマット:**
```
name:pid:port:password:protocol
```

**例:**
```
LeagueClient:13268:63569:xA7Gk2pL9mN4wQ8s:https
```

**構成要素:**
- name: プロセス名（LeagueClient）
- pid: プロセスID
- port: API サーバーのポート番号（ランダムに生成）
- password: 認証パスワード（ランダムに生成）
- protocol: プロトコル（https）

##### 2. API 接続

- URL: `https://127.0.0.1:{port}`
- 認証: Basic認証
  - ユーザー名: `riot`
  - パスワード: lockfile から取得したパスワード
- SSL証明書の検証を無効化する必要あり（自己署名証明書のため）

#### チャンピオンセレクト情報の取得

##### エンドポイント

```
GET /lol-champ-select/v1/session
```

##### レスポンス構造

```json
{
  "myTeam": [
    {
      "cellId": 0,
      "championId": 266,
      "championPickIntent": 0,
      "assignedPosition": "top",
      "selectedSkinId": 266000,
      "spell1Id": 4,
      "spell2Id": 14,
      "summonerId": 123456789,
      "team": 1,
      "wardSkinId": -1,
      "playerType": "HUMAN"
    }
  ],
  "theirTeam": [
    {
      "cellId": 5,
      "championId": 22,
      "championPickIntent": 0,
      "assignedPosition": "bottom",
      "selectedSkinId": 0,
      "spell1Id": 0,
      "spell2Id": 0,
      "summonerId": 0,
      "team": 2,
      "wardSkinId": 0,
      "playerType": "HUMAN"
    }
  ],
  "bans": {
    "myTeamBans": [64, 157, 238],
    "theirTeamBans": [55, 103, 350],
    "numBans": 5
  },
  "timer": {
    "adjustedTimeLeftInPhase": 30000,
    "phase": "PLANNING"
  },
  "allowBattleBoost": false,
  "allowDuplicatePicks": false,
  "allowRerolling": false,
  "localPlayerCellId": 0
}
```

**重要なフィールド:**
- `theirTeam`: 相手チームのプレイヤー情報（配列）
- `theirTeam[].championId`: 相手が選択したチャンピオンID
- `bans.theirTeamBans`: 相手チームのバンしたチャンピオンID（配列）
- `timer.phase`: 現在のフェーズ（PLANNING, BAN_PICK, FINALIZATION など）

#### リアルタイム検知（WebSocket）

##### WebSocket 接続

LCU API は WAMP 1.0 プロトコルを使用した WebSocket をサポート。

**接続URL:**
```
wss://127.0.0.1:{port}/
```

**イベント購読:**
```json
[5, "OnJsonApiEvent"]
```

##### チャンピオンセレクトイベント

`/lol-champ-select/v1/session` エンドポイントへの変更を監視することで、リアルタイムでチャンピオンのピックやバンを検知可能。

**イベント種類:**
- `Create`: セッション開始
- `Update`: セッション更新（チャンピオンピック/バン時）
- `Delete`: セッション終了

#### Python での実装方法

##### lcu-driver ライブラリの使用【推奨】

**インストール:**
```bash
pip install lcu-driver
```

**基本的な実装例:**

```python
from lcu_driver import Connector

connector = Connector()

@connector.ready
async def connect(connection):
    print('LCU API接続完了')

@connector.ws.register('/lol-champ-select/v1/session', event_types=('UPDATE',))
async def champ_select_updated(connection, event):
    """チャンピオンセレクト更新時のイベントハンドラ"""
    session_data = event.data

    # 相手チームのチャンピオンを取得
    their_team = session_data.get('theirTeam', [])

    # championId が 0 でないものを抽出（0 は未選択）
    enemy_champions = [
        player['championId']
        for player in their_team
        if player.get('championId', 0) > 0
    ]

    print(f'相手チーム: {enemy_champions}')

    # ここで各チャンピオンのカウンターページを開く処理を実装
    for champion_id in enemy_champions:
        champion_name = get_champion_name_by_id(champion_id)
        # カウンターページをWebViewで開く
        # open_counter_page(champion_name)

@connector.close
async def disconnect(connection):
    print('LCU API切断')

# 接続開始
connector.start()
```

##### 手動実装の例（requests + websocket-client）

```python
import requests
import json
import base64
import urllib3
from pathlib import Path

# SSL警告を抑制
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def read_lockfile():
    """lockfileから接続情報を読み取る"""
    lockfile_path = Path('C:/Riot Games/League of Legends/lockfile')

    if not lockfile_path.exists():
        raise FileNotFoundError('LoLクライアントが起動していません')

    with open(lockfile_path, 'r') as f:
        data = f.read().split(':')

    return {
        'name': data[0],
        'pid': data[1],
        'port': data[2],
        'password': data[3],
        'protocol': data[4]
    }

def get_lcu_connection():
    """LCU API接続を取得"""
    lockfile = read_lockfile()

    # Basic認証のヘッダーを作成
    auth_string = f"riot:{lockfile['password']}"
    auth_bytes = auth_string.encode('ascii')
    auth_b64 = base64.b64encode(auth_bytes).decode('ascii')

    return {
        'base_url': f"https://127.0.0.1:{lockfile['port']}",
        'headers': {
            'Authorization': f'Basic {auth_b64}'
        }
    }

def get_champ_select_session():
    """チャンピオンセレクト情報を取得"""
    conn = get_lcu_connection()

    response = requests.get(
        f"{conn['base_url']}/lol-champ-select/v1/session",
        headers=conn['headers'],
        verify=False  # 自己署名証明書のため
    )

    if response.status_code == 200:
        return response.json()
    elif response.status_code == 404:
        # チャンピオンセレクト中でない
        return None
    else:
        response.raise_for_status()

# 使用例
session = get_champ_select_session()
if session:
    their_team = session.get('theirTeam', [])
    enemy_champions = [
        player['championId']
        for player in their_team
        if player.get('championId', 0) > 0
    ]
    print(f'相手チーム: {enemy_champions}')
```

#### チャンピオンIDから名前への変換

##### Data Dragon API の使用

Riot Games が提供する静的データAPI「Data Dragon」からチャンピオン情報を取得。

**エンドポイント:**
```
https://ddragon.leagueoflegends.com/cdn/{version}/data/ja_JP/champion.json
```

**最新バージョンの取得:**
```
https://ddragon.leagueoflegends.com/api/versions.json
```

**実装例:**

```python
import requests

def get_latest_version():
    """最新のゲームバージョンを取得"""
    response = requests.get('https://ddragon.leagueoflegends.com/api/versions.json')
    versions = response.json()
    return versions[0]

def get_champion_data():
    """全チャンピオンデータを取得"""
    version = get_latest_version()
    url = f'https://ddragon.leagueoflegends.com/cdn/{version}/data/ja_JP/champion.json'
    response = requests.get(url)
    return response.json()['data']

def build_champion_id_map():
    """championId -> champion key のマップを構築"""
    champion_data = get_champion_data()
    id_map = {}

    for champion_key, champion_info in champion_data.items():
        champion_id = int(champion_info['key'])
        # LoLAnalytics用の小文字名
        champion_name = champion_key.lower()
        id_map[champion_id] = champion_name

    return id_map

# 使用例
champion_map = build_champion_id_map()
champion_id = 22  # Ashe
champion_name = champion_map.get(champion_id)  # 'ashe'
```

### 方法2: 画像認識（OCR/Computer Vision）【代替案】

#### 概要

画面キャプチャとOCR/画像認識を使用してチャンピオン名を検出。

#### メリット
- LCU APIに依存しない
- クライアントのアップデートによる影響を受けにくい

#### デメリット
- 精度が不安定（画面解像度、UI変更などに影響される）
- 処理負荷が高い
- 実装が複雑
- 多言語対応が困難

#### 実装の概要

1. **画面キャプチャ**: `pyautogui` や `mss` で画面をキャプチャ
2. **画像処理**: OpenCV でチャンピオン選択領域を抽出
3. **OCR**: `pytesseract` や `easyocr` でテキスト抽出
4. **または画像認識**: 事前学習済みモデルでチャンピオンアイコンを認識

#### 参考プロジェクト

- [LeagueOCR](https://github.com/floh22/LeagueOCR): League of Legends Spectator Mode用のOCRベースのデータ収集

### 方法3: メモリリーディング【非推奨】

#### 概要

ゲームクライアントのメモリから直接データを読み取る。

#### デメリット
- **Riot Vanguard（アンチチート）に検出される可能性が高い**
- アカウントBANのリスク
- 利用規約違反
- メモリアドレスがアップデートで変更される

#### 結論

**使用すべきではない**

## 推奨実装アプローチ

### 最終推奨: LCU API + lcu-driver

**理由:**
1. **信頼性**: 公式クライアントが使用しているAPIを利用
2. **リアルタイム性**: WebSocketで即座に変更を検知
3. **実装の容易さ**: `lcu-driver` ライブラリで簡潔に実装可能
4. **保守性**: APIの構造が明確でデバッグしやすい
5. **パフォーマンス**: 低負荷でリアルタイム処理が可能

### 実装アーキテクチャ

```
┌─────────────────────┐
│ LoL Client          │
│  (lockfile生成)     │
└──────────┬──────────┘
           │ LCU API (localhost)
           │
┌──────────▼──────────┐
│ LCU Monitor         │
│ (lcu-driver)        │
│                     │
│ - lockfile読取      │
│ - WebSocket接続     │
│ - イベント監視      │
└──────────┬──────────┘
           │ チャンピオンID配列
           │
┌──────────▼──────────┐
│ Champion Resolver   │
│                     │
│ - ID→名前変換       │
│ - Data Dragon使用   │
└──────────┬──────────┘
           │ チャンピオン名配列
           │
┌──────────▼──────────┐
│ UI Controller       │
│ (PyQt6)             │
│                     │
│ - WebView制御       │
│ - カウンターページ  │
│   自動表示          │
└─────────────────────┘
```

## 技術的課題とリスク

### 課題1: LCU APIの非公式性

**問題:**
- LCU APIは公式にサポートされていない
- エンドポイントやデータ構造が予告なく変更される可能性

**対策:**
- Riot Developer Portal でアプリケーションを登録
- 承認されたエンドポイントのみ使用
- コミュニティドキュメント（HextechDocs）を定期的に確認
- エラーハンドリングを厳重に実装

### 課題2: LoLクライアント未起動時の対応

**問題:**
- lockfileが存在しない場合、接続不可

**対策:**
- ファイル監視でlockfileの作成を検知
- 接続失敗時は定期的にリトライ
- ユーザーに適切なエラーメッセージを表示

### 課題3: チャンピオンセレクトフェーズの判定

**問題:**
- チャンピオンセレクト中でない場合、エンドポイントは404を返す

**対策:**
- 404エラーを正常系として処理
- `timer.phase` で現在のフェーズを確認
- 適切なタイミングでのみカウンターページを開く

### 課題4: パフォーマンス

**問題:**
- リアルタイムでの監視による負荷

**対策:**
- WebSocketイベントのみ処理（ポーリング不要）
- 既に開いているチャンピオンは再度開かない
- 非同期処理で UI をブロックしない

### 課題5: Riot Games のポリシー準拠

**問題:**
- 第三者アプリケーションとしてのポリシー遵守が必要

**対策:**
- [Riot Developer Portal](https://developer.riotgames.com/) でアプリケーション登録
- LCU API 使用について明記
- 利用規約に違反しない範囲での実装
- ユーザーデータの適切な取り扱い

## 実装ステップ

### Phase 1: 基本機能の実装

1. **lcu-driver のセットアップ**
   ```bash
   pip install lcu-driver
   ```

2. **LCU 接続テスト**
   - lockfile の読み取り
   - LCU API への接続確認
   - `/lol-champ-select/v1/session` のレスポンス確認

3. **チャンピオンデータの取得**
   - Data Dragon から最新のチャンピオンデータ取得
   - championId → champion name のマッピング構築
   - アプリ起動時にキャッシュ

4. **WebSocket イベントハンドラ実装**
   - チャンピオンセレクトセッション更新の監視
   - 相手チームのチャンピオンID抽出
   - チャンピオン名への変換

### Phase 2: UI統合

5. **既存アプリケーションとの統合**
   - `MainWindow` クラスに LCU Monitor を統合
   - 非同期処理の実装（QtAsyncio または QThread）

6. **自動WebView生成**
   - 相手チャンピオン検知時に `ChampionViewerWidget` を自動生成
   - カウンターページを自動で開く
   - 重複表示の防止

7. **UI/UX の改善**
   - 検知状態のインジケーター表示
   - 設定画面（自動表示ON/OFF など）
   - エラーメッセージの適切な表示

### Phase 3: エラーハンドリングと最適化

8. **エラーハンドリング**
   - LCU 切断時の再接続処理
   - タイムアウト処理
   - 例外の適切な処理とログ

9. **パフォーマンス最適化**
   - 不要なAPI呼び出しの削減
   - メモリ使用量の最適化

10. **テスト**
    - 単体テスト
    - 実際のチャンピオンセレクトでの動作確認
    - エッジケースのテスト

## 必要なライブラリ

### 必須

```
lcu-driver>=2.1.3
requests>=2.31.0
PyQt6>=6.6.0
PyQt6-WebEngine>=6.6.0
```

### 既存の requirements.txt への追加

```python
# requirements.txt に以下を追加
lcu-driver>=2.1.3
requests>=2.31.0
```

## セキュリティとプライバシー

### 注意事項

1. **認証情報の取り扱い**
   - lockfile のパスワードをログに出力しない
   - メモリ上でのみ保持、ディスクに保存しない

2. **ユーザーデータ**
   - サモナー名やアカウント情報を外部に送信しない
   - ローカルでのみ処理を完結

3. **SSL証明書検証**
   - LCU API への接続時のみ無効化
   - 外部APIへの接続では必ず検証を有効化

## Riot Games ポリシーへの対応

### 必須アクション

1. **Developer Portal でアプリケーション登録**
   - URL: https://developer.riotgames.com/
   - LCU API の使用を明記

2. **承認されたエンドポイントの確認**
   - `/lol-champ-select/v1/session` が承認リストに含まれるか確認
   - 最新のポリシードキュメントを参照

3. **利用規約の遵守**
   - Rate Limiting: LCU API使用時にRiot Games APIのレート制限をバイパスしない
   - データ使用: ユーザーのローカル環境でのみデータを使用

4. **アプリケーション公開時**
   - Riot Games への事前連絡
   - 承認取得後に公開

## 参考資料

### 公式・準公式

- [Riot Developer Portal](https://developer.riotgames.com/)
- [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)
- [LCU API Policy Changes](https://www.riotgames.com/en/DevRel/changes-to-the-lcu-api-policy)

### コミュニティドキュメント

- [HextechDocs - LCU API](https://hextechdocs.dev/)
- [Riot API Libraries - LCU](https://riot-api-libraries.readthedocs.io/en/latest/lcu.html)
- [lcu-driver Documentation](https://lcu-driver.readthedocs.io/)

### GitHub リポジトリ

- [lcu-driver](https://github.com/sousa-andre/lcu-driver)
- [lol-lockfile-parser](https://github.com/Pupix/lol-lockfile-parser)
- [awesome-league](https://github.com/CommunityDragon/awesome-league)

### Gist / サンプルコード

- [GET /lol-champ-select/v1/session](https://gist.github.com/xadamxk/8cb5d21d24bb78d63c5241e97087bb23)
- [LCU API auto-accept/auto-pick example](https://gist.github.com/Asbra/484165c4dd171e58275a1a0fb83e6978)

## まとめ

TODO項目7の実装には **LCU API + lcu-driver ライブラリ** を使用することを強く推奨します。

**主な理由:**
- 信頼性とリアルタイム性が高い
- 実装が比較的容易
- コミュニティによる充実したサポート
- パフォーマンスが良い

**重要な注意点:**
- Riot Developer Portal でアプリケーション登録が必要
- LCU APIは非公式であり、変更される可能性がある
- 適切なエラーハンドリングと再接続処理が必須

この設計に基づいて実装を進めることで、ユーザーがチャンピオンセレクト中に自動的に相手チャンピオンのカウンター情報を確認できる、便利で実用的な機能を実現できます。
