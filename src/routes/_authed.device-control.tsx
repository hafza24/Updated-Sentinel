import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Lock,
  RotateCcw,
  RefreshCw,
  WifiOff,
  Wifi,
  Loader2,
  Monitor,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/device-control")({
  head: () => ({
    meta: [
      { title: "Remote Control — Sentinel Net" },
      { name: "description", content: "Issue remote commands to Sentinel agents." },
    ],
  }),
  component: DeviceControlPage,
});

type CommandType = "lock_device" | "restart_agent" | "force_sync" | "disable_network" | "enable_network";
type CommandStatus = "pending" | "acknowledged" | "completed" | "failed";

interface DeviceRow {
  id: string;
  device_name: string;
  hostname: string | null;
  status: string;
  last_seen: string | null;
}

interface CommandRow {
  id: string;
  device_id: string;
  command_type: CommandType;
  status: CommandStatus;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

const ACTIONS: {
  type: CommandType;
  label: string;
  Icon: typeof Lock;
  variant: "default" | "destructive" | "secondary";
}[] = [
  { type: "force_sync", label: "Force sync", Icon: RefreshCw, variant: "secondary" },
  { type: "restart_agent", label: "Restart agent", Icon: RotateCcw, variant: "secondary" },
  { type: "disable_network", label: "Kill network", Icon: WifiOff, variant: "destructive" },
  { type: "enable_network", label: "Restore network", Icon: Wifi, variant: "default" },
  { type: "lock_device", label: "Lock device", Icon: Lock, variant: "destructive" },
];

const STATUS_STYLE: Record<CommandStatus, string> = {
  pending: "bg-info/15 text-info border-info/30",
  acknowledged: "bg-warning/15 text-warning border-warning/30",
  completed: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

const STATUS_ICON: Record<CommandStatus, typeof Clock> = {
  pending: Clock,
  acknowledged: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

function DeviceControlPage() {
  const { isAdmin, user } = useAuth();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [d, c] = await Promise.all([
        supabase
          .from("devices")
          .select("id,device_name,hostname,status,last_seen")
          .order("device_name"),
        supabase
          .from("device_commands")
          .select("id,device_id,command_type,status,result,created_at,completed_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (d.error) toast.error(d.error.message);
      else setDevices((d.data as DeviceRow[]) ?? []);
      if (!c.error) setCommands((c.data as CommandRow[]) ?? []);
      setLoading(false);
    })();

    const channel = supabase
      .channel("commands-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_commands" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setCommands((prev) => [payload.new as CommandRow, ...prev].slice(0, 100));
          } else if (payload.eventType === "UPDATE") {
            setCommands((prev) =>
              prev.map((c) => (c.id === (payload.new as CommandRow).id ? (payload.new as CommandRow) : c)),
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const issue = async (deviceId: string, type: CommandType) => {
    if (!user) return;
    setBusy(`${deviceId}:${type}`);
    const { error } = await supabase.from("device_commands").insert({
      device_id: deviceId,
      command_type: type,
      issued_by: user.id,
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else toast.success(`Queued: ${type.replace("_", " ")}`);
  };

  if (!isAdmin) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">REMOTE OPS</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Device control</h1>
        <p className="text-sm text-muted-foreground">
          Send commands to agents. They are picked up on the next sync cycle (~30s) and acknowledged in real time.
        </p>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : devices.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Monitor className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No devices registered yet.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {devices.map((d) => {
            const recent = commands.filter((c) => c.device_id === d.id).slice(0, 3);
            return (
              <Card key={d.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-foreground">{d.device_name}</h3>
                      <Badge
                        variant="outline"
                        className={
                          d.status === "active"
                            ? "bg-success/15 text-success border-success/30"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {d.status}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      HOST: {d.hostname ?? "—"} · LAST:{" "}
                      {d.last_seen ? new Date(d.last_seen).toLocaleString() : "never"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {ACTIONS.map(({ type, label, Icon, variant }) => {
                    const key = `${d.id}:${type}`;
                    const isBusy = busy === key;
                    return (
                      <Button
                        key={type}
                        variant={variant === "destructive" ? "destructive" : variant === "default" ? "default" : "outline"}
                        size="sm"
                        disabled={isBusy}
                        onClick={() => issue(d.id, type)}
                      >
                        {isBusy ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Icon className="mr-2 h-3.5 w-3.5" />
                        )}
                        {label}
                      </Button>
                    );
                  })}
                </div>
                {recent.length > 0 && (
                  <div className="mt-4 space-y-1 border-t border-border pt-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Recent commands
                    </p>
                    {recent.map((c) => {
                      const SIcon = STATUS_ICON[c.status];
                      return (
                        <div key={c.id} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className={`${STATUS_STYLE[c.status]} font-mono text-[9px] uppercase`}>
                            <SIcon className={`mr-1 h-3 w-3 ${c.status === "acknowledged" ? "animate-spin" : ""}`} />
                            {c.status}
                          </Badge>
                          <span className="font-mono text-foreground">{c.command_type.replace("_", " ")}</span>
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {new Date(c.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
