@echo off
cd /d "%~dp0"
start "Career Copilot CN server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"
