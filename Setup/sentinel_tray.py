"""
Sentinel Net — System Tray & Dashboard  (sentinel_tray.exe)
------------------------------------------------------------
College Lab Management Tool - Tray Application

Fixes:
  • Dashboard content fully visible (scrollable canvas)
  • No exit option in tray right-click menu
  • Left-click shows dashboard
  • All subprocess calls use CREATE_NO_WINDOW (no flashing)
  • Uninstall only after admin approval — then removes device from DB,
    restores hosts file, removes scheduled tasks, deletes install folder
  • Pop-up alerts for all policy violations
  • Device status shown in tray tooltip
"""

from __future__ import annotations

import json
import os
import platform
import socket
import subprocess
import sys
import threading
import tkinter as tk
from datetime import datetime, timezone
from pathlib import Path
from tkinter import font as tkfont
from tkinter import messagebox, ttk
from typing import Optional

# Hide console window immediately
if getattr(sys, "frozen", False) and platform.system() == "Windows":
    import ctypes
    try:
        ctypes.windll.user32.ShowWindow(
            ctypes.windll.kernel32.GetConsoleWindow(), 0)
    except Exception:
        pass

try:
    import pystray
    from PIL import Image, ImageDraw
    _TRAY_AVAILABLE = True
except ImportError:
    _TRAY_AVAILABLE = False

try:
    from plyer import notification as _plyer
    _TOAST_AVAILABLE = True
except ImportError:
    _TOAST_AVAILABLE = False

try:
    import win32gui
    import win32con
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False

try:
    import requests
except ImportError:
    requests = None

try:
    import psutil
    _PSUTIL_AVAILABLE = True
except ImportError:
    _PSUTIL_AVAILABLE = False


# ---------------------------------------------------------------------------
# Constants & paths
# ---------------------------------------------------------------------------
_NO_WINDOW = 0x08000000

APP_NAME           = "SentinelNet"
TASK_NAME          = "Sentinel Net Agent"
WATCHDOG_TASK_NAME = "Sentinel Net Watchdog"
TRAY_TASK_NAME     = "Sentinel Net Tray"

if getattr(sys, "frozen", False):
    INSTALL_DIR = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / APP_NAME
    DATA_DIR    = INSTALL_DIR  # All data in C:\Program Files\SentinelNet\ (NOT ProgramData)
else:
    INSTALL_DIR = Path(__file__).parent
    DATA_DIR    = Path(__file__).parent

CONFIG_PATH     = DATA_DIR / "sentinel_config.json"
STATS_FILE      = DATA_DIR / "agent_stats.json"
AGENT_EXE       = INSTALL_DIR / "sentinel_agent.exe"
WATCHDOG_EXE    = INSTALL_DIR / "sentinel_watchdog.exe"
AGENT_HEARTBEAT = DATA_DIR / "agent_heartbeat.json"
ALERT_LOG_FILE  = DATA_DIR / "alert_log.json"
HOSTS_BACKUP    = DATA_DIR / "hosts_original_backup"
LOG_DIR         = DATA_DIR / "logs"

SUPABASE_URL      = "https://kwctyqxdiocjmsekymft.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3Y3R5cXhkaW9jam1zZWt5bWZ0Iiwicm9sZSI6ImFub24i"
    "LCJpYXQiOjE3NzY1MDU3MTksImV4cCI6MjA5MjA4MTcxOX0."
    "9z3Jgnuds4uLOsz62eOvvCz34i-9iD9PWILKVnjRpaA"
)
USERNAME_DOMAIN = "sentinel.local"

# Brand
BG       = "#0b1020"
SURFACE  = "#10172a"
SURFACE2 = "#161f3a"
BORDER   = "#1f2a48"
TEXT     = "#e6eefc"
MUTED    = "#8a96b4"
PRIMARY  = "#4f8cff"
SUCCESS  = "#36d399"
WARNING  = "#fbbf24"
DANGER   = "#f87171"
INFO     = "#60a5fa"

POLL_MS       = 2000
ALERT_POLL_MS = 3000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _toast(title: str, message: str, duration: int = 6) -> None:
    if not _TOAST_AVAILABLE:
        return
    try:
        _plyer.notify(title=title[:64], message=message[:256],
                      app_name="Sentinel Net", timeout=duration)
    except Exception:
        pass


def _read_stats() -> dict:
    try:
        if STATS_FILE.exists():
            data = json.loads(STATS_FILE.read_text(encoding="utf-8"))
            if data.get("last_sync"):
                try:
                    data["last_sync"] = datetime.fromisoformat(data["last_sync"])
                except Exception:
                    data["last_sync"] = None
            return data
    except Exception:
        pass
    return {
        "sync_count": 0, "last_sync": None, "alerts_sent": 0,
        "status": "unknown", "last_error": "",
        "domains_blocked": 0, "blocked_domains_list": [],
        "downloads_rules": 0, "download_rules_list": [],
        "files_blocked": 0, "processes_killed": 0,
        "domain_blocks_count": 0, "last_domain_block": "",
        "realtime_connected": False, "offline_mode": False,
        "alert_count": 0, "telemetry_uploads": 0,
        "firewall_enabled": True,
        "download_restriction_enabled": True,
        "process_enforcement_enabled": True,
        "active_schedules": 0,
    }


def _read_alerts() -> list[dict]:
    try:
        if ALERT_LOG_FILE.exists():
            return json.loads(ALERT_LOG_FILE.read_text(encoding="utf-8"))[-50:]
    except Exception:
        pass
    return []


def _check_agent_alive() -> bool:
    if AGENT_HEARTBEAT.exists():
        try:
            data = json.loads(AGENT_HEARTBEAT.read_text(encoding="utf-8"))
            ts   = datetime.fromisoformat(data["ts"].replace("Z", "+00:00"))
            age  = (datetime.now(timezone.utc) - ts).total_seconds()
            return age < 120
        except Exception:
            pass
    if _PSUTIL_AVAILABLE:
        try:
            return any("sentinel_agent" in (p.info.get("name") or "").lower()
                       for p in psutil.process_iter(["name"]))
        except Exception:
            pass
    return False


def _get_device_status() -> dict:
    status = {
        "agent_running":     _check_agent_alive(),
        "network_connected": False,
        "hostname":          socket.gethostname(),
        "ip_address":        "Unknown",
    }
    try:
        socket.create_connection(("8.8.8.8", 53), timeout=2)
        status["network_connected"] = True
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        status["ip_address"] = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    return status


# ---------------------------------------------------------------------------
# Uninstall flow
# ---------------------------------------------------------------------------
def _submit_uninstall_request(cfg: dict, reason: str) -> tuple[str, str]:
    if requests is None:
        raise RuntimeError("'requests' not available")
    auth = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        json={"email": f"{cfg['username'].strip().lower()}@{USERNAME_DOMAIN}",
              "password": cfg["password"]},
        timeout=15,
    )
    if not auth.ok:
        raise RuntimeError(f"Login failed: {auth.text}")
    token   = auth.json()["access_token"]
    user_id = auth.json()["user"]["id"]
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/requests",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}",
                 "Content-Type": "application/json", "Prefer": "return=representation"},
        json={
            "user_id":      user_id,
            "device_id":    cfg.get("device_id"),
            "request_type": "uninstall",
            "payload":      {"hostname": socket.gethostname()},
            "reason":       reason or "Student requested uninstall from lab computer.",
            "status":       "pending",
        },
        timeout=15,
    )
    if not r.ok:
        raise RuntimeError(f"Request failed: {r.text}")
    return r.json()[0]["id"], token


def _poll_request_status(request_id: str, token: str) -> str:
    if requests is None:
        return "pending"
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/requests",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            params={"select": "status", "id": f"eq.{request_id}", "limit": 1},
            timeout=15,
        )
        if r.ok and r.json():
            return r.json()[0]["status"]
    except Exception:
        pass
    return "pending"


def _perform_uninstall() -> None:
    """
    Full uninstall:
    1. Remove device from Supabase
    2. Restore original hosts file
    3. Restore firewall to default
    4. Remove scheduled tasks
    5. Remove registry entries
    6. Remove firewall rules
    7. Self-delete via batch script
    """
    # 1 — Remove device from Supabase
    try:
        cfg          = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        access_token = cfg.get("access_token")
        device_id    = cfg.get("device_id")
        if access_token and device_id and requests:
            requests.delete(
                f"{SUPABASE_URL}/rest/v1/devices",
                headers={"apikey": SUPABASE_ANON_KEY,
                         "Authorization": f"Bearer {access_token}",
                         "Prefer": "return=minimal"},
                params={"id": f"eq.{device_id}"},
                timeout=15,
            )
    except Exception:
        pass

    # 2 — Restore hosts file
    hosts_path = Path(r"C:\Windows\System32\drivers\etc\hosts")
    try:
        if HOSTS_BACKUP.exists():
            current = hosts_path.read_text(encoding="utf-8")
            if "# >>> sentinel-net managed >>>" in current:
                before = current.split("# >>> sentinel-net managed >>>")[0]
                after_parts = current.split("# <<< sentinel-net managed <<<")
                after = after_parts[1] if len(after_parts) > 1 else ""
                hosts_path.write_text(
                    before.rstrip() + "\n" + after.lstrip(), encoding="utf-8")
            subprocess.run(["ipconfig", "/flushdns"],
                           capture_output=True, check=False,
                           creationflags=_NO_WINDOW)
    except Exception:
        pass

    # 3 — Restore firewall
    try:
        subprocess.run([
            "netsh", "advfirewall", "set", "allprofiles",
            "firewallpolicy", "allowinbound,allowoutbound",
        ], capture_output=True, check=False, creationflags=_NO_WINDOW)
        # Remove all Sentinel firewall rules
        for rule in ("SentinelAllowSupabase", "SentinelAllowDNS"):
            subprocess.run([
                "netsh", "advfirewall", "firewall", "delete", "rule",
                f"name={rule}",
            ], capture_output=True, check=False, creationflags=_NO_WINDOW)
        # Remove domain-block rules
        subprocess.run([
            "powershell", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
            "Get-NetFirewallRule | Where-Object {$_.DisplayName -like 'SentinelBlock*'} "
            "| Remove-NetFirewallRule",
        ], capture_output=True, check=False, creationflags=_NO_WINDOW)
    except Exception:
        pass

    # 4 — Remove scheduled tasks
    if platform.system() == "Windows":
        for task in (TASK_NAME, WATCHDOG_TASK_NAME, TRAY_TASK_NAME):
            subprocess.run(["schtasks", "/Delete", "/TN", task, "/F"],
                           capture_output=True, check=False,
                           creationflags=_NO_WINDOW)

    # 5 — Remove registry entries
    try:
        import winreg
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                key = winreg.OpenKey(
                    hive,
                    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
                    0, winreg.KEY_SET_VALUE)
                winreg.DeleteValue(key, "SentinelNetAgent")
                winreg.CloseKey(key)
            except Exception:
                pass
    except Exception:
        pass

    # 6 — Self-delete via batch (runs after tray exits)
    bat = DATA_DIR.parent / "SentinelNet_uninstall.bat"
    bat.write_text(
        "@echo off\r\n"
        "timeout /t 4 /nobreak >nul\r\n"
        "taskkill /F /IM sentinel_agent.exe >nul 2>&1\r\n"
        "taskkill /F /IM sentinel_tray.exe >nul 2>&1\r\n"
        "taskkill /F /IM sentinel_watchdog.exe >nul 2>&1\r\n"
        "timeout /t 2 /nobreak >nul\r\n"
        f'icacls "{INSTALL_DIR}" /grant Administrators:F /T >nul 2>&1\r\n'
        f'rmdir /S /Q "{INSTALL_DIR}" >nul 2>&1\r\n'
        f'rmdir /S /Q "{DATA_DIR}" >nul 2>&1\r\n'
        'del "%~f0"\r\n',
        encoding="utf-8",
    )
    subprocess.Popen(
        ["cmd", "/c", str(bat)],
        creationflags=_NO_WINDOW | 0x00000008,
        close_fds=True,
    )


# ---------------------------------------------------------------------------
# Tray icon
# ---------------------------------------------------------------------------
class TrayManager:
    def __init__(self, app: "AgentApp") -> None:
        self.app  = app
        self.icon: Optional[pystray.Icon] = None
        self._last_status = ""

    def create(self) -> Optional[pystray.Icon]:
        if not _TRAY_AVAILABLE:
            return None
        img = self._make_icon("starting")
        # NO exit option — students cannot close the tray
        menu = pystray.Menu(
            pystray.MenuItem("Show Dashboard", self._show, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Hide Dashboard", self._hide),
        )
        self.icon = pystray.Icon("sentinel_net", img,
                                  "Sentinel Net — Lab Management", menu)
        return self.icon

    def _make_icon(self, status: str) -> "Image.Image":
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        dc  = ImageDraw.Draw(img)
        dc.ellipse([2, 2, 62, 62], fill=(79, 140, 255, 255))
        dc.ellipse([10, 10, 54, 54], fill=(11, 16, 32, 255))
        dot = {
            "running":  (54, 211, 153),
            "starting": (251, 191, 36),
            "error":    (248, 113, 113),
        }.get(status, (138, 150, 180))
        dc.ellipse([22, 22, 42, 42], fill=dot)
        return img

    def update(self, status: str, device_status: dict) -> None:
        if not self.icon or status == self._last_status:
            return
        self._last_status = status
        try:
            self.icon.icon = self._make_icon(status)
            agent_str   = "Running ✓" if device_status.get("agent_running") else "Stopped ✗"
            network_str = "Connected" if device_status.get("network_connected") else "Disconnected"
            self.icon.title = (
                f"Sentinel Net — {status.upper()}\n"
                f"Agent: {agent_str}\n"
                f"Network: {network_str}\n"
                f"IP: {device_status.get('ip_address', '?')}"
            )
        except Exception:
            pass

    def _show(self, icon=None, item=None) -> None:
        self.app._show_window()

    def _hide(self, icon=None, item=None) -> None:
        self.app._hide_to_tray()

    def stop(self) -> None:
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Dashboard window
# ---------------------------------------------------------------------------
class AgentApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Sentinel Net — Lab Dashboard")
        self.configure(bg=BG)
        self.geometry("700x860")
        self.minsize(640, 600)
        self.resizable(True, True)

        self._uninstall_req_id: str | None = None
        self._uninstall_token:  str | None = None
        self._tray_mgr  = TrayManager(self)
        self._tray_icon = self._tray_mgr.create()
        self._prev_files    = 0
        self._prev_procs    = 0
        self._prev_domains  = 0
        self._prev_alerts   = 0

        self._build_fonts()
        self._build_ui()
        self._refresh_loop()
        self._alert_loop()

        if _TRAY_AVAILABLE and self._tray_icon:
            threading.Thread(target=self._tray_icon.run, daemon=True).start()

        # Start hidden — tray icon is the primary interface
        self.after(100, self.withdraw)

    # ------------------------------------------------------------------
    def _build_fonts(self) -> None:
        self.f_h1      = tkfont.Font(family="Segoe UI", size=16, weight="bold")
        self.f_eyebrow = tkfont.Font(family="Consolas", size=8)
        self.f_val     = tkfont.Font(family="Consolas", size=13, weight="bold")
        self.f_btn     = tkfont.Font(family="Segoe UI", size=10, weight="bold")
        self.f_log     = tkfont.Font(family="Consolas", size=9)
        self.f_small   = tkfont.Font(family="Consolas", size=8)
        self.f_body    = tkfont.Font(family="Segoe UI",  size=9)

    def _build_ui(self) -> None:
        # Top accent
        tk.Frame(self, bg=PRIMARY, height=3).pack(fill="x", side="top")

        # Outer container with scrollable canvas
        outer = tk.Frame(self, bg=BG)
        outer.pack(fill="both", expand=True)

        self._canvas = tk.Canvas(outer, bg=BG, highlightthickness=0)
        _sb = ttk.Scrollbar(outer, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=_sb.set)
        _sb.pack(side="right", fill="y")
        self._canvas.pack(side="left", fill="both", expand=True)

        wrap = tk.Frame(self._canvas, bg=BG, padx=26, pady=22)
        _win = self._canvas.create_window((0, 0), window=wrap, anchor="nw")

        def _frame_cfg(e):
            self._canvas.configure(scrollregion=self._canvas.bbox("all"))
        def _canvas_cfg(e):
            self._canvas.itemconfig(_win, width=e.width)
        wrap.bind("<Configure>", _frame_cfg)
        self._canvas.bind("<Configure>", _canvas_cfg)
        self._canvas.bind_all("<MouseWheel>",
            lambda e: self._canvas.yview_scroll(int(-1*(e.delta/120)), "units"))

        # ── Header ──────────────────────────────────────────────────────
        hdr = tk.Frame(wrap, bg=BG)
        hdr.pack(fill="x")
        tk.Label(hdr, text="◈", fg=PRIMARY, bg=BG,
                 font=tkfont.Font(family="Segoe UI", size=22, weight="bold")
                 ).pack(side="left", padx=(0, 10))
        col = tk.Frame(hdr, bg=BG)
        col.pack(side="left")
        tk.Label(col, text="SENTINEL NET", fg=TEXT, bg=BG,
                 font=self.f_h1).pack(anchor="w")
        srow = tk.Frame(col, bg=BG)
        srow.pack(anchor="w")
        self._dot_canvas = tk.Canvas(srow, width=10, height=10, bg=BG,
                                      highlightthickness=0)
        self._dot_canvas.pack(side="left", padx=(0, 6))
        self._dot = self._dot_canvas.create_oval(1, 1, 9, 9,
                                                   fill=WARNING, outline="")
        self._status_lbl = tk.Label(srow, text="STATUS · CHECKING",
                                     fg=WARNING, bg=BG, font=self.f_eyebrow)
        self._status_lbl.pack(side="left")

        tk.Frame(wrap, bg=BORDER, height=1).pack(fill="x", pady=(14, 12))

        # ── Device info bar ─────────────────────────────────────────────
        dev = tk.Frame(wrap, bg=SURFACE, highlightthickness=1,
                        highlightbackground=BORDER, padx=14, pady=8)
        dev.pack(fill="x", pady=(0, 10))
        tk.Label(dev, text="DEVICE", fg=MUTED, bg=SURFACE,
                 font=self.f_eyebrow).pack(anchor="w")
        drow = tk.Frame(dev, bg=SURFACE)
        drow.pack(fill="x", pady=(4, 0))
        self._lbl_host    = tk.Label(drow, text="Host: —", fg=TEXT,
                                      bg=SURFACE, font=self.f_small)
        self._lbl_host.pack(side="left", padx=(0, 18))
        self._lbl_ip      = tk.Label(drow, text="IP: —", fg=TEXT,
                                      bg=SURFACE, font=self.f_small)
        self._lbl_ip.pack(side="left", padx=(0, 18))
        self._lbl_net     = tk.Label(drow, text="Net: —", fg=TEXT,
                                      bg=SURFACE, font=self.f_small)
        self._lbl_net.pack(side="left", padx=(0, 18))
        self._lbl_agent   = tk.Label(drow, text="Agent: —", fg=TEXT,
                                      bg=SURFACE, font=self.f_small)
        self._lbl_agent.pack(side="left")

        # ── Stats grid 2×3 ───────────────────────────────────────────────
        grid = tk.Frame(wrap, bg=BG)
        grid.pack(fill="x")
        self._cards: dict[str, tk.Label] = {}
        defs = [
            ("sync_count",       "SYNCS",            SUCCESS),
            ("alerts_sent",      "ALERTS",           WARNING),
            ("domains_blocked",  "DOMAINS BLOCKED",  DANGER),
            ("downloads_rules",  "DOWNLOAD RULES",   INFO),
            ("files_blocked",    "FILES BLOCKED",    DANGER),
            ("processes_killed", "PROCS KILLED",     DANGER),
        ]
        for i, (key, label, color) in enumerate(defs):
            c = tk.Frame(grid, bg=SURFACE, highlightthickness=1,
                          highlightbackground=BORDER, padx=10, pady=8)
            c.grid(row=i // 3, column=i % 3, padx=3, pady=3, sticky="nsew")
            grid.columnconfigure(i % 3, weight=1)
            tk.Frame(c, bg=color, height=2).pack(fill="x", pady=(0, 5))
            tk.Label(c, text=label, fg=MUTED, bg=SURFACE,
                     font=self.f_eyebrow).pack(anchor="w")
            v = tk.Label(c, text="0", fg=color, bg=SURFACE, font=self.f_val)
            v.pack(anchor="w")
            self._cards[key] = v

        # ── Policy flags row ─────────────────────────────────────────────
        flags = tk.Frame(wrap, bg=SURFACE, highlightthickness=1,
                          highlightbackground=BORDER, padx=14, pady=8)
        flags.pack(fill="x", pady=(8, 0))
        tk.Label(flags, text="POLICY FLAGS", fg=MUTED, bg=SURFACE,
                 font=self.f_eyebrow).pack(anchor="w")
        frow = tk.Frame(flags, bg=SURFACE)
        frow.pack(fill="x", pady=(4, 0))
        self._flag_labels: dict[str, tk.Label] = {}
        for name, key in [("Firewall", "firewall_enabled"),
                           ("Downloads", "download_restriction_enabled"),
                           ("Processes", "process_enforcement_enabled"),
                           ("Schedules", "active_schedules")]:
            lbl = tk.Label(frow, text=f"{name}: —", fg=MUTED, bg=SURFACE,
                            font=self.f_small)
            lbl.pack(side="left", padx=(0, 16))
            self._flag_labels[key] = lbl

        # ── Sync info ────────────────────────────────────────────────────
        sync_f = tk.Frame(wrap, bg=SURFACE, highlightthickness=1,
                           highlightbackground=BORDER, padx=14, pady=8)
        sync_f.pack(fill="x", pady=(8, 0))
        srow2 = tk.Frame(sync_f, bg=SURFACE)
        srow2.pack(fill="x")
        tk.Label(srow2, text="LAST SYNC", fg=MUTED, bg=SURFACE,
                 font=self.f_eyebrow).pack(side="left")
        self._rt_badge = tk.Label(srow2, text="● POLLING", fg=WARNING,
                                   bg=SURFACE, font=self.f_eyebrow)
        self._rt_badge.pack(side="right")
        self._sync_lbl = tk.Label(sync_f, text="—", fg=TEXT, bg=SURFACE,
                                   font=self.f_small)
        self._sync_lbl.pack(anchor="w", pady=(3, 0))

        # ── Blocked domains ──────────────────────────────────────────────
        tk.Label(wrap, text="BLOCKED DOMAINS", fg=MUTED, bg=BG,
                 font=self.f_eyebrow).pack(anchor="w", pady=(12, 3))
        self._domains_txt = self._make_textbox(wrap, height=3)

        # ── Download rules ───────────────────────────────────────────────
        tk.Label(wrap, text="MONITORED EXTENSIONS", fg=MUTED, bg=BG,
                 font=self.f_eyebrow).pack(anchor="w", pady=(8, 3))
        self._rules_txt = self._make_textbox(wrap, height=2)

        # ── Recent alerts ────────────────────────────────────────────────
        tk.Label(wrap, text="RECENT ALERTS", fg=MUTED, bg=BG,
                 font=self.f_eyebrow).pack(anchor="w", pady=(10, 3))
        self._alerts_txt = self._make_textbox(wrap, height=5)

        # ── Error panel (hidden initially) ───────────────────────────────
        self._err_frame = tk.Frame(wrap, bg=SURFACE, highlightthickness=1,
                                    highlightbackground=DANGER, padx=12, pady=6)
        self._err_lbl   = tk.Label(self._err_frame, text="", fg=DANGER,
                                    bg=SURFACE, font=self.f_small,
                                    wraplength=620, justify="left")

        # ── Activity log ─────────────────────────────────────────────────
        tk.Label(wrap, text="ACTIVITY LOG", fg=MUTED, bg=BG,
                 font=self.f_eyebrow).pack(anchor="w", pady=(10, 3))
        self._log_txt = self._make_textbox(wrap, height=5)

        # ── Buttons ──────────────────────────────────────────────────────
        btns = tk.Frame(wrap, bg=BG)
        btns.pack(fill="x", pady=(14, 4))
        self._hide_btn = tk.Button(
            btns, text="HIDE TO TRAY",
            command=self._hide_to_tray,
            bg=SURFACE2, fg=TEXT, activebackground=BORDER,
            font=self.f_btn, relief="flat", cursor="hand2",
            padx=10, pady=9, borderwidth=0)
        self._hide_btn.pack(side="left", expand=True, fill="x", padx=(0, 5))

        self._uninstall_btn = tk.Button(
            btns, text="REQUEST UNINSTALL",
            command=self._on_uninstall,
            bg=DANGER, fg="white", activebackground="#b94040",
            font=self.f_btn, relief="flat", cursor="hand2",
            padx=10, pady=9, borderwidth=0)
        self._uninstall_btn.pack(side="right", expand=True, fill="x", padx=(5, 0))

        self.protocol("WM_DELETE_WINDOW", self._hide_to_tray)

    def _make_textbox(self, parent: tk.Widget, height: int) -> tk.Text:
        frame = tk.Frame(parent, bg=SURFACE2, highlightthickness=1,
                          highlightbackground=BORDER)
        frame.pack(fill="x")
        txt = tk.Text(frame, height=height, bg=SURFACE2, fg=MUTED,
                       font=self.f_log, relief="flat", borderwidth=0,
                       wrap="word", state="disabled", padx=10, pady=6)
        sb = ttk.Scrollbar(frame, orient="vertical", command=txt.yview)
        txt.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        txt.pack(side="left", fill="both", expand=True)
        return txt

    def _set_txt(self, widget: tk.Text, content: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", content)
        widget.configure(state="disabled")

    def _log(self, msg: str, color: str = MUTED) -> None:
        self._log_txt.configure(state="normal")
        ts = datetime.now().strftime("%H:%M:%S")
        self._log_txt.insert("end", f"[{ts}] {msg}\n")
        self._log_txt.tag_configure(color, foreground=color)
        line_n = int(self._log_txt.index("end-1c").split(".")[0]) - 1
        self._log_txt.tag_add(color, f"{line_n}.0", "end-1c")
        self._log_txt.configure(state="disabled")
        self._log_txt.see("end")

    # ------------------------------------------------------------------
    def _show_window(self) -> None:
        self.after(0, self.deiconify)
        self.after(0, self.lift)
        self.after(0, self.focus_force)

    def _hide_to_tray(self) -> None:
        self.withdraw()
        _toast("Sentinel Net", "Dashboard hidden. Click the tray icon to restore.", 3)

    # ------------------------------------------------------------------
    def _alert_loop(self) -> None:
        try:
            alerts = _read_alerts()
            if len(alerts) > self._prev_alerts:
                new = alerts[self._prev_alerts:]
                lines = []
                for a in reversed(alerts[-8:]):
                    ts  = (a.get("timestamp") or "")[:19].replace("T", " ")
                    sev = (a.get("severity") or "info").upper()
                    atp = a.get("type", "")
                    tgt = a.get("target", "")
                    lines.append(f"[{ts}] {sev}: {atp} — {tgt}")
                self._set_txt(self._alerts_txt,
                               "\n".join(lines) if lines else "No recent alerts")
                for a in new:
                    color = {
                        "critical": DANGER, "warning": WARNING,
                    }.get(a.get("severity", "info"), INFO)
                    self._log(f"ALERT: {a.get('type')} — {a.get('target')}", color)
                self._prev_alerts = len(alerts)
        except Exception:
            pass
        self.after(ALERT_POLL_MS, self._alert_loop)

    # ------------------------------------------------------------------
    def _refresh_loop(self) -> None:
        stats  = _read_stats()
        dev    = _get_device_status()

        # Device bar
        self._lbl_host.configure(text=f"Host: {dev['hostname']}")
        self._lbl_ip.configure(text=f"IP: {dev['ip_address']}")
        self._lbl_net.configure(
            text="Net: Connected" if dev["network_connected"] else "Net: Disconnected",
            fg=SUCCESS if dev["network_connected"] else DANGER)
        self._lbl_agent.configure(
            text="Agent: Running ✓" if dev["agent_running"] else "Agent: Stopped ✗",
            fg=SUCCESS if dev["agent_running"] else DANGER)

        # Stat cards
        for key in self._cards:
            self._cards[key].configure(text=str(stats.get(key, 0)))

        # Policy flags
        for key, lbl in self._flag_labels.items():
            if key == "active_schedules":
                n = int(stats.get(key, 0))
                lbl.configure(text=f"Schedules: {n}",
                               fg=SUCCESS if n else MUTED)
            else:
                on = bool(stats.get(key, True))
                lbl.configure(
                    text=f"{lbl.cget('text').split(':')[0]}: {'ON' if on else 'OFF'}",
                    fg=SUCCESS if on else DANGER)

        # Sync row
        ls = stats.get("last_sync")
        if ls:
            self._sync_lbl.configure(
                text=ls.strftime("%Y-%m-%d %H:%M:%S") if isinstance(ls, datetime)
                else str(ls)[:19])
        if stats.get("realtime_connected"):
            self._rt_badge.configure(text="● REALTIME", fg=SUCCESS)
        elif stats.get("offline_mode"):
            self._rt_badge.configure(text="● OFFLINE",  fg=DANGER)
        else:
            self._rt_badge.configure(text="● POLLING",  fg=WARNING)

        # Status dot + label
        status = stats.get("status", "unknown")
        dot_c  = {
            "running": SUCCESS, "starting": WARNING,
            "error": DANGER,    "stopped":  MUTED,
        }.get(status, MUTED)
        self._dot_canvas.itemconfig(self._dot, fill=dot_c)
        self._status_lbl.configure(text=f"STATUS · {status.upper()}", fg=dot_c)
        self._tray_mgr.update(status, dev)

        # Error panel
        err = stats.get("last_error", "")
        if status == "error" and err:
            if not self._err_frame.winfo_ismapped():
                self._err_frame.pack(fill="x", pady=(8, 0))
                self._err_lbl.pack(anchor="w")
            self._err_lbl.configure(text=f"Error: {err}")
        else:
            if self._err_frame.winfo_ismapped():
                self._err_frame.pack_forget()

        # Domains list
        domains = stats.get("blocked_domains_list", [])
        self._set_txt(self._domains_txt,
                       "  •  ".join(domains) if domains else "No domains blocked")

        # Extensions list
        rules = stats.get("download_rules_list", [])
        self._set_txt(self._rules_txt,
                       "  •  ".join(rules) if rules else "No download rules active")

        # Toast on new events
        fb = int(stats.get("files_blocked", 0) or 0)
        pk = int(stats.get("processes_killed", 0) or 0)
        db = int(stats.get("domain_blocks_count", 0) or 0)
        if fb > self._prev_files > 0:
            _toast("Sentinel Net", f"Download blocked ({fb} total)")
            self._log(f"Download blocked ({fb} total)", DANGER)
        if pk > self._prev_procs > 0:
            _toast("Sentinel Net", f"Process terminated ({pk} total)")
            self._log(f"Process killed ({pk} total)", DANGER)
        if db > self._prev_domains > 0:
            ld = stats.get("last_domain_block", "")
            _toast("Sentinel Net", f"Domain blocked: {ld}" if ld else "Domain blocked")
            self._log(f"Domain blocked: {ld}", WARNING)
        self._prev_files   = fb
        self._prev_procs   = pk
        self._prev_domains = db

        # Uninstall approval polling
        if self._uninstall_req_id and self._uninstall_token:
            try:
                rstat = _poll_request_status(self._uninstall_req_id,
                                              self._uninstall_token)
            except Exception:
                rstat = "pending"
            if rstat == "approved":
                self._log("Uninstall approved by admin — cleaning up…", SUCCESS)
                _toast("Sentinel Net", "Uninstall approved. Removing agent…")
                self._uninstall_btn.configure(text="UNINSTALLING…", state="disabled")
                self._uninstall_req_id = None
                self.after(600, self._do_uninstall)
            elif rstat == "rejected":
                self._log("Uninstall request rejected by administrator.", DANGER)
                self._uninstall_btn.configure(text="REQUEST UNINSTALL",
                                               state="normal", bg=DANGER)
                self._uninstall_req_id = None

        self.after(POLL_MS, self._refresh_loop)

    # ------------------------------------------------------------------
    def _on_uninstall(self) -> None:
        if not messagebox.askyesno(
            "Request Uninstall",
            "Submit an uninstall request to the lab administrator?\n\n"
            "This device will only be removed after your administrator approves.\n"
            "All restrictions will be lifted and the application deleted on approval.",
        ):
            return
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            messagebox.showerror("Error", f"Cannot read config: {e}")
            return
        try:
            req_id, token = _submit_uninstall_request(cfg, "")
        except Exception as e:
            messagebox.showerror("Request failed", str(e))
            return
        self._uninstall_req_id = req_id
        self._uninstall_token  = token
        self._uninstall_btn.configure(
            text="WAITING FOR ADMIN APPROVAL…", state="disabled", bg=WARNING)
        self._log("Uninstall request submitted — waiting for admin.", WARNING)
        _toast("Uninstall Requested", "Request sent to lab administrator.")

    def _do_uninstall(self) -> None:
        try:
            _perform_uninstall()
        finally:
            self._tray_mgr.stop()
            self.destroy()
            os._exit(0)


# ---------------------------------------------------------------------------
def _ensure_agent_running() -> None:
    if not AGENT_EXE.exists():
        return
    if _check_agent_alive():
        return
    try:
        subprocess.Popen(
            [str(AGENT_EXE)],
            creationflags=_NO_WINDOW | 0x00000008,
            close_fds=True,
            cwd=str(DATA_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def main() -> None:
    _ensure_agent_running()
    app = AgentApp()
    app.mainloop()


if __name__ == "__main__":
    main()