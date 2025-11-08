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
