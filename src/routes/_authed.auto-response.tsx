import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Zap, Plus, Trash2, Loader2, ShieldAlert } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/auto-response")({
  head: () => ({
    meta: [
      { title: "Auto-Response Rules — Sentinel Net" },
      {
        name: "description",
        content: "Automated actions when violations exceed thresholds.",
      },
    ],
  }),
  component: AutoResponsePage,
});

type Action = "log_only" | "temp_block_all" | "disable_network" | "lock_device";
type Trigger = "violation_count" | "single_violation";
type Severity = "info" | "warning" | "critical";
type Source = "domain" | "download" | "process";

interface Rule {
  id: string;
  name: string;
  trigger_type: Trigger;
  violation_threshold: number;
  time_window_minutes: number;
  action: Action;
  action_duration_minutes: number;
  severity_filter: Severity | null;
  source_filter: Source | null;
  is_active: boolean;
}

const ACTION_LABELS: Record<Action, { label: string; tone: string; desc: string }> = {
  log_only: {
    label: "Log only",
    tone: "bg-muted text-muted-foreground",
    desc: "Record event, no enforcement.",
  },
  temp_block_all: {
    label: "Temp block all domains",
    tone: "bg-warning/15 text-warning",
    desc: "Reversible: applies hosts-file blackhole for the duration.",
  },
  disable_network: {
    label: "Disable network adapter",
    tone: "bg-destructive/15 text-destructive",
    desc: "Hard: turns off the network interface via netsh.",
  },
  lock_device: {
    label: "Lock workstation",
    tone: "bg-destructive/15 text-destructive",
    desc: "Hard: invokes LockWorkStation, user must re-enter credentials.",
  },
};

function AutoResponsePage() {
  const { isAdmin, user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("violation_count");
  const [threshold, setThreshold] = useState(5);
  const [windowMin, setWindowMin] = useState(10);
  const [action, setAction] = useState<Action>("log_only");
  const [duration, setDuration] = useState(60);
  const [severity, setSeverity] = useState<Severity | "any">("any");
  const [source, setSource] = useState<Source | "any">("any");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("auto_response_rules")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRules((data as Rule[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("auto-response-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "auto_response_rules" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setName("");
    setTrigger("violation_count");
    setThreshold(5);
    setWindowMin(10);
    setAction("log_only");
    setDuration(60);
    setSeverity("any");
    setSource("any");
  };

  const create = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("auto_response_rules").insert({
      name: name.trim(),
      trigger_type: trigger,
      violation_threshold: trigger === "single_violation" ? 1 : threshold,
      time_window_minutes: windowMin,
      action,
      action_duration_minutes: duration,
      severity_filter: severity === "any" ? null : severity,
      source_filter: source === "any" ? null : source,
      created_by: user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Rule created");
    reset();
    setOpen(false);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("auto_response_rules").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Rule removed");
  };

  const toggleActive = async (id: string, value: boolean) => {
    const { error } = await supabase
      .from("auto_response_rules")
      .update({ is_active: value })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            AUTOMATION
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Auto-Response Rules</h1>
          <p className="text-sm text-muted-foreground">
            When violations exceed a threshold, the agent runs the configured action automatically.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> New rule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create auto-response rule</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="5 download violations → kill internet for 1h"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Trigger</Label>
                    <Select
                      value={trigger}
                      onValueChange={(v) => setTrigger(v as Trigger)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="violation_count">N violations in window</SelectItem>
                        <SelectItem value="single_violation">Any single violation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <Select value={action} onValueChange={(v) => setAction(v as Action)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                          <SelectItem key={a} value={a}>
                            {ACTION_LABELS[a].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{ACTION_LABELS[action].desc}</p>
                {trigger === "violation_count" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Threshold (violations)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Window (minutes)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={windowMin}
                        onChange={(e) => setWindowMin(Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
                {action !== "log_only" && action !== "lock_device" && (
                  <div className="space-y-2">
                    <Label>Action duration (minutes)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Severity filter</Label>
                    <Select value={severity} onValueChange={(v) => setSeverity(v as Severity | "any")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Source filter</Label>
                    <Select value={source} onValueChange={(v) => setSource(v as Source | "any")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="domain">Domain</SelectItem>
                        <SelectItem value="download">Download</SelectItem>
                        <SelectItem value="process">Process</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={create} disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
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
          <Zap className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No auto-response rules configured.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rules.map((r) => {
            const meta = ACTION_LABELS[r.action];
            return (
              <Card key={r.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-foreground">{r.name}</h3>
                      <Badge variant="secondary" className={meta.tone}>
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      {r.trigger_type === "single_violation"
                        ? "Triggers on any single violation"
                        : `${r.violation_threshold} violations in ${r.time_window_minutes} min`}
                      {r.severity_filter && ` · severity=${r.severity_filter}`}
                      {r.source_filter && ` · source=${r.source_filter}`}
                      {r.action !== "log_only" && r.action !== "lock_device" &&
                        ` · for ${r.action_duration_minutes} min`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Active</span>
                      <Switch
                        checked={r.is_active}
                        onCheckedChange={(v) => toggleActive(r.id, v)}
                        disabled={!isAdmin}
                      />
                    </label>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(r.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
