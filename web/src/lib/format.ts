import * as React from "react";

/** "12 Aug 2026" — accepts ISO dates or datetimes. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Date + time, or just the date when the value carries no real time (date-only seed data). */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length === 10 || /T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(value)) return formatDate(value.slice(0, 10));
  return formatDateTime(value);
}

/** Re-render every `intervalMs` so countdowns stay live. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

function span(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${s}s`;
}

/** "due in 23h 58m" / "overdue by 2h 5m". */
export function countdown(dueAt: string, now: number): { label: string; overdue: boolean } {
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return { label: "no due date", overdue: false };
  const diff = due - now;
  if (diff < 0) return { label: `overdue by ${span(-diff)}`, overdue: true };
  return { label: `due in ${span(diff)}`, overdue: false };
}

export const LEVEL_ORDER = ["critical", "high", "medium", "low"] as const;

export const RULE_LABELS: Record<string, string> = {
  conflict: "Conflicting rule",
  duplicate: "Duplicate document",
  "no-owner": "No owner",
  "stale-version": "Older version",
  "review-overdue": "Review overdue",
  "missing-metadata": "Missing metadata",
};

export function humanizeKey(key: string): string {
  const s = key.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "just now" / "12s ago" / "4m ago" / "3h ago" / "2d ago", then the date. */
export function formatAgo(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return "—";
  const t = new Date(value.length === 10 ? `${value}T00:00:00` : value).getTime();
  if (Number.isNaN(t)) return value;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(value.slice(0, 10));
}
