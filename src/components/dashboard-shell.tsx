import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Shield,
  LayoutDashboard,
  Monitor,
  Globe,
  Download,
  AlertTriangle,
  Inbox,
  LogOut,
  Activity,
  Cpu,
  Clock,
  Zap,
  Settings as SettingsIcon,
  ShieldAlert,
  Radio,
  Terminal,
  UserCircle,
  Webhook,
  HeartPulse,
  Database as DatabaseIcon,
  Camera,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/my-status", label: "My Status", icon: UserCircle },
  { to: "/activity", label: "Activity", icon: Radio },
  { to: "/devices", label: "Devices", icon: Monitor },
  { to: "/device-control", label: "Remote Control", icon: Terminal, adminOnly: true },
  { to: "/risk", label: "Risk Scores", icon: ShieldAlert, adminOnly: true },
  { to: "/domains", label: "Domains", icon: Globe },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/processes", label: "Processes", icon: Cpu },
  { to: "/schedules", label: "Schedules", icon: Clock },
  { to: "/auto-response", label: "Auto-Response", icon: Zap },
  { to: "/alerts", label: "Alerts", icon: AlertTriangle },
  { to: "/requests", label: "Requests", icon: Inbox },
  { to: "/telemetry", label: "Telemetry", icon: HeartPulse },
  { to: "/webhooks", label: "Webhooks", icon: Webhook, adminOnly: true },
  { to: "/retention", label: "Retention", icon: Camera, adminOnly: true },
  { to: "/backups", label: "Backups", icon: DatabaseIcon, adminOnly: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const { username, role, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/30 bg-card soc-glow">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide text-sidebar-foreground">SENTINEL NET</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Console v0.1
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => {
            const active =
              location.pathname === item.to ||
              (item.to !== "/dashboard" && location.pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="mb-3 flex items-center gap-3 rounded-md bg-sidebar-accent/40 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 font-mono text-xs uppercase text-primary">
              {(username ?? "?").charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">
                {username ?? "operator"}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {role ?? "user"}
                {isAdmin && " · privileged"}
              </p>
            </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card/40 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <Activity className="h-4 w-4 animate-pulse text-success" />
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              System nominal
            </span>
          </div>
          <div className="md:hidden">
            <Button onClick={handleLogout} variant="ghost" size="sm">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
