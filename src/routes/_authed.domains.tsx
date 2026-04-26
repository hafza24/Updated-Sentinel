import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Globe, Plus, Trash2, Loader2 } from "lucide-react";
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

export const Route = createFileRoute("/_authed/domains")({
  head: () => ({
    meta: [
      { title: "Domain Rules — Sentinel Net" },
      { name: "description", content: "Manage domain block and allow rules across devices." },
    ],
  }),
  component: DomainsPage,
});

interface Domain {
  id: string;
  domain_name: string;
  is_blocked: boolean;
  scope: "global" | "device";
  device_id: string | null;
  created_at: string;
}

function DomainsPage() {
  const { isAdmin, user } = useAuth();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("domains")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setDomains((data as Domain[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const addDomain = async () => {
    const clean = name.trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
      toast.error("Enter a valid domain (e.g., example.com)");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("domains").insert({
      domain_name: clean,
      is_blocked: true,
      scope: "global",
      created_by: user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Domain rule added");
    setName("");
    setOpen(false);
    load();
  };

  const toggleBlock = async (id: string, value: boolean) => {
    const { error } = await supabase.from("domains").update({ is_blocked: value }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDomains((prev) => prev.map((d) => (d.id === id ? { ...d, is_blocked: value } : d)));
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("domains").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDomains((prev) => prev.filter((d) => d.id !== id));
    toast.success("Rule removed");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">RULESET</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Domains</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Manage block and allow rules. Agents pull these on next sync."
              : "View domain rules currently enforced on your devices."}
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add domain
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add domain rule</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label>Domain</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="facebook.com"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Added as global block by default. Toggle to allow.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={addDomain} disabled={submitting || !name.trim()}>
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
      ) : domains.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Globe className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No domain rules configured.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {domains.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="truncate font-mono text-sm text-foreground">{d.domain_name}</p>
                    <Badge
                      variant="secondary"
                      className={
                        d.is_blocked
                          ? "bg-destructive/15 text-destructive"
                          : "bg-success/15 text-success"
                      }
                    >
                      {d.is_blocked ? "BLOCKED" : "ALLOWED"}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {d.scope}
                    </Badge>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Block
                      <Switch
                        checked={d.is_blocked}
                        onCheckedChange={(v) => toggleBlock(d.id, v)}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(d.id)}
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
