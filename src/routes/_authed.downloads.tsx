import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Plus, Trash2, Loader2 } from "lucide-react";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/downloads")({
  head: () => ({
    meta: [
      { title: "Download Rules — Sentinel Net" },
      { name: "description", content: "Configure download restrictions by extension and size." },
    ],
  }),
  component: DownloadsPage,
});

interface Rule {
  id: string;
  extension: string;
  size_limit_mb: number | null;
  is_blocked: boolean;
  scope: "global" | "device";
  created_at: string;
}

function DownloadsPage() {
  const { isAdmin, user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [ext, setExt] = useState("");
  const [size, setSize] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("downloads")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRules((data as Rule[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const addRule = async () => {
    let clean = ext.trim().toLowerCase().replace(/^\./, "");
    if (!/^[a-z0-9]{1,10}$/.test(clean)) {
      toast.error("Enter a valid extension (e.g., exe, zip)");
      return;
    }
    clean = `.${clean}`;
    const sizeNum = size.trim() ? parseInt(size, 10) : null;
    if (size.trim() && (Number.isNaN(sizeNum!) || sizeNum! < 0)) {
      toast.error("Size limit must be a positive number");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("downloads").insert({
      extension: clean,
      size_limit_mb: sizeNum,
      is_blocked: true,
      scope: "global",
      created_by: user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Download rule added");
    setExt("");
    setSize("");
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("downloads").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">POLICY</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Downloads</h1>
          <p className="text-sm text-muted-foreground">
            Restrict file types and sizes that agents may download.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add rule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add download rule</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Extension</Label>
                  <Input
                    value={ext}
                    onChange={(e) => setExt(e.target.value)}
                    placeholder="exe"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max size in MB (optional)</Label>
                  <Input
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    placeholder="100"
                    type="number"
                    className="font-mono"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={addRule} disabled={submitting || !ext.trim()}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add rule
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
      ) : rules.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Download className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No download policies configured.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-sm text-foreground">{r.extension}</span>
                  <Badge
                    variant="secondary"
                    className={
                      r.is_blocked
                        ? "bg-destructive/15 text-destructive"
                        : "bg-success/15 text-success"
                    }
                  >
                    {r.is_blocked ? "BLOCKED" : "ALLOWED"}
                  </Badge>
                  {r.size_limit_mb !== null && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      MAX {r.size_limit_mb} MB
                    </Badge>
                  )}
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(r.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
