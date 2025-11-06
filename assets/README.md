# Assets Directory

This directory contains application assets.

## Required Icons

To build the Electron app, you need to provide the following icon files:

### Windows
- `icon.ico` - 256x256 pixels, .ico format
  - Used for the application icon and taskbar

### macOS
- `icon.icns` - .icns format with multiple resolutions
  - 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024

### Linux
- `icon.png` - 512x512 pixels, .png format

### System Tray
- `tray-icon.png` - 16x16 or 32x32 pixels (will be resized to 16x16)
  - Simple monochrome icon works best

## Creating Icons

You can create icons using:
1. **Online tools**: https://icon-icons.com/, https://www.icoconverter.com/
2. **Design tools**: Figma, Photoshop, GIMP
3. **CLI tools**: ImageMagick, electron-icon-builder

### Using electron-icon-builder

```bash
npm install -g electron-icon-builder

# From a 1024x1024 PNG source
electron-icon-builder --input=./source-icon.png --output=./assets
```

## Temporary Placeholders

If you don't have icons yet, the app will still build, but you should add them before distributing.

For now, you can create simple colored squares as placeholders:
- Windows: Use any .ico file
- macOS: Use any .icns file
- Linux: Use any .png file
- Tray: Use a small .png file
