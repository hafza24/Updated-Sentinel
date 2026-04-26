import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background soc-grid">
        <div className="flex flex-col items-center gap-3">
          <Shield className="h-10 w-10 animate-pulse text-primary" />
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Initializing Sentinel
          </p>
        </div>
      </div>
    );
  }

  return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} />;
}
