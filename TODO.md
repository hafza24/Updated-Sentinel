# Sentinel Net — Completion Task Tracker

## Phase 1: Database Schema (Migration)
- [x] screen_sessions table
- [x] device_tasks table
- [x] file_integrity table
- [x] Update device_command_type enum (shutdown_device, kill_process, start_stream, stop_stream)
- [x] Update activity_events screenshot linkage
- [x] Realtime pub/sub for new tables

## Phase 2: Agent Enhancements
- [x] Screenshot capture module (PIL, upload on violation)
- [x] Live screen streaming module (WebSocket, compressed JPEG frames)
- [x] Task list reporter (periodic process snapshot to device_tasks)
- [x] Self-healing system (file integrity SHA256, auto-restore, hosts watcher, firewall repair)
- [x] Mutual monitoring (agent checks watchdog heartbeat)
- [x] Stealth improvements (window hiding, lower profile)

## Phase 3: Watchdog Overhaul
- [x] Convert to Windows Service (pywin32 service framework)
- [x] Run as SYSTEM via SCM
- [x] Tamper protection (prevent non-admin termination)
- [x] Mutual heartbeat file

## Phase 4: Tray App
- [x] Stealth mode support (hide tray icon option)
- [x] Read stealth config

## Phase 5: Installer
- [x] Stealth mode checkbox
- [x] Install watchdog as Windows Service
- [x] Remove scheduled task fallback for watchdog
- [x] File integrity baseline creation

## Phase 6: Web App
- [x] Live Screen route (_authed.live-screen.tsx)
- [x] Device Tasks route (_authed.tasks.tsx)
- [x] Update device-control (shutdown_device, kill_process, start_stream, stop_stream)
- [x] Update router for new routes
- [x] Sidebar navigation links

## Phase 7: Deployment
- [x] Hostinger deploy script (deploy/hostinger-deploy.sh)
- [x] Nginx config (deploy/nginx.conf)
- [x] Environment template (deploy/.env.hostinger)
- [x] File manager structure docs

## Phase 8: Verification & Polish
- [x] Build test — PASSED (all routes compile, no errors)
- [x] Check all imports — All lucide icons and modules resolved
- [x] Verify no placeholders — No TODOs or placeholders remaining

