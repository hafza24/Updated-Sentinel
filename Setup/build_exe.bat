@echo off
title Sentinel Net - Build System
setlocal ENABLEDELAYEDEXPANSION

:: ============================================================
::  AUTO-ELEVATE TO ADMINISTRATOR
:: ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [build] Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

cd /d "%~dp0"

echo.
echo ============================================================
echo   Sentinel Net  -  BUILD SYSTEM  (College Lab Edition)
echo ============================================================
echo.

:: ============================================================
::  CHECK PYTHON
:: ============================================================
where python >nul 2>nul
if errorlevel 1 (
    echo [build] ERROR: Python not found in PATH.
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set "PYV=%%v"
echo [build] Python: !PYV!

python -c "import sys; exit(0 if sys.version_info >= (3, 8) else 1)"
if errorlevel 1 (
    echo [build] ERROR: Python 3.8+ required.
    pause
    exit /b 1
)

:: ============================================================
::  INSTALL DEPENDENCIES
:: ============================================================
echo [build] Installing / upgrading dependencies...
echo.

python -m pip install --upgrade pip --quiet
if errorlevel 1 goto :error

python -m pip install --upgrade ^
    pyinstaller ^
    requests ^
    psutil ^
    pystray ^
    pillow ^
    plyer ^
    websocket-client ^
    pywin32 ^
    --quiet
if errorlevel 1 goto :error

python -m pip install --upgrade cryptography --quiet 2>nul
if errorlevel 1 (
    echo [build] NOTE: cryptography optional - skipping
)

echo [build] Dependencies ready.
echo.

:: ============================================================
::  VERIFY SOURCE FILES
:: ============================================================
for %%F in (installer.py sentinel_agent.py sentinel_tray.py sentinel_watchdog.py) do (
    if not exist "%%F" (
        echo [build] ERROR: Missing required file: %%F
        pause
        exit /b 1
    )
)
echo [build] Source files verified.
echo.

:: ============================================================
::  CLEAN PREVIOUS BUILDS
:: ============================================================
echo [build] Cleaning previous builds...
if exist build   rmdir /S /Q build   >nul 2>&1
if exist dist    rmdir /S /Q dist    >nul 2>&1
del /Q *.spec    >nul 2>&1
echo [build] Clean done.
echo.

:: ============================================================
::  COMMON PYINSTALLER FLAGS
::  --noconsole     : no console window (critical - prevents flashing)
::  --uac-admin     : request elevation
::  --onefile       : single exe
::  --clean         : fresh build
:: ============================================================

:: ============================================================
::  [1/4]  sentinel_agent.exe
:: ============================================================
echo [build] [1/4] Building sentinel_agent.exe ...

python -m PyInstaller ^
    --clean ^
    --onefile ^
    --noconsole ^
    --name sentinel_agent ^
    --hidden-import=requests ^
    --hidden-import=requests.adapters ^
    --hidden-import=requests.auth ^
    --hidden-import=urllib3 ^
    --hidden-import=psutil ^
    --hidden-import=servicemanager ^
    --hidden-import=win32event ^
    --hidden-import=win32service ^
    --hidden-import=win32serviceutil ^
    --hidden-import=win32timezone ^
    --uac-admin ^
    sentinel_agent.py

if errorlevel 1 goto :error
echo [build] sentinel_agent.exe OK
echo.

:: ============================================================
::  [2/4]  sentinel_tray.exe
:: ============================================================
echo [build] [2/4] Building sentinel_tray.exe ...

python -m PyInstaller ^
    --clean ^
    --onefile ^
    --noconsole ^
    --name sentinel_tray ^
    --hidden-import=requests ^
    --hidden-import=urllib3 ^
    --hidden-import=psutil ^
    --hidden-import=pystray ^
    --hidden-import=pystray._win32 ^
    --hidden-import=PIL ^
    --hidden-import=PIL.Image ^
    --hidden-import=PIL.ImageDraw ^
    --hidden-import=plyer ^
    --hidden-import=plyer.platforms ^
    --hidden-import=plyer.platforms.win ^
    --hidden-import=plyer.platforms.win.notification ^
    --hidden-import=win32gui ^
    --hidden-import=win32con ^
    --hidden-import=win32api ^
    --hidden-import=winreg ^
    --hidden-import=ctypes ^
    --hidden-import=ctypes.wintypes ^
    --hidden-import=tkinter ^
    --hidden-import=tkinter.ttk ^
    --hidden-import=tkinter.messagebox ^
    --hidden-import=tkinter.font ^
    --collect-all pystray ^
    --uac-admin ^
    sentinel_tray.py

if errorlevel 1 goto :error
echo [build] sentinel_tray.exe OK
echo.

:: ============================================================
::  [3/4]  sentinel_watchdog.exe
:: ============================================================
echo [build] [3/4] Building sentinel_watchdog.exe ...

python -m PyInstaller ^
    --clean ^
    --onefile ^
    --noconsole ^
    --name sentinel_watchdog ^
    --hidden-import=psutil ^
    --hidden-import=winreg ^
    --hidden-import=ctypes ^
    --hidden-import=ctypes.wintypes ^
    --uac-admin ^
    sentinel_watchdog.py

if errorlevel 1 goto :error
echo [build] sentinel_watchdog.exe OK
echo.

:: ============================================================
::  [4/4]  setup.exe  (bundles all three EXEs)
:: ============================================================
echo [build] [4/4] Building setup.exe (bundles agent + tray + watchdog) ...

python -m PyInstaller ^
    --clean ^
    --onefile ^
    --noconsole ^
    --name setup ^
    --hidden-import=requests ^
    --hidden-import=urllib3 ^
    --hidden-import=tkinter ^
    --hidden-import=tkinter.ttk ^
    --hidden-import=tkinter.messagebox ^
    --hidden-import=tkinter.font ^
    --hidden-import=json ^
    --hidden-import=os ^
    --hidden-import=platform ^
    --hidden-import=shutil ^
    --hidden-import=socket ^
    --hidden-import=subprocess ^
    --hidden-import=sys ^
    --hidden-import=threading ^
    --hidden-import=uuid ^
    --hidden-import=hashlib ^
    --hidden-import=ctypes ^
    --hidden-import=ctypes.wintypes ^
    --hidden-import=winreg ^
    --hidden-import=pathlib ^
    --add-binary "dist\sentinel_agent.exe;." ^
    --add-binary "dist\sentinel_tray.exe;." ^
    --add-binary "dist\sentinel_watchdog.exe;." ^
    --uac-admin ^
    installer.py

if errorlevel 1 goto :error

:: ============================================================
::  POST-BUILD: verify all outputs exist + copy unblock helper
:: ============================================================
echo.
echo [build] Verifying outputs...
for %%F in (dist\setup.exe dist\sentinel_agent.exe dist\sentinel_tray.exe dist\sentinel_watchdog.exe) do (
    if not exist "%%F" (
        echo [build] ERROR: Missing output: %%F
        goto :error
    )
    for %%S in ("%%F") do echo [build]   %%F  (%%~zS bytes)
)

:: ============================================================
::  SUCCESS
:: ============================================================
echo.
echo ============================================================
echo   BUILD COMPLETE
echo ============================================================
echo.
echo   OUTPUTS (copy all to deployment location):
echo     dist\setup.exe              ^<-- run this on each lab PC as Admin
echo     dist\sentinel_agent.exe     background policy agent
echo     dist\sentinel_tray.exe      system tray + dashboard
echo     dist\sentinel_watchdog.exe  keeps agent+tray alive
echo.
echo   INSTALL PATHS on target machine:
echo     Executables : C:\Program Files\SentinelNet\
echo     Runtime data: C:\ProgramData\SentinelNet\
echo     Logs        : C:\ProgramData\SentinelNet\agent.log
echo.
echo   DEPLOYMENT NOTES:
echo     1. Run setup.exe as Administrator on each lab computer
echo     2. Enter your admin credentials when prompted
echo     3. Agent starts silently on next boot (and immediately)
echo     4. Dashboard: click tray icon (bottom-right system tray)
echo     5. Uninstall: student requests via dashboard, admin approves
echo.
echo !! setup.exe MUST be run as Administrator !!
echo.
pause
exit /b 0

:: ============================================================
:error
echo.
echo ============================================================
echo   BUILD FAILED
echo ============================================================
echo.
echo   Common fixes:
echo     1. Run this script as Administrator
echo     2. Run manually: pip install pywin32 requests psutil pystray pillow plyer websocket-client pyinstaller
echo     3. Ensure Python 3.8-3.12 is installed (3.13 may have pywin32 issues)
echo     4. Check antivirus is not blocking PyInstaller temp files
echo        (add your project folder to AV exclusions during build)
echo.
pause
exit /b 1
