import * as React from "react";
import { api, type Dashboard } from "@/lib/api";

export const DASHBOARD_POLL_MS = 3000;

export interface DashboardPoll {
  data: Dashboard | null;
  /** Last poll failed (the previous data stays on screen). */
  error: string | null;
  /** Wall-clock time of the last successful poll. */
  updatedAt: number | null;
  /** The tab is hidden, so polling is on hold. */
  paused: boolean;
  refresh: () => Promise<Dashboard | null>;
}

/**
 * Poll GET /api/dashboard every 3 s, but only while the tab is visible; a tab that becomes
 * visible again refreshes immediately. At most one request is in flight and one timer pending.
 */
export function useDashboardPoll(): DashboardPoll {
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [paused, setPaused] = React.useState(() => document.visibilityState !== "visible");
  const alive = React.useRef(true);

  const refresh = React.useCallback(async () => {
    try {
      const d = await api.dashboard();
      if (!alive.current) return null;
      setData(d);
      setError(null);
      setUpdatedAt(Date.now());
      return d;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Could not load the dashboard.");
      return null;
    }
  }, []);

  React.useEffect(() => {
    alive.current = true;
    let timer: number | undefined;
    let inflight = false;

    async function tick() {
      window.clearTimeout(timer);
      if (!alive.current) return;
      if (document.visibilityState === "visible" && !inflight) {
        inflight = true;
        await refresh();
        inflight = false;
      }
      if (!alive.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, DASHBOARD_POLL_MS);
    }

    function onVisibility() {
      const visible = document.visibilityState === "visible";
      setPaused(!visible);
      if (visible) void tick();
    }

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { data, error, updatedAt, paused, refresh };
}
