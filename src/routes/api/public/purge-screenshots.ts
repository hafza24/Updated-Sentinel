import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Manual trigger for the retention purge. The DB function only nullifies the
// path; this route also deletes the underlying storage object.
export const Route = createFileRoute("/api/public/purge-screenshots")({
  server: {
    handlers: {
      POST: async () => {
        // 1) Run DB-side purge (logs to screenshot_deletions, nullifies path)
        const { data: purged, error } = await supabaseAdmin.rpc("purge_expired_screenshots");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        // 2) Delete storage objects logged in the last 24h that still exist
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: rows } = await supabaseAdmin
          .from("screenshot_deletions")
          .select("screenshot_path")
          .gte("deleted_at", since);

        const paths = (rows ?? []).map((r) => r.screenshot_path).filter(Boolean);
        if (paths.length) {
          await supabaseAdmin.storage.from("violation-screenshots").remove(paths);
        }
        return Response.json({ ok: true, purged });
      },
    },
  },
});
