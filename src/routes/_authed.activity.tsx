import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, Loader2, Globe, Download, Cpu, ImageIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/activity")({
  head: () => ({
    meta: [
      { title: "Activity Feed — Sentinel Net" },
      { name: "description", content: "Real-time unified activity feed across all Sentinel agents." },
    ],
  }),
  component: ActivityPage,
});

type EventType = "domain_access" | "download" | "process";
type Outcome = "allowed" | "blocked" | "killed" | "deleted";
type Severity = "info" | "warning" | "critical";

interface ActivityEvent {
  id: string;
  device_id: string | null;
  user_id: string | null;
  event_type: EventType;
  outcome: Outcome;
  target: string | null;
  severity: Severity;
  screenshot_path: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}

const TYPE_ICON = {
  domain_access: Globe,
  download: Download,
  process: Cpu,
} as const;

const OUTCOME_STYLE: Record<Outcome, string> = {
  allowed: "bg-success/15 text-success border-success/30",
  blocked: "bg-destructive/15 text-destructive border-destructive/30",
  killed: "bg-destructive/15 text-destructive border-destructive/30",
  deleted: "bg-warning/15 text-warning border-warning/30",
};

const SEV_STYLE: Record<Severity, string> = {
  info: "bg-info/10 text-info border-info/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
};

function ActivityPage() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | EventType>("all");
  const [shotUrl, setShotUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("activity_events")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(300);
      if (error) toast.error(error.message);
      else setEvents((data as ActivityEvent[]) ?? []);
      setLoading(false);
    })();

    const channel = supabase
      .channel("activity-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_events" },
        (payload) => {
          setEvents((prev) => [payload.new as ActivityEvent, ...prev].slice(0, 300));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.event_type === filter)),
    [events, filter],
  );

  const stats = useMemo(() => {
    const blocked = events.filter((e) => e.outcome !== "allowed").length;
    const critical = events.filter((e) => e.severity === "critical").length;
    return { total: events.length, blocked, critical };
  }, [events]);

  const openShot = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("violation-screenshots")
      .createSignedUrl(path, 60);
    if (error || !data) {
      toast.error("Could not load screenshot");
      return;
    }
    setShotUrl(data.signedUrl);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">LIVE FEED</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Every domain hit, download, and process event reported by agents."
            : "Activity from your devices."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total events" value={stats.total} />
        <StatCard label="Violations" value={stats.blocked} accent="warning" />
        <StatCard label="Critical" value={stats.critical} accent="destructive" />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="domain_access">Domains</TabsTrigger>
          <TabsTrigger value="download">Downloads</TabsTrigger>
          <TabsTrigger value="process">Processes</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Activity className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No events yet.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((e) => {
              const Icon = TYPE_ICON[e.event_type];
              return (
                <div key={e.id} className="flex items-start gap-3 p-4">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase ${OUTCOME_STYLE[e.outcome]}`}>
                        {e.outcome}
                      </Badge>
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase ${SEV_STYLE[e.severity]}`}>
                        {e.severity}
                      </Badge>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        {e.event_type.replace("_", " ")}
                      </span>
                    </div>
                    {e.target && (
                      <p className="break-all font-mono text-xs text-foreground">{e.target}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {e.screenshot_path && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => openShot(e.screenshot_path!)}
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {new Date(e.occurred_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Dialog open={!!shotUrl} onOpenChange={(o) => !o && setShotUrl(null)}>
        <DialogContent className="max-w-3xl">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Violation screenshot</p>
            <Button variant="ghost" size="sm" onClick={() => setShotUrl(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {shotUrl && (
            <img
              src={shotUrl}
              alt="Violation capture"
              className="w-full rounded-md border border-border"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "warning" | "destructive";
}) {
  const color =
    accent === "warning"
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
