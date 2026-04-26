import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Loader2, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/risk")({
  head: () => ({
    meta: [
      { title: "Risk Scoring — Sentinel Net" },
      { name: "description", content: "Per-device risk scores derived from recent activity." },
    ],
  }),
  component: RiskPage,
});

interface ViolationRow {
  device_id: string | null;
  user_id: string | null;
  severity: "info" | "warning" | "critical";
  occurred_at: string;
}

interface DeviceRow {
  id: string;
  device_name: string;
  user_id: string;
  status: string;
}

interface ProfileRow {
  id: string;
  username: string;
}

interface DeviceScore {
  deviceId: string;
  deviceName: string;
  username: string;
  status: string;
  score: number;
  count: number;
  recent: number;
}

const SEV_WEIGHT = { info: 1, warning: 5, critical: 15 } as const;

function band(score: number) {
  if (score >= 75) return { label: "CRITICAL", className: "bg-destructive/15 text-destructive border-destructive/30" };
  if (score >= 40) return { label: "HIGH", className: "bg-warning/15 text-warning border-warning/30" };
  if (score >= 15) return { label: "MEDIUM", className: "bg-info/15 text-info border-info/30" };
  return { label: "LOW", className: "bg-success/15 text-success border-success/30" };
}

function RiskPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [violations, setViolations] = useState<ViolationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [d, p, v] = await Promise.all([
        supabase.from("devices").select("id,device_name,user_id,status"),
        supabase.from("profiles").select("id,username"),
        supabase
          .from("violation_events")
          .select("device_id,user_id,severity,occurred_at")
          .gte("occurred_at", since)
          .limit(2000),
      ]);
      if (d.error || p.error || v.error) {
        toast.error("Failed to load risk data");
      } else {
        setDevices((d.data as DeviceRow[]) ?? []);
        setProfiles((p.data as ProfileRow[]) ?? []);
        setViolations((v.data as ViolationRow[]) ?? []);
      }
      setLoading(false);
    })();
  }, []);

  const scores = useMemo<DeviceScore[]>(() => {
    const userMap = new Map(profiles.map((p) => [p.id, p.username]));
    const recentCutoff = Date.now() - 60 * 60 * 1000;
    return devices
      .map((d) => {
        const dv = violations.filter((v) => v.device_id === d.id);
        const raw = dv.reduce((s, v) => s + SEV_WEIGHT[v.severity], 0);
        const score = Math.min(100, raw);
        const recent = dv.filter((v) => new Date(v.occurred_at).getTime() >= recentCutoff).length;
        return {
          deviceId: d.id,
          deviceName: d.device_name,
          username: userMap.get(d.user_id) ?? "—",
          status: d.status,
          score,
          count: dv.length,
          recent,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [devices, profiles, violations]);

  const fleetAvg = scores.length
    ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">RISK</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Risk scoring</h1>
        <p className="text-sm text-muted-foreground">
          Score (0–100) calculated from violations in the last 24h. Critical = 15, warning = 5, info = 1.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-background/50 text-primary">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Fleet average
            </p>
            <p className="mt-1 text-2xl font-bold">{fleetAvg}</p>
          </div>
          <Badge variant="outline" className={band(fleetAvg).className + " font-mono text-[10px] uppercase"}>
            {band(fleetAvg).label}
          </Badge>
        </div>
        <Progress value={fleetAvg} className="mt-4 h-2" />
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : scores.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No devices to score yet.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {scores.map((s) => {
            const b = band(s.score);
            return (
              <Card key={s.deviceId} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{s.deviceName}</h3>
                      <Badge variant="outline" className={b.className + " font-mono text-[10px] uppercase"}>
                        {b.label}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      USER: {s.username} · 24H: {s.count} · LAST HOUR: {s.recent}
                    </p>
                  </div>
                  <div className="w-48">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">Score</span>
                      <span className="text-lg font-bold">{s.score}</span>
                    </div>
                    <Progress value={s.score} className="mt-1 h-1.5" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
