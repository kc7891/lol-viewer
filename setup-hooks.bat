@echo off
REM Setup Git hooks for this repository (Windows version)

echo ================================================================
echo Setting up Git hooks for LoL Viewer
echo ================================================================
echo.

REM Configure Git to use .githooks directory
git config core.hooksPath .githooks

echo [OK] Git hooks configured successfully
echo.
echo The following hooks are now active:
echo   * commit-msg: Enforces Conventional Commits format
echo.
echo Commit message format:
echo   type(optional-scope): description
echo.
echo Valid types: feat, fix, docs, style, refactor, test, chore, ci, perf
echo.
echo Examples:
echo   feat: add user authentication
echo   fix(ui): correct button alignment
echo   docs: update README
echo.
echo ================================================================
pause
