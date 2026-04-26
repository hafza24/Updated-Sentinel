-- Enums
CREATE TYPE public.device_command_type AS ENUM ('lock_device', 'restart_agent', 'force_sync', 'disable_network', 'enable_network');
CREATE TYPE public.device_command_status AS ENUM ('pending', 'acknowledged', 'completed', 'failed');
CREATE TYPE public.activity_event_type AS ENUM ('domain_access', 'download', 'process');
CREATE TYPE public.activity_event_outcome AS ENUM ('allowed', 'blocked', 'killed', 'deleted');

-- Device commands queue
CREATE TABLE public.device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  command_type public.device_command_type NOT NULL,
  status public.device_command_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text,
  issued_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_commands_device_status ON public.device_commands(device_id, status);

ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read device_commands" ON public.device_commands
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert device_commands" ON public.device_commands
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update device_commands" ON public.device_commands
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Device owner reads own commands" ON public.device_commands
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = auth.uid())
  );
CREATE POLICY "Device owner updates own commands" ON public.device_commands
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = auth.uid())
  );

CREATE TRIGGER trg_device_commands_updated_at
  BEFORE UPDATE ON public.device_commands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Unified activity feed
CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  user_id uuid,
  event_type public.activity_event_type NOT NULL,
  outcome public.activity_event_outcome NOT NULL,
  target text,
  severity public.alert_severity NOT NULL DEFAULT 'info',
  screenshot_path text,
  metadata jsonb DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_events_occurred ON public.activity_events(occurred_at DESC);
CREATE INDEX idx_activity_events_device ON public.activity_events(device_id, occurred_at DESC);
CREATE INDEX idx_activity_events_user ON public.activity_events(user_id, occurred_at DESC);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all activity" ON public.activity_events
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users read own activity" ON public.activity_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Authenticated insert own activity" ON public.activity_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;
ALTER TABLE public.device_commands REPLICA IDENTITY FULL;
ALTER TABLE public.activity_events REPLICA IDENTITY FULL;

-- Private storage bucket for violation screenshots
INSERT INTO storage.buckets (id, name, public) VALUES ('violation-screenshots', 'violation-screenshots', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read violation screenshots" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'violation-screenshots' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins write violation screenshots" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'violation-screenshots' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Device owner uploads own screenshots" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'violation-screenshots'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "Device owner reads own screenshots" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'violation-screenshots'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );