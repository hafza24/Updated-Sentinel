"""
Sentinel Net Agent
------------------
Transparent, user-consented endpoint safety agent for student-safety and
parental-control environments.

This build intentionally avoids stealth, tamper-resistance, defender bypasses,
and unrestricted remote execution. The agent is designed to run as a normal
Windows Service and to expose only explicit, audited actions.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import platform
import socket
from socketserver import ThreadingMixIn
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Optional

try:
    import requests
except ImportError as exc:  # pragma: no cover - startup dependency failure
    raise SystemExit("The 'requests' package is required.") from exc

try:
    import psutil
except ImportError:  # pragma: no cover - optional dependency
    psutil = None  # type: ignore[assignment]

try:
    from PIL import ImageGrab
except ImportError:  # pragma: no cover - optional dependency
    ImageGrab = None  # type: ignore[assignment]

WINDOWS = platform.system() == "Windows"

if WINDOWS:
    try:
        import servicemanager
        import win32event
        import win32service
        import win32serviceutil
    except ImportError:  # pragma: no cover - console mode still works
        servicemanager = None  # type: ignore[assignment]
        win32event = None  # type: ignore[assignment]
        win32service = None  # type: ignore[assignment]
        win32serviceutil = None  # type: ignore[assignment]
else:  # pragma: no cover - non-Windows fallback
    servicemanager = None  # type: ignore[assignment]
    win32event = None  # type: ignore[assignment]
    win32service = None  # type: ignore[assignment]
    win32serviceutil = None  # type: ignore[assignment]


APP_NAME = "SentinelNet"
SERVICE_NAME = "SentinelNetAgent"
SERVICE_DISPLAY_NAME = "Sentinel Net Agent"
SERVICE_DESCRIPTION = (
    "Sentinel Net endpoint safety agent for transparent, consent-based "
    "student safety and parental control environments."
)
AGENT_VERSION = "5.0.0"

DEFAULT_SUPABASE_URL = "https://kwctyqxdiocjmsekymft.supabase.co"
DEFAULT_SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3Y3R5cXhkaW9jam1zZWt5bWZ0Iiwicm9sZSI6ImFub24i"
    "LCJpYXQiOjE3NzY1MDU3MTksImV4cCI6MjA5MjA4MTcxOX0."
    "9z3Jgnuds4uLOsz62eOvvCz34i-9iD9PWILKVnjRpaA"
)
USERNAME_DOMAIN = "sentinel.local"

SYNC_INTERVAL_SECONDS = 30
HEARTBEAT_INTERVAL_SECONDS = 30
DOWNLOAD_SCAN_SECONDS = 5
PROCESS_SCAN_SECONDS = 5
DOMAIN_SCAN_SECONDS = 10
TASK_REPORT_SECONDS = 60
SELF_HEAL_SECONDS = 60
HEARTBEAT_STALE_SECONDS = 90
MAX_STREAM_FPS = 5

if getattr(sys, "frozen", False):
    INSTALL_DIR = Path(sys.executable).resolve().parent
else:
    INSTALL_DIR = Path(__file__).resolve().parent

if WINDOWS:
    DATA_DIR = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / APP_NAME
else:
    DATA_DIR = INSTALL_DIR / ".runtime"

LOG_DIR = DATA_DIR / "logs"
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

CONFIG_PATH = DATA_DIR / "sentinel_config.json"
RULE_CACHE_PATH = DATA_DIR / "rule_cache.json"
STATS_PATH = DATA_DIR / "agent_stats.json"
ALERT_LOG_PATH = DATA_DIR / "alert_log.json"
HEARTBEAT_PATH = DATA_DIR / "agent_heartbeat.json"
HOSTS_BACKUP_PATH = DATA_DIR / "hosts_original_backup"
LOG_PATH = LOG_DIR / "agent.log"

HOSTS_PATH = (
    Path(r"C:\Windows\System32\drivers\etc\hosts")
    if WINDOWS
    else Path("/etc/hosts")
)
HOSTS_BEGIN = "# >>> sentinel-net managed >>>"
HOSTS_END = "# <<< sentinel-net managed <<<"

ALERT_TITLES = {
    "domain_blocked": "Blocked Website",
    "download_blocked": "Download Blocked",
    "process_blocked": "Blocked Application",
    "process_killed": "Application Closed",
    "device_locked": "Device Locked",
    "device_shutdown": "Device Shutdown",
    "screen_share_started": "Screen Share Started",
    "screen_share_stopped": "Screen Share Stopped",
    "self_heal": "Agent Self-Heal",
}


class ConfigError(RuntimeError):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utcnow_iso() -> str:
    return utcnow().isoformat()


def ensure_json_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def get_download_directories() -> list[Path]:
    paths = [Path.home() / "Downloads"]
    if WINDOWS:
        one_drive = os.environ.get("OneDrive")
        if one_drive:
            paths.append(Path(one_drive) / "Downloads")
    unique_paths: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path).lower()
        if key in seen or not path.exists():
            continue
        unique_paths.append(path)
        seen.add(key)
    return unique_paths


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("sentinel_agent")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    file_handler = RotatingFileHandler(
        LOG_PATH,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    if "--console" in sys.argv or not WINDOWS:
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)

    logger.propagate = False
    return logger


LOGGER = configure_logging()


@dataclass
class AgentConfig:
    username: str
    password: Optional[str]
    access_token: Optional[str]
    refresh_token: Optional[str]
    user_id: Optional[str]
    device_id: Optional[str]
    supabase_url: str = DEFAULT_SUPABASE_URL
    supabase_anon_key: str = DEFAULT_SUPABASE_ANON_KEY
    heartbeat_interval_seconds: int = HEARTBEAT_INTERVAL_SECONDS
    sync_interval_seconds: int = SYNC_INTERVAL_SECONDS
    enable_firewall_rules: bool = False
    screenshot_capture_enabled: bool = True
    max_stream_fps: int = 2
    stream_jpeg_quality: int = 60
    monitored_download_directories: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> "AgentConfig":
        if not path.exists():
            raise ConfigError(
                f"Missing configuration file at {path}. "
                "Install the agent through the Sentinel Net installer first."
            )

        data = json.loads(path.read_text(encoding="utf-8"))
        username = str(data.get("username") or "").strip()
        if not username:
            raise ConfigError("Configuration is missing 'username'.")

        monitored_paths = data.get("monitored_download_directories") or []
        if not isinstance(monitored_paths, list):
            monitored_paths = []

        return cls(
            username=username,
            password=data.get("password"),
            access_token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            user_id=data.get("user_id"),
            device_id=data.get("device_id"),
            supabase_url=str(data.get("supabase_url") or os.environ.get("SENTINEL_SUPABASE_URL") or DEFAULT_SUPABASE_URL).rstrip("/"),
            supabase_anon_key=str(
                data.get("supabase_anon_key")
                or os.environ.get("SENTINEL_SUPABASE_ANON_KEY")
                or DEFAULT_SUPABASE_ANON_KEY
            ),
            heartbeat_interval_seconds=int(data.get("heartbeat_interval_seconds") or HEARTBEAT_INTERVAL_SECONDS),
            sync_interval_seconds=int(data.get("sync_interval_seconds") or SYNC_INTERVAL_SECONDS),
            enable_firewall_rules=bool(data.get("enable_firewall_rules", False)),
            screenshot_capture_enabled=bool(data.get("screenshot_capture_enabled", True)),
            max_stream_fps=max(1, min(MAX_STREAM_FPS, int(data.get("max_stream_fps") or 2))),
            stream_jpeg_quality=max(35, min(85, int(data.get("stream_jpeg_quality") or 60))),
            monitored_download_directories=[str(item) for item in monitored_paths],
        )

    def save(self, path: Path) -> None:
        payload = {
            "username": self.username,
            "password": self.password,
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "user_id": self.user_id,
            "device_id": self.device_id,
            "supabase_url": self.supabase_url,
            "supabase_anon_key": self.supabase_anon_key,
            "heartbeat_interval_seconds": self.heartbeat_interval_seconds,
            "sync_interval_seconds": self.sync_interval_seconds,
            "enable_firewall_rules": self.enable_firewall_rules,
            "screenshot_capture_enabled": self.screenshot_capture_enabled,
            "max_stream_fps": self.max_stream_fps,
            "stream_jpeg_quality": self.stream_jpeg_quality,
            "monitored_download_directories": self.monitored_download_directories,
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class SupabaseRestClient:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.session = requests.Session()
        self.access_token = config.access_token
        self.refresh_token = config.refresh_token
        self.user_id = config.user_id

    @property
    def base_url(self) -> str:
        return self.config.supabase_url.rstrip("/")

    def _headers(self, *, auth_required: bool = True, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        headers = {
            "apikey": self.config.supabase_anon_key,
            "Content-Type": "application/json",
        }
        if auth_required and self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        elif auth_required:
            raise ConfigError("No access token is available for authenticated API calls.")
        if extra:
            headers.update(extra)
        return headers

    def sign_in(self) -> None:
        if not self.config.password:
            raise ConfigError(
                "The configuration is missing a password. "
                "Reinstall the agent or refresh the local credentials."
            )

        response = self.session.post(
            f"{self.base_url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": self.config.supabase_anon_key,
                "Content-Type": "application/json",
            },
            json={
                "email": f"{self.config.username.strip().lower()}@{USERNAME_DOMAIN}",
                "password": self.config.password,
            },
            timeout=15,
        )
        response.raise_for_status()
        body = response.json()
        self.access_token = body["access_token"]
        self.refresh_token = body["refresh_token"]
        self.user_id = body["user"]["id"]

    def restore_session(self) -> bool:
        if not self.access_token or not self.refresh_token:
            return False

        response = self.session.get(
            f"{self.base_url}/auth/v1/user",
            headers=self._headers(),
            timeout=15,
        )
        if response.ok:
            self.user_id = response.json()["id"]
            return True

        refreshed = self.session.post(
            f"{self.base_url}/auth/v1/token?grant_type=refresh_token",
            headers={
                "apikey": self.config.supabase_anon_key,
                "Content-Type": "application/json",
            },
            json={"refresh_token": self.refresh_token},
            timeout=15,
        )
        if not refreshed.ok:
            return False

        body = refreshed.json()
        self.access_token = body["access_token"]
        self.refresh_token = body["refresh_token"]
        self.user_id = body["user"]["id"]
        return True

    def authenticated(self) -> None:
        if self.restore_session():
            return
        self.sign_in()

    def select(self, table: str, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        response = self.session.get(
            f"{self.base_url}/rest/v1/{table}",
            headers=self._headers(),
            params=params or {},
            timeout=20,
        )
        response.raise_for_status()
        if not response.text:
            return []
        return response.json()

    def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/rest/v1/{table}",
            headers=self._headers(extra={"Prefer": "return=representation"}),
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        body = response.json()
        if isinstance(body, list):
            return body[0] if body else {}
        return body

    def update(self, table: str, match: dict[str, Any], payload: dict[str, Any]) -> None:
        params = {key: f"eq.{value}" for key, value in match.items()}
        response = self.session.patch(
            f"{self.base_url}/rest/v1/{table}",
            headers=self._headers(),
            params=params,
            json=payload,
            timeout=20,
        )
        response.raise_for_status()

    def delete(self, table: str, match: dict[str, Any]) -> None:
        params = {key: f"eq.{value}" for key, value in match.items()}
        response = self.session.delete(
            f"{self.base_url}/rest/v1/{table}",
            headers=self._headers(),
            params=params,
            timeout=20,
        )
        if response.status_code not in (200, 204):
            response.raise_for_status()

    def storage_upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        response = self.session.post(
            f"{self.base_url}/storage/v1/object/{bucket}/{path}",
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "apikey": self.config.supabase_anon_key,
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=data,
            timeout=30,
        )
        response.raise_for_status()


@dataclass
class PolicySnapshot:
    app_settings: dict[str, bool] = field(
        default_factory=lambda: {
            "firewall_enabled": True,
            "download_restriction_enabled": True,
            "process_enforcement_enabled": True,
        }
    )
    domains: list[dict[str, Any]] = field(default_factory=list)
    downloads: list[dict[str, Any]] = field(default_factory=list)
    process_blacklist: list[dict[str, Any]] = field(default_factory=list)
    retention_days: int = 30

    def effective_blocked_domains(self) -> list[str]:
        values = [str(item.get("domain_name") or "").strip().lower() for item in self.domains]
        return sorted({value for value in values if value})

    def blocked_download_rules(self) -> list[str]:
        rules: list[str] = []
        for item in self.downloads:
            extension = str(item.get("extension") or "").strip().lower().lstrip(".")
            if extension:
                rules.append(f".{extension}")
        return sorted(set(rules))

    def blocked_process_map(self) -> dict[str, bool]:
        blocked: dict[str, bool] = {}
        for item in self.process_blacklist:
            name = str(item.get("process_name") or "").strip().lower()
            if name:
                blocked[name] = bool(item.get("kill_on_detect", True))
        return blocked

    def to_json(self) -> dict[str, Any]:
        return {
            "app_settings": self.app_settings,
            "domains": self.domains,
            "downloads": self.downloads,
            "process_blacklist": self.process_blacklist,
            "retention_days": self.retention_days,
            "cached_at": utcnow_iso(),
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "PolicySnapshot":
        return cls(
            app_settings=ensure_json_object(payload.get("app_settings")),
            domains=list(payload.get("domains") or []),
            downloads=list(payload.get("downloads") or []),
            process_blacklist=list(payload.get("process_blacklist") or []),
            retention_days=int(payload.get("retention_days") or 30),
        )


class ScreenShareServer:
    def __init__(
        self,
        fps: int,
        jpeg_quality: int,
        logger: logging.Logger,
    ) -> None:
        self.fps = max(1, min(MAX_STREAM_FPS, fps))
        self.jpeg_quality = max(35, min(85, jpeg_quality))
        self.logger = logger
        self._frame_lock = threading.Lock()
        self._latest_frame = b""
        self._stop_event = threading.Event()
        self._server: Optional[_ThreadedHTTPServer] = None
        self._server_thread: Optional[threading.Thread] = None
        self._capture_thread: Optional[threading.Thread] = None

    @property
    def port(self) -> int:
        return self._server.server_port if self._server else 0

    def start(self) -> None:
        if ImageGrab is None:
            raise RuntimeError("Pillow screen capture support is not installed.")

        if self._server is not None:
            return

        self._stop_event.clear()

        self._server = _ThreadedHTTPServer(("0.0.0.0", 0), _make_handler(self))
        self._server_thread = threading.Thread(target=self._server.serve_forever, name="screen-share-http", daemon=True)
        self._capture_thread = threading.Thread(target=self._capture_loop, name="screen-share-capture", daemon=True)

        self._server_thread.start()
        self._capture_thread.start()
        self.logger.info("Screen-share server listening on port %s", self.port)

    def stop(self) -> None:
        self._stop_event.set()
        if self._server is not None:
            try:
                self._server.shutdown()
                self._server.server_close()
            except Exception:
                pass
        self._server = None
        self._latest_frame = b""

    def endpoint(self, ip_address: str) -> str:
        return f"http://{ip_address}:{self.port}/stream"

    def current_frame(self) -> bytes:
        with self._frame_lock:
            return self._latest_frame

    def _capture_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                image = ImageGrab.grab(all_screens=True)
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=self.jpeg_quality, optimize=True)
                with self._frame_lock:
                    self._latest_frame = buffer.getvalue()
            except Exception as exc:
                self.logger.warning("Screen capture is unavailable in the current session: %s", exc)
                self._stop_event.wait(timeout=2)
            self._stop_event.wait(timeout=1 / self.fps)


def _make_handler(server_wrapper: ScreenShareServer):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:
            if self.path != "/stream":
                self.send_error(404)
                return

            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.end_headers()

            while not server_wrapper._stop_event.is_set():
                frame = server_wrapper.current_frame()
                if not frame:
                    server_wrapper._stop_event.wait(timeout=0.5)
                    continue

                try:
                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii"))
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    break

                server_wrapper._stop_event.wait(timeout=1 / server_wrapper.fps)

    return Handler


class _ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class SentinelAgentRuntime:
    def __init__(self, *, stop_event: Optional[threading.Event] = None, service_mode: bool = False) -> None:
        self.stop_event = stop_event or threading.Event()
        self.service_mode = service_mode
        self.logger = LOGGER
        self.config = AgentConfig.load(CONFIG_PATH)
        self.client = SupabaseRestClient(self.config)
        self.device_id = self.config.device_id or ""
        self.user_id = self.config.user_id or ""
        self.policy = PolicySnapshot()
        self.policy_lock = threading.Lock()
        self.sync_requested = threading.Event()
        self.download_seen: set[str] = set()
        self.domain_alerts: dict[str, float] = {}
        self.process_alerts: dict[str, float] = {}
        self.stats_lock = threading.Lock()
        self.started_at = time.time()
        self.stream_server: Optional[ScreenShareServer] = None
        self.active_stream_session_id: Optional[str] = None
        self.stats: dict[str, Any] = {
            "sync_count": 0,
            "last_sync": None,
            "alerts_sent": 0,
            "status": "starting",
            "last_error": "",
            "domains_blocked": 0,
            "blocked_domains_list": [],
            "downloads_rules": 0,
            "download_rules_list": [],
            "files_blocked": 0,
            "processes_killed": 0,
            "domain_blocks_count": 0,
            "last_domain_block": "",
            "realtime_connected": False,
            "offline_mode": False,
            "telemetry_uploads": 0,
            "firewall_enabled": True,
            "download_restriction_enabled": True,
            "process_enforcement_enabled": True,
            "active_schedules": 0,
            "alert_count": 0,
            "stream_active": False,
            "stream_port": 0,
        }

    def run(self) -> None:
        self.logger.info("Sentinel Net Agent v%s starting", AGENT_VERSION)
        self.authenticate()
        self.ensure_device()
        self.prime_download_cache()
        self.update_status("running")

        self.sync_requested.set()
        workers = [
            threading.Thread(target=self.sync_loop, name="policy-sync", daemon=True),
            threading.Thread(target=self.heartbeat_loop, name="heartbeat", daemon=True),
            threading.Thread(target=self.download_monitor_loop, name="download-monitor", daemon=True),
            threading.Thread(target=self.process_monitor_loop, name="process-monitor", daemon=True),
            threading.Thread(target=self.domain_monitor_loop, name="domain-monitor", daemon=True),
            threading.Thread(target=self.task_report_loop, name="task-report", daemon=True),
            threading.Thread(target=self.self_heal_loop, name="self-heal", daemon=True),
        ]
        for worker in workers:
            worker.start()

        while not self.stop_event.wait(timeout=1):
            pass

        self.stop_stream(update_backend=True)
        self.update_status("stopped")
        self.logger.info("Sentinel Net Agent stopped")

    def stop(self) -> None:
        self.stop_event.set()

    def authenticate(self) -> None:
        self.client.authenticated()
        self.user_id = self.client.user_id or self.user_id
        self.config.access_token = self.client.access_token
        self.config.refresh_token = self.client.refresh_token
        self.config.user_id = self.user_id
        self.config.save(CONFIG_PATH)
        self.logger.info("Authenticated as %s", self.config.username)

    def ensure_device(self) -> None:
        now = utcnow_iso()
        if self.config.device_id:
            try:
                self.client.update(
                    "devices",
                    {"id": self.config.device_id},
                    {
                        "last_seen": now,
                        "status": "active",
                        "agent_version": AGENT_VERSION,
                        "ip_address": self.current_ip_address(),
                    },
                )
                self.device_id = self.config.device_id
                return
            except Exception as exc:
                self.logger.warning("Unable to refresh existing device row: %s", exc)

        device = self.client.insert(
            "devices",
            {
                "user_id": self.user_id,
                "device_name": socket.gethostname(),
                "hostname": socket.gethostname(),
                "os": f"{platform.system()} {platform.release()}",
                "agent_version": AGENT_VERSION,
                "ip_address": self.current_ip_address(),
                "status": "active",
                "firewall_enabled": True,
                "download_restriction_enabled": True,
                "last_seen": now,
            },
        )
        self.device_id = str(device["id"])
        self.config.device_id = self.device_id
        self.config.save(CONFIG_PATH)
        self.logger.info("Registered device %s", self.device_id)

    def sync_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                wait_time = self.config.sync_interval_seconds
                triggered = self.sync_requested.wait(timeout=wait_time)
                if triggered:
                    self.sync_requested.clear()
                self.perform_sync()
                self.process_pending_commands()
            except Exception as exc:
                self.set_error(f"Policy sync failed: {exc}")
                cached = self.load_cached_policy()
                if cached:
                    with self.policy_lock:
                        self.policy = cached
                    self.apply_local_policy(cached, reason="offline-cache")
            finally:
                self.stop_event.wait(timeout=0)

    def heartbeat_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.send_heartbeat()
            except Exception as exc:
                self.logger.warning("Heartbeat upload failed: %s", exc)
            self.stop_event.wait(timeout=self.config.heartbeat_interval_seconds)

    def download_monitor_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.scan_downloads()
            except Exception as exc:
                self.logger.debug("Download monitor error: %s", exc)
            self.stop_event.wait(timeout=DOWNLOAD_SCAN_SECONDS)

    def process_monitor_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.scan_processes()
            except Exception as exc:
                self.logger.debug("Process monitor error: %s", exc)
            self.stop_event.wait(timeout=PROCESS_SCAN_SECONDS)

    def domain_monitor_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.scan_blocked_domains()
            except Exception as exc:
                self.logger.debug("Domain monitor error: %s", exc)
            self.stop_event.wait(timeout=DOMAIN_SCAN_SECONDS)

    def task_report_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.report_tasks()
            except Exception as exc:
                self.logger.debug("Task reporting error: %s", exc)
            self.stop_event.wait(timeout=TASK_REPORT_SECONDS)

    def self_heal_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.perform_safe_self_heal()
            except Exception as exc:
                self.logger.debug("Self-heal error: %s", exc)
            self.stop_event.wait(timeout=SELF_HEAL_SECONDS)

    def perform_sync(self) -> None:
        snapshot = self.fetch_policy_snapshot()
        with self.policy_lock:
            self.policy = snapshot
        self.cache_policy(snapshot)
        self.apply_local_policy(snapshot, reason="sync")
        self.refresh_device_row(snapshot)
        self.update_status("running")
        with self.stats_lock:
            self.stats["sync_count"] = int(self.stats.get("sync_count", 0)) + 1
            self.stats["last_sync"] = utcnow_iso()
            self.stats["last_error"] = ""
            self.stats["offline_mode"] = False
        self.write_stats()

    def fetch_policy_snapshot(self) -> PolicySnapshot:
        app_settings_rows = self.client.select(
            "app_settings",
            {"select": "firewall_enabled,download_restriction_enabled,process_enforcement_enabled", "limit": "1"},
        )
        app_settings = app_settings_rows[0] if app_settings_rows else {}

        domains = [
            row
            for row in self.client.select(
                "domains",
                {"select": "domain_name,is_blocked,scope,device_id", "is_blocked": "eq.true"},
            )
            if row.get("scope") == "global" or row.get("device_id") == self.device_id
        ]

        downloads = [
            row
            for row in self.client.select(
                "downloads",
                {"select": "extension,is_blocked,size_limit_mb,scope,device_id"},
            )
            if row.get("scope") == "global" or row.get("device_id") == self.device_id
        ]

        process_blacklist = self.client.select(
            "process_blacklist",
            {"select": "process_name,kill_on_detect"},
        )

        retention_rows = self.client.select(
            "screenshot_retention_policies",
            {"select": "retention_days", "singleton": "eq.true", "limit": "1"},
        )

        return PolicySnapshot(
            app_settings={
                "firewall_enabled": bool(app_settings.get("firewall_enabled", True)),
                "download_restriction_enabled": bool(app_settings.get("download_restriction_enabled", True)),
                "process_enforcement_enabled": bool(app_settings.get("process_enforcement_enabled", True)),
            },
            domains=domains,
            downloads=downloads,
            process_blacklist=process_blacklist,
            retention_days=int((retention_rows[0] if retention_rows else {}).get("retention_days", 30)),
        )

    def cache_policy(self, snapshot: PolicySnapshot) -> None:
        RULE_CACHE_PATH.write_text(json.dumps(snapshot.to_json(), indent=2), encoding="utf-8")

    def load_cached_policy(self) -> Optional[PolicySnapshot]:
        if not RULE_CACHE_PATH.exists():
            return None
        try:
            payload = json.loads(RULE_CACHE_PATH.read_text(encoding="utf-8"))
            with self.stats_lock:
                self.stats["offline_mode"] = True
            self.write_stats()
            return PolicySnapshot.from_json(payload)
        except Exception as exc:
            self.logger.warning("Unable to load cached policy: %s", exc)
            return None

    def apply_local_policy(self, snapshot: PolicySnapshot, *, reason: str) -> None:
        blocked_domains = snapshot.effective_blocked_domains()
        if snapshot.app_settings.get("firewall_enabled", True):
            if blocked_domains:
                self.apply_hosts_file(blocked_domains)
            else:
                self.clear_hosts_rules()
            if self.config.enable_firewall_rules:
                self.apply_optional_firewall_rules(blocked_domains)
        else:
            self.clear_hosts_rules()

        with self.stats_lock:
            self.stats["firewall_enabled"] = snapshot.app_settings.get("firewall_enabled", True)
            self.stats["download_restriction_enabled"] = snapshot.app_settings.get(
                "download_restriction_enabled",
                True,
            )
            self.stats["process_enforcement_enabled"] = snapshot.app_settings.get(
                "process_enforcement_enabled",
                True,
            )
            self.stats["domains_blocked"] = len(blocked_domains)
            self.stats["blocked_domains_list"] = blocked_domains[:50]
            self.stats["downloads_rules"] = len(snapshot.downloads)
            self.stats["download_rules_list"] = snapshot.blocked_download_rules()[:50]
        self.write_stats()
        self.logger.info("Applied %s policy snapshot (%s blocked domains)", reason, len(blocked_domains))

    def refresh_device_row(self, snapshot: PolicySnapshot) -> None:
        self.client.update(
            "devices",
            {"id": self.device_id},
            {
                "last_seen": utcnow_iso(),
                "status": "active",
                "agent_version": AGENT_VERSION,
                "ip_address": self.current_ip_address(),
                "firewall_enabled": snapshot.app_settings.get("firewall_enabled", True),
                "download_restriction_enabled": snapshot.app_settings.get("download_restriction_enabled", True),
            },
        )

    def send_heartbeat(self) -> None:
        cpu_percent = round(psutil.cpu_percent(interval=0.1), 2) if psutil else None
        memory_mb = None
        if psutil:
            try:
                memory_mb = int(psutil.virtual_memory().used / (1024 * 1024))
            except Exception:
                memory_mb = None

        with self.stats_lock:
            last_sync = self.stats.get("last_sync")
            status = str(self.stats.get("status", "running"))

        watchdog_status = "healthy" if status == "running" else "degraded" if status == "error" else "unknown"

        self.client.insert(
            "agent_heartbeats",
            {
                "device_id": self.device_id,
                "user_id": self.user_id,
                "uptime_seconds": int(time.time() - self.started_at),
                "agent_version": AGENT_VERSION,
                "watchdog_status": watchdog_status,
                "cpu_percent": cpu_percent,
                "memory_mb": memory_mb,
                "last_sync_at": last_sync,
                "metadata": {
                    "hostname": socket.gethostname(),
                    "offline_mode": bool(self.stats.get("offline_mode", False)),
                    "stream_active": bool(self.stats.get("stream_active", False)),
                    "stream_port": int(self.stats.get("stream_port", 0) or 0),
                },
                "reported_at": utcnow_iso(),
            },
        )

        HEARTBEAT_PATH.write_text(
            json.dumps(
                {
                    "ts": utcnow_iso(),
                    "pid": os.getpid(),
                    "device_id": self.device_id,
                    "version": AGENT_VERSION,
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        with self.stats_lock:
            self.stats["telemetry_uploads"] = int(self.stats.get("telemetry_uploads", 0)) + 1
        self.write_stats()

    def prime_download_cache(self) -> None:
        for directory in self.monitored_download_directories():
            try:
                for entry in directory.iterdir():
                    if entry.is_file():
                        self.download_seen.add(str(entry.resolve()))
            except (OSError, PermissionError):
                continue

    def monitored_download_directories(self) -> list[Path]:
        if self.config.monitored_download_directories:
            result = []
            for value in self.config.monitored_download_directories:
                path = Path(value)
                if path.exists():
                    result.append(path)
            if result:
                return result
        return get_download_directories()

    def scan_downloads(self) -> None:
        with self.policy_lock:
            snapshot = self.policy

        if not snapshot.app_settings.get("download_restriction_enabled", True):
            return

        rules: dict[str, dict[str, Any]] = {}
        for item in snapshot.downloads:
            extension = str(item.get("extension") or "").strip().lower().lstrip(".")
            if extension:
                rules[extension] = item

        for directory in self.monitored_download_directories():
            try:
                entries = list(directory.iterdir())
            except (OSError, PermissionError):
                continue

            for entry in entries:
                if not entry.is_file():
                    continue

                resolved = str(entry.resolve())
                if resolved in self.download_seen:
                    continue
                self.download_seen.add(resolved)

                extension = entry.suffix.lower().lstrip(".")
                rule = rules.get(extension)
                if not rule:
                    continue

                size_mb = 0.0
                try:
                    size_mb = entry.stat().st_size / (1024 * 1024)
                except OSError:
                    pass

                blocked = bool(rule.get("is_blocked", False))
                size_limit = rule.get("size_limit_mb")
                over_limit = size_limit is not None and size_mb > float(size_limit)
                if not blocked and not over_limit:
                    continue

                deleted = False
                try:
                    entry.unlink()
                    deleted = True
                except Exception as exc:
                    self.logger.warning("Unable to delete blocked download %s: %s", entry, exc)

                screenshot = self.capture_screenshot(
                    reason="download_policy_violation",
                    target=entry.name,
                )
                self.emit_violation(
                    source="download",
                    severity="critical",
                    target=entry.name,
                )
                self.emit_activity(
                    event_type="download",
                    outcome="deleted" if deleted else "blocked",
                    target=entry.name,
                    severity="critical",
                    metadata={"size_mb": round(size_mb, 2), "extension": extension},
                    screenshot=screenshot,
                )
                self.emit_alert(
                    action_type="download_blocked",
                    target=entry.name,
                    severity="critical",
                    metadata={"size_mb": round(size_mb, 2), "extension": extension},
                )
                with self.stats_lock:
                    self.stats["files_blocked"] = int(self.stats.get("files_blocked", 0)) + 1
                self.write_stats()

    def scan_processes(self) -> None:
        if psutil is None:
            return

        with self.policy_lock:
            snapshot = self.policy

        if not snapshot.app_settings.get("process_enforcement_enabled", True):
            return

        blocked = snapshot.blocked_process_map()
        if not blocked:
            return

        for process in psutil.process_iter(["pid", "name"]):
            try:
                pid = int(process.info["pid"])
                name = str(process.info.get("name") or "").strip().lower()
            except Exception:
                continue

            if not name:
                continue

            kill_on_detect = blocked.get(name)
            if kill_on_detect is None:
                kill_on_detect = blocked.get(Path(name).stem)
            if kill_on_detect is None:
                continue

            dedupe_key = f"{pid}:{name}"
            if not self.should_emit("process", dedupe_key, cooldown_seconds=30):
                continue

            killed = False
            detail = "detected"
            if kill_on_detect:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                    killed = True
                    detail = "killed"
                except Exception as exc:
                    detail = f"kill_failed:{exc}"

            screenshot = self.capture_screenshot(
                reason="process_policy_violation",
                target=name,
            )
            severity = "critical" if kill_on_detect else "warning"
            self.emit_violation(source="process", severity=severity, target=name)
            self.emit_activity(
                event_type="process",
                outcome="killed" if killed else "blocked",
                target=name,
                severity=severity,
                metadata={"pid": pid, "detail": detail},
                screenshot=screenshot,
            )
            self.emit_alert(
                action_type="process_killed" if killed else "process_blocked",
                target=name,
                severity=severity,
                metadata={"pid": pid, "detail": detail},
            )
            if killed:
                with self.stats_lock:
                    self.stats["processes_killed"] = int(self.stats.get("processes_killed", 0)) + 1
                self.write_stats()

    def scan_blocked_domains(self) -> None:
        if psutil is None:
            return

        with self.policy_lock:
            snapshot = self.policy

        if not snapshot.app_settings.get("firewall_enabled", True):
            return

        blocked_domains = snapshot.effective_blocked_domains()
        if not blocked_domains:
            return

        try:
            connections = psutil.net_connections(kind="inet")
        except Exception:
            return

        for connection in connections:
            if not connection.raddr or connection.status != "ESTABLISHED":
                continue

            remote_ip = getattr(connection.raddr, "ip", None)
            if not remote_ip:
                continue

            hostname = ""
            try:
                hostname = socket.gethostbyaddr(remote_ip)[0].lower()
            except Exception:
                hostname = ""

            matched_domain = next((domain for domain in blocked_domains if domain in hostname), None)
            if not matched_domain:
                continue

            if not self.should_emit("domain", matched_domain, cooldown_seconds=60):
                continue

            screenshot = self.capture_screenshot(
                reason="domain_policy_violation",
                target=matched_domain,
            )
            self.emit_violation(source="domain", severity="critical", target=matched_domain)
            self.emit_activity(
                event_type="domain_access",
                outcome="blocked",
                target=matched_domain,
                severity="critical",
                metadata={"remote_ip": remote_ip, "pid": connection.pid},
                screenshot=screenshot,
            )
            self.emit_alert(
                action_type="domain_blocked",
                target=matched_domain,
                severity="critical",
                metadata={"remote_ip": remote_ip, "pid": connection.pid},
            )
            with self.stats_lock:
                self.stats["domain_blocks_count"] = int(self.stats.get("domain_blocks_count", 0)) + 1
                self.stats["last_domain_block"] = matched_domain
            self.write_stats()

    def report_tasks(self) -> None:
        if psutil is None:
            return

        rows: list[dict[str, Any]] = []
        for process in psutil.process_iter(["pid", "name", "memory_info", "cpu_percent"]):
            try:
                memory_info = process.info.get("memory_info")
                rows.append(
                    {
                        "device_id": self.device_id,
                        "user_id": self.user_id,
                        "pid": int(process.info["pid"]),
                        "process_name": str(process.info.get("name") or "unknown"),
                        "cpu_percent": round(float(process.info.get("cpu_percent") or 0), 2),
                        "memory_mb": round((memory_info.rss / (1024 * 1024)) if memory_info else 0, 2),
                        "status": "running",
                    }
                )
            except Exception:
                continue
            if len(rows) >= 200:
                break

        try:
            self.client.delete("device_tasks", {"device_id": self.device_id})
        except Exception:
            pass

        for row in rows:
            try:
                self.client.insert("device_tasks", row)
            except Exception as exc:
                self.logger.debug("Unable to insert device task row: %s", exc)

    def perform_safe_self_heal(self) -> None:
        if not CONFIG_PATH.exists():
            self.set_error("Configuration file is missing; waiting for admin repair.")
            return

        with self.policy_lock:
            snapshot = self.policy

        blocked_domains = snapshot.effective_blocked_domains()
        if snapshot.app_settings.get("firewall_enabled", True) and blocked_domains:
            try:
                contents = HOSTS_PATH.read_text(encoding="utf-8")
            except Exception:
                contents = ""
            if HOSTS_BEGIN not in contents:
                self.logger.warning("Hosts block list is missing; reapplying cached policy.")
                self.emit_alert(
                    action_type="self_heal",
                    target="hosts_file",
                    severity="warning",
                    metadata={"reason": "managed block list missing"},
                )
                self.apply_hosts_file(blocked_domains)

    def process_pending_commands(self) -> None:
        commands = self.client.select(
            "device_commands",
            {
                "select": "id,command_type,payload",
                "device_id": f"eq.{self.device_id}",
                "status": "eq.pending",
                "order": "created_at.asc",
            },
        )

        for command in commands:
            command_id = str(command["id"])
            command_type = str(command.get("command_type") or "")
            payload = ensure_json_object(command.get("payload"))

            self.client.update(
                "device_commands",
                {"id": command_id},
                {
                    "status": "acknowledged",
                    "acknowledged_at": utcnow_iso(),
                },
            )

            success = True
            result = "ok"
            try:
                if command_type == "force_sync":
                    self.sync_requested.set()
                    result = "sync_requested"
                elif command_type == "restart_agent":
                    self.authenticate()
                    self.sync_requested.set()
                    result = "runtime_reloaded"
                elif command_type == "lock_device":
                    self.lock_device()
                    result = "device_locked"
                    self.emit_alert("device_locked", socket.gethostname(), "warning", {"command_id": command_id})
                elif command_type == "shutdown_device":
                    grace_seconds = int(payload.get("grace_seconds", 30))
                    reason = str(payload.get("reason") or "Managed shutdown requested by Sentinel Net.")
                    self.shutdown_device(grace_seconds=grace_seconds, reason=reason)
                    result = f"shutdown_scheduled:{grace_seconds}s"
                    self.emit_alert("device_shutdown", socket.gethostname(), "warning", {"command_id": command_id})
                elif command_type == "kill_process":
                    pid = int(payload["pid"])
                    process_name = str(payload.get("process_name") or "")
                    self.kill_process(pid=pid, process_name=process_name)
                    result = f"process_terminated:{pid}"
                elif command_type == "start_stream":
                    session_id = str(payload["session_id"])
                    fps = int(payload.get("max_fps", self.config.max_stream_fps))
                    quality = int(payload.get("jpeg_quality", self.config.stream_jpeg_quality))
                    endpoint = self.start_stream(session_id=session_id, fps=fps, jpeg_quality=quality)
                    result = endpoint
                    self.emit_alert("screen_share_started", endpoint, "info", {"command_id": command_id})
                elif command_type == "stop_stream":
                    session_id = str(payload.get("session_id") or self.active_stream_session_id or "")
                    self.stop_stream(update_backend=True, session_id=session_id or None)
                    result = "stream_stopped"
                    self.emit_alert("screen_share_stopped", socket.gethostname(), "info", {"command_id": command_id})
                else:
                    success = False
                    result = f"unsupported_command:{command_type}"
            except Exception as exc:
                success = False
                result = str(exc)
                self.logger.warning("Command %s failed: %s", command_type, exc)

            self.client.update(
                "device_commands",
                {"id": command_id},
                {
                    "status": "completed" if success else "failed",
                    "result": result,
                    "completed_at": utcnow_iso(),
                },
            )

    def start_stream(self, *, session_id: str, fps: int, jpeg_quality: int) -> str:
        self.stop_stream(update_backend=False)
        self.stream_server = ScreenShareServer(
            fps=fps,
            jpeg_quality=jpeg_quality,
            logger=self.logger,
        )
        self.stream_server.start()
        endpoint = self.stream_server.endpoint(self.current_ip_address())
        self.active_stream_session_id = session_id
        self.client.update(
            "screen_sessions",
            {"id": session_id},
            {
                "status": "active",
                "ws_endpoint": endpoint,
                "started_at": utcnow_iso(),
                "updated_at": utcnow_iso(),
                "error_message": None,
            },
        )
        with self.stats_lock:
            self.stats["stream_active"] = True
            self.stats["stream_port"] = self.stream_server.port
        self.write_stats()
        return endpoint

    def stop_stream(self, *, update_backend: bool, session_id: Optional[str] = None) -> None:
        if self.stream_server is not None:
            self.stream_server.stop()
        self.stream_server = None
        target_session_id = session_id or self.active_stream_session_id
        self.active_stream_session_id = None

        if update_backend and target_session_id:
            try:
                self.client.update(
                    "screen_sessions",
                    {"id": target_session_id},
                    {
                        "status": "stopped",
                        "stopped_at": utcnow_iso(),
                        "updated_at": utcnow_iso(),
                    },
                )
            except Exception as exc:
                self.logger.debug("Unable to update screen session %s: %s", target_session_id, exc)

        with self.stats_lock:
            self.stats["stream_active"] = False
            self.stats["stream_port"] = 0
        self.write_stats()

    def lock_device(self) -> None:
        if WINDOWS:
            result = subprocess.run(
                ["rundll32.exe", "user32.dll,LockWorkStation"],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "LockWorkStation failed")
            return
        raise RuntimeError("Device locking is only supported on Windows.")

    def shutdown_device(self, *, grace_seconds: int, reason: str) -> None:
        if not WINDOWS:
            raise RuntimeError("Managed shutdown is only supported on Windows.")
        result = subprocess.run(
            ["shutdown", "/s", "/t", str(grace_seconds), "/c", reason],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Shutdown command failed")

    def kill_process(self, *, pid: int, process_name: str) -> None:
        if psutil is None:
            raise RuntimeError("psutil is required for process management.")

        process = psutil.Process(pid)
        actual_name = process.name()
        if process_name and actual_name.lower() != process_name.lower():
            raise RuntimeError(
                f"PID {pid} is running '{actual_name}', not '{process_name}'."
            )
        process.terminate()
        process.wait(timeout=5)

    def capture_screenshot(self, *, reason: str, target: str) -> Optional[dict[str, Any]]:
        if not self.config.screenshot_capture_enabled or ImageGrab is None:
            return None

        try:
            image = ImageGrab.grab(all_screens=True)
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=65, optimize=True)
            data = buffer.getvalue()
        except Exception as exc:
            self.logger.debug("Screenshot capture skipped: %s", exc)
            return None

        sha256 = hashlib.sha256(data).hexdigest()
        timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
        path = f"{self.user_id}/{self.device_id}/{reason}_{timestamp}.jpg"
        try:
            self.client.storage_upload("violation-screenshots", path, data, "image/jpeg")
        except Exception as exc:
            self.logger.warning("Unable to upload screenshot evidence: %s", exc)
            return None

        row = self.client.insert(
            "screenshots",
            {
                "device_id": self.device_id,
                "user_id": self.user_id,
                "bucket": "violation-screenshots",
                "storage_path": path,
                "content_type": "image/jpeg",
                "capture_reason": reason,
                "sha256": sha256,
                "file_size_bytes": len(data),
                "captured_at": utcnow_iso(),
            },
        )
        return {
            "id": row.get("id"),
            "bucket": "violation-screenshots",
            "storage_path": path,
        }

    def emit_alert(
        self,
        action_type: str,
        target: Optional[str],
        severity: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        try:
            self.client.insert(
                "alerts",
                {
                    "user_id": self.user_id,
                    "device_id": self.device_id,
                    "action_type": action_type,
                    "target": target,
                    "severity": severity,
                    "metadata": metadata or {},
                },
            )
        except Exception as exc:
            self.logger.debug("Unable to write alert row: %s", exc)

        log_payload = {
            "timestamp": utcnow_iso(),
            "type": action_type,
            "target": target,
            "severity": severity,
            "metadata": metadata or {},
        }
        try:
            existing = []
            if ALERT_LOG_PATH.exists():
                existing = json.loads(ALERT_LOG_PATH.read_text(encoding="utf-8"))
            existing.append(log_payload)
            retention_days = max(1, int(self.policy.retention_days))
            cutoff = utcnow().timestamp() - (retention_days * 86400)
            pruned = []
            for item in existing[-1000:]:
                try:
                    if datetime.fromisoformat(item["timestamp"]).timestamp() >= cutoff:
                        pruned.append(item)
                except Exception:
                    pruned.append(item)
            ALERT_LOG_PATH.write_text(json.dumps(pruned, indent=2), encoding="utf-8")
        except Exception:
            pass

        with self.stats_lock:
            self.stats["alerts_sent"] = int(self.stats.get("alerts_sent", 0)) + 1
            self.stats["alert_count"] = int(self.stats.get("alert_count", 0)) + 1
        self.write_stats()

        title = ALERT_TITLES.get(action_type, "Sentinel Net Alert")
        if target:
            self.logger.warning("%s: %s", title, target)
        else:
            self.logger.warning("%s", title)

    def emit_violation(self, *, source: str, severity: str, target: Optional[str]) -> None:
        try:
            self.client.insert(
                "violation_events",
                {
                    "device_id": self.device_id,
                    "user_id": self.user_id,
                    "severity": severity,
                    "source": source,
                    "target": target,
                    "occurred_at": utcnow_iso(),
                },
            )
        except Exception as exc:
            self.logger.debug("Unable to write violation row: %s", exc)

    def emit_activity(
        self,
        *,
        event_type: str,
        outcome: str,
        target: Optional[str],
        severity: str,
        metadata: Optional[dict[str, Any]] = None,
        screenshot: Optional[dict[str, Any]] = None,
    ) -> None:
        payload: dict[str, Any] = {
            "device_id": self.device_id,
            "user_id": self.user_id,
            "event_type": event_type,
            "outcome": outcome,
            "target": target,
            "severity": severity,
            "metadata": metadata or {},
        }
        if screenshot:
            payload["screenshot_bucket"] = screenshot["bucket"]
            payload["screenshot_storage_path"] = screenshot["storage_path"]
            if screenshot.get("id"):
                payload["screenshot_id"] = screenshot["id"]

        row = self.client.insert("activity_events", payload)
        if screenshot and screenshot.get("id") and row.get("id"):
            try:
                self.client.update(
                    "screenshots",
                    {"id": screenshot["id"]},
                    {"activity_event_id": row["id"]},
                )
            except Exception as exc:
                self.logger.debug("Unable to back-link screenshot evidence: %s", exc)

    def should_emit(self, kind: str, target: str, *, cooldown_seconds: int) -> bool:
        bucket = self.domain_alerts if kind == "domain" else self.process_alerts
        now = time.time()
        last_seen = bucket.get(target)
        if last_seen and now - last_seen < cooldown_seconds:
            return False
        bucket[target] = now
        expired = [key for key, timestamp in bucket.items() if now - timestamp > max(cooldown_seconds * 10, 300)]
        for key in expired:
            bucket.pop(key, None)
        return True

    def apply_hosts_file(self, blocked_domains: list[str]) -> None:
        self.back_up_hosts_once()
        existing = ""
        try:
            existing = HOSTS_PATH.read_text(encoding="utf-8")
        except Exception:
            existing = ""

        if HOSTS_BEGIN in existing:
            before = existing.split(HOSTS_BEGIN)[0]
            after_parts = existing.split(HOSTS_END)
            after = after_parts[1] if len(after_parts) > 1 else ""
            existing = before.rstrip() + "\n" + after.lstrip()

        lines = [HOSTS_BEGIN]
        added: set[str] = set()
        for domain in blocked_domains:
            canonical = domain.strip().lower()
            if not canonical or canonical in added:
                continue
            lines.append(f"127.0.0.1 {canonical}")
            added.add(canonical)
            if not canonical.startswith("www."):
                lines.append(f"127.0.0.1 www.{canonical}")
                added.add(f"www.{canonical}")
        lines.append(HOSTS_END)

        HOSTS_PATH.write_text(
            (existing.rstrip() + "\n\n" + "\n".join(lines) + "\n") if lines else existing,
            encoding="utf-8",
        )
        self.flush_dns()

    def clear_hosts_rules(self) -> None:
        try:
            contents = HOSTS_PATH.read_text(encoding="utf-8")
        except Exception:
            return

        if HOSTS_BEGIN not in contents:
            return

        before = contents.split(HOSTS_BEGIN)[0]
        after_parts = contents.split(HOSTS_END)
        after = after_parts[1] if len(after_parts) > 1 else ""
        HOSTS_PATH.write_text((before.rstrip() + "\n" + after.lstrip()).rstrip() + "\n", encoding="utf-8")
        self.flush_dns()

    def back_up_hosts_once(self) -> None:
        if HOSTS_BACKUP_PATH.exists() or not HOSTS_PATH.exists():
            return
        try:
            HOSTS_BACKUP_PATH.write_bytes(HOSTS_PATH.read_bytes())
        except Exception as exc:
            self.logger.debug("Unable to create hosts backup: %s", exc)

    def apply_optional_firewall_rules(self, blocked_domains: list[str]) -> None:
        if not WINDOWS or not blocked_domains:
            return

        resolved_ips: set[str] = set()
        for domain in blocked_domains:
            try:
                _, _, addresses = socket.gethostbyname_ex(domain)
                resolved_ips.update(addresses)
            except Exception:
                continue

        if not resolved_ips:
            return

        rule_name = "SentinelNetDomainBlock"
        subprocess.run(
            [
                "netsh",
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                f"name={rule_name}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        subprocess.run(
            [
                "netsh",
                "advfirewall",
                "firewall",
                "add",
                "rule",
                f"name={rule_name}",
                "dir=out",
                "action=block",
                f"remoteip={','.join(sorted(resolved_ips))}",
                "enable=yes",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def flush_dns(self) -> None:
        if not WINDOWS:
            return
        subprocess.run(["ipconfig", "/flushdns"], capture_output=True, text=True, check=False)

    def current_ip_address(self) -> str:
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.connect(("8.8.8.8", 80))
            address = probe.getsockname()[0]
            probe.close()
            return address
        except Exception:
            return "unknown"

    def update_status(self, value: str) -> None:
        with self.stats_lock:
            self.stats["status"] = value
            if value != "error":
                self.stats["last_error"] = ""
        self.write_stats()

    def set_error(self, message: str) -> None:
        self.logger.error(message)
        with self.stats_lock:
            self.stats["status"] = "error"
            self.stats["last_error"] = message
        self.write_stats()

    def write_stats(self) -> None:
        with self.stats_lock:
            payload = dict(self.stats)
        STATS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class SentinelAgentService(win32serviceutil.ServiceFramework if win32serviceutil else object):
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = SERVICE_DISPLAY_NAME
    _svc_description_ = SERVICE_DESCRIPTION

    def __init__(self, args: Any) -> None:
        if not win32serviceutil:
            raise RuntimeError("pywin32 service support is not available.")
        super().__init__(args)
        self.stop_requested = threading.Event()
        self.wait_handle = win32event.CreateEvent(None, 0, 0, None)
        self.runtime: Optional[SentinelAgentRuntime] = None

    def SvcStop(self) -> None:
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.stop_requested.set()
        if self.runtime is not None:
            self.runtime.stop()
        win32event.SetEvent(self.wait_handle)

    def SvcDoRun(self) -> None:
        if servicemanager:
            servicemanager.LogInfoMsg(f"{SERVICE_NAME} starting")
        self.runtime = SentinelAgentRuntime(stop_event=self.stop_requested, service_mode=True)
        self.runtime.run()


def run_console() -> int:
    runtime = SentinelAgentRuntime(service_mode=False)
    try:
        runtime.run()
        return 0
    except KeyboardInterrupt:
        runtime.stop()
        return 0


def main() -> int:
    if not WINDOWS or "--console" in sys.argv:
        return run_console()

    if win32serviceutil is None:
        LOGGER.error("pywin32 is required to run Sentinel Net Agent as a Windows Service.")
        return 1

    if len(sys.argv) == 1:
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(SentinelAgentService)
        servicemanager.StartServiceCtrlDispatcher()
        return 0

    win32serviceutil.HandleCommandLine(SentinelAgentService)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
