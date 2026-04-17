@echo off
setlocal EnableDelayedExpansion
title Growth Force Field
cd /d "%~dp0"

echo.
echo  ========================================
echo        Growth Force Field
echo  ========================================
echo.

:: 检测 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [i] 未检测到 Node.js，正在安装...
    echo.

    :: 尝试使用 winget 安装
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements >nul 2>nul
    if %errorlevel% equ 0 (
        :: 刷新环境变量
        for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
        for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%b"
        set "PATH=%SYSTEMROOT%\System32;%SYSTEMROOT%;%SYS_PATH%;%USR_PATH%"
        echo  [OK] Node.js 安装完成
        echo.
        echo  请重新双击 start.bat 启动
        echo.
        pause
        exit /b 0
    ) else (
        echo  [ERROR] 自动安装 Node.js 失败
        echo.
        echo  请手动安装 Node.js：
        echo  1. 访问 https://nodejs.org 下载安装包
        echo  2. 安装完成后重新双击 start.bat
        echo.
        pause
        exit /b 1
    )
)

:: 检测端口占用
netstat -aon | findstr ":3000" | findstr "LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo  [!] Port 3000 已被占用，正在释放...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
        taskkill /PID %%a /F >nul 2>nul
    )
    timeout /t 1 /nobreak >nul
    echo  [OK] 端口已释放
    echo.
)

:: 检查依赖
if not exist "node_modules\" (
    echo  [i] 首次运行，正在安装依赖...
    call npm install
    if !errorlevel! neq 0 (
        echo  [ERROR] 依赖安装失败
        pause
        exit /b 1
    )
    echo.
)

:: 启动服务
echo  启动服务中...
echo.
node server\index.js --open

echo.
echo  服务已停止
pause
