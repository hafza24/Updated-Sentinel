import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Database, Download, Loader2, Plus, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authed/backups")({
  head: () => ({ meta: [{ title: "Backup & Restore — Sentinel Net" }] }),
  component: BackupsPage,
});

interface Snapshot {
  id: string;
  label: string;
  notes: string | null;
  status: "pending" | "ready" | "failed" | "restored";
  size_bytes: number | null;
  storage_path: string | null;
  table_counts: Record<string, number>;
  created_at: string;
  restored_at: string | null;
}

function BackupsPage() {
  const { isAdmin, session } = useAuth();
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = async () => {
    const { data } = await supabase
      .from("db_snapshots")
      .select("*")
      .order("created_at", { ascending: false });
    setSnaps((data as Snapshot[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []);

  const createSnapshot = async () => {
    if (!session?.access_token) return;
    setCreating(true);
    try {
      const res = await fetch("/api/public/create-snapshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          label: label.trim() || `snapshot-${new Date().toISOString().slice(0, 19)}`,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Snapshot failed");
      toast.success("Snapshot created");
      setLabel("");
      setNotes("");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const downloadSnap = async (snap: Snapshot) => {
    if (!snap.storage_path) return;
    const { data, error } = await supabase.storage
      .from("violation-screenshots")
      .createSignedUrl(snap.storage_path, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const markRestored = async (snap: Snapshot) => {
    if (!confirm(`Mark "${snap.label}" as restored?\n\nThis only updates the audit log — true restore requires uploading the JSON via Lovable Cloud.`)) {
      return;
    }
    await supabase
      .from("db_snapshots")
      .update({ status: "restored", restored_at: new Date().toISOString() })
      .eq("id", snap.id);
    refresh();
  };

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center text-muted-foreground">Admin only.</Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">DISASTER RECOVERY</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Backup & Restore</h1>
        <p className="text-sm text-muted-foreground">
          Versioned JSON snapshots of all configuration tables. Stored under{" "}
          <code className="font-mono text-xs">snapshots/</code> in the secure bucket.
        </p>
      </div>

      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="pre-policy-rollout"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context"
              rows={1}
            />
          </div>
        </div>
        <Button className="mt-4" onClick={createSnapshot} disabled={creating}>
          {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
          Create snapshot
        </Button>
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      ) : snaps.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Database className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No snapshots yet.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {snaps.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 p-4">
              <Badge
                variant="outline"
                className={
                  s.status === "ready"
                    ? "bg-success/15 text-success"
                    : s.status === "restored"
                      ? "bg-info/15 text-info"
                      : s.status === "failed"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-warning/15 text-warning"
                }
              >
                {s.status}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.label}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {new Date(s.created_at).toLocaleString()}
                  {s.size_bytes ? ` · ${(s.size_bytes / 1024).toFixed(1)} KB` : ""}
                </p>
                {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
              </div>
              {s.storage_path && (
                <Button size="sm" variant="outline" onClick={() => downloadSnap(s)}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                </Button>
              )}
              {s.status === "ready" && (
                <Button size="sm" variant="ghost" onClick={() => markRestored(s)}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Mark restored
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
