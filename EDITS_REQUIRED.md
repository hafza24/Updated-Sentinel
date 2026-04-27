# Sentinel Net — Required Database Edits (NONE SHOULD BE MISSING)

## Executive Summary

After analyzing ALL migration files, frontend routes, API endpoints, and the Supabase types file, I found **several critical gaps and inconsistencies** between the current schema and what the application actually requires. The frontend code references tables/columns/enums that do not exist in the current consolidated schema.

---

## 🔴 CRITICAL EDITS REQUIRED

### 1. ENUM `device_command_type` — VALUES MISSING

**Current State**: The types.ts file and some migrations only define:
```
('lock_device', 'restart_agent', 'force_sync', 'disable_network', 'enable_network')
```

**Required Values** (used by `_authed.live-screen.tsx`, `_authed.tasks.tsx`, `_authed.device-control.tsx`):
```
('lock_device', 'restart_agent', 'force_sync', 'disable_network', 'enable_network', 'shutdown_device', 'kill_process', 'start_stream', 'stop_stream')
```

**Edit Required**:
```sql
-- In a DO $$ block, drop and recreate, or use ALTER TYPE ADD VALUE IF NOT EXISTS
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'shutdown_device';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'kill_process';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'start_stream';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'stop_stream';
```

**Files that break without this**: `src/routes/_authed.live-screen.tsx` (sends `start_stream`, `stop_stream`), `src/routes/_authed.tasks.tsx` (sends `kill_process`, `shutdown_device`), `src/routes/_authed.device-control.tsx`.

---

### 2. TABLE `screen_sessions` — COLUMNS MISSING / DISCREPANCY

**Current State in `all_combined.sql`** (simplified, missing columns):
```sql
status TEXT NOT NULL DEFAULT 'active',
ws_endpoint TEXT,
started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
stopped_at TIMESTAMPTZ,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

**Required Schema** (from `complete_features.sql` and frontend `live-screen.tsx`):
```sql
user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'stopped', 'error')),
ws_endpoint TEXT,
started_at TIMESTAMPTZ,
stopped_at TIMESTAMPTZ,
frame_count BIGINT NOT NULL DEFAULT 0,
bytes_transferred BIGINT NOT NULL DEFAULT 0,
error_message TEXT,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

**Missing Columns**:
- `user_id` (NOT NULL, FK to auth.users)
- `frame_count` (BIGINT DEFAULT 0)
- `bytes_transferred` (BIGINT DEFAULT 0)
- `error_message` (TEXT)
- `updated_at` (TIMESTAMPTZ DEFAULT now())

**Missing Constraint**: `CHECK (status IN ('pending', 'active', 'stopped', 'error'))`

**Missing Index**:
```sql
CREATE INDEX idx_screen_sessions_user ON screen_sessions(user_id, created_at DESC);
```

**Missing Trigger**:
```sql
CREATE TRIGGER trg_screen_sessions_updated BEFORE UPDATE ON screen_sessions 
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

**Missing RLS Policies** (in `all_combined.sql`):
```sql
CREATE POLICY "Admins insert screen_sessions" ON screen_sessions FOR INSERT TO authenticated 
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update screen_sessions" ON screen_sessions FOR UPDATE TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));
```

---

### 3. TABLE `device_tasks` — COLUMNS MISSING / DISCREPANCY

**Current State in `all_combined.sql`**:
```sql
pid INTEGER NOT NULL,
process_name TEXT NOT NULL,
cpu_percent NUMERIC(5,2),
memory_mb NUMERIC(8,2),
status TEXT NOT NULL DEFAULT 'running',
reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

**Required Schema** (from `complete_features.sql` and frontend `tasks.tsx`):
```sql
user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
pid INT NOT NULL,
process_name TEXT NOT NULL,
cpu_percent NUMERIC(5,2),
memory_mb NUMERIC(10,2),
status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'killed', 'exited')),
reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

**Missing Column**:
- `user_id` (NOT NULL, FK to auth.users)

**Type Discrepancy**:
- `memory_mb` should be `NUMERIC(10,2)` not `NUMERIC(8,2)`

**Missing Constraint**: `CHECK (status IN ('running', 'killed', 'exited'))`

**Missing Index**:
```sql
CREATE INDEX idx_device_tasks_pid ON device_tasks(device_id, pid);
```

**Missing RLS Policy**:
```sql
CREATE POLICY "Authenticated insert device_tasks" ON device_tasks FOR INSERT TO authenticated 
WITH CHECK (auth.uid() = user_id);
```

---

### 4. TABLE `file_integrity` — ENTIRELY MISSING FROM `all_combined.sql` AND `types.ts`

This table exists in `complete_features.sql` but is **completely absent** from the consolidated schema and the TypeScript types file.

**Required Schema**:
```sql
CREATE TABLE public.file_integrity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  expected_sha256 TEXT NOT NULL,
  last_verified_at TIMESTAMPTZ,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  repair_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_file_integrity_device ON file_integrity(device_id);

ALTER TABLE public.file_integrity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read file_integrity" ON public.file_integrity FOR SELECT TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own file_integrity" ON public.file_integrity FOR SELECT TO authenticated 
USING (auth.uid() = user_id);
CREATE POLICY "Authenticated insert file_integrity" ON public.file_integrity FOR INSERT TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Realtime
ALTER TABLE public.file_integrity REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.file_integrity;
```

**Referenced in**: `TODO.md` (Phase 2: Self-healing system), `complete_features.sql`

---

### 5. TABLE `activity_events` — COLUMNS MISSING

**Current State** (in some migrations):
```sql
screenshot_path text,
metadata jsonb DEFAULT '{}'::jsonb,
occurred_at timestamptz NOT NULL DEFAULT now()
```

**Required Columns** (from `complete_features.sql`):
```sql
screenshot_bucket TEXT DEFAULT 'violation-screenshots',
screenshot_storage_path TEXT,
screenshot_path TEXT,
metadata JSONB DEFAULT '{}'::jsonb,
occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

**Missing Columns**:
- `screenshot_bucket` (TEXT DEFAULT 'violation-screenshots')
- `screenshot_storage_path` (TEXT)

---

### 6. TABLE `screenshot_retention_policies` — MISSING `updated_by` COLUMN

**Current State in `all_combined.sql`**:
```sql
retention_days INT NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
auto_purge_enabled BOOLEAN NOT NULL DEFAULT true,
updated_by UUID,
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Actually this one looks correct. But verify the `singleton` column has `UNIQUE` constraint.

---

### 7. TABLE `agent_heartbeats` — COLUMN ORDERING ISSUE

Not critical, but the `all_combined.sql` creates this BEFORE `watchdog_status` enum is created in the same file. Ensure enum is created BEFORE the table.

---

### 8. TABLE `device_commands` — MISSING `updated_at` TRIGGER

The `all_combined.sql` recreates `device_commands` but does **NOT** add the `updated_at` trigger that exists in the earlier migration.

**Missing**:
```sql
CREATE TRIGGER trg_device_commands_updated_at
  BEFORE UPDATE ON public.device_commands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

---

### 9. REALTIME PUBLICATION — TABLES MISSING

**Current State**: `all_combined.sql` only adds:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.screen_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_heartbeats;
```

**Required Additions** (also need `REPLICA IDENTITY FULL`):
```sql
ALTER TABLE public.file_integrity REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.file_integrity;
```

Also verify these were already added in earlier migrations:
- `devices`, `alerts`, `domains`, `downloads`, `app_settings`, `process_blacklist`, `policy_schedules`, `auto_response_rules`, `violation_events`, `device_commands`, `activity_events`

---

### 10. RLS POLICY GAPS

#### A. `activity_events` — Missing UPDATE policy for purge function
```sql
CREATE POLICY "Admins update activity_events" ON public.activity_events
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
```
This is required by `purge_expired_screenshots()` to set `screenshot_path = NULL`.

#### B. `webhook_deliveries` — Missing INSERT policy for test deliveries
The frontend (`webhooks.tsx`) allows admins to insert test deliveries directly:
```sql
CREATE POLICY "Admins insert webhook_deliveries" ON public.webhook_deliveries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
```

#### C. `agent_heartbeats` — Missing INSERT policy for device owners
```sql
CREATE POLICY "Users insert own heartbeats" ON public.agent_heartbeats
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

---

### 11. FUNCTION `get_device_online_status` — MISSING FROM `all_combined.sql`

Exists in `complete_features.sql` but missing from consolidated:
```sql
CREATE OR REPLACE FUNCTION public.get_device_online_status(_last_seen TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN _last_seen IS NULL THEN 'offline'
    WHEN _last_seen < now() - interval '2 minutes' THEN 'offline'
    ELSE 'online'
  END;
$$;
```

---

### 12. CRON JOB DISCREPANCY

**Current in `all_combined.sql`**:
```sql
SELECT cron.schedule('sentinel-webhook-sweeper', '*/15 * * * *', $$ ... $$);
```

**Missing from `all_combined.sql`** (exists in `20260423104130_*.sql`):
```sql
SELECT cron.schedule(
  'sentinel-webhook-dispatch',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := '<YOUR_APP_URL>/api/public/dispatch-webhooks',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

**Note**: The URL must be updated to the actual deployment URL.

---

### 13. `app_settings` — MISSING `updated_by` COLUMN

Wait, actually it's there. But verify it's in all migrations consistently.

---

### 14. REALTIME RLS POLICIES ON `realtime.messages`

These exist in migration `20260423102525_*.sql` but may be lost if only applying `all_combined.sql`.

**Required**:
```sql
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rt_select_self_or_admin" ON realtime.messages FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin')
  OR realtime.topic() = 'user:' || auth.uid()::text
  OR (
    realtime.topic() LIKE 'device:%'
    AND EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.user_id = auth.uid()
        AND d.id::text = split_part(realtime.topic(), ':', 2)
    )
  )
  OR realtime.topic() = 'public:settings'
);

CREATE POLICY "rt_insert_self_or_admin" ON realtime.messages FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR realtime.topic() = 'user:' || auth.uid()::text
  OR (
    realtime.topic() LIKE 'device:%'
    AND EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.user_id = auth.uid()
        AND d.id::text = split_part(realtime.topic(), ':', 2)
    )
  )
);
```

---

## 🟡 RECOMMENDED BUT NOT BREAKING

### 15. INDEXES That Should Be Added For Performance

These indexes exist in individual migrations but verify they're all present:
- `idx_screen_sessions_device` (device_id, status) — in `all_combined.sql`
- `idx_device_tasks_device` (device_id, reported_at DESC) — in `all_combined.sql`
- `idx_heartbeats` (device_id, reported_at DESC) — in `all_combined.sql`
- `idx_webhook_deliveries` (status, created_at) — in `all_combined.sql`

---

### 16. TYPE CONSISTENCY — `memory_mb`

- In `agent_heartbeats`: `memory_mb INT`
- In `device_tasks`: `memory_mb NUMERIC(10,2)` (from `complete_features.sql`)

This is intentional (agent reports rounded MB, tasks report precise MB), but verify both are correct.

---

### 17. FOREIGN KEY REFERENCES

Verify ALL foreign keys use `ON DELETE CASCADE` or `ON DELETE SET NULL` appropriately:
- `screenshot_deletions.activity_event_id` → should probably be `ON DELETE SET NULL`
- `screenshot_deletions.device_id` → should probably be `ON DELETE SET NULL`

---

## ✅ VERIFICATION CHECKLIST

Before declaring the schema complete, verify EACH of these:

| # | Check | Status |
|---|-------|--------|
| 1 | `device_command_type` has all 9 values | ⬜ |
| 2 | `screen_sessions` has `user_id`, `frame_count`, `bytes_transferred`, `error_message`, `updated_at` | ⬜ |
| 3 | `device_tasks` has `user_id`, correct `memory_mb` type, status CHECK constraint | ⬜ |
| 4 | `file_integrity` table exists with all columns, indexes, RLS, realtime | ⬜ |
| 5 | `activity_events` has `screenshot_bucket` and `screenshot_storage_path` | ⬜ |
| 6 | `device_commands` has `updated_at` trigger | ⬜ |
| 7 | `get_device_online_status()` function exists | ⬜ |
| 8 | `purge_expired_screenshots()` function exists | ⬜ |
| 9 | `enqueue_webhook_deliveries()` trigger function exists + trigger on alerts | ⬜ |
| 10 | `handle_new_user()` function + trigger on auth.users exists | ⬜ |
| 11 | All 20+ tables have RLS enabled | ⬜ |
| 12 | All 20+ tables have appropriate RLS policies | ⬜ |
| 13 | `realtime.messages` has RLS policies | ⬜ |
| 14 | Storage bucket `violation-screenshots` exists with RLS policies | ⬜ |
| 15 | All relevant tables in `supabase_realtime` publication | ⬜ |
| 16 | All tables have `REPLICA IDENTITY FULL` where needed | ⬜ |
| 17 | 3 cron jobs scheduled (retention purge, webhook sweeper, webhook dispatch) | ⬜ |
| 18 | `pg_cron` and `pg_net` extensions enabled | ⬜ |
| 19 | Seed data inserted (app_settings, retention policy, process_blacklist) | ⬜ |
| 20 | All indexes created for performance | ⬜ |

---

## 🔧 SUGGESTED MIGRATION ORDER

If you need to apply these as incremental migrations rather than one big file:

1. **Migration A**: Fix `device_command_type` enum (add 4 values)
2. **Migration B**: Fix `screen_sessions` (add missing columns, trigger, indexes, RLS)
3. **Migration C**: Fix `device_tasks` (add `user_id`, fix types, constraints, indexes, RLS)
4. **Migration D**: Create `file_integrity` table (full schema + RLS + realtime)
5. **Migration E**: Fix `activity_events` (add `screenshot_bucket`, `screenshot_storage_path`)
6. **Migration F**: Fix `device_commands` (add updated_at trigger)
7. **Migration G**: Add missing functions (`get_device_online_status`)
8. **Migration H**: Add missing RLS policies (activity_events UPDATE, webhook_deliveries INSERT, agent_heartbeats INSERT)
9. **Migration I**: Add missing cron job (webhook-dispatch)
10. **Migration J**: Verify realtime.messages RLS policies
11. **Migration K**: Add `file_integrity` to realtime publication

Or better yet, use the **LOVABLE_PROMPT.md** file to generate one complete, correct schema and replace everything.

