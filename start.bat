@echo off
title Growth Force Field
echo.
echo  ========================================
echo        Growth Force Field
echo  ========================================
echo.

cd /d "%~dp0"

netstat -aon | findstr ":3000" | findstr "LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo  [!] Port 3000 in use, releasing...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
        taskkill /PID %%a /F >nul 2>nul
    )
    timeout /t 1 /nobreak >nul
    echo  [OK] Port released.
    echo.
)

echo  Starting server...
echo.

if not exist "node_modules\" (
    echo  First run, installing dependencies...
    call npm install --production
    echo.
)

node server\index.js --open

echo.
echo  Server stopped.
pause
