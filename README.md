# Sentinel Net

Sentinel Net is a full-stack endpoint monitoring dashboard built with React, TanStack Start, TypeScript, and Supabase. This repository contains the web control plane, Supabase schema, realtime workflows, storage-backed evidence handling, and deployment-facing documentation for a legitimate, visible monitoring product.

This codebase does not include or distribute stealth tooling, anti-removal logic, hidden remote control, or protected persistence mechanisms. If you extend it with endpoint components, keep them user-visible, authenticated, auditable, and consent-based.

## Folder structure

```text
sentinel_network/
|-- docs/
|   `-- Sentinel-Net-Project-Documentation.md
|-- dist/
|-- src/
|   |-- components/
|   |-- hooks/
|   |-- integrations/
|   |   `-- supabase/
|   |-- lib/
|   |-- routes/
|   |   |-- api/public/
|   |   `-- ...
|   |-- router.tsx
|   `-- styles.css
|-- supabase/
|   |-- config.toml
|   `-- migrations/
|-- package.json
|-- vite.config.ts
`-- wrangler.jsonc
```

## Included capabilities

- Supabase auth with `admin` and `user` roles
- Device inventory, telemetry, heartbeat, alerts, activity, and request workflows
- Realtime subscriptions for device, alert, telemetry, policy, and command updates
- Storage-backed screenshot retention and snapshot workflows
- Webhook dispatching and cron-driven maintenance jobs
- Dashboard views for devices, alerts, activity, requests, retention, backups, and settings

## Local setup

1. Install dependencies with `npm install`.
2. Create a local `.env` with:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` for server-side routes
3. Apply the SQL migrations in `supabase/migrations`.
4. Start the app with `npm run dev`.
5. Build for production with `npm run build`.

## Production notes

- The dashboard build is currently configured for the Cloudflare/TanStack Start deployment path in `wrangler.jsonc`.
- Supabase should be treated as the system of record for auth, realtime, storage, and relational data.
- Heartbeat freshness is treated as a runtime connectivity signal. Devices that stop reporting for more than 2 minutes should be considered offline.
- Any future endpoint agent should use least privilege, signed updates, explicit service registration, and audited command allowlists.

## Safety and scope

Sentinel Net should be operated as a transparent administrative platform. Avoid adding:

- stealth execution or hidden persistence
- resistance to legitimate uninstall or system administration
- screen or session capture without explicit notice and authorization
- unrestricted remote command execution

## Verification

The current web app builds successfully with:

```bash
npm run build
```
