import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shield, Download, Cpu, Loader2, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({
    meta: [
      { title: "System Settings — Sentinel Net" },
      {
        name: "description",
        content: "Global enforcement toggles for firewall, downloads, and processes.",
      },
    ],
  }),
  component: SettingsPage,
});

interface AppSettings {
  id: string;
  firewall_enabled: boolean;
  download_restriction_enabled: boolean;
  process_enforcement_enabled: boolean;
  updated_at: string;
}

function SettingsPage() {
  const { isAdmin, user } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) toast.error(error.message);
      else setSettings(data as AppSettings | null);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel("app-settings-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload) => {
          if (payload.eventType !== "DELETE") {
            setSettings(payload.new as AppSettings);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const toggle = async (
    field: "firewall_enabled" | "download_restriction_enabled" | "process_enforcement_enabled",
    value: boolean,
  ) => {
    if (!settings || !isAdmin) return;
    setBusy(field);
    const patch: {
      firewall_enabled?: boolean;
      download_restriction_enabled?: boolean;
      process_enforcement_enabled?: boolean;
      updated_by: string | null;
    } = { updated_by: user?.id ?? null };
    if (field === "firewall_enabled") patch.firewall_enabled = value;
    else if (field === "download_restriction_enabled")
      patch.download_restriction_enabled = value;
    else patch.process_enforcement_enabled = value;
    const { error } = await supabase
      .from("app_settings")
      .update(patch)
      .eq("id", settings.id);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSettings({ ...settings, [field]: value });
    toast.success(`${humanLabel(field)} ${value ? "enabled" : "disabled"} globally`);
  };

  const items: Array<{
    key: "firewall_enabled" | "download_restriction_enabled" | "process_enforcement_enabled";
    icon: typeof Shield;
    title: string;
    desc: string;
  }> = [
    {
      key: "firewall_enabled",
      icon: Shield,
      title: "Firewall enforcement",
      desc: "Master switch for all domain blocking on every device. When OFF, agents stop applying hosts rules.",
    },
    {
      key: "download_restriction_enabled",
      icon: Download,
      title: "Download restrictions",
      desc: "Globally enforce download policies. When OFF, agents stop deleting blocked files.",
    },
    {
      key: "process_enforcement_enabled",
      icon: Cpu,
      title: "Process enforcement",
      desc: "Globally enforce the process blacklist. When OFF, agents stop killing blacklisted processes.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">CONTROL</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">System Settings</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Master switches that override every device. Changes propagate in real time."
            : "Read-only view of system-wide enforcement state."}
        </p>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : !settings ? (
        <Card className="p-6 text-sm text-muted-foreground">No settings row found.</Card>
      ) : (
        <div className="grid gap-3">
          {items.map((it) => {
            const Icon = it.icon;
            const enabled = settings[it.key];
            return (
              <Card key={it.key} className="p-5">
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border ${
                      enabled
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-destructive/40 bg-destructive/10 text-destructive"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{it.title}</h3>
                      <Badge
                        variant="secondary"
                        className={
                          enabled
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive"
                        }
                      >
                        <Power className="mr-1 h-3 w-3" />
                        {enabled ? "ENABLED" : "DISABLED"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{it.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {busy === it.key && (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    )}
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => toggle(it.key, v)}
                      disabled={!isAdmin || busy !== null}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!isAdmin && (
        <Card className="border-warning/30 bg-warning/5 p-4">
          <p className="text-sm text-warning-foreground">
            <span className="font-semibold text-warning">Read-only:</span> Only administrators can
            change global enforcement settings.
          </p>
        </Card>
      )}
    </div>
  );
}

function humanLabel(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\benabled\b/, "")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}
