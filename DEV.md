# LoL Viewer - Development Guide

## Debug Logging

**Log files are only created when the executable name contains `debug`.**

Examples:
- `lol-viewer-debug.exe` → Logs enabled ✓
- `lol-viewer.exe` → No logs
- `python main.py` → Logs enabled ✓ (during development)

The log file (`lol_viewer_debug.log`) records:
- Champion data loading status
- Autocomplete configuration status
- Application initialization process

### How to Check Logs

1. Launch the application
2. Enter text in the champion name input field
3. Open `lol_viewer_debug.log` in the same folder as the application

### Troubleshooting

**If autocomplete is not working, check the following in the logs:**

1. **Is data loaded?**
   - Does the log show `Loaded 171 champions`?
   - If not → Verify that `champions.json` exists in the same folder as the executable

2. **Is autocomplete configured?**
   - Does the log show `Populated model with 171 champions`?
   - If not → Champion data loading may have failed

3. **Are there any Qt-related errors?**
   - Check if any error messages are recorded

## Development Setup

### Required Packages

```bash
pip install -r requirements.txt
```

### Updating Champion Data

```bash
python fetch_champions.py
```

### Running Tests

```bash
python test_champion_data_basic.py
python test_autocomplete.py
```

### Running the Application

```bash
python main.py
```

## Building

`champions.json` is embedded into the executable, so no separate deployment is needed.

### Pre-Build Verification (Important!)

Before building, verify that all required files are present:

```bash
python check_build.py
```

Confirm that all items show ✓ before proceeding with the build.

### Recommended Build Method

**Run from the project folder:**

**Debug Version (with logging):**
```bash
# Clean build (recommended)
python clean_build.py
pyinstaller lol-viewer-debug.spec

# Or direct build
pyinstaller lol-viewer-debug.spec
```

**Release Version (no logging):**
```bash
# Clean build (recommended)
python clean_build.py
pyinstaller lol-viewer.spec

# Or direct build
pyinstaller lol-viewer.spec
```

**Note:** After modifying `.spec` files, it's recommended to clear the cache with `python clean_build.py` before rebuilding.

### Manual Build

#### For Windows

**Debug Version:**
```bash
pyinstaller --onefile --windowed --name lol-viewer-debug --add-data "champions.json;." main.py
```

**Release Version:**
```bash
pyinstaller --onefile --windowed --name lol-viewer --add-data "champions.json;." main.py
```

#### For macOS/Linux

**Debug Version:**
```bash
pyinstaller --onefile --windowed --name lol-viewer-debug --add-data "champions.json:." main.py
```

**Release Version:**
```bash
pyinstaller --onefile --windowed --name lol-viewer --add-data "champions.json:." main.py
```

### After Building

The executable will be created in the `dist` folder and can be run standalone.

## Auto-Update Mechanism

The application includes an automatic update feature that checks for new versions on startup.

### How It Works

1. **Version Check**: On startup, the app checks GitHub Releases API for the latest version
2. **User Prompt**: If a newer version is available, a dialog asks if the user wants to update
3. **Download**: If confirmed, the new executable is downloaded with a progress indicator
4. **Installation**: A batch script replaces the current executable and restarts the app

### Version Management

- Current version is defined in `main.py` as `__version__`
- Update this version before creating a new release:
  ```python
  __version__ = "1.0.0"  # Update this before release
  ```

### Creating a Release with Auto-Update

1. Update version in `main.py`:
   ```python
   __version__ = "1.1.0"  # New version
   ```

2. Build the executables:
   ```bash
   python clean_build.py
   pyinstaller lol-viewer.spec
   pyinstaller lol-viewer-debug.spec
   ```

3. Create a GitHub Release:
   - Tag version: `v1.1.0` (must match `__version__` with 'v' prefix)
   - Upload both `lol-viewer.exe` and `lol-viewer-debug.exe` as release assets
   - Add release notes in the description

4. The next time users launch the app, they'll be prompted to update automatically

### Testing Updates

To test the update mechanism:
- Build with an older version number
- Create a test release on GitHub with a newer version
- Launch the app and verify the update prompt appears

### Notes

- Updates only work when running as `.exe` (not from Python script)
- Network connection required for update checks
- If update check fails, the app continues normally
- Update checks respect debug vs release versions (debug.exe updates to debug.exe)
