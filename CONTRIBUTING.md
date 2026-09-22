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

2. **Git hooksをインストール（重要）**

コミットメッセージのフォーマットを強制するため、必ずhooksをインストールしてください：

```bash
# Linux/Mac
bash setup-hooks.sh

# Windows
setup-hooks.bat
```

3. 依存関係をインストール

```bash
# 開発・テスト・ビルドに必要なもの一式（ハッシュ検証付き）
pip install -r requirements.txt
```

`requirements*.txt` はハッシュ固定済みのコンパイル済みファイルです。ハッシュが
含まれているため、pip は `--require-hashes` を明示しなくても全パッケージの
ハッシュを検証します。

4. アプリケーションを実行

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
├── pyproject.toml             # 直接依存（編集するのはこちら）+ pytest設定
├── requirements.txt       # ↑から生成されたハッシュ固定ロック
├── requirements-ci.txt        # 同上
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

**Conventional Commits形式が必須です**。Git hooksにより、不正なフォーマットのコミットは拒否されます。

形式：
```
type(optional-scope): description

[optional body]

[optional footer]
```

#### 有効なタイプ

- `feat`: 新機能 → minor バージョンアップ (0.2.0 → 0.3.0)
- `fix`: バグ修正 → patch バージョンアップ (0.2.0 → 0.2.1)
- `docs`: ドキュメント変更
- `style`: コードフォーマット（ロジック変更なし）
- `refactor`: リファクタリング
- `test`: テスト追加・更新
- `chore`: メンテナンス作業
- `ci`: CI/CD変更
- `perf`: パフォーマンス改善

#### 例

```bash
# 良いコミット ✓
git commit -m "feat: ダークモードサポートを追加"
git commit -m "fix(ui): 小画面でのボタン配置を修正"
git commit -m "docs: インストール手順を更新"
git commit -m "test: updaterモジュールのユニットテストを追加"

# 悪いコミット ✗ (git hookにより拒否されます)
git commit -m "新機能追加"
git commit -m "バグ修正"
git commit -m "更新"
```

#### 破壊的変更

破壊的変更の場合は、タイプの後に `!` を付けるか、フッターに `BREAKING CHANGE:` を含めます：

```bash
git commit -m "feat!: APIを再設計

BREAKING CHANGE: API署名が変更されました"
```

これによりmajorバージョンアップ (0.2.0 → 1.0.0) がトリガーされます。

## 自動リリースプロセス

**バージョン管理は完全に自動化されています！** 手動でバージョンを更新する必要はありません。

### 仕組み

PRが`main`にマージされると：

1. GitHub Actionsがコミットメッセージを解析
2. `constants.py`の`__version__`を自動更新
3. Gitタグを作成 (例: `v0.3.0`)
4. Windows環境で`lol-viewer.exe`をビルド
5. GitHub Releaseを作成してexeを添付
6. ユーザーは次回起動時に自動的に更新通知を受け取る

**マージから約10分でリリース完了！**

詳細は[DEV.md](DEV.md)の「Auto-Update Mechanism」セクションを参照してください。

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

## 依存関係の更新

依存関係は `pyproject.toml` の PEP 735 `[dependency-groups]`（直接依存のみ）と、
そこから生成される `requirements*.txt`（推移的依存まで含むハッシュ固定ロック）の
2層構成です。グループは3つあります。

| グループ | 生成先 | 用途 |
|---|---|---|
| `runtime` | （単独のロックなし） | アプリが import する実行時依存。宣言のみで、`dev` に含まれる形でロックされる |
| `dev` | **`requirements.txt`** | `runtime` + テスト・ビルド。開発一式なので、慣例どおり `requirements.txt` が生成先 |
| `ci` | `requirements-ci.txt` | 軽量CIジョブ用。**`runtime` を含まない**（PyQt6が入らない） |

グループ名と生成先が一対一に対応していないのは意図的です。`dev` は PEP 735 の
慣例名でツールが特別扱いするため（`pip install --group dev` など）グループ名は
そのままにし、生成先は pip の慣例名である `requirements.txt` にしています。
`requirements.txt` の意味は従来どおり「このプロジェクトを触るのに必要なもの一式」です。

`runtime` 単独のロックは作りません。実行時依存のみをインストールする箇所が
どこにもなく、`dev` のロックが runtime の全ピンを同一バージョン・同一ハッシュで
含んでいるためです。したがって **`dev` から `{ include-group = "runtime" }` を
外すと、実行時依存が pip-audit の対象から静かに漏れます。**

このプロジェクトは配布パッケージではないため `[project]` テーブルは
意図的に作っていません。バージョンは `constants.py` の `__version__` が唯一の正で、
`release.yml` がそれを書き換えます。`[project].version` を作ると
リリースワークフローが更新しない第二の出所になってしまいます。
CI とリリースビルドは必ずロック側をインストールするため、ビルドは再現可能で、
上流パッケージが差し替わっても勝手に取り込まれません。

### 手動で更新する場合

1. `pyproject.toml` の該当するグループを編集する
2. ロックを再生成する（`uv` が必要: `pip install uv`）

```bash
uv pip compile --universal --generate-hashes --python-version 3.11 \
    --group dev -o requirements.txt
uv pip compile --universal --generate-hashes --python-version 3.11 \
    --group ci -o requirements-ci.txt

`--group` は入力ファイルの *代わり* に指定します（`uv pip compile` の usage は
`<SRC_FILE|--group <GROUP>>`）。`pyproject.toml` を引数に渡すと `[project]` の
依存も混ざるため、渡してはいけません。
```

`--universal` は必須です。テストは Linux、リリースビルドは Windows で走るため、
ロックは両方のプラットフォームで解決できる必要があります（`pip-compile` は
実行したプラットフォーム専用のロックしか作れないので使いません）。

3. 脆弱性を確認してテストを流す

```bash
pip install --require-hashes -r requirements-ci.txt
pip-audit --disable-pip -r requirements.txt -r requirements-ci.txt
pytest
```

### Dependabot からの PR

Dependabot は毎週月曜に `pip` と `github-actions` の更新 PR を出します
（設定は `.github/dependabot.yml`）。

Dependabot は `pyproject.toml` を書き換えますが、ロックは `uv pip compile --universal` で
作られているため、**再生成されたロックが正しいとは限りません**。
Dependabot の PR は必ずロックを確認し、必要なら上記の手順でローカルで
再生成してコミットを追加してください。`python-tests.yml` の `audit` ジョブと
`--require-hashes` インストールが、ずれたロックを検出する安全網になります。

### GitHub Actions のピン留め

ワークフロー内の action はすべてコミット SHA で固定し、行末に
`# vX.Y.Z` のコメントを添えています。タグは動かせるため、SHA 固定でないと
リリースワークフロー（releases への書き込み権限を持つ）が
サードパーティ製 action の差し替えに晒されます。更新は Dependabot の
`github-actions` エコシステムが SHA ごと追従します。
