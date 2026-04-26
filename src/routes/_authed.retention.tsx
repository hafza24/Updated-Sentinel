import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Camera, Loader2, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authed/retention")({
  head: () => ({ meta: [{ title: "Evidence Retention — Sentinel Net" }] }),
  component: RetentionPage,
});

interface Policy {
  id: string;
  retention_days: number;
  auto_purge_enabled: boolean;
  updated_at: string;
}

interface Deletion {
  id: string;
  screenshot_path: string;
  reason: string;
  deleted_at: string;
  device_id: string | null;
}

function RetentionPage() {
  const { isAdmin } = useAuth();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [deletions, setDeletions] = useState<Deletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [days, setDays] = useState(30);
  const [autoPurge, setAutoPurge] = useState(true);

  const refresh = async () => {
    const [{ data: pol }, { data: dels }] = await Promise.all([
      supabase.from("screenshot_retention_policies").select("*").maybeSingle(),
      supabase
        .from("screenshot_deletions")
        .select("*")
        .order("deleted_at", { ascending: false })
        .limit(200),
    ]);
    if (pol) {
      setPolicy(pol as Policy);
      setDays(pol.retention_days);
      setAutoPurge(pol.auto_purge_enabled);
    }
    setDeletions((dels as Deletion[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    const { error } = await supabase
      .from("screenshot_retention_policies")
      .update({ retention_days: days, auto_purge_enabled: autoPurge })
      .eq("id", policy.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Policy saved");
    refresh();
  };

  const purgeNow = async () => {
    if (!confirm(`Purge screenshots older than ${days} days now?`)) return;
    setPurging(true);
    try {
      const res = await fetch("/api/public/purge-screenshots", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast.success(`Purged ${json.purged ?? 0} screenshots`);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPurging(false);
    }
  };

  if (!isAdmin) {
    return <Card className="p-8 text-center text-muted-foreground">Admin only.</Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">EVIDENCE</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Retention Policy</h1>
        <p className="text-sm text-muted-foreground">
          Auto-expire violation screenshots and inspect every deletion.
        </p>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label className="text-xs">Retention (days)</Label>
            <Input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value || "0", 10))}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Screenshots older than this are purged daily at 03:00 UTC.
            </p>
          </div>
          <div>
            <Label className="text-xs">Auto-purge</Label>
            <div className="mt-2 flex items-center gap-2">
              <Switch checked={autoPurge} onCheckedChange={setAutoPurge} />
              <span className="text-xs text-muted-foreground">
                {autoPurge ? "Enabled" : "Manual only"}
              </span>
            </div>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <Button onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save policy
            </Button>
            <Button variant="outline" onClick={purgeNow} disabled={purging}>
              {purging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
              Purge now
            </Button>
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Deletion history
        </h2>
        {loading ? (
          <Card className="flex items-center justify-center p-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </Card>
        ) : deletions.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <Camera className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No deletions logged.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {deletions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-xs">
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {d.reason}
                </Badge>
                <span className="break-all font-mono text-muted-foreground">{d.screenshot_path}</span>
                <span className="ml-auto font-mono text-muted-foreground">
                  {new Date(d.deleted_at).toLocaleString()}
                </span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
