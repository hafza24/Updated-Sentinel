import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 soc-grid">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
          ERR_ROUTE_NOT_FOUND
        </p>
        <h1 className="mt-4 text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Sector unreachable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The endpoint you requested is not registered in the Sentinel grid.
        </p>
        <div className="mt-6">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Return to console
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sentinel Net — Firewall Operations Console" },
      {
        name: "description",
        content:
          "Centralized firewall management and threat operations console for managing devices, domain blocks, and download policies in real time.",
      },
      { name: "author", content: "Sentinel Net" },
      { property: "og:title", content: "Sentinel Net — Firewall Operations Console" },
      {
        property: "og:description",
        content: "Centralized firewall management and threat operations console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Sentinel Net — Firewall Operations Console" },
      { name: "description", content: "New" },
      { property: "og:description", content: "New" },
      { name: "twitter:description", content: "New" },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/hPSdfrj9DOUC9AOfcts7Lkxu9Rq1/social-images/social-1776537012831-U_(10)_(1).webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/hPSdfrj9DOUC9AOfcts7Lkxu9Rq1/social-images/social-1776537012831-U_(10)_(1).webp" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster />
    </AuthProvider>
  );
}
