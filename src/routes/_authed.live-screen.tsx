import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Monitor, Loader2, Play, Square, Radio, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { issueDeviceCommand } from "@/lib/device-command-api";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/live-screen")({
  head: () => ({
    meta: [
      { title: "Live Screen - Sentinel Net" },
      { name: "description", content: "View live screen streams from managed devices." },
    ],
  }),
  component: LiveScreenPage,
});

interface ScreenSession {
  id: string;
  device_id: string;
  status: string;
  ws_endpoint: string | null;
  started_at: string;
  stopped_at: string | null;
}

interface DeviceRow {
  id: string;
  device_name: string;
  hostname: string | null;
}

function LiveScreenPage() {
  const { isAdmin, session } = useAuth();
  const [sessions, setSessions] = useState<ScreenSession[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [s, d] = await Promise.all([
      supabase
        .from("screen_sessions" as any)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(50),
      supabase.from("devices").select("id,device_name,hostname").order("device_name"),
    ]);
    if (!s.error) setSessions((s.data as any) ?? []);
    if (!d.error) setDevices((d.data as DeviceRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("screen-sessions-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screen_sessions" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const sendCommand = async (
    deviceId: string,
    cmd: "start_stream" | "stop_stream",
    payload?: { session_id?: string },
  ) => {
    try {
      await issueDeviceCommand(session, {
        deviceId,
        commandType: cmd,
        payload:
          cmd === "start_stream"
            ? {
                max_fps: 2,
                jpeg_quality: 60,
                session_note: "Administrator requested a consented screen share.",
              }
            : payload ?? {},
      });
      toast.success(`Queued: ${cmd.replace("_", " ")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue screen-share command");
    }
  };

  const getDeviceName = (deviceId: string) => {
    const d = devices.find((x) => x.id === deviceId);
    return d?.device_name ?? d?.hostname ?? deviceId.slice(0, 8);
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
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">SCREEN SHARE</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Live Screen</h1>
        <p className="text-sm text-muted-foreground">
          View operator-requested screen-share sessions from managed endpoints.
        </p>
      </div>

      {streamUrl && (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-destructive animate-pulse" />
              <span className="text-sm font-semibold">Live Stream</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStreamUrl(null)}>
              Close
            </Button>
          </div>
          <div className="aspect-video w-full bg-black">
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img
              src={streamUrl}
              alt="Live stream"
              className="h-full w-full object-contain"
              onError={() => {
                toast.error("Stream disconnected");
                setStreamUrl(null);
              }}
            />
          </div>
        </Card>
      )}

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : sessions.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Monitor className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No active screen sessions.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sessions.map((session) => (
            <Card key={session.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-foreground">
                      {getDeviceName(session.device_id)}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        session.status === "active"
                          ? "border-success/30 bg-success/15 text-success"
                          : "border-muted bg-muted/40 text-muted-foreground"
                      }
                    >
                      {session.status}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Started: {new Date(session.started_at).toLocaleString()}
                  </p>
                  {session.ws_endpoint && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {session.ws_endpoint}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {session.status === "active" && session.ws_endpoint && (
                    <Button size="sm" onClick={() => setStreamUrl(session.ws_endpoint!)}>
                      <Eye className="mr-2 h-3.5 w-3.5" /> View
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendCommand(session.device_id, "start_stream")}
                  >
                    <Play className="mr-2 h-3.5 w-3.5" /> Start
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => sendCommand(session.device_id, "stop_stream", { session_id: session.id })}
                  >
                    <Square className="mr-2 h-3.5 w-3.5" /> Stop
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {devices
          .filter((d) => !sessions.some((s) => s.device_id === d.id && s.status === "active"))
          .map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">{d.device_name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {d.hostname ?? "-"}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => sendCommand(d.id, "start_stream")}>
                  <Play className="mr-2 h-3.5 w-3.5" /> Stream
                </Button>
              </div>
            </Card>
          ))}
      </div>
    </div>
  );
}

