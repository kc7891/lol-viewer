# LoL Analytics Viewer - Release Files

## 📦 ファイルの結合方法

このディレクトリには、GitHubの100MBファイルサイズ制限のため、ZIPファイルが3つに分割されています：

- `LoL-Analytics-Viewer-Windows-x64.zip.part-aa` (50MB)
- `LoL-Analytics-Viewer-Windows-x64.zip.part-ab` (50MB)
- `LoL-Analytics-Viewer-Windows-x64.zip.part-ac` (11MB)

### 方法1: スクリプトを使用（推奨）

#### Windows
```cmd
combine-release.bat
```

#### Mac/Linux
```bash
chmod +x combine-release.sh
./combine-release.sh
```

### 方法2: 手動で結合

#### Windows (PowerShell)
```powershell
cd release
cmd /c copy /b LoL-Analytics-Viewer-Windows-x64.zip.part-aa+LoL-Analytics-Viewer-Windows-x64.zip.part-ab+LoL-Analytics-Viewer-Windows-x64.zip.part-ac LoL-Analytics-Viewer-Windows-x64.zip
```

#### Mac/Linux
```bash
cd release
cat LoL-Analytics-Viewer-Windows-x64.zip.part-* > LoL-Analytics-Viewer-Windows-x64.zip
```

### 結合後

`LoL-Analytics-Viewer-Windows-x64.zip` (111MB) が作成されます。

このZIPファイルを解凍して、`win-unpacked/LoL Analytics Viewer.exe` を実行してください。

## 📋 ファイル検証

結合後、ファイルサイズを確認してください：
- **期待サイズ**: 111 MB (116,391,527 bytes)

サイズが一致しない場合は、結合が失敗しています。

## 🚀 使用方法

詳細な使用方法は [RELEASE_NOTES.md](../RELEASE_NOTES.md) を参照してください。
