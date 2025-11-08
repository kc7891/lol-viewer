# Contributing to LoL Viewer

LoL Viewerへの貢献に興味を持っていただきありがとうございます！

## 開発環境のセットアップ

### 必要な環境

- Python 3.11以上
- pip (Pythonパッケージマネージャー)

### セットアップ手順

1. リポジトリをクローン

```bash
git clone https://github.com/kc7891/lol-viewer.git
cd lol-viewer
```

2. 依存関係をインストール

```bash
pip install -r requirements.txt
```

3. アプリケーションを実行

```bash
python main.py
```

## 開発ワークフロー

### ローカルでの開発

1. 新しいブランチを作成

```bash
git checkout -b feature/your-feature-name
```

2. コードを編集

3. 動作確認

```bash
python main.py
```

4. 変更をコミット

```bash
git add .
git commit -m "Your descriptive commit message"
```

5. プッシュ

```bash
git push origin feature/your-feature-name
```

### Windowsビルドのテスト

GitHub Actionsが自動的にWindows向けexeファイルをビルドします。

手動でビルドする場合：

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name lol-viewer main.py
```

ビルドされたexeファイルは `dist/lol-viewer.exe` に生成されます。

## プロジェクト構成

```
lol-viewer/
├── main.py                    # メインアプリケーション
├── requirements.txt           # Python依存関係
├── .github/
│   └── workflows/
│       └── windows-build.yml  # GitHub Actions設定
├── TODO.md                    # 実装予定の機能
├── claude.md                  # 開発時の注意事項
└── CONTRIBUTING.md            # このファイル
```

## コーディング規約

### Python

- PEP 8に従う
- 型ヒントを使用する（可能な限り）
- ドキュメント文字列を関数/クラスに記述する

### コミットメッセージ

明確で説明的なコミットメッセージを書いてください：

```
Add feature to display multiple champion builds

- Implement split view for comparing builds
- Add UI controls for managing multiple views
```

## テスト

現在、テストコードは実装中です。TODO.mdに記載されているように、できる限りテストコードを実装することが推奨されています。

### テストの実行

```bash
# TODO: テストフレームワークの追加後に更新
```

## 注意事項

### exeファイルのプッシュについて

`claude.md` に記載されている通り：
- GitHub Actionsでビルドを行うため、**exeファイルはリポジトリにプッシュしない**
- ビルド成果物はGitHub ActionsのArtifactsからダウンロード可能

### ビルドサイズについて

もし将来exeファイルをリポジトリに含める必要がある場合：
- 50MBを超える場合は、50MBごとに分割してzipファイルとしてプッシュ
- zipファイルを統合するためのbatファイルも一緒にプッシュ

## 機能追加のアイデア

`TODO.md`を参照してください。現在実装予定の機能：

1. ✅ シンプルなアプリでチャンピオン名入力→LoLAnalyticsページを開く
2. 2分割でビルド/カウンターページを表示
3. チャンピオン名のマスタ取得と部分一致検索
4. ゲーム内チャンピオン自動検知
5. 6窓まで開ける機能
6. BanPick画面での自動カウンター表示

## 質問やサポート

- Issue: プロジェクトのIssueセクションで質問や提案を投稿してください
- Pull Request: 機能追加や修正のPRを歓迎します

## ライセンス

このプロジェクトに貢献することで、あなたの貢献がプロジェクトのライセンスの下で公開されることに同意するものとします。
