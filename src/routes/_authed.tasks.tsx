import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Cpu, Loader2, Skull, Monitor, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { issueDeviceCommand } from "@/lib/device-command-api";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/tasks")({
  head: () => ({
    meta: [
      { title: "Device Tasks - Sentinel Net" },
      { name: "description", content: "View and manage running processes on managed devices." },
    ],
  }),
  component: TasksPage,
});

interface TaskRow {
  id: string;
  device_id: string;
  pid: number;
  process_name: string;
  cpu_percent: number;
  memory_mb: number;
  status: string;
  reported_at: string;
}

interface DeviceRow {
  id: string;
  device_name: string;
  hostname: string | null;
}

function TasksPage() {
  const { isAdmin, session } = useAuth();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPid, setBusyPid] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [t, d] = await Promise.all([
      supabase
        .from("device_tasks" as any)
        .select("*")
        .order("reported_at", { ascending: false })
        .limit(500),
      supabase.from("devices").select("id,device_name,hostname").order("device_name"),
    ]);
    if (!t.error) setTasks((t.data as any) ?? []);
    if (!d.error) setDevices((d.data as DeviceRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("device-tasks-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_tasks" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const killProcess = async (deviceId: string, pid: number, name: string) => {
    setBusyPid(`${deviceId}:${pid}`);
    try {
      await issueDeviceCommand(session, {
        deviceId,
        commandType: "kill_process",
        payload: { pid, process_name: name },
      });
      toast.success(`Kill command queued for ${name} (PID ${pid})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue kill command");
    } finally {
      setBusyPid(null);
    }
  };

  const shutdownDevice = async (deviceId: string) => {
    try {
      await issueDeviceCommand(session, {
        deviceId,
        commandType: "shutdown_device",
        payload: {
          grace_seconds: 30,
          reason: "Administrator requested a managed shutdown from Sentinel Net.",
        },
      });
      toast.success("Shutdown command queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue shutdown command");
    }
  };

  const getDeviceName = (deviceId: string) => {
    const d = devices.find((x) => x.id === deviceId);
    return d?.device_name ?? d?.hostname ?? deviceId.slice(0, 8);
  };

  const deviceGroups = tasks.reduce((acc, task) => {
    if (!acc[task.device_id]) acc[task.device_id] = [];
    acc[task.device_id].push(task);
    return acc;
  }, {} as Record<string, TaskRow[]>);

  if (!isAdmin) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">PROCESSES</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Device Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Live running processes from managed endpoints. Kill or shutdown remotely.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : tasks.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Cpu className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No process data available.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(deviceGroups).map(([deviceId, deviceTasks]) => (
            <Card key={deviceId} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-foreground">
                    {getDeviceName(deviceId)}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {deviceTasks.length} processes
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => shutdownDevice(deviceId)}
                >
                  <Skull className="mr-2 h-3.5 w-3.5" /> Shutdown
                </Button>
              </div>
              <div className="divide-y divide-border">
                {deviceTasks.slice(0, 50).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between px-4 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-foreground truncate">
                        {task.process_name}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        PID:{task.pid}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        CPU {task.cpu_percent?.toFixed(1) ?? "-"}%
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        MEM {task.memory_mb?.toFixed(0) ?? "-"} MB
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        disabled={busyPid === `${task.device_id}:${task.pid}`}
                        onClick={() =>
                          killProcess(task.device_id, task.pid, task.process_name)
                        }
                      >
                        {busyPid === `${task.device_id}:${task.pid}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Skull className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

