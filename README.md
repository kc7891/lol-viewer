# LoL Viewer

League of Legendsのチャンピオン情報をLoLAnalyticsで簡単に閲覧できるアプリケーション。

## 機能

- チャンピオン名の入力でビルド/カウンター情報を表示
- 英語名・日本語名両方に対応したオートコンプリート
- サムネイル画像付きの候補リスト
- 複数のWebViewを同時に開いて比較可能
- ダークテーマUI

## デバッグログ

**実行ファイル名に `debug` が含まれる場合のみ**ログファイルが出力されます。

例：
- `lol-viewer-debug.exe` → ログ出力 ✓
- `lol-viewer.exe` → ログ出力なし
- `python main.py` → ログ出力 ✓（開発時）

ログファイル（`lol_viewer_debug.log`）には以下の情報が記録されます：
- チャンピオンデータの読み込み状況
- オートコンプリートの設定状況
- アプリケーションの初期化過程

### ログの確認方法

1. アプリケーションを起動
2. チャンピオン名入力欄に文字を入力
3. アプリケーションと同じフォルダの `lol_viewer_debug.log` を開く

### トラブルシューティング

**オートコンプリートが表示されない場合、ログで以下を確認：**

1. **データが読み込まれているか**
   - ログに `Loaded 171 champions` と表示されているか
   - 表示されていない場合 → `champions.json` が実行ファイルと同じフォルダにあるか確認

2. **オートコンプリートが設定されているか**
   - ログに `Populated model with 171 champions` と表示されているか
   - 表示されていない場合 → チャンピオンデータの読み込みに失敗している可能性

3. **Qt関連のエラーがないか**
   - エラーメッセージが記録されていないか確認

## 開発

### 必要なパッケージ

```bash
pip install -r requirements.txt
```

### チャンピオンデータの更新

```bash
python fetch_champions.py
```

### テストの実行

```bash
python test_champion_data_basic.py
python test_autocomplete.py
```

### アプリケーションの実行

```bash
python main.py
```

## ビルド

`champions.json`は実行ファイルに埋め込まれるため、別途配置不要です。

### ビルド前の確認（重要！）

ビルドする前に、必要なファイルが揃っているか確認：

```bash
python check_build.py
```

すべて✓であることを確認してからビルドしてください。

### 簡単な方法（推奨）

**プロジェクトフォルダで**実行してください：

**デバッグ版（ログ出力あり）:**
```bash
# クリーンビルド（推奨）
python clean_build.py
pyinstaller lol-viewer-debug.spec

# または直接ビルド
pyinstaller lol-viewer-debug.spec
```

**リリース版（ログ出力なし）:**
```bash
# クリーンビルド（推奨）
python clean_build.py
pyinstaller lol-viewer.spec

# または直接ビルド
pyinstaller lol-viewer.spec
```

**注意:** `.spec`ファイルを変更した後は、`python clean_build.py`でキャッシュをクリアしてから再ビルドすることを推奨します。

### 手動ビルド

#### Windowsの場合

**デバッグ版:**
```bash
pyinstaller --onefile --windowed --name lol-viewer-debug --add-data "champions.json;." main.py
```

**リリース版:**
```bash
pyinstaller --onefile --windowed --name lol-viewer --add-data "champions.json;." main.py
```

#### macOS/Linuxの場合

**デバッグ版:**
```bash
pyinstaller --onefile --windowed --name lol-viewer-debug --add-data "champions.json:." main.py
```

**リリース版:**
```bash
pyinstaller --onefile --windowed --name lol-viewer --add-data "champions.json:." main.py
```

### ビルド後

`dist` フォルダに実行ファイルが生成されます。単体で実行可能です。
