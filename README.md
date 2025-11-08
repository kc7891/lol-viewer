# LoL Viewer

League of Legends チャンピオンのビルドとカウンター情報を表示するシンプルなデスクトップアプリケーション。

## 機能

- チャンピオン名を入力してLoLAnalyticsのビルドページを表示
- カウンター情報の表示
- 複数のWebViewを同時に開いて比較
- ダークテーマのモダンなUI

## インストール

### 実行ファイル版（推奨）

1. [Releases](https://github.com/kc7891/lol-viewer/releases)から最新版をダウンロード
2. `lol-viewer.exe`を実行

**⚠️ Windows SmartScreen 警告について**

初回起動時にSmartScreen警告が表示される場合があります。詳しい対処法は[SMARTSCREEN_WARNING.md](./SMARTSCREEN_WARNING.md)をご覧ください。

簡単な対処法：
1. 「詳細情報」をクリック
2. 「実行する」をクリック

### Pythonスクリプト版

```bash
# リポジトリをクローン
git clone https://github.com/kc7891/lol-viewer.git
cd lol-viewer

# 依存関係をインストール
pip install -r requirements.txt

# アプリケーションを実行
python main.py
```

## 必要な環境

- Windows 10/11
- Python 3.11以上（スクリプト版の場合）

## 使い方

1. アプリケーションを起動
2. チャンピオン名を入力（例：ashe, swain）
3. 「Build」または「Counter」ボタンをクリック
4. 複数のチャンピオンを比較する場合は「＋ Add Viewer」をクリック

## 開発

詳しい貢献方法については[CONTRIBUTING.md](./CONTRIBUTING.md)をご覧ください。

### ローカルでビルド

```bash
# PyInstallerをインストール
pip install pyinstaller

# ビルド
pyinstaller --onefile --windowed --name lol-viewer --version-file version_info.txt main.py

# 実行ファイルはdist/ディレクトリに生成されます
```

## ライセンス

このプロジェクトはオープンソースです。

## TODO

詳細なロードマップは[TODO.md](./TODO.md)をご覧ください。
