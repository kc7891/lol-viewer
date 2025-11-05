# LoL Analytics Browser Viewer

Automatically opens relevant LoL Analytics pages based on current draft status in League of Legends.

## 🎯 Features

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

### Using Bun (Recommended)

```bash
# Install Bun if you haven't
curl -fsSL https://bun.sh/install | bash

# Clone the repository
git clone https://github.com/yourusername/lol-analytics-viewer.git
cd lol-analytics-viewer

# Install dependencies
bun install

# Run in development mode
bun run dev
```

### Using npm

```bash
npm install -g lol-analytics-viewer
lol-analytics-viewer
```

## 🎮 Usage

### Automatic Mode (Recommended)

1. Start League of Legends client
2. Run the viewer:
   ```bash
   bun run dev
   ```
3. Enter champion select
4. Browser pages will automatically open based on your actions:
   - **Hover**: Opens counter information for your champion
   - **Pick**: Opens matchup page (your champion vs enemy laner)
   - **Lock-in**: Opens build guide
   - **Game Start**: Opens build guide in a new tab

### Manual Mode

```bash
# Open matchup page
bun run cli matchup Ahri Zed

# Open counters for your champion
bun run cli counters Ahri

# Open counters for enemy champion
bun run cli counter-of Zed

# Open build guide
bun run cli build Ahri
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
bun install

# Run in development mode
bun run dev

# Build
bun run build

# Run tests
bun test

# Lint
bun run lint

# Format
bun run format
```

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
