import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
      { title: "Alerts - Sentinel Net" },
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
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistReadSet(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(set).slice(-1000);
    window.localStorage.setItem(READ_KEY, JSON.stringify(arr));
  } catch {
    // Ignore local storage failures.
  }
}

function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Severity | "unread">("all");
  const [search, setSearch] = useState("");
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadSet());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const recentToastSignaturesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) {
        toast.error(error.message);
      } else {
        const initialAlerts = (data as Alert[]) ?? [];
        setAlerts(initialAlerts);
        seenIdsRef.current = new Set(initialAlerts.map((alert) => alert.id));
      }
      setLoading(false);
    })();

    const channel = supabase
      .channel("alerts-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          const next = payload.new as Alert;
          if (seenIdsRef.current.has(next.id)) return;

          seenIdsRef.current.add(next.id);
          setAlerts((prev) => [next, ...prev].slice(0, 300));
          setNewIds((prev) => {
            const updated = new Set(prev);
            updated.add(next.id);
            return updated;
          });

          if (mutedRef.current) return;

          const signature = [
            next.device_id ?? "unknown",
            next.severity,
            next.action_type,
            next.target ?? "",
          ].join("|");
          const now = Date.now();
          const lastShownAt = recentToastSignaturesRef.current.get(signature);
          if (lastShownAt && now - lastShownAt < 10_000) return;

          recentToastSignaturesRef.current.set(signature, now);
          if (recentToastSignaturesRef.current.size > 250) {
            for (const [key, shownAt] of recentToastSignaturesRef.current.entries()) {
              if (now - shownAt > 60_000) recentToastSignaturesRef.current.delete(key);
            }
          }

          const label = `${next.action_type}${next.target ? ` -> ${next.target}` : ""}`;
          if (next.severity === "critical") {
            toast.error(`Critical: ${label}`);
          } else if (next.severity === "warning") {
            toast.warning(label);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const stats = useMemo(
    () => ({
      total: alerts.length,
      critical: alerts.filter((alert) => alert.severity === "critical").length,
      warning: alerts.filter((alert) => alert.severity === "warning").length,
      unread: alerts.filter((alert) => !readIds.has(alert.id)).length,
      fresh: alerts.filter((alert) => newIds.has(alert.id)).length,
    }),
    [alerts, newIds, readIds],
  );

  const filtered = useMemo(() => {
    let out = alerts;
    if (filter === "unread") out = out.filter((alert) => !readIds.has(alert.id));
    else if (filter !== "all") out = out.filter((alert) => alert.severity === filter);

    if (search.trim()) {
      const query = search.trim().toLowerCase();
      out = out.filter(
        (alert) =>
          alert.action_type.toLowerCase().includes(query) ||
          (alert.target ?? "").toLowerCase().includes(query),
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
    setNewIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const markAllRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      alerts.forEach((alert) => next.add(alert.id));
      persistReadSet(next);
      return next;
    });
    setNewIds(new Set());
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
            onClick={() => setMuted((prev) => !prev)}
            title={muted ? "Unmute toast notifications" : "Mute toast notifications"}
          >
            {muted ? (
              <BellOff className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Bell className="mr-1.5 h-3.5 w-3.5" />
            )}
            {muted ? "Muted" : "Notifications on"}
          </Button>
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={stats.unread === 0}>
            Mark all read
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Critical" value={stats.critical} accent="destructive" />
        <StatCard label="Warning" value={stats.warning} accent="warning" />
        <StatCard label="New" value={stats.fresh} accent="info" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as typeof filter)}
          className="flex-shrink-0"
        >
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
            placeholder="Search action or target..."
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
            {filtered.map((alert) => {
              const isRead = readIds.has(alert.id);
              return (
                <button
                  key={alert.id}
                  onClick={() => toggleRead(alert.id)}
                  className={`flex w-full items-start gap-4 p-4 text-left transition-colors hover:bg-accent/30 ${
                    isRead ? "opacity-60" : ""
                  }`}
                >
                  <Badge
                    variant="outline"
                    className={`shrink-0 font-mono text-[10px] uppercase ${SEVERITY_STYLES[alert.severity]}`}
                  >
                    {alert.severity}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{alert.action_type}</p>
                    {alert.target && (
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        -&gt; {alert.target}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {new Date(alert.created_at).toLocaleString()}
                    </p>
                    {newIds.has(alert.id) && (
                      <Badge
                        variant="outline"
                        className="border-info/30 bg-info/10 font-mono text-[9px] uppercase text-info"
                      >
                        new
                      </Badge>
                    )}
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
