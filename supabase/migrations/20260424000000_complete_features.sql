-- ============================================================
-- SENTINEL NET — COMPLETION MIGRATION
-- Adds: screen streaming, device tasks, file integrity,
--       shutdown/kill/stream commands, self-healing tables
-- ============================================================

-- 1) Extend device_command_type enum
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'shutdown_device';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'kill_process';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'start_stream';
ALTER TYPE public.device_command_type ADD VALUE IF NOT EXISTS 'stop_stream';

-- 2) Screen streaming sessions
CREATE TABLE public.screen_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
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
);
CREATE INDEX idx_screen_sessions_device ON public.screen_sessions(device_id, created_at DESC);
CREATE INDEX idx_screen_sessions_user ON public.screen_sessions(user_id, created_at DESC);

ALTER TABLE public.screen_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read screen_sessions" ON public.screen_sessions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own screen_sessions" ON public.screen_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins insert screen_sessions" ON public.screen_sessions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update screen_sessions" ON public.screen_sessions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_screen_sessions_updated BEFORE UPDATE ON public.screen_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Device tasks (live running processes snapshot)
CREATE TABLE public.device_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pid INT NOT NULL,
  process_name TEXT NOT NULL,
  cpu_percent NUMERIC(5,2),
  memory_mb NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'killed', 'exited')),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_tasks_device ON public.device_tasks(device_id, reported_at DESC);
CREATE INDEX idx_device_tasks_pid ON public.device_tasks(device_id, pid);

ALTER TABLE public.device_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read device_tasks" ON public.device_tasks FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own device_tasks" ON public.device_tasks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Authenticated insert device_tasks" ON public.device_tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 4) File integrity (self-healing baseline)
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
CREATE INDEX idx_file_integrity_device ON public.file_integrity(device_id);

ALTER TABLE public.file_integrity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read file_integrity" ON public.file_integrity FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own file_integrity" ON public.file_integrity FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Authenticated insert file_integrity" ON public.file_integrity FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 5) Realtime pub/sub for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.screen_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.file_integrity;

ALTER TABLE public.screen_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.device_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.file_integrity REPLICA IDENTITY FULL;

-- 6) Update activity_events to better support screenshots
ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS screenshot_bucket TEXT DEFAULT 'violation-screenshots';
ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS screenshot_storage_path TEXT;

-- 7) Helper function for device status from heartbeat
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

