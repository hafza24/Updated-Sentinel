import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Called every 5 min by pg_cron (and on-demand by admins via "Send test").
// Picks pending webhook_deliveries, posts them to Slack/Discord/generic, marks status.
export const Route = createFileRoute("/api/public/dispatch-webhooks")({
  server: {
    handlers: {
      POST: handler,
      GET: handler,
    },
  },
});

async function handler() {
  const { data: pending, error } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("id, endpoint_id, payload, attempts, webhook_endpoints(provider, url, name, is_active)")
    .eq("status", "pending")
    .lte("attempts", 5)
    .limit(50);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const row of pending ?? []) {
    const ep = (row as any).webhook_endpoints;
    if (!ep || !ep.is_active) continue;
    const body = formatPayload(ep.provider, row.payload as Record<string, unknown>);

    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await supabaseAdmin
        .from("webhook_deliveries")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq("id", row.id);
      sent++;
    } catch (e: any) {
      const attempts = row.attempts + 1;
      await supabaseAdmin
        .from("webhook_deliveries")
        .update({
          status: attempts >= 5 ? "failed" : "pending",
          attempts,
          last_error: String(e?.message ?? e),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return Response.json({ ok: true, sent, failed, picked: pending?.length ?? 0 });
}

function formatPayload(provider: string, p: Record<string, unknown>) {
  const title = `🚨 Sentinel Net — ${String(p.severity ?? "alert").toUpperCase()}`;
  const line = `${p.action_type ?? "alert"}${p.target ? ` → ${p.target}` : ""}`;
  if (provider === "slack") {
    return {
      text: `${title}\n${line}`,
      attachments: [
        {
          color: p.severity === "critical" ? "#ef4444" : p.severity === "warning" ? "#f59e0b" : "#3b82f6",
          fields: [
            { title: "Action", value: String(p.action_type ?? "—"), short: true },
            { title: "Target", value: String(p.target ?? "—"), short: true },
            { title: "Severity", value: String(p.severity ?? "—"), short: true },
            { title: "Time", value: String(p.created_at ?? "—"), short: true },
          ],
        },
      ],
    };
  }
  if (provider === "discord") {
    return {
      content: title,
      embeds: [
        {
          title: line,
          color: p.severity === "critical" ? 15548997 : p.severity === "warning" ? 16098851 : 3447003,
          fields: [
            { name: "Action", value: String(p.action_type ?? "—"), inline: true },
            { name: "Severity", value: String(p.severity ?? "—"), inline: true },
            { name: "Target", value: String(p.target ?? "—"), inline: false },
          ],
          timestamp: String(p.created_at ?? new Date().toISOString()),
        },
      ],
    };
  }
  return { title, ...p };
}
