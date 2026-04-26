import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Monitor, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/devices")({
  head: () => ({
    meta: [
      { title: "Devices — Sentinel Net" },
      { name: "description", content: "Manage registered agent devices on the Sentinel Net grid." },
    ],
  }),
  component: DevicesPage,
});

interface Device {
  id: string;
  user_id: string;
  device_name: string;
  hostname: string | null;
  os: string | null;
  ip_address: string | null;
  status: "active" | "inactive" | "disabled";
  firewall_enabled: boolean;
  download_restriction_enabled: boolean;
  last_seen: string | null;
  created_at: string;
}

function DevicesPage() {
  const { isAdmin, user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [os, setOs] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setDevices((data as Device[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();

    const channel = supabase
      .channel("devices-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setDevices((prev) => [payload.new as Device, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setDevices((prev) =>
              prev.map((d) => (d.id === (payload.new as Device).id ? (payload.new as Device) : d)),
            );
          } else if (payload.eventType === "DELETE") {
            setDevices((prev) => prev.filter((d) => d.id !== (payload.old as Device).id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const addDevice = async () => {
    if (!name.trim() || !user) return;
    setSubmitting(true);
    const { error } = await supabase.from("devices").insert({
      user_id: user.id,
      device_name: name.trim(),
      hostname: hostname.trim() || null,
      os: os.trim() || null,
      status: "inactive",
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Device registered");
    setName("");
    setHostname("");
    setOs("");
    setOpen(false);
    load();
  };

  const toggle = async (
    id: string,
    field: "firewall_enabled" | "download_restriction_enabled",
    value: boolean,
  ) => {
    const patch =
      field === "firewall_enabled"
        ? { firewall_enabled: value }
        : { download_restriction_enabled: value };
    const { error } = await supabase.from("devices").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">FLEET</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Devices</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "All registered agents across the grid." : "Devices linked to your account."}
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Register device
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Register device</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Device name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="HQ-Workstation-01"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Hostname (optional)</Label>
                  <Input
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    placeholder="hq-ws-01.local"
                  />
                </div>
                <div className="space-y-2">
                  <Label>OS (optional)</Label>
                  <Input
                    value={os}
                    onChange={(e) => setOs(e.target.value)}
                    placeholder="Windows 11 / Ubuntu 22.04"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={addDevice} disabled={submitting || !name.trim()}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Register
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
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
          {devices.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-foreground">{d.device_name}</h3>
                    <Badge
                      variant={d.status === "active" ? "default" : "secondary"}
                      className={
                        d.status === "active"
                          ? "bg-success/15 text-success hover:bg-success/20"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {d.status}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-4">
                    <span>HOST: {d.hostname ?? "—"}</span>
                    <span>OS: {d.os ?? "—"}</span>
                    <span>IP: {d.ip_address ?? "—"}</span>
                    <span>LAST: {d.last_seen ? new Date(d.last_seen).toLocaleString() : "never"}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Firewall</span>
                    <Switch
                      checked={d.firewall_enabled}
                      onCheckedChange={(v) => toggle(d.id, "firewall_enabled", v)}
                      disabled={!isAdmin}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Downloads</span>
                    <Switch
                      checked={d.download_restriction_enabled}
                      onCheckedChange={(v) => toggle(d.id, "download_restriction_enabled", v)}
                      disabled={!isAdmin}
                    />
                  </label>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
