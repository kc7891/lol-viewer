# LoL Viewer

League of Legendsのチャンピオン情報をLoLAnalyticsで簡単に閲覧できるアプリケーション。

## 機能

- チャンピオン名の入力でビルド/カウンター情報を表示
- 英語名・日本語名両方に対応したオートコンプリート
- サムネイル画像付きの候補リスト
- 複数のWebViewを同時に開いて比較可能
- ダークテーマUI

## デバッグログ

アプリケーションを実行すると、実行ファイルと同じディレクトリに `lol_viewer_debug.log` が生成されます。

このログファイルには以下の情報が記録されます：
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

```bash
pyinstaller --onefile --windowed main.py
```

ビルド後、`dist` フォルダに実行ファイルが生成されます。
**重要**: `champions.json` を実行ファイルと同じフォルダにコピーしてください。
