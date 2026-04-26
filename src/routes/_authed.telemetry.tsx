import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Cpu, HardDrive, Loader2, MemoryStick } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authed/telemetry")({
  head: () => ({ meta: [{ title: "Agent Telemetry — Sentinel Net" }] }),
  component: TelemetryPage,
});

interface Heartbeat {
  id: string;
  device_id: string;
  user_id: string;
  uptime_seconds: number;
  agent_version: string | null;
  watchdog_status: "healthy" | "degraded" | "down" | "unknown";
  cpu_percent: number | null;
  memory_mb: number | null;
  last_sync_at: string | null;
  reported_at: string;
}

interface Device {
  id: string;
  device_name: string;
  hostname: string | null;
  user_id: string;
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function TelemetryPage() {
  const { isAdmin } = useAuth();
  const [latest, setLatest] = useState<Heartbeat[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: hbs }, { data: devs }] = await Promise.all([
        supabase
          .from("agent_heartbeats")
          .select("*")
          .order("reported_at", { ascending: false })
          .limit(500),
        supabase.from("devices").select("id, device_name, hostname, user_id"),
      ]);
      // Reduce to one heartbeat per device (the most recent)
      const byDevice = new Map<string, Heartbeat>();
      for (const h of (hbs as Heartbeat[]) ?? []) {
        if (!byDevice.has(h.device_id)) byDevice.set(h.device_id, h);
      }
      setLatest([...byDevice.values()]);
      setDevices((devs as Device[]) ?? []);
      setLoading(false);
    })();

    const ch = supabase
      .channel("hb-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_heartbeats" },
        (p) => {
          const next = p.new as Heartbeat;
          setLatest((prev) => {
            const without = prev.filter((h) => h.device_id !== next.device_id);
            return [next, ...without];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const stats = {
    total: latest.length,
    healthy: latest.filter((h) => h.watchdog_status === "healthy").length,
    degraded: latest.filter((h) => h.watchdog_status === "degraded").length,
    down: latest.filter((h) => h.watchdog_status === "down").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">FLEET</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Agent Telemetry</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Live health from every Sentinel agent." : "Health of agents linked to your account."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Reporting" value={stats.total} />
        <Stat label="Healthy" value={stats.healthy} accent="success" />
        <Stat label="Degraded" value={stats.degraded} accent="warning" />
        <Stat label="Down" value={stats.down} accent="destructive" />
      </div>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : latest.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Activity className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No heartbeats yet. Agents start reporting after their first sync.
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {latest.map((h) => {
            const dev = devices.find((d) => d.id === h.device_id);
            const wdColor =
              h.watchdog_status === "healthy"
                ? "bg-success/15 text-success"
                : h.watchdog_status === "degraded"
                  ? "bg-warning/15 text-warning"
                  : h.watchdog_status === "down"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground";
            return (
              <div key={h.id} className="grid gap-3 p-4 md:grid-cols-6">
                <div className="md:col-span-2">
                  <p className="text-sm font-semibold">{dev?.device_name ?? "Unknown"}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {dev?.hostname ?? h.device_id.slice(0, 8)}
                    {h.agent_version ? ` · v${h.agent_version}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className={`w-fit font-mono text-[10px] uppercase ${wdColor}`}>
                  {h.watchdog_status}
                </Badge>
                <div className="flex items-center gap-1 text-xs">
                  <HardDrive className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono">{fmtUptime(h.uptime_seconds)}</span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <Cpu className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono">
                    {h.cpu_percent != null ? `${h.cpu_percent.toFixed(1)}%` : "—"}
                  </span>
                  <MemoryStick className="ml-2 h-3 w-3 text-muted-foreground" />
                  <span className="font-mono">{h.memory_mb != null ? `${h.memory_mb} MB` : "—"}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Last sync: <span className="font-mono">{fmtAgo(h.last_sync_at)}</span>
                  <br />
                  Heard: <span className="font-mono">{fmtAgo(h.reported_at)}</span>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "success" | "warning" | "destructive" }) {
  const color =
    accent === "success"
      ? "text-success"
      : accent === "warning"
        ? "text-warning"
        : accent === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <Card className="p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}
