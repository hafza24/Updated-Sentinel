import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Inbox, Plus, Loader2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/requests")({
  head: () => ({
    meta: [
      { title: "Requests — Sentinel Net" },
      { name: "description", content: "User access requests pending administrator review." },
    ],
  }),
  component: RequestsPage,
});

type ReqType = "domain" | "download" | "uninstall";
type ReqStatus = "pending" | "approved" | "rejected";

interface Req {
  id: string;
  user_id: string;
  request_type: ReqType;
  payload: Record<string, unknown>;
  reason: string | null;
  status: ReqStatus;
  reviewed_by: string | null;
  review_notes: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<ReqStatus, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
};

function RequestsPage() {
  const { isAdmin, user } = useAuth();
  const [requests, setRequests] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReqType>("domain");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRequests((data as Req[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const submitRequest = async () => {
    if (!user) return;
    if (type !== "uninstall" && !target.trim()) {
      toast.error("Please specify the target");
      return;
    }
    setSubmitting(true);
    const payload =
      type === "uninstall"
        ? {}
        : type === "domain"
          ? { domain: target.trim() }
          : { extension: target.trim() };

    const { error } = await supabase.from("requests").insert([
      {
        user_id: user.id,
        request_type: type,
        payload,
        reason: reason.trim() || null,
        status: "pending",
      },
    ]);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Request submitted");
    setTarget("");
    setReason("");
    setOpen(false);
    load();
  };

  const review = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase
      .from("requests")
      .update({ status, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Request ${status}`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">QUEUE</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Review and approve user requests."
              : "Submit and track your access requests."}
          </p>
        </div>
        {!isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> New request
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Submit request</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as ReqType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="domain">Domain access</SelectItem>
                      <SelectItem value="download">Download exception</SelectItem>
                      <SelectItem value="uninstall">Uninstall agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {type !== "uninstall" && (
                  <div className="space-y-2">
                    <Label>{type === "domain" ? "Domain" : "Extension"}</Label>
                    <Input
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      placeholder={type === "domain" ? "example.com" : "exe"}
                      className="font-mono"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why do you need this?"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={submitRequest} disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit
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
      ) : requests.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No requests in the queue.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {requests.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {r.request_type}
                    </Badge>
                    <Badge variant="secondary" className={STATUS_STYLES[r.status]}>
                      {r.status}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>
                  {Object.keys(r.payload).length > 0 && (
                    <p className="font-mono text-xs text-foreground">
                      {Object.entries(r.payload)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ")}
                    </p>
                  )}
                  {r.reason && (
                    <p className="text-sm text-muted-foreground">"{r.reason}"</p>
                  )}
                </div>
                {isAdmin && r.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => review(r.id, "approved")}
                      className="border-success/30 text-success hover:bg-success/10"
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => review(r.id, "rejected")}
                      className="border-destructive/30 text-destructive hover:bg-destructive/10"
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
