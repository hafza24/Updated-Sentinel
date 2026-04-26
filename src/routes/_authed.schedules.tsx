import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, Plus, Trash2, Loader2, Globe, Cpu } from "lucide-react";
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

export const Route = createFileRoute("/_authed/schedules")({
  head: () => ({
    meta: [
      { title: "Time-Based Policies — Sentinel Net" },
      {
        name: "description",
        content: "Schedule when domains and processes are blocked or allowed.",
      },
    ],
  }),
  component: SchedulesPage,
});

interface Schedule {
  id: string;
  name: string;
  target_type: "domain" | "process";
  target_value: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function SchedulesPage() {
  const { isAdmin, user } = useAuth();
  const [items, setItems] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState<"domain" | "process">("domain");
  const [targetValue, setTargetValue] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("policy_schedules")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setItems((data as Schedule[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("schedules-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "policy_schedules" },
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
    setTargetType("domain");
    setTargetValue("");
    setDays([1, 2, 3, 4, 5]);
    setStartTime("09:00");
    setEndTime("17:00");
  };

  const toggleDay = (d: number) =>
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );

  const create = async () => {
    if (!name.trim() || !targetValue.trim() || days.length === 0) {
      toast.error("Fill all fields and pick at least one day");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("policy_schedules").insert({
      name: name.trim(),
      target_type: targetType,
      target_value: targetValue.trim(),
      days_of_week: days,
      start_time: startTime,
      end_time: endTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      created_by: user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Schedule created");
    reset();
    setOpen(false);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("policy_schedules").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Schedule removed");
  };

  const toggleActive = async (id: string, value: boolean) => {
    const { error } = await supabase
      .from("policy_schedules")
      .update({ is_active: value })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            TIME WINDOWS
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Schedules</h1>
          <p className="text-sm text-muted-foreground">
            Block domains or processes only during specific time windows. Times use the device&apos;s
            local clock.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> New schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create schedule</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Block social media during work hours"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Target type</Label>
                    <Select
                      value={targetType}
                      onValueChange={(v) => setTargetType(v as "domain" | "process")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="domain">Domain</SelectItem>
                        <SelectItem value="process">Process</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{targetType === "domain" ? "Domain" : "Process name"}</Label>
                    <Input
                      value={targetValue}
                      onChange={(e) => setTargetValue(e.target.value)}
                      placeholder={
                        targetType === "domain" ? "facebook.com" : "chrome.exe"
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Days of week</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(i)}
                        className={`rounded-md border px-3 py-1 text-xs font-mono uppercase transition-colors ${
                          days.includes(i)
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Start time</Label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End time</Label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
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
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Clock className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No schedules defined.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((s) => {
            const Icon = s.target_type === "domain" ? Globe : Cpu;
            return (
              <Card key={s.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-foreground">{s.name}</h3>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {s.target_type.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      Target: <span className="text-foreground">{s.target_value}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span>
                        {s.start_time.slice(0, 5)} → {s.end_time.slice(0, 5)}
                      </span>
                      <span>·</span>
                      <span>
                        {s.days_of_week.map((d) => DAYS[d]).join(" ")}
                      </span>
                      <span>·</span>
                      <span>{s.timezone}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Active</span>
                      <Switch
                        checked={s.is_active}
                        onCheckedChange={(v) => toggleActive(s.id, v)}
                        disabled={!isAdmin}
                      />
                    </label>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(s.id)}
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
