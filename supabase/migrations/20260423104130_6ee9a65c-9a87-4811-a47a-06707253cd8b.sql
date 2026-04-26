-- Dispatch webhooks every 5 minutes by hitting the public route
SELECT cron.schedule(
  'sentinel-webhook-dispatch',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b25ecf04-d408-4009-830a-63850852cca7.lovable.app/api/public/dispatch-webhooks',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);