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

**Note:** The application uses **onedir** format (not onefile) to include all DLLs and eliminate VC++ Redistributable dependency.

**Debug Version:**
```bash
pyinstaller lol-viewer-debug.spec
# Output: dist/lol-viewer-debug/ (folder containing exe and _internal/)
```

**Release Version:**
```bash
pyinstaller lol-viewer.spec
# Output: dist/lol-viewer/ (folder containing exe and _internal/)
```

**Building the Installer:**

After building with PyInstaller, create the installer with Inno Setup:

```bash
# Install Inno Setup (if not already installed)
choco install innosetup

# Build installer
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" lol-viewer.iss
# Output: installer_output/lol-viewer-setup.exe
```

### After Building

The onedir build creates a folder in `dist/` containing:
- `lol-viewer.exe` (main executable)
- `_internal/` (all DLLs and dependencies)

**For distribution**, use the installer (`lol-viewer-setup.exe`) which handles installation to Program Files, Start Menu shortcuts, and more.

## Auto-Update Mechanism

The application includes an automatic update feature that checks for new versions on startup.

### How It Works

1. **Version Check**: On startup, the app checks GitHub Releases API for the latest version
2. **User Prompt**: If a newer version is available, a dialog asks if the user wants to update
3. **Download**: If confirmed, the installer is downloaded with a progress indicator
4. **Installation**: The installer runs in silent mode, automatically updating the application

### Automated Release Process

**The entire release process is now automated!** No manual version updates needed.

#### Setup (One-time)

1. **Install Git hooks** (enforces commit message format):
   ```bash
   # Linux/Mac
   bash setup-hooks.sh

   # Windows
   setup-hooks.bat
   ```

#### How to Release

Simply merge to `main` with proper commit messages:

```bash
# Feature (minor version bump: 0.2.0 → 0.3.0)
git commit -m "feat: add dark mode support"

# Bug fix (patch version bump: 0.2.0 → 0.2.1)
git commit -m "fix: correct button alignment"

# Documentation (patch version bump)
git commit -m "docs: update installation guide"

# Breaking change (major version bump: 0.2.0 → 1.0.0)
git commit -m "feat!: redesign UI

BREAKING CHANGE: Old configuration files are not compatible"
```

**When you merge to `main`:**
1. GitHub Actions analyzes commit messages
2. Automatically bumps version in `main.py`
3. Creates git tag (e.g., `v0.3.0`)
4. Builds application with PyInstaller (onedir format)
5. Creates Windows installer with Inno Setup (`lol-viewer-setup.exe`)
6. Creates GitHub Release with installer attached
7. Users receive update notification on next launch

**Total time: ~10 minutes from merge to release**

#### Commit Message Format

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(optional-scope): description

[optional body]

[optional footer]
```

**Valid types:**
- `feat`: New feature → **minor** version bump (0.2.0 → 0.3.0)
- `fix`: Bug fix → **patch** version bump (0.2.0 → 0.2.1)
- `docs`: Documentation → **patch** version bump
- `style`: Code formatting → **patch** version bump
- `refactor`: Code refactoring → **patch** version bump
- `test`: Tests → **patch** version bump
- `chore`: Maintenance → **patch** version bump
- `ci`: CI/CD changes → **patch** version bump
- `perf`: Performance → **patch** version bump

**Breaking changes:**
- Add `!` after type: `feat!: redesign API`
- Or add `BREAKING CHANGE:` in footer → **major** version bump (0.2.0 → 1.0.0)

**Examples:**
```bash
✓ feat: add automatic update mechanism
✓ fix(ui): correct button alignment on small screens
✓ docs: update README with new installation steps
✓ chore: update dependencies to latest versions
✗ Added new feature (rejected by git hook)
✗ fixed bug (rejected by git hook)
```

#### Manual Release (if needed)

You can also trigger a release manually from GitHub Actions UI:
1. Go to Actions → Automatic Release
2. Click "Run workflow"
3. Select version bump type (patch/minor/major)
4. Click "Run workflow"

### Testing Updates

To test the update mechanism:
```bash
# Use the quick test script (no build required)
python quick_test_update.py

# Or test with actual app
python main.py  # Will check for updates on startup
```

### Version Management

- Current version is in `main.py` as `__version__`
- **DO NOT manually edit this** - it's automatically updated on release
- If you need to check current version: `grep __version__ main.py`

### Notes

- Updates only work when running as `.exe` (not from Python script)
- Network connection required for update checks
- If update check fails, the app continues normally
- Pre-commit hook validates all commit messages before allowing commit
- All version bumps and releases are fully automated via GitHub Actions
