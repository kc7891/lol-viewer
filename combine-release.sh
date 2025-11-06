#!/bin/bash
echo "Combining ZIP file parts..."
cd release
cat LoL-Analytics-Viewer-Windows-x64.zip.part-* > LoL-Analytics-Viewer-Windows-x64.zip
echo "Done! File created: release/LoL-Analytics-Viewer-Windows-x64.zip"
