import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Send, Trash2, Webhook } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authed/webhooks")({
  head: () => ({ meta: [{ title: "Webhooks — Sentinel Net" }] }),
  component: WebhooksPage,
});

type Provider = "slack" | "discord" | "generic";
type Severity = "info" | "warning" | "critical";

interface Endpoint {
  id: string;
  name: string;
  provider: Provider;
  url: string;
  is_active: boolean;
  min_severity: Severity;
  created_at: string;
}

interface Delivery {
  id: string;
  endpoint_id: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

function WebhooksPage() {
  const { isAdmin } = useAuth();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<Provider>("slack");
  const [minSeverity, setMinSeverity] = useState<Severity>("critical");

  const refresh = async () => {
    const [{ data: eps }, { data: dels }] = await Promise.all([
      supabase.from("webhook_endpoints").select("*").order("created_at", { ascending: false }),
      supabase
        .from("webhook_deliveries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setEndpoints((eps as Endpoint[]) ?? []);
    setDeliveries((dels as Delivery[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error("Name and URL are required");
      return;
    }
    const { error } = await supabase.from("webhook_endpoints").insert({
      name: name.trim(),
      url: url.trim(),
      provider,
      min_severity: minSeverity,
    });
    if (error) return toast.error(error.message);
    setName("");
    setUrl("");
    toast.success("Webhook added");
    refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("webhook_endpoints").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Webhook removed");
    refresh();
  };

  const toggle = async (ep: Endpoint) => {
    await supabase
      .from("webhook_endpoints")
      .update({ is_active: !ep.is_active })
      .eq("id", ep.id);
    refresh();
  };

  const sendTest = async (ep: Endpoint) => {
    // Insert a synthetic delivery so the dispatcher picks it up immediately
    const { error } = await supabase.from("webhook_deliveries").insert({
      endpoint_id: ep.id,
      payload: {
        action_type: "test_alert",
        target: "sentinel-net://test",
        severity: "critical",
        created_at: new Date().toISOString(),
      },
    });
    if (error) return toast.error(error.message);
    toast.success("Test enqueued — dispatching…");
    // Trigger the dispatcher now
    fetch("/api/public/dispatch-webhooks", { method: "POST" }).catch(() => {});
    setTimeout(refresh, 1500);
  };

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        Admin only. Ask an administrator for access.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">NOTIFICATIONS</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Webhook Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Push critical alerts to Slack, Discord, or any HTTPS endpoint.
        </p>
      </div>

      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="SOC Channel" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Webhook URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/..." />
          </div>
          <div>
            <Label className="text-xs">Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="discord">Discord</SelectItem>
                <SelectItem value="generic">Generic JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Min severity</Label>
            <Select value={minSeverity} onValueChange={(v) => setMinSeverity(v as Severity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button className="mt-4" onClick={create}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add webhook
        </Button>
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : endpoints.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Webhook className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No webhooks configured.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {endpoints.map((ep) => (
            <div key={ep.id} className="flex flex-wrap items-center gap-3 p-4">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {ep.provider}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{ep.name}</p>
                <p className="break-all font-mono text-[11px] text-muted-foreground">{ep.url}</p>
              </div>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                ≥ {ep.min_severity}
              </Badge>
              <div className="flex items-center gap-2">
                <Switch checked={ep.is_active} onCheckedChange={() => toggle(ep)} />
                <span className="text-xs text-muted-foreground">{ep.is_active ? "Active" : "Off"}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => sendTest(ep)}>
                <Send className="mr-1.5 h-3.5 w-3.5" /> Test
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(ep.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Recent deliveries
        </h2>
        <Card className="divide-y divide-border">
          {deliveries.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">No deliveries yet.</p>
          ) : (
            deliveries.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 text-xs">
                <Badge
                  variant="outline"
                  className={
                    d.status === "sent"
                      ? "bg-success/15 text-success"
                      : d.status === "failed"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-warning/15 text-warning"
                  }
                >
                  {d.status}
                </Badge>
                <span className="font-mono text-muted-foreground">
                  {new Date(d.created_at).toLocaleString()}
                </span>
                <span className="text-muted-foreground">attempts: {d.attempts}</span>
                {d.last_error && (
                  <span className="ml-auto truncate text-destructive" title={d.last_error}>
                    {d.last_error}
                  </span>
                )}
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
