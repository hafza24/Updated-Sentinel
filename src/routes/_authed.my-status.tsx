import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Activity,
  Globe,
  Download,
  Cpu,
  Inbox,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/my-status")({
  head: () => ({
    meta: [
      { title: "My Status — Sentinel Net" },
      {
        name: "description",
        content: "Your personal Sentinel Net status: enforcement, alerts, and pending requests.",
      },
    ],
  }),
  component: MyStatusPage,
});

interface DeviceRow {
  id: string;
  device_name: string;
  status: "active" | "inactive" | "disabled";
  firewall_enabled: boolean;
  download_restriction_enabled: boolean;
  last_seen: string | null;
}

interface ActivityRow {
  id: string;
  event_type: "domain_access" | "download" | "process";
  outcome: "allowed" | "blocked" | "killed" | "deleted";
  target: string | null;
  severity: "info" | "warning" | "critical";
  occurred_at: string;
}

interface RequestRow {
  id: string;
  request_type: "domain" | "download" | "uninstall";
  status: "pending" | "approved" | "rejected";
  payload: Record<string, unknown>;
  created_at: string;
}

interface AppSettings {
  firewall_enabled: boolean;
  download_restriction_enabled: boolean;
  process_enforcement_enabled: boolean;
}

function MyStatusPage() {
  const { user, username } = useAuth();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [d, a, r, s] = await Promise.all([
        supabase
          .from("devices")
          .select("id, device_name, status, firewall_enabled, download_restriction_enabled, last_seen")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("activity_events")
          .select("id, event_type, outcome, target, severity, occurred_at")
          .eq("user_id", user.id)
          .order("occurred_at", { ascending: false })
          .limit(20),
        supabase
          .from("requests")
          .select("id, request_type, status, payload, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("app_settings")
          .select("firewall_enabled, download_restriction_enabled, process_enforcement_enabled")
          .maybeSingle(),
      ]);
      if (d.error) toast.error(d.error.message);
      setDevices((d.data as DeviceRow[]) ?? []);
      setActivity((a.data as ActivityRow[]) ?? []);
      setRequests((r.data as RequestRow[]) ?? []);
      setSettings((s.data as AppSettings) ?? null);
      setLoading(false);
    })();
  }, [user]);

  const stats = useMemo(() => {
    const total24h = activity.length;
    const blocked = activity.filter((e) => e.outcome !== "allowed").length;
    const pending = requests.filter((r) => r.status === "pending").length;
    return { total24h, blocked, pending };
  }, [activity, requests]);

  const enforcement = useMemo(() => {
    const firewallGlobal = settings?.firewall_enabled ?? true;
    const downloadGlobal = settings?.download_restriction_enabled ?? true;
    const processGlobal = settings?.process_enforcement_enabled ?? true;
    const myDeviceFirewall = devices.some((d) => d.firewall_enabled);
    const myDeviceDownload = devices.some((d) => d.download_restriction_enabled);
    return {
      firewall: firewallGlobal && myDeviceFirewall,
      download: downloadGlobal && myDeviceDownload,
      process: processGlobal,
    };
  }, [settings, devices]);

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
          MY ACCOUNT
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Hello, <span className="text-primary">{username ?? "operator"}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of policies enforced on your devices.
        </p>
      </div>

      {/* System status banner */}
      <Card
        className={
          enforcement.firewall
            ? "border-success/30 bg-success/5 p-4"
            : "border-warning/30 bg-warning/5 p-4"
        }
      >
        <div className="flex items-center gap-3">
          {enforcement.firewall ? (
            <ShieldCheck className="h-5 w-5 text-success" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-warning" />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              {enforcement.firewall ? "Sentinel protection active" : "Protection partially disabled"}
            </p>
            <p className="text-xs text-muted-foreground">
              {devices.length} device{devices.length === 1 ? "" : "s"} linked to your account.
            </p>
          </div>
          <Activity className="h-4 w-4 animate-pulse text-success" />
        </div>
      </Card>

      {/* Enforcement matrix (READ-ONLY) */}
      <div className="grid gap-3 md:grid-cols-3">
        <EnforcementChip icon={Globe} label="Firewall" active={enforcement.firewall} />
        <EnforcementChip
          icon={Download}
          label="Download policy"
          active={enforcement.download}
        />
        <EnforcementChip icon={Cpu} label="Process control" active={enforcement.process} />
      </div>

      {/* My devices (read-only) */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground">
          My devices
        </h2>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No devices registered yet. An administrator will provision your endpoint.
          </p>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-md border border-border bg-background/30 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{d.device_name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Last seen: {d.last_seen ? new Date(d.last_seen).toLocaleString() : "never"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    d.status === "active"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-muted bg-muted/40 text-muted-foreground"
                  }
                >
                  {d.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quick stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Recent events" value={stats.total24h} />
        <StatCard label="Blocked actions" value={stats.blocked} accent="warning" />
        <StatCard label="Pending requests" value={stats.pending} accent="info" />
      </div>

      {/* Two-column: Recent activity + Requests */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
              Recent activity
            </h2>
            <Link to="/activity" className="font-mono text-[10px] uppercase text-primary hover:underline">
              View all →
            </Link>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {activity.slice(0, 6).map((e) => (
                <div
                  key={e.id}
                  className="flex items-start gap-3 rounded-md border border-border bg-background/20 px-3 py-2"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-primary">
                    {e.event_type === "domain_access" && <Globe className="h-3.5 w-3.5" />}
                    {e.event_type === "download" && <Download className="h-3.5 w-3.5" />}
                    {e.event_type === "process" && <Cpu className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          e.outcome === "allowed"
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-destructive/30 bg-destructive/10 text-destructive"
                        }
                      >
                        {e.outcome}
                      </Badge>
                    </div>
                    {e.target && (
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        {e.target}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {new Date(e.occurred_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
              My requests
            </h2>
            <Button asChild size="sm" variant="outline">
              <Link to="/requests">
                <Inbox className="mr-1.5 h-3.5 w-3.5" /> New request
              </Link>
            </Button>
          </div>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requests yet. Need access to a domain or file type? Submit a request.
            </p>
          ) : (
            <div className="space-y-2">
              {requests.slice(0, 6).map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border bg-background/20 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        {r.request_type}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={
                          r.status === "approved"
                            ? "bg-success/15 text-success"
                            : r.status === "rejected"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-warning/15 text-warning"
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                    {Object.keys(r.payload ?? {}).length > 0 && (
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        {Object.entries(r.payload)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function EnforcementChip({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Globe;
  label: string;
  active: boolean;
}) {
  return (
    <Card
      className={
        active
          ? "border-success/30 bg-success/5 p-4"
          : "border-muted bg-muted/10 p-4"
      }
    >
      <div className="flex items-center gap-3">
        <div
          className={
            active
              ? "flex h-9 w-9 items-center justify-center rounded-md border border-success/30 bg-success/10 text-success"
              : "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background/40 text-muted-foreground"
          }
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p
            className={
              active
                ? "font-mono text-[10px] uppercase tracking-wider text-success"
                : "font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            }
          >
            {active ? "● Enforced" : "○ Inactive"}
          </p>
        </div>
      </div>
    </Card>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "warning" | "info";
}) {
  const color =
    accent === "warning"
      ? "text-warning"
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
