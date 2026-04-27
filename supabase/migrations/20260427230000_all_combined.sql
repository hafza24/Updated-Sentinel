-- ============================================================
-- Sentinel Net v4.0.0 — Complete Database Schema
-- Apply this via Supabase Dashboard SQL Editor
-- ============================================================

-- 1. NEW ENUMS
CREATE TYPE IF NOT EXISTS public.violation_source AS ENUM ('domain', 'download', 'process');
CREATE TYPE IF NOT EXISTS public.webhook_provider AS ENUM ('slack', 'discord', 'generic');
CREATE TYPE IF NOT EXISTS public.webhook_delivery_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE IF NOT EXISTS public.watchdog_status AS ENUM ('healthy', 'degraded', 'down', 'unknown');
CREATE TYPE IF NOT EXISTS public.snapshot_status AS ENUM ('pending', 'ready', 'failed', 'restored');
CREATE TYPE IF NOT EXISTS public.schedule_target_type AS ENUM ('domain', 'process');
CREATE TYPE IF NOT EXISTS public.auto_response_trigger AS ENUM ('violation_count', 'single_violation');
CREATE TYPE IF NOT EXISTS public.auto_response_action AS ENUM ('log_only', 'temp_block_all', 'disable_network', 'lock_device');

-- 2. EXTENDED DEVICE COMMANDS ENUM
DO $$
BEGIN
  -- Drop and recreate with new values if needed
  DROP TYPE IF EXISTS public.device_command_type CASCADE;
  CREATE TYPE public.device_command_type AS ENUM (
    'lock_device', 'restart_agent', 'force_sync',
    'disable_network', 'enable_network',
    'shutdown_device', 'kill_process',
    'start_stream', 'stop_stream'
  );
END $$;

-- 3. SCREEN SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.screen_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  ws_endpoint TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.screen_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read screen_sessions" ON public.screen_sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own screen_sessions" ON public.screen_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_screen_sessions_device ON public.screen_sessions(device_id, status);

-- 4. DEVICE TASKS TABLE
CREATE TABLE IF NOT EXISTS public.device_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  pid INTEGER NOT NULL,
  process_name TEXT NOT NULL,
  cpu_percent NUMERIC(5,2),
  memory_mb NUMERIC(8,2),
  status TEXT NOT NULL DEFAULT 'running',
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.device_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read device_tasks" ON public.device_tasks
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own device_tasks" ON public.device_tasks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_device_tasks_device ON public.device_tasks(device_id, reported_at DESC);

-- 5. WEBHOOK TABLES
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  provider public.webhook_provider NOT NULL DEFAULT 'slack',
  url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  min_severity public.alert_severity NOT NULL DEFAULT 'critical',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  alert_id UUID REFERENCES public.alerts(id) ON DELETE SET NULL,
  status public.webhook_delivery_status NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries ON public.webhook_deliveries(status, created_at);

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage webhook_endpoints" ON public.webhook_endpoints
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read webhook_deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 6. AGENT HEARTBEATS
CREATE TABLE IF NOT EXISTS public.agent_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  uptime_seconds BIGINT NOT NULL DEFAULT 0,
  agent_version TEXT,
  watchdog_status public.watchdog_status NOT NULL DEFAULT 'unknown',
  cpu_percent NUMERIC(5,2),
  memory_mb INT,
  last_sync_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read heartbeats" ON public.agent_heartbeats
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own heartbeats" ON public.agent_heartbeats
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats ON public.agent_heartbeats(device_id, reported_at DESC);

-- 7. SCREENSHOT RETENTION
CREATE TABLE IF NOT EXISTS public.screenshot_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  retention_days INT NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  auto_purge_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.screenshot_retention_policies (singleton, retention_days)
VALUES (true, 30) ON CONFLICT DO NOTHING;
ALTER TABLE public.screenshot_retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage retention" ON public.screenshot_retention_policies
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Read retention policy" ON public.screenshot_retention_policies
  FOR SELECT TO authenticated USING (true);

-- 8. SCREENSHOT DELETIONS LOG
CREATE TABLE IF NOT EXISTS public.screenshot_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screenshot_path TEXT NOT NULL,
  activity_event_id UUID,
  device_id UUID,
  reason TEXT NOT NULL DEFAULT 'auto_retention',
  deleted_by UUID,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.screenshot_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read deletions" ON public.screenshot_deletions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 9. DB SNAPSHOTS
CREATE TABLE IF NOT EXISTS public.db_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  notes TEXT,
  status public.snapshot_status NOT NULL DEFAULT 'pending',
  size_bytes BIGINT,
  storage_path TEXT,
  table_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at TIMESTAMPTZ
);
ALTER TABLE public.db_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage snapshots" ON public.db_snapshots
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 10. DEVICE COMMANDS TABLE (recreate with new enum)
CREATE TABLE IF NOT EXISTS public.device_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  command_type public.device_command_type NOT NULL,
  status public.device_command_status NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result TEXT,
  issued_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage commands" ON public.device_commands
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 11. REALTIME PUBLICATIONS
ALTER PUBLICATION supabase_realtime ADD TABLE public.screen_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_heartbeats;

-- 12. WEBHOOK TRIGGER
CREATE OR REPLACE FUNCTION public.enqueue_webhook_deliveries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ep RECORD;
  severity_rank INT;
  endpoint_rank INT;
BEGIN
  severity_rank := CASE NEW.severity WHEN 'info' THEN 0 WHEN 'warning' THEN 1 WHEN 'critical' THEN 2 END;
  FOR ep IN SELECT * FROM public.webhook_endpoints WHERE is_active LOOP
    endpoint_rank := CASE ep.min_severity WHEN 'info' THEN 0 WHEN 'warning' THEN 1 WHEN 'critical' THEN 2 END;
    IF severity_rank >= endpoint_rank THEN
      INSERT INTO public.webhook_deliveries (endpoint_id, alert_id, payload)
      VALUES (ep.id, NEW.id, jsonb_build_object(
        'action_type', NEW.action_type,
        'target', NEW.target,
        'severity', NEW.severity,
        'created_at', NEW.created_at,
        'device_id', NEW.device_id
      ));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alerts_enqueue_webhook ON public.alerts;
CREATE TRIGGER trg_alerts_enqueue_webhook
  AFTER INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_webhook_deliveries();

-- 13. PURGE FUNCTION
CREATE OR REPLACE FUNCTION public.purge_expired_screenshots()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pol RECORD;
  ev RECORD;
  purged INT := 0;
BEGIN
  SELECT * INTO pol FROM public.screenshot_retention_policies WHERE singleton LIMIT 1;
  IF pol IS NULL OR NOT pol.auto_purge_enabled THEN RETURN 0; END IF;
  FOR ev IN
    SELECT id, device_id, screenshot_path
    FROM public.activity_events
    WHERE screenshot_path IS NOT NULL
      AND occurred_at < now() - (pol.retention_days || ' days')::interval
  LOOP
    INSERT INTO public.screenshot_deletions (screenshot_path, activity_event_id, device_id, reason)
    VALUES (ev.screenshot_path, ev.id, ev.device_id, 'auto_retention');
    UPDATE public.activity_events SET screenshot_path = NULL WHERE id = ev.id;
    purged := purged + 1;
  END LOOP;
  RETURN purged;
END;
$$;

-- 14. STORAGE BUCKET FOR VIOLATION SCREENSHOTS
INSERT INTO storage.buckets (id, name, public) VALUES ('violation-screenshots', 'violation-screenshots', false)
  ON CONFLICT (id) DO NOTHING;

-- 15. CRON JOBS
SELECT cron.schedule('sentinel-retention-purge', '0 3 * * *', $$ SELECT public.purge_expired_screenshots(); $$);
SELECT cron.schedule('sentinel-webhook-sweeper', '*/15 * * * *', $$
  UPDATE public.webhook_deliveries SET status='failed', last_error='timeout' 
  WHERE status='pending' AND created_at < now() - interval '1 hour';
$$);
