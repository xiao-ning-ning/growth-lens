@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Growth Force Field

echo.
echo ========================================
echo        Growth Force Field
echo ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install it first:
    echo.
    echo   https://nodejs.org/  (LTS version recommended)
    echo.
    echo After installing, run start.bat again.
    echo.
    pause
    exit /b
)

echo [OK] Node.js detected

:: Install dependencies if needed
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Check your network.
        pause
        exit /b
    )
)

:: Check .env
if not exist ".env" (
    echo [ERROR] .env file not found.
    echo.
    echo Please create .env in the project root with at least:
    echo   OPENAI_API_KEY=your-api-key
    echo   ADMIN_PASSWORD=your-password^(min 8 chars^)
    echo.
    echo See README.md for details.
    echo.
    pause
    exit /b
)

echo [OK] All ready. Starting server...
node server\index.js --open
pause
