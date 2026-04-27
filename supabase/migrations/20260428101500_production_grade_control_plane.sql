-- ============================================================
-- Sentinel Net - Production-grade control-plane fixes
-- Adds validated command payloads, 90-second heartbeat handling,
-- supporting evidence tables, and safer agent-side RLS contracts.
-- ============================================================

-- 1) Bring device_command_type in line with the frontend and agent.
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'shutdown_device';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'kill_process';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'start_stream';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'stop_stream';

-- 2) Expand screen_sessions to support validated screen-share lifecycle.
ALTER TABLE public.screen_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS frame_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bytes_transferred BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.screen_sessions AS sessions
SET user_id = devices.user_id
FROM public.devices AS devices
WHERE sessions.user_id IS NULL
  AND devices.id = sessions.device_id;

ALTER TABLE public.screen_sessions
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'screen_sessions_status_check'
      AND conrelid = 'public.screen_sessions'::regclass
  ) THEN
    ALTER TABLE public.screen_sessions
      ADD CONSTRAINT screen_sessions_status_check
      CHECK (status IN ('pending', 'active', 'stopped', 'error'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_screen_sessions_user ON public.screen_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_screen_sessions_device_status ON public.screen_sessions(device_id, status);

DROP TRIGGER IF EXISTS trg_screen_sessions_updated ON public.screen_sessions;
CREATE TRIGGER trg_screen_sessions_updated
  BEFORE UPDATE ON public.screen_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.screen_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read screen_sessions" ON public.screen_sessions;
DROP POLICY IF EXISTS "Users read own screen_sessions" ON public.screen_sessions;
DROP POLICY IF EXISTS "Admins insert screen_sessions" ON public.screen_sessions;
DROP POLICY IF EXISTS "Admins update screen_sessions" ON public.screen_sessions;
DROP POLICY IF EXISTS "Device owners update screen_sessions" ON public.screen_sessions;

CREATE POLICY "Admins read screen_sessions" ON public.screen_sessions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read own screen_sessions" ON public.screen_sessions
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.devices AS devices
      WHERE devices.id = device_id
        AND devices.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins insert screen_sessions" ON public.screen_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update screen_sessions" ON public.screen_sessions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Device owners update screen_sessions" ON public.screen_sessions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.devices AS devices
      WHERE devices.id = device_id
        AND devices.user_id = auth.uid()
    )
  );

-- 3) Expand device_tasks so agents can safely refresh task inventory.
ALTER TABLE public.device_tasks
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.device_tasks AS tasks
SET user_id = devices.user_id
FROM public.devices AS devices
WHERE tasks.user_id IS NULL
  AND devices.id = tasks.device_id;

ALTER TABLE public.device_tasks
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'device_tasks'
      AND column_name = 'memory_mb'
      AND numeric_precision <> 10
  ) THEN
    ALTER TABLE public.device_tasks
      ALTER COLUMN memory_mb TYPE NUMERIC(10,2)
      USING memory_mb::numeric(10,2);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'device_tasks_status_check'
      AND conrelid = 'public.device_tasks'::regclass
  ) THEN
    ALTER TABLE public.device_tasks
      ADD CONSTRAINT device_tasks_status_check
      CHECK (status IN ('running', 'killed', 'exited'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_device_tasks_pid ON public.device_tasks(device_id, pid);

ALTER TABLE public.device_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read device_tasks" ON public.device_tasks;
DROP POLICY IF EXISTS "Users read own device_tasks" ON public.device_tasks;
DROP POLICY IF EXISTS "Authenticated insert device_tasks" ON public.device_tasks;
DROP POLICY IF EXISTS "Device owners delete own device_tasks" ON public.device_tasks;

CREATE POLICY "Admins read device_tasks" ON public.device_tasks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read own device_tasks" ON public.device_tasks
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated insert device_tasks" ON public.device_tasks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Device owners delete own device_tasks" ON public.device_tasks
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4) Create a first-class screenshots table for evidence tracking.
CREATE TABLE IF NOT EXISTS public.screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_event_id UUID REFERENCES public.activity_events(id) ON DELETE SET NULL,
  violation_event_id UUID REFERENCES public.violation_events(id) ON DELETE SET NULL,
  bucket TEXT NOT NULL DEFAULT 'violation-screenshots',
  storage_path TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  capture_reason TEXT NOT NULL DEFAULT 'policy_violation',
  sha256 TEXT,
  file_size_bytes BIGINT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screenshots_device_captured_at ON public.screenshots(device_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_screenshots_user_captured_at ON public.screenshots(user_id, captured_at DESC);

ALTER TABLE public.screenshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read screenshots" ON public.screenshots;
DROP POLICY IF EXISTS "Device owners read screenshots" ON public.screenshots;
DROP POLICY IF EXISTS "Device owners insert screenshots" ON public.screenshots;
DROP POLICY IF EXISTS "Device owners update screenshots" ON public.screenshots;

CREATE POLICY "Admins read screenshots" ON public.screenshots
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Device owners read screenshots" ON public.screenshots
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Device owners insert screenshots" ON public.screenshots
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Device owners update screenshots" ON public.screenshots
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- 5) Restore the missing file_integrity table with a usable ownership model.
CREATE TABLE IF NOT EXISTS public.file_integrity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  expected_sha256 TEXT NOT NULL,
  last_verified_at TIMESTAMPTZ,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  repair_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_integrity_device ON public.file_integrity(device_id);

ALTER TABLE public.file_integrity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read file_integrity" ON public.file_integrity;
DROP POLICY IF EXISTS "Users read own file_integrity" ON public.file_integrity;
DROP POLICY IF EXISTS "Authenticated insert file_integrity" ON public.file_integrity;
DROP POLICY IF EXISTS "Device owners update file_integrity" ON public.file_integrity;

CREATE POLICY "Admins read file_integrity" ON public.file_integrity
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read own file_integrity" ON public.file_integrity
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated insert file_integrity" ON public.file_integrity
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Device owners update file_integrity" ON public.file_integrity
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- 6) Activity events need explicit screenshot linkage for retention + UI.
ALTER TABLE public.activity_events
  ADD COLUMN IF NOT EXISTS screenshot_bucket TEXT NOT NULL DEFAULT 'violation-screenshots',
  ADD COLUMN IF NOT EXISTS screenshot_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS screenshot_id UUID REFERENCES public.screenshots(id) ON DELETE SET NULL;

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins update activity_events" ON public.activity_events;

CREATE POLICY "Admins update activity_events" ON public.activity_events
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 7) Validate command payloads at the database boundary.
CREATE OR REPLACE FUNCTION public.validate_device_command_payload(
  _command_type public.device_command_type,
  _payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  payload JSONB := COALESCE(_payload, '{}'::jsonb);
  pid_value INTEGER;
  fps_value INTEGER;
  quality_value INTEGER;
  grace_value INTEGER;
BEGIN
  IF jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'device command payload must be a JSON object';
  END IF;

  CASE _command_type
    WHEN 'force_sync' THEN
      RETURN;
    WHEN 'restart_agent' THEN
      RETURN;
    WHEN 'lock_device' THEN
      RETURN;
    WHEN 'stop_stream' THEN
      RETURN;

    WHEN 'shutdown_device' THEN
      IF payload ? 'grace_seconds' THEN
        grace_value := (payload->>'grace_seconds')::INTEGER;
        IF grace_value < 0 OR grace_value > 300 THEN
          RAISE EXCEPTION 'shutdown_device grace_seconds must be between 0 and 300';
        END IF;
      END IF;
      RETURN;

    WHEN 'kill_process' THEN
      IF NOT payload ? 'pid' THEN
        RAISE EXCEPTION 'kill_process requires payload.pid';
      END IF;
      pid_value := (payload->>'pid')::INTEGER;
      IF pid_value <= 0 THEN
        RAISE EXCEPTION 'kill_process payload.pid must be a positive integer';
      END IF;
      RETURN;

    WHEN 'start_stream' THEN
      IF NOT payload ? 'session_id' THEN
        RAISE EXCEPTION 'start_stream requires payload.session_id';
      END IF;

      IF payload ? 'max_fps' THEN
        fps_value := (payload->>'max_fps')::INTEGER;
        IF fps_value < 1 OR fps_value > 5 THEN
          RAISE EXCEPTION 'start_stream max_fps must be between 1 and 5';
        END IF;
      END IF;

      IF payload ? 'jpeg_quality' THEN
        quality_value := (payload->>'jpeg_quality')::INTEGER;
        IF quality_value < 35 OR quality_value > 85 THEN
          RAISE EXCEPTION 'start_stream jpeg_quality must be between 35 and 85';
        END IF;
      END IF;
      RETURN;

    ELSE
      RAISE EXCEPTION 'unsupported device command type: %', _command_type;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_validate_device_command_payload()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.payload := COALESCE(NEW.payload, '{}'::jsonb);
  PERFORM public.validate_device_command_payload(NEW.command_type, NEW.payload);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_device_command_payload ON public.device_commands;
CREATE TRIGGER trg_validate_device_command_payload
  BEFORE INSERT OR UPDATE OF command_type, payload
  ON public.device_commands
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_device_command_payload();

DROP TRIGGER IF EXISTS trg_device_commands_updated_at ON public.device_commands;
CREATE TRIGGER trg_device_commands_updated_at
  BEFORE UPDATE ON public.device_commands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8) Keep device last_seen/status synchronized with heartbeats.
CREATE OR REPLACE FUNCTION public.sync_device_from_heartbeat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.devices
  SET
    last_seen = GREATEST(COALESCE(last_seen, NEW.reported_at), NEW.reported_at),
    status = CASE WHEN status = 'disabled' THEN status ELSE 'active'::public.device_status END,
    agent_version = COALESCE(NEW.agent_version, agent_version),
    updated_at = now()
  WHERE id = NEW.device_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_heartbeats_sync_device ON public.agent_heartbeats;
CREATE TRIGGER trg_agent_heartbeats_sync_device
  AFTER INSERT ON public.agent_heartbeats
  FOR EACH ROW EXECUTE FUNCTION public.sync_device_from_heartbeat();

CREATE OR REPLACE FUNCTION public.mark_stale_devices_offline(
  _stale_after INTERVAL DEFAULT interval '90 seconds'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER := 0;
BEGIN
  UPDATE public.devices
  SET
    status = 'inactive'::public.device_status,
    updated_at = now()
  WHERE status <> 'disabled'::public.device_status
    AND (last_seen IS NULL OR last_seen < now() - _stale_after);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_device_online_status(
  _status public.device_status,
  _last_seen TIMESTAMPTZ,
  _stale_after INTERVAL DEFAULT interval '90 seconds'
)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN _status = 'disabled' THEN 'disabled'
    WHEN _last_seen IS NULL THEN 'offline'
    WHEN _last_seen < now() - _stale_after THEN 'offline'
    ELSE 'online'
  END;
$$;

ALTER TABLE public.agent_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users insert own heartbeats" ON public.agent_heartbeats;

CREATE POLICY "Users insert own heartbeats" ON public.agent_heartbeats
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 9) Allow admin-side testing of webhook inserts and keep realtime in sync.
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins insert webhook_deliveries" ON public.webhook_deliveries;

CREATE POLICY "Admins insert webhook_deliveries" ON public.webhook_deliveries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.screen_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.device_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.file_integrity REPLICA IDENTITY FULL;
ALTER TABLE public.screenshots REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel AS publication_rel
    JOIN pg_publication AS publication ON publication.oid = publication_rel.prpubid
    JOIN pg_class AS class_info ON class_info.oid = publication_rel.prrelid
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = class_info.relnamespace
    WHERE publication.pubname = 'supabase_realtime'
      AND namespace_info.nspname = 'public'
      AND class_info.relname = 'file_integrity'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.file_integrity';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel AS publication_rel
    JOIN pg_publication AS publication ON publication.oid = publication_rel.prpubid
    JOIN pg_class AS class_info ON class_info.oid = publication_rel.prrelid
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = class_info.relnamespace
    WHERE publication.pubname = 'supabase_realtime'
      AND namespace_info.nspname = 'public'
      AND class_info.relname = 'screenshots'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.screenshots';
  END IF;
END $$;

-- 10) Update retention to purge the new linkage fields as well.
CREATE OR REPLACE FUNCTION public.purge_expired_screenshots()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  policy_row RECORD;
  event_row RECORD;
  purged_count INT := 0;
  storage_path TEXT;
BEGIN
  SELECT * INTO policy_row
  FROM public.screenshot_retention_policies
  WHERE singleton
  LIMIT 1;

  IF policy_row IS NULL OR NOT policy_row.auto_purge_enabled THEN
    RETURN 0;
  END IF;

  FOR event_row IN
    SELECT id, device_id, screenshot_path, screenshot_storage_path, screenshot_id
    FROM public.activity_events
    WHERE (
      screenshot_path IS NOT NULL
      OR screenshot_storage_path IS NOT NULL
      OR screenshot_id IS NOT NULL
    )
      AND occurred_at < now() - make_interval(days => policy_row.retention_days)
  LOOP
    storage_path := COALESCE(event_row.screenshot_storage_path, event_row.screenshot_path);

    IF storage_path IS NOT NULL THEN
      INSERT INTO public.screenshot_deletions (screenshot_path, activity_event_id, device_id, reason)
      VALUES (storage_path, event_row.id, event_row.device_id, 'auto_retention');
    END IF;

    UPDATE public.activity_events
    SET
      screenshot_path = NULL,
      screenshot_storage_path = NULL,
      screenshot_id = NULL
    WHERE id = event_row.id;

    IF event_row.screenshot_id IS NOT NULL THEN
      DELETE FROM public.screenshots
      WHERE id = event_row.screenshot_id;
    END IF;

    purged_count := purged_count + 1;
  END LOOP;

  RETURN purged_count;
END;
$$;

-- 11) Enforce the 90-second offline window from the backend as well.
DO $$
DECLARE
  stale_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO stale_job_id
  FROM cron.job
  WHERE jobname = 'sentinel-mark-stale-devices-offline'
  LIMIT 1;

  IF stale_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(stale_job_id);
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'sentinel-mark-stale-devices-offline',
  '* * * * *',
  $$ SELECT public.mark_stale_devices_offline(interval '90 seconds'); $$
);
