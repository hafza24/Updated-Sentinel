
-- 1) Fix devices DELETE policy: target authenticated, not public
DROP POLICY IF EXISTS "Users can delete own devices" ON public.devices;

CREATE POLICY "Users can delete own devices"
ON public.devices
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 2) Lock down realtime channel subscriptions.
-- Topic conventions used by the app:
--   user:<uid>            -> personal stream (alerts, activity, requests, my devices)
--   device:<device_id>    -> per-device stream (commands, telemetry)
--   admin:*               -> admin-only firehose (all alerts/violations/commands)
--   public:settings       -> app_settings broadcast (read-only, every authenticated user)

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- SELECT (subscribe / receive)
DROP POLICY IF EXISTS "rt_select_self_or_admin" ON realtime.messages;
CREATE POLICY "rt_select_self_or_admin"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Admins can listen on everything
  public.has_role(auth.uid(), 'admin')
  -- Users can listen on their own personal topic
  OR realtime.topic() = 'user:' || auth.uid()::text
  -- Users can listen on topics for devices they own
  OR (
    realtime.topic() LIKE 'device:%'
    AND EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.user_id = auth.uid()
        AND d.id::text = split_part(realtime.topic(), ':', 2)
    )
  )
  -- Public app settings broadcast (no PII)
  OR realtime.topic() = 'public:settings'
);

-- INSERT (broadcast / presence write)
DROP POLICY IF EXISTS "rt_insert_self_or_admin" ON realtime.messages;
CREATE POLICY "rt_insert_self_or_admin"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
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
