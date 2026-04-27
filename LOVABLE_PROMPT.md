# Lovable Prompt — Sentinel Net Complete Database Schema

## Project Overview

**Sentinel Net** is a full-stack endpoint monitoring, control, and alerting system. It uses:
- **Frontend**: React 19 + TanStack Start + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions)
- **Agent**: Python endpoint agent that reports to Supabase

The system has **two roles**: `admin` and `user`.

---

## CRITICAL: Generate ONE Complete SQL File

Generate a **single, idempotent, complete Supabase SQL schema** that I can paste into the Supabase SQL Editor. It must include **EVERY table, enum, function, trigger, RLS policy, index, realtime publication, storage bucket, and cron job** listed below. **Nothing can be missing.**

Use `CREATE TYPE IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`, and `DROP POLICY IF EXISTS` patterns to make it safe to re-run.

---

## 1. ENUMS (Create These First)

```sql
app_role: ('admin', 'user')
device_status: ('active', 'inactive', 'disabled')
rule_scope: ('global', 'device')
alert_severity: ('info', 'warning', 'critical')
request_type: ('domain', 'download', 'uninstall')
request_status: ('pending', 'approved', 'rejected')
schedule_target_type: ('domain', 'process')
auto_response_trigger: ('violation_count', 'single_violation')
auto_response_action: ('log_only', 'temp_block_all', 'disable_network', 'lock_device')
violation_source: ('domain', 'download', 'process')
watchdog_status: ('healthy', 'degraded', 'down', 'unknown')
snapshot_status: ('pending', 'ready', 'failed', 'restored')
webhook_delivery_status: ('pending', 'sent', 'failed')
webhook_provider: ('slack', 'discord', 'generic')
activity_event_type: ('domain_access', 'download', 'process')
activity_event_outcome: ('allowed', 'blocked', 'killed', 'deleted')
device_command_status: ('pending', 'acknowledged', 'completed', 'failed')
device_command_type: ('lock_device', 'restart_agent', 'force_sync', 'disable_network', 'enable_network', 'shutdown_device', 'kill_process', 'start_stream', 'stop_stream')
```

---

## 2. TABLES (Complete Schema with All Columns)

### profiles
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, REFERENCES auth.users(id) ON DELETE CASCADE |
| username | TEXT | NOT NULL, UNIQUE |
| display_name | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### user_roles
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE |
| role | app_role | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| UNIQUE(user_id, role) |

### devices
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE |
| device_name | TEXT | NOT NULL |
| hostname | TEXT | |
| os | TEXT | |
| agent_version | TEXT | |
| ip_address | TEXT | |
| status | device_status | DEFAULT 'inactive' |
| firewall_enabled | BOOLEAN | DEFAULT TRUE |
| download_restriction_enabled | BOOLEAN | DEFAULT TRUE |
| last_seen | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### domains
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| domain_name | TEXT | NOT NULL |
| is_blocked | BOOLEAN | DEFAULT TRUE |
| scope | rule_scope | DEFAULT 'global' |
| device_id | UUID | REFERENCES devices(id) ON DELETE CASCADE |
| created_by | UUID | REFERENCES auth.users(id) ON DELETE SET NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### downloads
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| extension | TEXT | NOT NULL |
| size_limit_mb | INTEGER | |
| is_blocked | BOOLEAN | DEFAULT TRUE |
| scope | rule_scope | DEFAULT 'global' |
| device_id | UUID | REFERENCES devices(id) ON DELETE CASCADE |
| created_by | UUID | REFERENCES auth.users(id) ON DELETE SET NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### process_blacklist
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| process_name | TEXT | NOT NULL, UNIQUE |
| description | TEXT | |
| kill_on_detect | BOOLEAN | DEFAULT TRUE |
| created_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### app_settings
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| singleton | BOOLEAN | DEFAULT TRUE, UNIQUE |
| firewall_enabled | BOOLEAN | DEFAULT TRUE |
| download_restriction_enabled | BOOLEAN | DEFAULT TRUE |
| process_enforcement_enabled | BOOLEAN | DEFAULT TRUE |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| updated_by | UUID | |

### alerts
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| user_id | UUID | REFERENCES auth.users(id) ON DELETE SET NULL |
| device_id | UUID | REFERENCES devices(id) ON DELETE CASCADE |
| action_type | TEXT | NOT NULL |
| target | TEXT | |
| severity | alert_severity | DEFAULT 'info' |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| created_at | TIMESTAMPTZ | DEFAULT now() |

### requests
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE |
| device_id | UUID | REFERENCES devices(id) ON DELETE CASCADE |
| request_type | request_type | NOT NULL |
| payload | JSONB | DEFAULT '{}'::jsonb |
| reason | TEXT | |
| status | request_status | DEFAULT 'pending' |
| reviewed_by | UUID | REFERENCES auth.users(id) ON DELETE SET NULL |
| review_notes | TEXT | |
| reviewed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### activity_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| device_id | UUID | REFERENCES devices(id) ON DELETE SET NULL |
| user_id | UUID | |
| event_type | activity_event_type | NOT NULL |
| outcome | activity_event_outcome | NOT NULL |
| target | TEXT | |
| severity | alert_severity | DEFAULT 'info' |
| screenshot_path | TEXT | |
| screenshot_bucket | TEXT | DEFAULT 'violation-screenshots' |
| screenshot_storage_path | TEXT | |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| occurred_at | TIMESTAMPTZ | DEFAULT now() |

### violation_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| device_id | UUID | REFERENCES devices(id) ON DELETE CASCADE |
| user_id | UUID | |
| severity | alert_severity | DEFAULT 'warning' |
| source | violation_source | NOT NULL |
| target | TEXT | |
| occurred_at | TIMESTAMPTZ | DEFAULT now() |

### policy_schedules
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| target_type | schedule_target_type | NOT NULL |
| target_value | TEXT | NOT NULL |
| days_of_week | SMALLINT[] | DEFAULT ARRAY[0,1,2,3,4,5,6] |
| start_time | TIME | NOT NULL |
| end_time | TIME | NOT NULL |
| timezone | TEXT | DEFAULT 'UTC' |
| scope | rule_scope | DEFAULT 'global' |
| device_id | UUID | REFERENCES devices(id) ON DELETE CASCADE |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### auto_response_rules
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| trigger_type | auto_response_trigger | DEFAULT 'violation_count' |
| violation_threshold | INT | DEFAULT 5 |
| time_window_minutes | INT | DEFAULT 10 |
| action | auto_response_action | DEFAULT 'log_only' |
| action_duration_minutes | INT | DEFAULT 60 |
| severity_filter | alert_severity | |
| source_filter | violation_source | |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### device_commands
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| device_id | UUID | NOT NULL, REFERENCES devices(id) ON DELETE CASCADE |
| command_type | device_command_type | NOT NULL |
| status | device_command_status | DEFAULT 'pending' |
| payload | JSONB | DEFAULT '{}'::jsonb |
| result | TEXT | |
| issued_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| acknowledged_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### screen_sessions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| device_id | UUID | NOT NULL, REFERENCES devices(id) ON DELETE CASCADE |
| user_id | UUID | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE |
| status | TEXT | NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'stopped', 'error')) |
| ws_endpoint | TEXT | |
| started_at | TIMESTAMPTZ | |
| stopped_at | TIMESTAMPTZ | |
| frame_count | BIGINT | DEFAULT 0 |
| bytes_transferred | BIGINT | DEFAULT 0 |
| error_message | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### device_tasks
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| device_id | UUID | NOT NULL, REFERENCES devices(id) ON DELETE CASCADE |
| user_id | UUID | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE |
| pid | INT | NOT NULL |
| process_name | TEXT | NOT NULL |
| cpu_percent | NUMERIC(5,2) | |
| memory_mb | NUMERIC(10,2) | |
| status | TEXT | DEFAULT 'running' CHECK (status IN ('running', 'killed', 'exited')) |
| reported_at | TIMESTAMPTZ | DEFAULT now() |

### file_integrity
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| device_id | UUID | REFERENCES devices(id) ON DELETE CASCADE |
| file_path | TEXT | NOT NULL |
| expected_sha256 | TEXT | NOT NULL |
| last_verified_at | TIMESTAMPTZ | |
| is_valid | BOOLEAN | DEFAULT TRUE |
| repair_count | INT | DEFAULT 0 |
| created_at | TIMESTAMPTZ | DEFAULT now() |

### agent_heartbeats
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| device_id | UUID | NOT NULL, REFERENCES devices(id) ON DELETE CASCADE |
| user_id | UUID | NOT NULL |
| uptime_seconds | BIGINT | DEFAULT 0 |
| agent_version | TEXT | |
| watchdog_status | watchdog_status | DEFAULT 'unknown' |
| cpu_percent | NUMERIC(5,2) | |
| memory_mb | INT | |
| last_sync_at | TIMESTAMPTZ | |
| metadata | JSONB | DEFAULT '{}'::jsonb |
| reported_at | TIMESTAMPTZ | DEFAULT now() |

### webhook_endpoints
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL |
| provider | webhook_provider | DEFAULT 'slack' |
| url | TEXT | NOT NULL |
| is_active | BOOLEAN | DEFAULT TRUE |
| min_severity | alert_severity | DEFAULT 'critical' |
| created_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### webhook_deliveries
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| endpoint_id | UUID | NOT NULL, REFERENCES webhook_endpoints(id) ON DELETE CASCADE |
| alert_id | UUID | REFERENCES alerts(id) ON DELETE SET NULL |
| status | webhook_delivery_status | DEFAULT 'pending' |
| attempts | INT | DEFAULT 0 |
| last_error | TEXT | |
| payload | JSONB | DEFAULT '{}'::jsonb |
| sent_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

### screenshot_retention_policies
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| singleton | BOOLEAN | DEFAULT TRUE, UNIQUE |
| retention_days | INT | DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650) |
| auto_purge_enabled | BOOLEAN | DEFAULT TRUE |
| updated_by | UUID | |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### screenshot_deletions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| screenshot_path | TEXT | NOT NULL |
| activity_event_id | UUID | |
| device_id | UUID | |
| reason | TEXT | DEFAULT 'auto_retention' |
| deleted_by | UUID | |
| deleted_at | TIMESTAMPTZ | DEFAULT now() |

### db_snapshots
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK DEFAULT gen_random_uuid() |
| label | TEXT | NOT NULL |
| notes | TEXT | |
| status | snapshot_status | DEFAULT 'pending' |
| size_bytes | BIGINT | |
| storage_path | TEXT | |
| table_counts | JSONB | DEFAULT '{}'::jsonb |
| created_by | UUID | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| restored_at | TIMESTAMPTZ | |

---

## 3. INDEXES (Performance Critical)

Create these indexes:
- `idx_devices_user_id` ON devices(user_id)
- `idx_domains_device_id` ON domains(device_id)
- `idx_domains_scope` ON domains(scope)
- `idx_downloads_device_id` ON downloads(device_id)
- `idx_alerts_user_id` ON alerts(user_id)
- `idx_alerts_device_id` ON alerts(device_id)
- `idx_alerts_created_at` ON alerts(created_at DESC)
- `idx_requests_user_id` ON requests(user_id)
- `idx_requests_status` ON requests(status)
- `idx_activity_events_occurred` ON activity_events(occurred_at DESC)
- `idx_activity_events_device` ON activity_events(device_id, occurred_at DESC)
- `idx_activity_events_user` ON activity_events(user_id, occurred_at DESC)
- `idx_violation_events_device_time` ON violation_events(device_id, occurred_at DESC)
- `idx_device_commands_device_status` ON device_commands(device_id, status)
- `idx_screen_sessions_device` ON screen_sessions(device_id, created_at DESC)
- `idx_screen_sessions_user` ON screen_sessions(user_id, created_at DESC)
- `idx_device_tasks_device` ON device_tasks(device_id, reported_at DESC)
- `idx_device_tasks_pid` ON device_tasks(device_id, pid)
- `idx_file_integrity_device` ON file_integrity(device_id)
- `idx_heartbeats_device_time` ON agent_heartbeats(device_id, reported_at DESC)
- `idx_heartbeats_user_time` ON agent_heartbeats(user_id, reported_at DESC)
- `idx_webhook_deliveries_status` ON webhook_deliveries(status, created_at)
- `idx_screenshot_deletions_time` ON screenshot_deletions(deleted_at DESC)

---

## 4. FUNCTIONS

### update_updated_at_column()
Standard updated_at trigger function.

### has_role(_user_id UUID, _role app_role)
Security definer function that checks if a user has a specific role. Returns BOOLEAN. Used extensively in RLS policies to avoid recursion.

### get_device_online_status(_last_seen TIMESTAMPTZ)
Returns TEXT: 'offline' if _last_seen IS NULL or older than 2 minutes, else 'online'.

### purge_expired_screenshots()
Returns INT. Reads screenshot_retention_policies singleton row. If auto_purge_enabled, loops through activity_events with screenshot_path NOT NULL and occurred_at older than retention_days. For each, inserts into screenshot_deletions and sets screenshot_path to NULL. Returns count of purged rows.

### enqueue_webhook_deliveries()
Trigger function (SECURITY DEFINER). On INSERT into alerts, loops through active webhook_endpoints. Compares alert severity rank (info=0, warning=1, critical=2) against endpoint min_severity rank. If alert severity >= endpoint min_severity, inserts into webhook_deliveries with JSONB payload containing action_type, target, severity, created_at, device_id.

### handle_new_user()
Trigger function on auth.users INSERT. Creates profile row with username from raw_user_meta_data or email prefix. Assigns default 'user' role in user_roles.

---

## 5. TRIGGERS

Create `BEFORE UPDATE` triggers on ALL tables with `updated_at` column to call `update_updated_at_column()`:
- profiles, devices, domains, downloads, requests, process_blacklist, app_settings, policy_schedules, auto_response_rules, webhook_endpoints, device_commands, screen_sessions

Create `AFTER INSERT` trigger on auth.users calling `handle_new_user()`.

Create `AFTER INSERT` trigger on alerts calling `enqueue_webhook_deliveries()`.

---

## 6. ROW LEVEL SECURITY (RLS) — COMPLETE POLICIES

**Enable RLS on ALL tables.**

### profiles
- SELECT: authenticated can read all profiles
- UPDATE: users can update own; admins can update any

### user_roles
- SELECT: users read own; admins read all
- INSERT/UPDATE/DELETE: admin only

### devices
- SELECT: users read own; admins read all
- INSERT: users insert own
- UPDATE: users update own; admins update any
- DELETE: users delete own; admins delete any

### domains
- SELECT: all authenticated
- INSERT/UPDATE/DELETE: admin only

### downloads
- SELECT: all authenticated
- INSERT/UPDATE/DELETE: admin only

### process_blacklist
- SELECT: all authenticated
- INSERT/UPDATE/DELETE: admin only

### app_settings
- SELECT: all authenticated
- INSERT/UPDATE: admin only

### alerts
- SELECT: users read own; admins read all
- INSERT: authenticated insert own

### requests
- SELECT: users read own; admins read all
- INSERT: users create own
- UPDATE: admin only (for review)

### activity_events
- SELECT: users read own; admins read all
- INSERT: authenticated insert own
- UPDATE: admin only (for purge function)

### violation_events
- SELECT: users read own; admins read all
- INSERT: authenticated insert own

### policy_schedules
- SELECT: all authenticated
- INSERT/UPDATE/DELETE: admin only

### auto_response_rules
- SELECT: all authenticated
- INSERT/UPDATE/DELETE: admin only

### device_commands
- SELECT: admin read all; device owners read own via EXISTS subquery on devices
- UPDATE: admin update all; device owners update own
- INSERT: admin only

### screen_sessions
- SELECT: admin read all; users read own
- INSERT/UPDATE: admin only

### device_tasks
- SELECT: admin read all; users read own
- INSERT: authenticated insert own

### file_integrity
- SELECT: admin read all; users read own
- INSERT: authenticated insert own

### agent_heartbeats
- SELECT: admin read all; users read own
- INSERT: users insert own

### webhook_endpoints
- ALL: admin only

### webhook_deliveries
- SELECT: admin only

### screenshot_retention_policies
- SELECT: all authenticated
- ALL: admin only

### screenshot_deletions
- SELECT/INSERT: admin only

### db_snapshots
- ALL: admin only

---

## 7. REALTIME PUBLICATIONS

Add ALL of these tables to `supabase_realtime` publication:
`devices`, `alerts`, `domains`, `downloads`, `app_settings`, `process_blacklist`, `policy_schedules`, `auto_response_rules`, `violation_events`, `device_commands`, `activity_events`, `screen_sessions`, `device_tasks`, `file_integrity`

Set `REPLICA IDENTITY FULL` on all of them.

---

## 8. STORAGE

### Buckets
Create bucket `violation-screenshots` (private, NOT public).

### Storage RLS Policies on `storage.objects`
- SELECT: bucket_id = 'violation-screenshots' AND (admin OR auth.uid()::text = storage.foldername(name)[1])
- INSERT: bucket_id = 'violation-screenshots' AND (admin OR auth.uid()::text = storage.foldername(name)[1])

---

## 9. CRON JOBS (Requires pg_cron extension)

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

1. **sentinel-retention-purge**: `0 3 * * *` → `SELECT public.purge_expired_screenshots();`
2. **sentinel-webhook-sweeper**: `*/15 * * * *` → Update webhook_deliveries status='failed' where pending and older than 1 hour
3. **sentinel-webhook-dispatch**: `*/5 * * * *` → HTTP POST to `/api/public/dispatch-webhooks` (use net.http_post)

---

## 10. SEED DATA

Insert default app_settings singleton: `(true, true, true, true)`
Insert default screenshot_retention_policies: `(true, 30, true)`
Insert process_blacklist seeds:
- `('utorrent.exe', 'BitTorrent client', true)`
- `('bittorrent.exe', 'BitTorrent client', true)`
- `('qbittorrent.exe', 'BitTorrent client', true)`
- `('teamviewer.exe', 'Remote access tool', true)`
- `('anydesk.exe', 'Remote access tool', true)`
- `('tor.exe', 'Tor browser', true)`
- `('cmd.exe', 'Command prompt', false)`

Use `ON CONFLICT DO NOTHING` for all seeds.

---

## 11. REALTIME MESSAGE RLS (Advanced)

On `realtime.messages`, enable RLS and create:
- SELECT policy: admin can listen to everything; users can listen to `user:<uid>` topic; users can listen to `device:<device_id>` topics where they own the device; everyone authenticated can listen to `public:settings`
- INSERT policy: same logic as SELECT but for broadcasting

---

## OUTPUT FORMAT

Return the complete SQL as a single code block. Do NOT split into multiple files. Every CREATE statement must use IF NOT EXISTS or OR REPLACE. Include comments separating each section. The SQL must be runnable top-to-bottom in the Supabase SQL Editor without errors.

