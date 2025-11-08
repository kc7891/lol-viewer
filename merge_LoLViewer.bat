@echo off
echo Merging LoLViewer.zip parts...
copy /b LoLViewer.zip.part_aa+LoLViewer.zip.part_ab+LoLViewer.zip.part_ac+LoLViewer.zip.part_ad LoLViewer.zip
echo Merge complete!
echo Extracting LoLViewer.zip...
powershell -command "Expand-Archive -Path LoLViewer.zip -DestinationPath . -Force"
echo Extraction complete!
echo You can now run LoLViewer.exe
pause
