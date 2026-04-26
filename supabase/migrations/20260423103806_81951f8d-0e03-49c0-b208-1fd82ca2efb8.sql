-- Required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- 1. Webhook notifications
-- ============================================================
CREATE TYPE public.webhook_provider AS ENUM ('slack', 'discord', 'generic');
CREATE TYPE public.webhook_delivery_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE public.webhook_endpoints (
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

CREATE TABLE public.webhook_deliveries (
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
CREATE INDEX idx_webhook_deliveries_status ON public.webhook_deliveries(status, created_at);

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage webhook_endpoints" ON public.webhook_endpoints
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins read webhook_deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_webhook_endpoints_updated
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-enqueue deliveries when a critical alert lands
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

CREATE TRIGGER trg_alerts_enqueue_webhook
  AFTER INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_webhook_deliveries();

-- ============================================================
-- 2. Agent heartbeats
-- ============================================================
CREATE TYPE public.watchdog_status AS ENUM ('healthy', 'degraded', 'down', 'unknown');

CREATE TABLE public.agent_heartbeats (
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
CREATE INDEX idx_heartbeats_device_time ON public.agent_heartbeats(device_id, reported_at DESC);
CREATE INDEX idx_heartbeats_user_time ON public.agent_heartbeats(user_id, reported_at DESC);

ALTER TABLE public.agent_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all heartbeats" ON public.agent_heartbeats
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read own heartbeats" ON public.agent_heartbeats
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own heartbeats" ON public.agent_heartbeats
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. Screenshot retention
-- ============================================================
CREATE TABLE public.screenshot_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  retention_days INT NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  auto_purge_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.screenshot_retention_policies (singleton, retention_days)
VALUES (true, 30) ON CONFLICT DO NOTHING;

CREATE TABLE public.screenshot_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screenshot_path TEXT NOT NULL,
  activity_event_id UUID,
  device_id UUID,
  reason TEXT NOT NULL DEFAULT 'auto_retention',
  deleted_by UUID,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_screenshot_deletions_time ON public.screenshot_deletions(deleted_at DESC);

ALTER TABLE public.screenshot_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenshot_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage retention policy" ON public.screenshot_retention_policies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read retention policy" ON public.screenshot_retention_policies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins read deletions" ON public.screenshot_deletions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert deletions" ON public.screenshot_deletions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Function executed by cron to mark expired screenshots and log them
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

-- Allow UPDATE on activity_events for the purge function (admin-only via RLS)
CREATE POLICY "Admins update activity_events" ON public.activity_events
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 4. DB snapshots registry
-- ============================================================
CREATE TYPE public.snapshot_status AS ENUM ('pending', 'ready', 'failed', 'restored');

CREATE TABLE public.db_snapshots (
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
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 5. Cron jobs
-- ============================================================
-- Nightly retention purge at 03:00 UTC
SELECT cron.schedule(
  'sentinel-retention-purge',
  '0 3 * * *',
  $$ SELECT public.purge_expired_screenshots(); $$
);

-- Snapshot deliveries that have been pending > 1 hour as failed (sweeper)
SELECT cron.schedule(
  'sentinel-webhook-sweeper',
  '*/15 * * * *',
  $$ UPDATE public.webhook_deliveries
       SET status='failed', last_error='timeout'
     WHERE status='pending' AND created_at < now() - interval '1 hour'; $$
);