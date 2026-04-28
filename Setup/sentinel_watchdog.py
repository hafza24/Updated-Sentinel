"""
Sentinel Net — Watchdog  (sentinel_watchdog.exe)
-------------------------------------------------
College Lab Management Tool - Process Guardian

Keeps sentinel_agent.exe and sentinel_tray.exe running.
Restarts them silently if they exit or are killed.
Runs as SYSTEM via scheduled task — fully hidden, no console.
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys
import time
import ctypes
from pathlib import Path

# Hide console immediately
if getattr(sys, "frozen", False) and platform.system() == "Windows":
    try:
        ctypes.windll.user32.ShowWindow(
            ctypes.windll.kernel32.GetConsoleWindow(), 0)
    except Exception:
        pass

try:
    import psutil
    _PSUTIL = True
except ImportError:
    _PSUTIL = False

_NO_WINDOW = 0x08000000
CHECK_INTERVAL = 15  # seconds between checks

if getattr(sys, "frozen", False):
    INSTALL_DIR = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "SentinelNet"
    DATA_DIR    = INSTALL_DIR  # All data in C:\Program Files\SentinelNet\ (NOT ProgramData)
else:
    INSTALL_DIR = Path(__file__).parent
    DATA_DIR    = Path(__file__).parent

AGENT_EXE = INSTALL_DIR / "sentinel_agent.exe"
TRAY_EXE  = INSTALL_DIR / "sentinel_tray.exe"

LOG_FILE  = INSTALL_DIR / "watchdog.log"
LOG_DIR   = INSTALL_DIR / "logs"

DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)


def _log(msg: str) -> None:
    try:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] {msg}\n")
        # Keep log small
        if LOG_FILE.stat().st_size > 512 * 1024:
            content = LOG_FILE.read_text(encoding="utf-8")
            lines   = content.splitlines()
            LOG_FILE.write_text("\n".join(lines[-200:]) + "\n", encoding="utf-8")
    except Exception:
        pass


def _is_running(exe_name: str) -> bool:
    name_lower = exe_name.lower()
    if _PSUTIL:
        try:
            return any(
                name_lower in (p.info.get("name") or "").lower()
                for p in psutil.process_iter(["name"])
            )
        except Exception:
            pass
    # Fallback: tasklist
    try:
        out = subprocess.check_output(
            ["tasklist", "/FO", "CSV", "/NH", "/FI", f"IMAGENAME eq {exe_name}"],
            text=True, stderr=subprocess.DEVNULL,
            creationflags=_NO_WINDOW,
        )
        return exe_name.lower() in out.lower()
    except Exception:
        return False


def _launch(exe: Path) -> None:
    if not exe.exists():
        _log(f"EXE not found: {exe}")
        return
    try:
        subprocess.Popen(
            [str(exe)],
            creationflags=_NO_WINDOW | 0x00000008 | 0x00000200,
            close_fds=True,
            cwd=str(DATA_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log(f"Launched: {exe.name}")
    except Exception as e:
        _log(f"Failed to launch {exe.name}: {e}")


def _protect_self() -> None:
    """Raise own priority so watchdog is harder to kill."""
    try:
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.kernel32.SetPriorityClass(handle, 0x80)  # HIGH_PRIORITY
    except Exception:
        pass


def main() -> None:
    _protect_self()
    _log("Watchdog started")

    # Give agent/tray time to start on boot before first check
    time.sleep(20)

    while True:
        try:
            if not _is_running(AGENT_EXE.name):
                _log("Agent not running — restarting")
                _launch(AGENT_EXE)
                time.sleep(5)  # Grace period after launch

            if not _is_running(TRAY_EXE.name):
                _log("Tray not running — restarting")
                _launch(TRAY_EXE)
                time.sleep(5)

        except Exception as e:
            _log(f"Watchdog loop error: {e}")

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()