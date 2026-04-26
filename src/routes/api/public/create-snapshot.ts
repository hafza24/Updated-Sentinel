import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Lightweight JSON snapshot of all public tables. Stored as a row in db_snapshots
// (table_counts) plus an artifact uploaded to the violation-screenshots bucket
// under a `snapshots/` prefix. NOT a true pg_dump — for full restore you must
// use Lovable Cloud's managed backups. This gives admins a quick, app-level
// rollback point and an audit trail.
const SNAPSHOT_TABLES = [
  "profiles",
  "user_roles",
  "devices",
  "domains",
  "downloads",
  "process_blacklist",
  "policy_schedules",
  "auto_response_rules",
  "app_settings",
  "webhook_endpoints",
  "screenshot_retention_policies",
] as const;

export const Route = createFileRoute("/api/public/create-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        const token = auth.slice(7);
        const { data: claims, error: cErr } = await supabaseAdmin.auth.getUser(token);
        if (cErr || !claims?.user) {
          return Response.json({ ok: false, error: "Invalid token" }, { status: 401 });
        }
        const { data: roleRow } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", claims.user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (!roleRow) {
          return Response.json({ ok: false, error: "Admin only" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const label = String(body.label ?? `snapshot-${new Date().toISOString()}`);
        const notes = body.notes ? String(body.notes) : null;

        const { data: snap, error: insErr } = await supabaseAdmin
          .from("db_snapshots")
          .insert({ label, notes, status: "pending", created_by: claims.user.id })
          .select("id")
          .single();
        if (insErr || !snap) {
          return Response.json({ ok: false, error: insErr?.message }, { status: 500 });
        }

        try {
          const counts: Record<string, number> = {};
          const dump: Record<string, unknown[]> = {};
          for (const t of SNAPSHOT_TABLES) {
            const { data, count } = await supabaseAdmin
              .from(t)
              .select("*", { count: "exact" })
              .limit(5000);
            counts[t] = count ?? data?.length ?? 0;
            dump[t] = data ?? [];
          }
          const json = JSON.stringify({ created_at: new Date().toISOString(), label, dump }, null, 2);
          const path = `snapshots/${snap.id}.json`;
          const { error: upErr } = await supabaseAdmin.storage
            .from("violation-screenshots")
            .upload(path, new Blob([json], { type: "application/json" }), { upsert: true });
          if (upErr) throw upErr;

          await supabaseAdmin
            .from("db_snapshots")
            .update({
              status: "ready",
              size_bytes: json.length,
              storage_path: path,
              table_counts: counts,
            })
            .eq("id", snap.id);

          return Response.json({ ok: true, snapshot_id: snap.id, size_bytes: json.length });
        } catch (e: any) {
          await supabaseAdmin
            .from("db_snapshots")
            .update({ status: "failed", notes: String(e?.message ?? e) })
            .eq("id", snap.id);
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
