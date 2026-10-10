@echo off
echo Packaging Gemini Tree Chrome Extension...
powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; Remove-Item -Force -ErrorAction SilentlyContinue 'gemini-tree-v1.2.5.zip'; Compress-Archive -Path 'gemini-tree-extension\manifest.json', 'gemini-tree-extension\content.js', 'gemini-tree-extension\content.css', 'gemini-tree-extension\popup.html', 'gemini-tree-extension\popup.js', 'gemini-tree-extension\popup.css', 'gemini-tree-extension\icons' -DestinationPath 'gemini-tree-v1.2.5.zip' -Force"
echo Packaged successfully: gemini-tree-v1.2.5.zip
