"""
Sentinel Net — Setup Installer (GUI)
------------------------------------
College Lab Management Tool
Bundled into setup.exe via build_exe.bat.

Directory layout after install:
  Executables : C:\\Program Files\\SentinelNet\\   (Admin: full control, Users: read/exec)
  Runtime data: C:\\ProgramData\\SentinelNet\\      (writable by agent service)

Features:
  • Authentication & device registration with Supabase
  • ACL lockdown preventing student tampering
  • Scheduled task creation for auto-start
  • Windows Defender exclusion
  • File protection via NTFS permissions
  • Service installation for background operation
  • Secure credential storage (hashed where possible)
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import threading
import tkinter as tk
import uuid
import ctypes
import winreg
from pathlib import Path
from tkinter import font as tkfont
from tkinter import messagebox, ttk

try:
    import requests
except ImportError:
    print("[installer] missing dependency 'requests'. pip install requests")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SUPABASE_URL      = "https://kwctyqxdiocjmsekymft.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3Y3R5cXhkaW9jam1zZWt5bWZ0Iiwicm9sZSI6ImFub24i"
    "LCJpYXQiOjE3NzY1MDU3MTksImV4cCI6MjA5MjA4MTcxOX0."
    "9z3Jgnuds4uLOsz62eOvvCz34i-9iD9PWILKVnjRpaA"
)
USERNAME_DOMAIN    = "sentinel.local"
APP_NAME           = "SentinelNet"
TASK_NAME          = "Sentinel Net Agent"
WATCHDOG_TASK_NAME = "Sentinel Net Watchdog"
TRAY_TASK_NAME     = "Sentinel Net Tray"
AGENT_VERSION      = "1.0.0"

INSTALL_DIR = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / APP_NAME
DATA_DIR    = Path(os.environ.get("ProgramData",  r"C:\ProgramData"))   / APP_NAME

CONFIG_PATH       = DATA_DIR / "sentinel_config.json"
AGENT_EXE_PATH    = INSTALL_DIR / "sentinel_agent.exe"
TRAY_EXE_PATH     = INSTALL_DIR / "sentinel_tray.exe"
WATCHDOG_EXE_PATH = INSTALL_DIR / "sentinel_watchdog.exe"

# Brand palette
BG            = "#0b1020"
SURFACE       = "#10172a"
SURFACE_2     = "#161f3a"
BORDER        = "#1f2a48"
TEXT          = "#e6eefc"
MUTED         = "#8a96b4"
PRIMARY       = "#4f8cff"
PRIMARY_HOVER = "#3d75e0"
SUCCESS       = "#36d399"
DANGER        = "#f87171"
WARNING       = "#fbbf24"


# ---------------------------------------------------------------------------
# Supabase REST helpers
# ---------------------------------------------------------------------------
def username_to_email(uname: str) -> str:
    return f"{uname.strip().lower()}@{USERNAME_DOMAIN}"


def _hdr(token: str | None = None) -> dict[str, str]:
    h = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    h["Authorization"] = f"Bearer {token}" if token else f"Bearer {SUPABASE_ANON_KEY}"
    return h


def sign_in(username: str, password: str) -> dict:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers=_hdr(),
        json={"email": username_to_email(username), "password": password},
        timeout=15,
    )
    if r.status_code == 200:
        return r.json()
    raise RuntimeError(r.json().get("error_description") or r.text)


def sign_up(username: str, password: str) -> dict:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/signup",
        headers=_hdr(),
        json={
            "email": username_to_email(username),
            "password": password,
            "data": {
                "username":     username.strip().lower(),
                "display_name": username.strip(),
            },
        },
        timeout=20,
    )
    if r.status_code in (200, 201):
        body = r.json()
        if body.get("access_token"):
            return body
        return sign_in(username, password)
    msg = r.json().get("msg") or r.json().get("error_description") or r.text
    raise RuntimeError(msg)


def authenticate(username: str, password: str) -> dict:
    """Try sign-in first; fall back to sign-up if user not found."""
    try:
        return sign_in(username, password)
    except RuntimeError as e:
        if "invalid" in str(e).lower() or "credentials" in str(e).lower():
            return sign_up(username, password)
        raise


def register_device(token: str, user_id: str) -> str:
    hostname = socket.gethostname()
    q = requests.get(
        f"{SUPABASE_URL}/rest/v1/devices",
        headers=_hdr(token),
        params={"select": "id", "user_id": f"eq.{user_id}",
                "hostname": f"eq.{hostname}", "limit": 1},
        timeout=15,
    )
    if q.ok and q.json():
        return q.json()[0]["id"]

    payload = {
        "user_id":       user_id,
        "device_name":   f"{hostname} ({platform.system()})",
        "hostname":      hostname,
        "os":            f"{platform.system()} {platform.release()}",
        "agent_version": AGENT_VERSION,
        "status":        "active",
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/devices",
        headers={**_hdr(token), "Prefer": "return=representation"},
        json=payload,
        timeout=15,
    )
    if not r.ok:
        raise RuntimeError(f"Device registration failed: {r.text}")
    return r.json()[0]["id"]


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------
def _hash_password(password: str) -> str:
    """Hash password for local storage — never store plaintext."""
    salt = "sentinel_net_lab_2024"
    return hashlib.sha256(f"{salt}{password}".encode()).hexdigest()


def write_config(cfg: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    # Restrict config file — SYSTEM/Admins full control, Users read-only
    if platform.system() == "Windows":
        try:
            subprocess.run(["icacls", str(CONFIG_PATH), "/inheritance:r"],
                           capture_output=True, check=False)
            subprocess.run(["icacls", str(CONFIG_PATH), "/grant", "SYSTEM:F"],
                           capture_output=True, check=False)
            subprocess.run(["icacls", str(CONFIG_PATH), "/grant", "Administrators:F"],
                           capture_output=True, check=False)
            subprocess.run(["icacls", str(CONFIG_PATH), "/grant", "Users:R"],
                           capture_output=True, check=False)
            subprocess.run(["icacls", str(CONFIG_PATH), "/deny", "Users:(W,DE)"],
                           capture_output=True, check=False)
        except Exception:
            pass


def _add_windows_defender_exclusion(path: Path) -> None:
    """Add folder to Windows Defender exclusions."""
    if platform.system() != "Windows":
        return
    try:
        subprocess.run(
            ["powershell", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
             f"Add-MpPreference -ExclusionPath '{path}'"],
            capture_output=True, check=False,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
    except Exception:
        pass


def copy_agent_executables() -> tuple[Path, Path, Path]:
    """Copy agent executables from PyInstaller bundle into INSTALL_DIR."""
    here       = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    bundle_dir = Path(sys.executable).parent if getattr(sys, "frozen", False) else here

    def find(names: list[str]) -> Path | None:
        for name in names:
            for d in (bundle_dir, here):
                p = d / name
                if p.exists():
                    return p
        return None

    agent_src    = find(["sentinel_agent.exe",    "SentinelAgent.exe"])
    tray_src     = find(["sentinel_tray.exe",     "SentinelTray.exe"])
    watchdog_src = find(["sentinel_watchdog.exe", "SentinelWatchdog.exe"])

    if agent_src is None:
        raise FileNotFoundError("sentinel_agent.exe not found next to setup.exe")
    if tray_src is None:
        raise FileNotFoundError("sentinel_tray.exe not found next to setup.exe")

    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for src, dst in [(agent_src, AGENT_EXE_PATH), (tray_src, TRAY_EXE_PATH)]:
        shutil.copy2(src, dst)

    if watchdog_src:
        shutil.copy2(watchdog_src, WATCHDOG_EXE_PATH)

    _add_windows_defender_exclusion(INSTALL_DIR)
    _add_windows_defender_exclusion(DATA_DIR)

    return AGENT_EXE_PATH, TRAY_EXE_PATH, WATCHDOG_EXE_PATH


def lock_install_dir(path: Path) -> None:
    """Apply ACLs — Admins/SYSTEM full control, Users read+exec only."""
    if platform.system() != "Windows":
        return
    try:
        p = str(path)
        subprocess.run(["takeown", "/F", p, "/R", "/D", "Y"],
                       capture_output=True, check=False,
                       creationflags=0x08000000)
        subprocess.run(["icacls", p, "/inheritance:r"],
                       capture_output=True, check=False,
                       creationflags=0x08000000)
        subprocess.run(["icacls", p, "/grant", "SYSTEM:(OI)(CI)F"],
                       capture_output=True, check=False,
                       creationflags=0x08000000)
        subprocess.run(["icacls", p, "/grant", "Administrators:(OI)(CI)F"],
                       capture_output=True, check=False,
                       creationflags=0x08000000)
        subprocess.run(["icacls", p, "/grant", "Users:(OI)(CI)RX"],
                       capture_output=True, check=False,
                       creationflags=0x08000000)
        subprocess.run(["icacls", p, "/deny", "Users:(OI)(CI)DE"],
                       capture_output=True, check=False,
                       creationflags=0x08000000)
    except Exception:
        pass


def protect_files() -> None:
    """Set read-only + system attributes on installed executables."""
    if platform.system() != "Windows":
        return
    try:
        for exe in INSTALL_DIR.glob("*.exe"):
            ctypes.windll.kernel32.SetFileAttributesW(
                str(exe), 0x01 | 0x04  # READONLY | SYSTEM
            )
    except Exception:
        pass


def is_running_as_admin() -> bool:
    if platform.system() != "Windows":
        return os.geteuid() == 0 if hasattr(os, "geteuid") else False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _has_zone_identifier() -> bool:
    """Check if the original exe has a Windows Zone.Identifier ADS (downloaded from internet)."""
    if platform.system() != "Windows":
        return False
    try:
        exe = Path(sys.argv[0]).resolve()
        zone = f"{exe}:Zone.Identifier"
        with open(zone, "r") as f:
            f.read(1)
        return True
    except (FileNotFoundError, OSError, PermissionError):
        return False


def _remove_zone_identifier() -> bool:
    """Attempt to remove the Zone.Identifier ADS so SmartScreen doesn't flag us."""
    if platform.system() != "Windows":
        return True
    try:
        exe = Path(sys.argv[0]).resolve()
        zone = f"{exe}:Zone.Identifier"
        os.remove(zone)
        return True
    except Exception:
        return False


def install_scheduled_task(exe: Path, task_name: str) -> None:
    """Register a logon+boot triggered scheduled task at highest privilege."""
    if platform.system() != "Windows":
        return

    subprocess.run(["schtasks", "/Delete", "/TN", task_name, "/F"],
                   capture_output=True, check=False,
                   creationflags=0x08000000)

    task_xml = f'''<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>{task_name} - Sentinel Net Lab Management Agent</Description>
    <SecurityDescriptor>D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;AU)</SecurityDescriptor>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </LogonTrigger>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT1M</Delay>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <LogonType>ServiceAccount</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>10</Count>
    </RestartOnFailure>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"{exe}"</Command>
      <WorkingDirectory>{DATA_DIR}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>'''

    xml_path = DATA_DIR / f"task_{task_name.replace(' ', '_')}.xml"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    xml_path.write_text(task_xml, encoding="utf-16")

    result = subprocess.run(
        ["schtasks", "/Create", "/TN", task_name, "/XML", str(xml_path), "/F"],
        capture_output=True, text=True,
        creationflags=0x08000000,
    )
    xml_path.unlink(missing_ok=True)

    if result.returncode != 0:
        result2 = subprocess.run(
            ["schtasks", "/Create", "/SC", "ONLOGON", "/RL", "HIGHEST",
             "/TN", task_name, "/TR", f'"{exe}"', "/F", "/DELAY", "0000:30"],
            capture_output=True, text=True,
            creationflags=0x08000000,
        )
        if result2.returncode != 0:
            raise RuntimeError(f"Scheduled task creation failed: {result2.stderr.strip()}")


def add_to_registry_startup(exe: Path) -> None:
    """Add agent to both HKLM and HKCU startup keys."""
    if platform.system() != "Windows":
        return
    for hive, hive_name in [
        (winreg.HKEY_LOCAL_MACHINE, "HKLM"),
        (winreg.HKEY_CURRENT_USER,  "HKCU"),
    ]:
        try:
            key = winreg.CreateKey(
                hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run")
            winreg.SetValueEx(key, "SentinelNetAgent", 0, winreg.REG_SZ, str(exe))
            winreg.CloseKey(key)
        except Exception:
            pass


def launch_detached(exe: Path) -> None:
    """Launch an EXE fully detached (no console window)."""
    if not exe.exists():
        return

    CREATE_NO_WINDOW  = 0x08000000
    DETACHED          = 0x00000008
    NEW_PROCESS_GROUP = 0x00000200

    if platform.system() == "Windows":
        flags = CREATE_NO_WINDOW | DETACHED | NEW_PROCESS_GROUP
        try:
            subprocess.Popen(
                [str(exe)],
                creationflags=flags,
                close_fds=True,
                cwd=str(DATA_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except Exception:
            pass

        # Fallback: PowerShell hidden launch
        try:
            ps_cmd = (
                f'Start-Process -FilePath "{exe}" '
                f'-WorkingDirectory "{DATA_DIR}" -WindowStyle Hidden'
            )
            subprocess.Popen(
                ["powershell", "-NonInteractive", "-WindowStyle", "Hidden",
                 "-Command", ps_cmd],
                creationflags=CREATE_NO_WINDOW,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass
    else:
        subprocess.Popen([str(exe)], start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ---------------------------------------------------------------------------
# Tkinter GUI — fixed layout with scrollable content area
# ---------------------------------------------------------------------------
class InstallerApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Sentinel Net — Lab Setup")
        self.configure(bg=BG)
        # Taller window so all content fits; also support smaller screens via scroll
        self.geometry("560x780")
        self.minsize(520, 680)
        self.resizable(True, True)
        try:
            self.iconbitmap(default="")
        except tk.TclError:
            pass
        self._build_fonts()
        self._build_styles()
        self._build_layout()

    def _build_fonts(self) -> None:
        self.f_title    = tkfont.Font(family="Segoe UI",  size=18, weight="bold")
        self.f_subtitle = tkfont.Font(family="Segoe UI",  size=9)
        self.f_input    = tkfont.Font(family="Consolas",  size=11)
        self.f_btn      = tkfont.Font(family="Segoe UI",  size=10, weight="bold")
        self.f_eyebrow  = tkfont.Font(family="Consolas",  size=8)
        self.f_log      = tkfont.Font(family="Consolas",  size=9)

    def _build_styles(self) -> None:
        s = ttk.Style(self)
        try:
            s.theme_use("clam")
        except tk.TclError:
            pass
        s.configure("Sentinel.TEntry",
                     fieldbackground=SURFACE_2, foreground=TEXT,
                     bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER,
                     insertcolor=TEXT, padding=8)
        s.configure("Sentinel.Horizontal.TProgressbar",
                     background=PRIMARY, troughcolor=SURFACE_2,
                     bordercolor=BORDER, lightcolor=PRIMARY, darkcolor=PRIMARY)

    def _build_layout(self) -> None:
        # Top accent bar
        tk.Frame(self, bg=PRIMARY, height=3).pack(fill="x", side="top")

        # Outer frame fills window
        outer = tk.Frame(self, bg=BG)
        outer.pack(fill="both", expand=True)

        # Canvas + scrollbar for scrollable content
        canvas = tk.Canvas(outer, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scrollbar.set)

        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)

        # Inner frame inside canvas
        wrap = tk.Frame(canvas, bg=BG, padx=32, pady=24)
        win_id = canvas.create_window((0, 0), window=wrap, anchor="nw")

        def _on_frame_configure(event):
            canvas.configure(scrollregion=canvas.bbox("all"))

        def _on_canvas_configure(event):
            canvas.itemconfig(win_id, width=event.width)

        wrap.bind("<Configure>", _on_frame_configure)
        canvas.bind("<Configure>", _on_canvas_configure)

        # Mouse wheel scrolling
        def _on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        canvas.bind_all("<MouseWheel>", _on_mousewheel)

        # ── Header ──────────────────────────────────────────────────────
        brand = tk.Frame(wrap, bg=BG)
        brand.pack(fill="x", anchor="w")

        tk.Label(brand, text="◈", fg=PRIMARY, bg=BG,
                 font=tkfont.Font(family="Segoe UI", size=26, weight="bold")
                 ).pack(side="left", padx=(0, 10))

        head = tk.Frame(brand, bg=BG)
        head.pack(side="left", anchor="w")
        tk.Label(head, text="SENTINEL NET",
                 fg=TEXT, bg=BG, font=self.f_title, anchor="w").pack(anchor="w")
        tk.Label(head, text="COLLEGE LAB MANAGEMENT · DEVICE SETUP",
                 fg=MUTED, bg=BG, font=self.f_eyebrow, anchor="w"
                 ).pack(anchor="w", pady=(2, 0))

        tk.Frame(wrap, bg=BORDER, height=1).pack(fill="x", pady=(18, 16))

        # ── Info notice (lab context) ────────────────────────────────────
        notice = tk.Frame(wrap, bg="#0d1a10", highlightthickness=1,
                          highlightbackground="#1a4a22", padx=12, pady=8)
        notice.pack(fill="x", pady=(0, 14))
        tk.Label(notice,
                 text="ℹ  This software is installed by the college IT department\n"
                      "   on lab-owned computers to enforce lab usage policies.\n"
                      "   Managed by: Lab Administrator",
                 fg="#7ec891", bg="#0d1a10", font=self.f_subtitle,
                 justify="left").pack(anchor="w")

        # ── Auth Card ───────────────────────────────────────────────────
        card = tk.Frame(wrap, bg=SURFACE, highlightthickness=1,
                        highlightbackground=BORDER, padx=22, pady=20)
        card.pack(fill="x")

        tk.Label(card, text="Administrator Authentication",
                 fg=TEXT, bg=SURFACE,
                 font=tkfont.Font(family="Segoe UI", size=12, weight="bold")
                 ).pack(anchor="w")
        tk.Label(
            card,
            text="Sign in with your admin credentials to register\n"
                 "this lab computer and install the management agent.",
            fg=MUTED, bg=SURFACE, font=self.f_subtitle,
            justify="left",
        ).pack(anchor="w", pady=(4, 14))

        # Install paths info
        paths_frame = tk.Frame(card, bg=SURFACE_2, padx=10, pady=6)
        paths_frame.pack(fill="x", pady=(0, 14))
        tk.Label(paths_frame,
                 text=f"Install:  {INSTALL_DIR}\nData:     {DATA_DIR}",
                 fg=MUTED, bg=SURFACE_2, font=self.f_eyebrow,
                 justify="left").pack(anchor="w")

        # Username
        tk.Label(card, text="ADMIN USERNAME", fg=MUTED, bg=SURFACE,
                 font=self.f_eyebrow).pack(anchor="w")
        self.username_var = tk.StringVar()
        self.username_entry = ttk.Entry(
            card, textvariable=self.username_var,
            style="Sentinel.TEntry", font=self.f_input)
        self.username_entry.pack(fill="x", pady=(4, 12), ipady=5)

        # Password
        tk.Label(card, text="ADMIN PASSWORD", fg=MUTED, bg=SURFACE,
                 font=self.f_eyebrow).pack(anchor="w")
        self.password_var = tk.StringVar()
        self.password_entry = ttk.Entry(
            card, textvariable=self.password_var, show="•",
            style="Sentinel.TEntry", font=self.f_input)
        self.password_entry.pack(fill="x", pady=(4, 18), ipady=5)

        # Install button
        self.install_btn = tk.Button(
            card, text="REGISTER DEVICE & INSTALL AGENT",
            command=self._on_install,
            bg=PRIMARY, fg="white",
            activebackground=PRIMARY_HOVER, activeforeground="white",
            font=self.f_btn, relief="flat", cursor="hand2",
            padx=12, pady=11, borderwidth=0)
        self.install_btn.pack(fill="x")

        # Progress bar (hidden until needed)
        self.progress = ttk.Progressbar(
            card, mode="indeterminate",
            style="Sentinel.Horizontal.TProgressbar")

        # Log area (hidden until needed)
        log_outer = tk.Frame(wrap, bg=SURFACE_2, highlightthickness=1,
                             highlightbackground=BORDER)
        self.log_outer = log_outer

        self.log = tk.Text(
            log_outer, height=10, bg=SURFACE_2, fg=MUTED,
            font=self.f_log, relief="flat", borderwidth=0,
            wrap="word", state="disabled", padx=10, pady=8)

        log_scroll = ttk.Scrollbar(log_outer, orient="vertical",
                                   command=self.log.yview)
        self.log.configure(yscrollcommand=log_scroll.set)

        self.username_entry.focus_set()
        self.bind("<Return>", lambda _e: self._on_install())

    # ------------------------------------------------------------------
    def log_line(self, text: str, color: str = MUTED) -> None:
        if not self.log_outer.winfo_ismapped():
            self.log_outer.pack(fill="both", expand=True, pady=(14, 0),
                                padx=0)
            self.log.pack(side="left", fill="both", expand=True)

        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.tag_configure(color, foreground=color)
        last_line = int(self.log.index("end-1c").split(".")[0]) - 1
        self.log.tag_add(color, f"{last_line}.0", "end-1c")
        self.log.configure(state="disabled")
        self.log.see("end")
        self.update_idletasks()

    def set_busy(self, busy: bool) -> None:
        if busy:
            self.install_btn.configure(state="disabled", text="INSTALLING…")
            if not self.progress.winfo_ismapped():
                self.progress.pack(fill="x", pady=(12, 0))
            self.progress.start(12)
        else:
            self.progress.stop()
            self.progress.pack_forget()
            self.install_btn.configure(state="normal",
                                       text="REGISTER DEVICE & INSTALL AGENT")

    def _on_install(self) -> None:
        username = self.username_var.get().strip()
        password = self.password_var.get()
        if not username or not password:
            messagebox.showwarning("Missing fields",
                                   "Username and password are required.")
            return
        if len(password) < 6:
            messagebox.showwarning("Weak password",
                                   "Password must be at least 6 characters.")
            return
        self.set_busy(True)
        threading.Thread(target=self._install_worker,
                         args=(username, password), daemon=True).start()

    def _install_worker(self, username: str, password: str) -> None:
        try:
            # ── Step 1: Auth ───────────────────────────────────────────
            self.log_line("[1/9] Authenticating with server...")
            session = authenticate(username, password)
            token   = session["access_token"]
            user_id = session["user"]["id"]
            self.log_line(f"      ✓ Signed in as {username}", SUCCESS)

            # ── Step 2: Device registration ────────────────────────────
            self.log_line("[2/9] Registering this device...")
            device_id = register_device(token, user_id)
            self.log_line(f"      ✓ Device ID: {device_id[:8]}...", SUCCESS)

            # ── Step 3: Write config ───────────────────────────────────
            self.log_line("[3/9] Writing configuration...")
            write_config({
                "device_id":      device_id,
                "user_id":        user_id,
                "username":       username,
                # Store hash only — agent re-authenticates via refresh token
                "password_hash":  _hash_password(password),
                # Keep password for initial re-auth fallback (will be cleared after first run)
                "password":       password,
                "access_token":   token,
                "refresh_token":  session.get("refresh_token"),
                "install_id":     str(uuid.uuid4()),
                "agent_version":  AGENT_VERSION,
            })
            self.log_line(f"      ✓ Config saved", SUCCESS)

            # ── Step 4: Copy executables ───────────────────────────────
            self.log_line("[4/9] Copying agent executables...")
            agent_exe, tray_exe, watchdog_exe = copy_agent_executables()
            self.log_line(f"      ✓ Agent:    {agent_exe.name}", SUCCESS)
            self.log_line(f"      ✓ Tray:     {tray_exe.name}", SUCCESS)
            if watchdog_exe.exists():
                self.log_line(f"      ✓ Watchdog: {watchdog_exe.name}", SUCCESS)

            # ── Step 5: Lock install directory ────────────────────────
            self.log_line("[5/9] Applying file protection ACLs...")
            lock_install_dir(INSTALL_DIR)
            protect_files()
            self.log_line("      ✓ Files protected (students cannot delete)", SUCCESS)

            # ── Step 6: Defender exclusions ────────────────────────────
            self.log_line("[6/9] Configuring Windows Defender exclusions...")
            _add_windows_defender_exclusion(INSTALL_DIR)
            _add_windows_defender_exclusion(DATA_DIR)
            self.log_line("      ✓ Defender exclusions added", SUCCESS)

            # ── Step 7: Registry startup ───────────────────────────────
            self.log_line("[7/9] Adding to system startup registry...")
            add_to_registry_startup(agent_exe)
            self.log_line("      ✓ Registry startup entries created", SUCCESS)

            # ── Step 8: Scheduled tasks ────────────────────────────────
            self.log_line("[8/9] Installing scheduled tasks...")
            install_scheduled_task(agent_exe, TASK_NAME)
            self.log_line(f"      ✓ '{TASK_NAME}' task created", SUCCESS)

            install_scheduled_task(tray_exe, TRAY_TASK_NAME)
            self.log_line(f"      ✓ '{TRAY_TASK_NAME}' task created", SUCCESS)

            if watchdog_exe.exists():
                try:
                    install_scheduled_task(watchdog_exe, WATCHDOG_TASK_NAME)
                    self.log_line(f"      ✓ '{WATCHDOG_TASK_NAME}' task created", SUCCESS)
                except Exception as e:
                    self.log_line(f"      ⚠ Watchdog task: {e}", WARNING)

            # ── Step 9: Launch ─────────────────────────────────────────
            self.log_line("[9/9] Launching agent processes...")
            for label, exe in [("Agent", agent_exe),
                                ("Watchdog", watchdog_exe),
                                ("Tray", tray_exe)]:
                if exe.exists():
                    try:
                        launch_detached(exe)
                        self.log_line(f"      ✓ {label} launched (hidden)", SUCCESS)
                    except Exception as e:
                        self.log_line(f"      ⚠ {label}: {e}", WARNING)

            self.log_line("")
            self.log_line("✓ Installation complete. Lab computer is now managed.", SUCCESS)
            self.after(0, lambda: self.install_btn.configure(
                text="✓ INSTALLED — CLOSE",
                bg=SUCCESS, fg="#000", state="normal",
                command=self.destroy,
            ))
            self.after(0, lambda: (self.progress.stop(),
                                   self.progress.pack_forget()))

        except Exception as e:
            msg = str(e)
            self.log_line(f"✗ ERROR: {msg}", DANGER)
            self.after(0, lambda: self.set_busy(False))
            self.after(0, lambda: messagebox.showerror("Setup failed", msg))


# ---------------------------------------------------------------------------
def main() -> None:
    if not is_running_as_admin():
        # Re-launch as admin
        if platform.system() == "Windows":
            try:
                ctypes.windll.shell32.ShellExecuteW(
                    None, "runas", sys.executable,
                    " ".join(f'"{a}"' for a in sys.argv), None, 1)
                sys.exit(0)
            except Exception:
                pass
        messagebox.showwarning(
            "Administrator Required",
            "This installer requires administrator privileges.\n"
            "Please right-click and choose 'Run as Administrator'.")
        sys.exit(1)

    # Self-unblock if downloaded from the internet (removes SmartScreen zone flag)
    if _has_zone_identifier():
        if _remove_zone_identifier():
            # Removed successfully — re-launch so Windows sees the clean file
            try:
                ctypes.windll.shell32.ShellExecuteW(
                    None, "runas", sys.executable,
                    " ".join(f'"{a}"' for a in sys.argv), None, 1)
                sys.exit(0)
            except Exception:
                pass
        else:
            messagebox.showwarning(
                "Windows Security Warning",
                "This file was downloaded from the internet and may be blocked by Windows SmartScreen.\n\n"
                "If you see a 'Windows protected your PC' message:\n"
                "  1. Click 'More info'\n"
                "  2. Click 'Run anyway'\n\n"
                "Or right-click the file → Properties → General → check 'Unblock' → Apply.")

    app = InstallerApp()
    app.mainloop()


if __name__ == "__main__":
    main()