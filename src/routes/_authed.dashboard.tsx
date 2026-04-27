import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Monitor,
  Globe,
  Download,
  AlertTriangle,
  Inbox,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { deriveDeviceRuntimeStatus } from "@/lib/device-health";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/dashboard")({
  head: () => ({
    meta: [
      { title: "Operations Overview - Sentinel Net" },
      {
        name: "description",
        content: "Real-time operations overview for the Sentinel Net dashboard.",
      },
    ],
  }),
  component: DashboardPage,
});

interface Counts {
  devices: number;
  domains: number;
  downloads: number;
  alerts: number;
  pendingRequests: number;
}

interface DeviceSummary {
  id: string;
  status: "active" | "inactive" | "disabled";
  last_seen: string | null;
}

function DashboardPage() {
  const { username, isAdmin } = useAuth();
  const [counts, setCounts] = useState<Counts>({
    devices: 0,
    domains: 0,
    downloads: 0,
    alerts: 0,
    pendingRequests: 0,
  });
  const [deviceSummaries, setDeviceSummaries] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [deviceCount, deviceRows, domains, downloads, alerts, requests] = await Promise.all([
        supabase.from("devices").select("id", { count: "exact", head: true }),
        supabase.from("devices").select("id,status,last_seen"),
        supabase.from("domains").select("id", { count: "exact", head: true }),
        supabase.from("downloads").select("id", { count: "exact", head: true }),
        supabase.from("alerts").select("id", { count: "exact", head: true }),
        supabase.from("requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);

      setCounts({
        devices: deviceCount.count ?? 0,
        domains: domains.count ?? 0,
        downloads: downloads.count ?? 0,
        alerts: alerts.count ?? 0,
        pendingRequests: requests.count ?? 0,
      });
      setDeviceSummaries((deviceRows.data as DeviceSummary[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const runtime = useMemo(() => {
    const online = deviceSummaries.filter(
      (device) => deriveDeviceRuntimeStatus(device.status, device.last_seen) === "online",
    ).length;
    const offline = deviceSummaries.filter(
      (device) => deriveDeviceRuntimeStatus(device.status, device.last_seen) === "offline",
    ).length;
    const disabled = deviceSummaries.filter(
      (device) => deriveDeviceRuntimeStatus(device.status, device.last_seen) === "disabled",
    ).length;
    return { online, offline, disabled };
  }, [deviceSummaries]);

  const cards = [
    { to: "/devices", label: "Devices", icon: Monitor, value: counts.devices, hint: "Registered agents" },
    { to: "/domains", label: "Domains", icon: Globe, value: counts.domains, hint: "Block / allow rules" },
    { to: "/downloads", label: "Downloads", icon: Download, value: counts.downloads, hint: "Restriction policies" },
    { to: "/alerts", label: "Alerts", icon: AlertTriangle, value: counts.alerts, hint: "Security events" },
    { to: "/requests", label: "Requests", icon: Inbox, value: counts.pendingRequests, hint: "Pending approvals" },
  ] as const;

  const statusTone =
    counts.devices === 0
      ? "border-muted bg-muted/10"
      : runtime.offline > 0
        ? "border-warning/30 bg-warning/5"
        : "border-success/30 bg-success/5";
  const statusLine =
    counts.devices === 0
      ? "No managed devices are reporting yet."
      : runtime.offline > 0
        ? `${runtime.online} online, ${runtime.offline} offline, ${runtime.disabled} disabled. Offline devices have missed the 90 second heartbeat window.`
        : `${runtime.online} device${runtime.online === 1 ? "" : "s"} online and reporting normally.`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
          OPERATIONS - LIVE
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, <span className="text-primary">{username ?? "operator"}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Full administrator access. Monitor the fleet and triage incoming requests."
            : "Standard operator console. Review your devices and submit requests for approval."}
        </p>
      </div>

      <Card className={`${statusTone} p-4`}>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-success" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Sentinel grid health</p>
            <p className="text-xs text-muted-foreground">
              {loading ? "Refreshing runtime status..." : statusLine}
            </p>
          </div>
          <Activity className="h-4 w-4 animate-pulse text-success" />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => (
          <Link key={card.to} to={card.to} className="group">
            <Card className="relative overflow-hidden border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-glow)]">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    {card.hint}
                  </p>
                  <p className="mt-2 text-3xl font-bold text-foreground">
                    {loading ? "-" : card.value}
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">{card.label}</p>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background/50 text-primary transition-colors group-hover:border-primary/40">
                  <card.icon className="h-4 w-4" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
              Quick actions
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {isAdmin ? "ADMIN" : "USER"}
            </span>
          </div>
          <div className="space-y-2">
            {isAdmin ? (
              <>
                <QuickLink to="/domains" label="Add a domain rule" />
                <QuickLink to="/downloads" label="Configure download policies" />
                <QuickLink to="/requests" label="Review pending requests" />
                <QuickLink to="/alerts" label="Inspect recent alerts" />
              </>
            ) : (
              <>
                <QuickLink to="/devices" label="View my devices" />
                <QuickLink to="/requests" label="Submit an access request" />
                <QuickLink to="/alerts" label="Review my alerts" />
              </>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
              Agent deployment
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Install the Sentinel Net agent service on a managed device to register it with the grid.
            </p>
          </div>
          <div className="rounded-md border border-border bg-background/40 p-3">
            <p className="font-mono text-[11px] text-muted-foreground">
              <span className="text-primary">$</span> sentinel_agent.exe --startup auto install
            </p>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Endpoint packaging should remain visible, authenticated, service-managed, and auditable.
          </p>
        </Card>
      </div>
    </div>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-md border border-border bg-background/30 px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-background/60"
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">-&gt;</span>
    </Link>
  );
}
