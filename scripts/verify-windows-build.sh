#!/bin/bash
# Windows .exe ビルドの健全性チェックスクリプト
# ビルド後に自動実行して基本的な問題を検出

set -e
set +H  # ヒストリ展開を無効化

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

echo "======================================"
echo "  Windows ビルド健全性チェック"
echo "======================================"
echo ""

# 1. ビルドファイルの存在確認
echo "📁 [1/8] ビルドファイルの存在確認..."
if [ ! -d "release/win-unpacked" ]; then
    echo -e "${RED}✗ release/win-unpacked/ が見つかりません${NC}"
    echo "  → npm run package を実行してください"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓ release/win-unpacked/ が存在します${NC}"
fi

# 2. 実行ファイルの確認
echo ""
echo "🔍 [2/8] 実行ファイルの確認..."
EXE_FILE="release/win-unpacked/LoL Analytics Viewer.exe"
if [ ! -f "$EXE_FILE" ]; then
    echo -e "${RED}✗ 実行ファイルが見つかりません: $EXE_FILE${NC}"
    ERRORS=$((ERRORS + 1))
else
    EXE_SIZE=$(stat -c%s "$EXE_FILE" 2>/dev/null || stat -f%z "$EXE_FILE" 2>/dev/null)
    EXE_SIZE_MB=$((EXE_SIZE / 1024 / 1024))
    echo -e "${GREEN}✓ 実行ファイルが存在します (${EXE_SIZE_MB}MB)${NC}"

    # サイズチェック（100MB未満は異常、200MB超えも異常）
    if [ $EXE_SIZE_MB -lt 100 ]; then
        echo -e "${RED}✗ 実行ファイルが小さすぎます (${EXE_SIZE_MB}MB < 100MB)${NC}"
        echo "  → ビルドが不完全な可能性があります"
        ERRORS=$((ERRORS + 1))
    elif [ $EXE_SIZE_MB -gt 250 ]; then
        echo -e "${YELLOW}⚠ 実行ファイルが大きすぎます (${EXE_SIZE_MB}MB > 250MB)${NC}"
        echo "  → 不要な依存関係が含まれている可能性があります"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# 3. 必須DLLファイルの確認
echo ""
echo "🔧 [3/8] 必須DLLファイルの確認..."
REQUIRED_DLLS=(
    "d3dcompiler_47.dll"
    "libEGL.dll"
    "libGLESv2.dll"
)

for dll in "${REQUIRED_DLLS[@]}"; do
    if [ ! -f "release/win-unpacked/$dll" ]; then
        echo -e "${RED}✗ $dll が見つかりません${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓ $dll が存在します${NC}"
    fi
done

# 4. resourcesディレクトリの確認
echo ""
echo "📦 [4/8] resourcesディレクトリの確認..."
if [ ! -d "release/win-unpacked/resources" ]; then
    echo -e "${RED}✗ resources/ ディレクトリが見つかりません${NC}"
    ERRORS=$((ERRORS + 1))
else
    if [ ! -f "release/win-unpacked/resources/app.asar" ]; then
        echo -e "${RED}✗ resources/app.asar が見つかりません${NC}"
        ERRORS=$((ERRORS + 1))
    else
        ASAR_SIZE=$(stat -c%s "release/win-unpacked/resources/app.asar" 2>/dev/null || stat -f%z "release/win-unpacked/resources/app.asar" 2>/dev/null)
        ASAR_SIZE_KB=$((ASAR_SIZE / 1024))
        echo -e "${GREEN}✓ resources/app.asar が存在します (${ASAR_SIZE_KB}KB)${NC}"

        # asarファイルが小さすぎないかチェック
        if [ $ASAR_SIZE_KB -lt 10 ]; then
            echo -e "${RED}✗ app.asar が小さすぎます (${ASAR_SIZE_KB}KB)${NC}"
            echo "  → ビルドが失敗している可能性があります"
            ERRORS=$((ERRORS + 1))
        fi
    fi
fi

# 5. dist/electron/ の確認（ビルド成果物）
echo ""
echo "🏗️  [5/8] TypeScriptビルド成果物の確認..."
if [ ! -d "dist/electron" ]; then
    # app.asarが存在する場合（パッケージング済み）は警告のみ
    if [ -f "release/win-unpacked/resources/app.asar" ]; then
        echo -e "${YELLOW}⚠ dist/electron/ が見つかりません（パッケージング済みのため問題なし）${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${RED}✗ dist/electron/ が見つかりません${NC}"
        echo "  → npm run build を実行してください"
        ERRORS=$((ERRORS + 1))
    fi
else
    REQUIRED_FILES=(
        "dist/electron/main.cjs"
        "dist/electron/preload.cjs"
    )

    for file in "${REQUIRED_FILES[@]}"; do
        if [ ! -f "$file" ]; then
            echo -e "${RED}✗ $file が見つかりません${NC}"
            ERRORS=$((ERRORS + 1))
        else
            echo -e "${GREEN}✓ $file が存在します${NC}"
        fi
    done
fi

# 6. ES module エラーの検出
echo ""
echo "🔎 [6/8] 一般的なビルドエラーのチェック..."
if [ -f "dist/electron/main.cjs" ]; then
    # "export " や "import " がCJSファイルに含まれていないかチェック
    if grep -q "^export " "dist/electron/main.cjs" 2>/dev/null; then
        echo -e "${RED}✗ main.cjs に ES module構文が含まれています${NC}"
        echo "  → CommonJS形式でビルドされていません"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓ main.cjs は適切なCommonJS形式です${NC}"
    fi

    if grep -q "^import " "dist/electron/main.cjs" 2>/dev/null; then
        echo -e "${RED}✗ main.cjs に ES import構文が含まれています${NC}"
        echo "  → CommonJS形式でビルドされていません"
        ERRORS=$((ERRORS + 1))
    fi
fi

# 7. ZIPファイルのサイズチェック（存在する場合）
echo ""
echo "📦 [7/8] ZIPファイルのチェック..."
if [ -f "release/LoL-Analytics-Viewer-Windows-x64.zip" ]; then
    ZIP_SIZE=$(stat -c%s "release/LoL-Analytics-Viewer-Windows-x64.zip" 2>/dev/null || stat -f%z "release/LoL-Analytics-Viewer-Windows-x64.zip" 2>/dev/null)
    ZIP_SIZE_MB=$((ZIP_SIZE / 1024 / 1024))

    if [ $ZIP_SIZE_MB -gt 100 ]; then
        echo -e "${YELLOW}⚠ ZIPファイルが100MBを超えています (${ZIP_SIZE_MB}MB)${NC}"
        echo "  → GitHubにプッシュできません"
        echo "  → split -b 50M を使って分割してください"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${GREEN}✓ ZIPファイルサイズ OK (${ZIP_SIZE_MB}MB < 100MB)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ ZIPファイルが見つかりません${NC}"
    echo "  → combine-release.sh を実行して作成してください"
    WARNINGS=$((WARNINGS + 1))
fi

# 8. package.json の確認
echo ""
echo "📄 [8/8] package.json の確認..."
if [ -f "package.json" ]; then
    MAIN_VALUE=$(grep -o '"main"[[:space:]]*:[[:space:]]*"[^"]*"' package.json | sed 's/.*: *"\([^"]*\)".*/\1/')
    if [ "$MAIN_VALUE" != "dist/electron/main.cjs" ]; then
        echo -e "${RED}✗ package.json の main フィールドが正しくありません (${MAIN_VALUE})${NC}"
        echo "  → 期待値: dist/electron/main.cjs"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓ package.json の main フィールドが正しいです${NC}"
    fi
else
    echo -e "${RED}✗ package.json が見つかりません${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 結果サマリー
echo ""
echo "======================================"
echo "  チェック結果"
echo "======================================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ すべてのチェックに合格しました！${NC}"
    echo ""
    echo "次のステップ:"
    echo "  1. Wineでexeを実行してテスト: wine64 'release/win-unpacked/LoL Analytics Viewer.exe'"
    echo "  2. または、Windows環境でテスト"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS 個の警告があります${NC}"
    echo "  → 警告を確認して修正することをおすすめします"
    exit 0
else
    echo -e "${RED}✗ $ERRORS 個のエラーがあります${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠ $WARNINGS 個の警告があります${NC}"
    fi
    echo ""
    echo "修正が必要です。上記のエラーを確認してください。"
    exit 1
fi
