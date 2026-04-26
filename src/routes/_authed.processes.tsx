import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Cpu, Plus, Trash2, Loader2, Skull, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/processes")({
  head: () => ({
    meta: [
      { title: "Process Blacklist — Sentinel Net" },
      {
        name: "description",
        content: "Manage blacklisted processes that agents will detect and terminate.",
      },
    ],
  }),
  component: ProcessesPage,
});

interface BlacklistEntry {
  id: string;
  process_name: string;
  description: string | null;
  kill_on_detect: boolean;
  created_at: string;
}

function ProcessesPage() {
  const { isAdmin, user } = useAuth();
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [killFlag, setKillFlag] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("process_blacklist")
      .select("*")
      .order("process_name", { ascending: true });
    if (error) toast.error(error.message);
    else setEntries((data as BlacklistEntry[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();

    const channel = supabase
      .channel("process-blacklist-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "process_blacklist" },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const add = async () => {
    const clean = name.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,100}$/.test(clean)) {
      toast.error("Process name must be 2–100 chars (letters, numbers, . _ -)");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("process_blacklist").insert({
      process_name: clean,
      description: desc.trim() || null,
      kill_on_detect: killFlag,
      created_by: user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Process added to blacklist");
    setName("");
    setDesc("");
    setKillFlag(true);
    setOpen(false);
  };

  const toggleKill = async (entry: BlacklistEntry) => {
    const { error } = await supabase
      .from("process_blacklist")
      .update({ kill_on_detect: !entry.kill_on_detect })
      .eq("id", entry.id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("process_blacklist").delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">POLICY</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Process Blacklist</h1>
          <p className="text-sm text-muted-foreground">
            Executables that agents must detect — and optionally terminate — on every device.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add process
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add blacklisted process</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Process name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="utorrent.exe"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description (optional)</Label>
                  <Input
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="BitTorrent client"
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <Label className="text-sm">Kill on detect</Label>
                    <p className="text-xs text-muted-foreground">
                      Off = alert only. On = terminate immediately.
                    </p>
                  </div>
                  <Switch checked={killFlag} onCheckedChange={setKillFlag} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={add} disabled={submitting || !name.trim()}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add
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
      ) : entries.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Cpu className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No blacklisted processes yet.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-foreground">{e.process_name}</span>
                      <Badge
                        variant="secondary"
                        className={
                          e.kill_on_detect
                            ? "bg-destructive/15 text-destructive"
                            : "bg-warning/15 text-warning"
                        }
                      >
                        {e.kill_on_detect ? (
                          <>
                            <Skull className="mr-1 h-3 w-3" /> KILL
                          </>
                        ) : (
                          <>
                            <Eye className="mr-1 h-3 w-3" /> ALERT
                          </>
                        )}
                      </Badge>
                    </div>
                    {e.description && (
                      <p className="truncate text-xs text-muted-foreground">{e.description}</p>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        kill
                      </span>
                      <Switch
                        checked={e.kill_on_detect}
                        onCheckedChange={() => toggleKill(e)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(e.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
