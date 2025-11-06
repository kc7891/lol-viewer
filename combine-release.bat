@echo off
echo Combining ZIP file parts...
cd release
copy /b LoL-Analytics-Viewer-Windows-x64.zip.part-aa+LoL-Analytics-Viewer-Windows-x64.zip.part-ab+LoL-Analytics-Viewer-Windows-x64.zip.part-ac LoL-Analytics-Viewer-Windows-x64.zip
echo Done! File created: release\LoL-Analytics-Viewer-Windows-x64.zip
pause
