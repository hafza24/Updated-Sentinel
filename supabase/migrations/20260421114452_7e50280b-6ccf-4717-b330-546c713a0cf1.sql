-- Enums
CREATE TYPE public.schedule_target_type AS ENUM ('domain', 'process');
CREATE TYPE public.auto_response_trigger AS ENUM ('violation_count', 'single_violation');
CREATE TYPE public.auto_response_action AS ENUM ('log_only', 'temp_block_all', 'disable_network', 'lock_device');
CREATE TYPE public.violation_source AS ENUM ('domain', 'download', 'process');

-- policy_schedules
CREATE TABLE public.policy_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_type public.schedule_target_type NOT NULL,
  target_value TEXT NOT NULL,
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  scope public.rule_scope NOT NULL DEFAULT 'global',
  device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.policy_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read schedules" ON public.policy_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert schedules" ON public.policy_schedules FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update schedules" ON public.policy_schedules FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete schedules" ON public.policy_schedules FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_schedules_updated BEFORE UPDATE ON public.policy_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- auto_response_rules
CREATE TABLE public.auto_response_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  trigger_type public.auto_response_trigger NOT NULL DEFAULT 'violation_count',
  violation_threshold INT NOT NULL DEFAULT 5,
  time_window_minutes INT NOT NULL DEFAULT 10,
  action public.auto_response_action NOT NULL DEFAULT 'log_only',
  action_duration_minutes INT NOT NULL DEFAULT 60,
  severity_filter public.alert_severity,
  source_filter public.violation_source,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.auto_response_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read auto_response" ON public.auto_response_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert auto_response" ON public.auto_response_rules FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update auto_response" ON public.auto_response_rules FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete auto_response" ON public.auto_response_rules FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_auto_response_updated BEFORE UPDATE ON public.auto_response_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- violation_events (running tally; agents insert, admins read all)
CREATE TABLE public.violation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID,
  severity public.alert_severity NOT NULL DEFAULT 'warning',
  source public.violation_source NOT NULL,
  target TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.violation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read violations" ON public.violation_events FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own violations" ON public.violation_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Authenticated insert own violations" ON public.violation_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_violation_events_device_time ON public.violation_events (device_id, occurred_at DESC);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.policy_schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_response_rules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.violation_events;