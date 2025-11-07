@echo off
echo Combining ZIP file parts...
cd release
copy /b LoL-Analytics-Viewer-Windows-x64.zip.part-00+LoL-Analytics-Viewer-Windows-x64.zip.part-01+LoL-Analytics-Viewer-Windows-x64.zip.part-02 LoL-Analytics-Viewer-Windows-x64.zip
echo Done! File created: release\LoL-Analytics-Viewer-Windows-x64.zip
pause
