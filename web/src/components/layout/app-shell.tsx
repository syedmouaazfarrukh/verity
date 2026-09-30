import * as React from "react";
import { Outlet } from "react-router-dom";
import { Topbar } from "@/components/layout/topbar";
import { Sidebar } from "@/components/layout/sidebar";
import { api, ISSUES_CHANGED } from "@/lib/api";

const SIDEBAR_KEY = "verity.sidebar.collapsed";

export function AppShell() {
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  });
  const [openIssues, setOpenIssues] = React.useState<number | null>(null);

  const toggleSidebar = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  // Open-issue count for the Review queue badge: on mount, every 30s, and
  // whenever an upload/resolve changes it.
  React.useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const issues = await api.issues("open");
        if (!cancelled) setOpenIssues(issues.length);
      } catch {
        if (!cancelled) setOpenIssues(null);
      }
    }
    pull();
    const t = window.setInterval(pull, 30_000);
    window.addEventListener(ISSUES_CHANGED, pull);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener(ISSUES_CHANGED, pull);
    };
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <Topbar />
      <div className="flex flex-1 min-h-0">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} openIssues={openIssues} />
        <main className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
