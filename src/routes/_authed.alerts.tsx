import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Search, Bell, BellOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — Sentinel Net" },
      { name: "description", content: "Real-time security event log from agents in the field." },
    ],
  }),
  component: AlertsPage,
});

type Severity = "info" | "warning" | "critical";

interface Alert {
  id: string;
  device_id: string | null;
  user_id: string | null;
  action_type: string;
  target: string | null;
  severity: Severity;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const SEVERITY_STYLES: Record<Severity, string> = {
  info: "bg-info/15 text-info border-info/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
};

const READ_KEY = "sentinel:alerts-read";

function loadReadSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function persistReadSet(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    // Cap to last 1000 ids
    const arr = Array.from(set).slice(-1000);
    window.localStorage.setItem(READ_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Severity | "unread">("all");
  const [search, setSearch] = useState("");
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadSet());
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) toast.error(error.message);
      else setAlerts((data as Alert[]) ?? []);
      setLoading(false);
    })();

    const channel = supabase
      .channel("alerts-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          const next = payload.new as Alert;
          setAlerts((prev) => [next, ...prev].slice(0, 300));
          if (muted) return;
          if (next.severity === "critical") {
            toast.error(
              `Critical: ${next.action_type}${next.target ? ` → ${next.target}` : ""}`,
            );
          } else if (next.severity === "warning") {
            toast.warning(`${next.action_type}${next.target ? ` → ${next.target}` : ""}`);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  const stats = useMemo(() => {
    return {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
      unread: alerts.filter((a) => !readIds.has(a.id)).length,
    };
  }, [alerts, readIds]);

  const filtered = useMemo(() => {
    let out = alerts;
    if (filter === "unread") out = out.filter((a) => !readIds.has(a.id));
    else if (filter !== "all") out = out.filter((a) => a.severity === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (a) =>
          a.action_type.toLowerCase().includes(q) ||
          (a.target ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [alerts, filter, search, readIds]);

  const toggleRead = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistReadSet(next);
      return next;
    });
  };

  const markAllRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      alerts.forEach((a) => next.add(a.id));
      persistReadSet(next);
      return next;
    });
    toast.success("All alerts marked as read");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">EVENTS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Security events captured by Sentinel agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Unmute toast notifications" : "Mute toast notifications"}
          >
            {muted ? <BellOff className="mr-1.5 h-3.5 w-3.5" /> : <Bell className="mr-1.5 h-3.5 w-3.5" />}
            {muted ? "Muted" : "Notifications on"}
          </Button>
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={stats.unread === 0}>
            Mark all read
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Critical" value={stats.critical} accent="destructive" />
        <StatCard label="Warning" value={stats.warning} accent="warning" />
        <StatCard label="Unread" value={stats.unread} accent="info" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="flex-shrink-0">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="critical">Critical</TabsTrigger>
            <TabsTrigger value="warning">Warning</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="unread">
              Unread {stats.unread > 0 && <span className="ml-1 text-primary">({stats.unread})</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative ml-auto min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action or target…"
            className="pl-8 font-mono text-xs"
          />
        </div>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {alerts.length === 0 ? "No alerts yet. The grid is quiet." : "No alerts match this filter."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((a) => {
              const isRead = readIds.has(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => toggleRead(a.id)}
                  className={`flex w-full items-start gap-4 p-4 text-left transition-colors hover:bg-accent/30 ${
                    isRead ? "opacity-60" : ""
                  }`}
                >
                  <Badge
                    variant="outline"
                    className={`shrink-0 font-mono text-[10px] uppercase ${SEVERITY_STYLES[a.severity]}`}
                  >
                    {a.severity}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{a.action_type}</p>
                    {a.target && (
                      <p className="break-all font-mono text-xs text-muted-foreground">→ {a.target}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </p>
                    {!isRead && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="unread" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}
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
  accent?: "warning" | "destructive" | "info";
}) {
  const color =
    accent === "warning"
      ? "text-warning"
      : accent === "destructive"
        ? "text-destructive"
        : accent === "info"
          ? "text-info"
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
