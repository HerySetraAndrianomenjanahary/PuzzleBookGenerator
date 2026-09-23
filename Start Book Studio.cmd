@echo off
title MyPuzzles Book Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node 18 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing dependencies for the first run...
  call npm install
)
echo Starting MyPuzzles Book Studio...
start "" http://localhost:4173
node src\cli.js serve
pause