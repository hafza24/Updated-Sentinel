-- Process blacklist table
CREATE TABLE public.process_blacklist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_name TEXT NOT NULL UNIQUE,
  description TEXT,
  kill_on_detect BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.process_blacklist ENABLE ROW LEVEL SECURITY;

-- Any authenticated user (including agents) can read
CREATE POLICY "Authenticated read process_blacklist"
ON public.process_blacklist
FOR SELECT
TO authenticated
USING (true);

-- Only admins can mutate
CREATE POLICY "Admins insert process_blacklist"
ON public.process_blacklist
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update process_blacklist"
ON public.process_blacklist
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete process_blacklist"
ON public.process_blacklist
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_process_blacklist_updated_at
BEFORE UPDATE ON public.process_blacklist
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.process_blacklist REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'process_blacklist'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.process_blacklist';
  END IF;
END $$;

-- Seed common entries
INSERT INTO public.process_blacklist (process_name, description, kill_on_detect) VALUES
  ('utorrent.exe', 'BitTorrent client', true),
  ('bittorrent.exe', 'BitTorrent client', true),
  ('qbittorrent.exe', 'BitTorrent client', true),
  ('teamviewer.exe', 'Remote access tool', true),
  ('anydesk.exe', 'Remote access tool', true),
  ('tor.exe', 'Tor browser', true),
  ('cmd.exe', 'Command prompt (example, disable if needed)', false)
ON CONFLICT (process_name) DO NOTHING;