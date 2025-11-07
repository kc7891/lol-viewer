@echo off
echo Combining LoL Viewer release files...
echo.

REM Check if all parts exist
if not exist "LoL-Viewer-win-x64.zip.partaa" (
    echo Error: LoL-Viewer-win-x64.zip.partaa not found
    pause
    exit /b 1
)
if not exist "LoL-Viewer-win-x64.zip.partab" (
    echo Error: LoL-Viewer-win-x64.zip.partab not found
    pause
    exit /b 1
)
if not exist "LoL-Viewer-win-x64.zip.partac" (
    echo Error: LoL-Viewer-win-x64.zip.partac not found
    pause
    exit /b 1
)

REM Combine the parts
echo Combining parts into LoL-Viewer-win-x64.zip...
copy /b LoL-Viewer-win-x64.zip.partaa+LoL-Viewer-win-x64.zip.partab+LoL-Viewer-win-x64.zip.partac LoL-Viewer-win-x64.zip

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Success! LoL-Viewer-win-x64.zip has been created.
    echo You can now extract the zip file to use LoL Viewer.
    echo.
) else (
    echo.
    echo Error: Failed to combine parts
    pause
    exit /b 1
)

pause
