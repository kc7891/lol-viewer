# LoL Analytics Browser Viewer

🎮 **Windows環境設定不要！** .exeファイルをダブルクリックするだけで使えるElectronアプリ

Automatically opens relevant LoL Analytics pages based on current draft status in League of Legends.

## 🎯 Features

- **💻 Windows .exe配布**: Node.js/npm不要、インストーラーで簡単セットアップ
- **🎨 GUI設定画面**: 美しいインターフェースで設定変更
- **📍 システムトレイ常駐**: バックグラウンドで動作、邪魔にならない
- **Matchup Analysis**: Automatically displays winrate for your champion vs enemy champion
- **Counter Pick Support**: Shows counter information for both your and enemy champions
- **Build Guides**: Displays optimal builds during champion select and in-game
- **Lane Auto-Prediction**: Intelligently predicts lanes based on pick order and champion roles
- **Real-time Monitoring**: Connects to League Client Update (LCU) API via WebSocket

## 🚀 Tech Stack

- **Bun**: 4.8x faster than Node.js with native TypeScript support
- **Playwright**: Modern browser automation (20-30% faster than Puppeteer)
- **Biome**: 100x faster linter & formatter (replaces ESLint + Prettier)
- **Zod**: Schema validation for type-safe configuration
- **WebSocket**: Real-time LCU API connection

## 📦 Installation

### For End Users (Windows)

**最も簡単な方法 - Electronアプリ版**

1. [Releases](../../releases) から `LoL Analytics Viewer Setup.exe` をダウンロード
2. インストーラーを実行
3. デスクトップのショートカットをダブルクリック
4. システムトレイのアイコンを右クリック → "Start"
5. League of Legendsでチャンピオン選択を開始

**環境設定不要！すぐに使えます！**

### For Developers

#### Using npm/Node.js

```bash
# Clone the repository
git clone https://github.com/yourusername/lol-analytics-viewer.git
cd lol-analytics-viewer

# Install dependencies
npm install

# Run CLI mode
npm run dev

# Run Electron app (development)
npm run dev:electron

# Build Windows .exe
npm run build
npm run package
```

## 🎮 Usage

### Electron App (推奨 - Windows)

1. **起動**: デスクトップまたはスタートメニューから "LoL Analytics Viewer" を起動
2. **システムトレイ**: タスクバーのトレイアイコンを確認（紫色）
3. **設定**: トレイアイコンを右クリック → "Settings" で設定画面を開く
4. **開始**: "Start" ボタンをクリック（または自動開始）
5. **League of Legends起動**: ゲームクライアントを起動
6. **チャンピオン選択**: 自動的にブラウザでページが開きます

#### 設定画面の使い方

- **Application Control**: Start/Stop/Restart でアプリを制御
- **Features**: 各機能のON/OFFとトリガータイミングを設定
  - Hover: チャンピオンにマウスを乗せた時
  - Pick: チャンピオンを選択した時
  - Lock-in: チャンピオンを確定した時
- **Settings**: URLや遅延時間などを変更

### CLI Mode (開発者向け)

```bash
# 自動モード
npm run dev

# マニュアルモード
npm run cli matchup Ahri Zed
npm run cli counters Ahri
npm run cli build Ahri
```

## ⚙️ Configuration

Create a config file at `~/.lol-viewer/config.json`:

```json
{
  "browser": {
    "type": "chromium",
    "width": 1200,
    "height": 800,
    "reuseExisting": true
  },
  "lolAnalytics": {
    "baseUrl": "https://lolanalytics.com",
    "features": {
      "matchup": {
        "enabled": true,
        "trigger": "pick"
      },
      "myCounters": {
        "enabled": true,
        "trigger": "hover"
      },
      "enemyCounters": {
        "enabled": true,
        "trigger": "pick"
      },
      "buildGuide": {
        "enabled": true,
        "trigger": "lock-in",
        "inGame": true
      }
    }
  }
}
```

## 🛠️ Development

```bash
# Install dependencies
npm install

# CLI mode (no GUI)
npm run dev

# Electron app (development)
npm run dev:electron

# Build TypeScript
npm run build

# Build Electron app for Windows
npm run build
npm run package

# Run tests
npm test

# Lint & Format
npm run lint
npm run format
```

### Building for Distribution

```bash
# Windows installer (.exe)
npm run package

# All platforms (Windows, macOS, Linux)
npm run package:all

# Output directory
ls release/
```

詳細は [ELECTRON_GUIDE.md](./ELECTRON_GUIDE.md) を参照

## 📖 Project Structure

```
lol-viewer/
├── src/
│   ├── core/              # Core logic
│   │   ├── lcu/           # LCU API integration
│   │   ├── analytics/     # Analytics site URL builders
│   │   ├── browser/       # Browser control
│   │   └── prediction/    # Lane prediction
│   ├── utils/             # Utilities
│   ├── cli/               # CLI interface
│   └── types/             # Type definitions
├── tests/                 # Tests
├── config/                # Configuration files
└── docs/                  # Documentation
```

## 🧪 Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/unit/url-builder.test.ts

# Run with coverage
bun test --coverage
```

## 🤝 Contributing

Contributions are welcome! Please read our [Coding Guidelines](./CODING_GUIDELINES.md) before submitting a PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

MIT License - see [LICENSE](./LICENSE) for details

## ⚠️ Disclaimer

This tool is not officially supported by Riot Games. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc. Please use in accordance with Riot Games' Terms of Service.

This tool only opens browser pages and does not scrape, store, or use any data directly. It's equivalent to manually opening URLs in your browser.

## 🐛 Troubleshooting

### LCU Connection Failed
- Ensure League Client is running
- Check if the LCU API port is accessible
- Try restarting the League Client

### Browser Not Opening
- Verify your default browser is set
- Check if the browser executable is in PATH
- Try specifying browser path in config

### Champion Data Not Loading
- Check your internet connection
- Verify Data Dragon API is accessible
- Clear cache and retry

## 📚 Documentation

- [Design Document](./DESIGN.md)
- [Coding Guidelines](./CODING_GUIDELINES.md)
- [Build Checklist](./BUILD_CHECKLIST.md)

## 🙏 Acknowledgments

- [LCU API](https://developer.riotgames.com/) for League Client integration
- [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) for champion data
- [Bun](https://bun.sh/) for blazing fast TypeScript runtime
- [Playwright](https://playwright.dev/) for browser automation

---

Made with ❤️ for League of Legends players
