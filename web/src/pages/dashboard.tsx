import * as React from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, FileText, Gavel, Inbox, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { FlowDiagram, type Flight, type Outcome } from "@/components/dashboard/flow";
import { UploadSourceCard, type DropState } from "@/components/dashboard/upload-card";
import { LevelBadge, StatusBadge, TrustDot } from "@/components/verity/badges";
import { ErrorState } from "@/components/verity/states";
import { TRUST_NAME } from "@/components/verity/topic-card";
import {
  api,
  notifyIssuesChanged,
  type Dashboard,
  type DashboardActivity,
  type DashboardUploadSource,
} from "@/lib/api";
import { countdown, formatAgo, LEVEL_ORDER, useNow } from "@/lib/format";
import { checkUploadFile } from "@/lib/upload";
import { useDashboardPoll } from "@/lib/use-dashboard";
import { cn } from "@/lib/utils";

/** Pull the quoted title out of an activity line ("… uploaded 'Title' → blocked"). */
function titleOf(a: DashboardActivity): string {
  return /'([^']+)'/.exec(a.text)?.[1] ?? "a document";
}

export function DashboardPage() {
  const poll = useDashboardPoll();
  const reducedMotion = !!useReducedMotion();
  const [flights, setFlights] = React.useState<Flight[]>([]);
  const flightsRef = React.useRef(flights);
  flightsRef.current = flights;
  // What's on screen. It only catches up with the latest poll when no document is mid-flight,
  // so a count changes when the dot lands, not before.
  const [shown, setShown] = React.useState<Dashboard | null>(null);
  const [holding, setHolding] = React.useState(false);
  const [pulse, setPulse] = React.useState<{ outcome: Outcome; n: number } | null>(null);
  const [drop, setDrop] = React.useState<DropState>({ phase: "idle" });
  const seen = React.useRef<Set<string> | null>(null);
  const animated = React.useRef(new Set<string>());

  React.useEffect(() => {
    if (poll.data && flights.length === 0 && !holding) setShown(poll.data);
  }, [poll.data, flights.length, holding]);

  // New outcome events between polls (someone else uploaded, an owner resolved) fly through the door.
  React.useEffect(() => {
    const d = poll.data;
    if (!d) return;
    if (!seen.current) {
      seen.current = new Set(d.activity.map((a) => a.id));
      return;
    }
    const fresh = d.activity.filter((a) => !seen.current!.has(a.id));
    fresh.forEach((a) => seen.current!.add(a.id));
    const next: Flight[] = fresh
      .filter((a) => a.outcome && (a.kind === "uploaded" || a.kind === "resolved"))
      .filter((a) => {
        const k = `${a.document_id}:${a.kind}`;
        if (animated.current.has(k)) return false;
        animated.current.add(k);
        return true;
      })
      .reverse() // oldest first
      .slice(-3)
      .map((a) => ({
        key: a.id,
        from: a.kind === "uploaded" ? "upload" : "door",
        outcome: a.outcome as Outcome,
        title: titleOf(a),
        documentId: a.document_id,
        local: false,
      }));
    if (next.length) setFlights((f) => [...f, ...next]);
  }, [poll.data]);

  const onLanded = React.useCallback((f: Flight) => {
    setFlights((fs) => fs.filter((x) => x.key !== f.key));
    setPulse({ outcome: f.outcome, n: Date.now() });
    if (f.local) setDrop((s) => (s.phase === "checking" ? { phase: "done", result: s.result } : s));
  }, []);

  async function onFile(file: File) {
    const problem = checkUploadFile(file);
    if (problem) {
      setDrop({ phase: "error", message: problem });
      return;
    }
    setDrop({ phase: "uploading", name: file.name });
    setHolding(true);
    try {
      const result = await api.upload(file, { silent: true });
      notifyIssuesChanged();
      const key = `${result.document.id}:uploaded`;
      const already = animated.current.has(key);
      animated.current.add(key);
      setDrop({ phase: "checking", name: file.name, result });
      await poll.refresh();
      if (already) {
        // A poll saw it first and queued the flight: make it ours so the card updates on landing.
        if (flightsRef.current.some((f) => f.documentId === result.document.id)) {
          setFlights((fs) => fs.map((f) => (f.documentId === result.document.id ? { ...f, local: true } : f)));
        } else {
          setDrop({ phase: "done", result });
        }
      } else {
        setFlights((fs) => [
          ...fs,
          {
            key: `local-${result.document.id}`,
            from: "upload",
            outcome: result.outcome === "blocked" ? "blocked" : "live",
            title: result.document.title,
            documentId: result.document.id,
            local: true,
          },
        ]);
      }
    } catch (e) {
      setDrop({ phase: "error", message: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setHolding(false);
    }
  }

  const d = shown;
  const upload = (d?.sources.find((s) => s.id === "upload" && s.status === "live") ?? null) as DashboardUploadSource | null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="space-y-1">
          <h1 className="text-display-md">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Every document passes through one check before anyone can rely on it.
          </p>
        </div>
        <LiveIndicator updatedAt={poll.updatedAt} paused={poll.paused} error={!!poll.error} />
      </div>

      {!d ? (
        poll.error ? (
          <Card className="p-2">
            <ErrorState message={poll.error} onRetry={() => void poll.refresh()} />
          </Card>
        ) : (
          <DashboardSkeleton />
        )
      ) : (
        <>
          <StatTiles d={d} />

          <Card className="mt-3 px-5 pt-4 pb-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[14px] font-semibold">
                Many sources, one door
                <span className="ml-2 font-normal text-[12px] text-muted-foreground">
                  Drop a file on Upload to watch it go through the check.
                </span>
              </h2>
              <FlowLegend />
            </div>
            <div className="max-lg:overflow-x-auto">
              <div className="min-w-[900px]">
                <FlowDiagram
                  sources={d.sources}
                  live={d.totals.live}
                  blocked={d.totals.blocked}
                  checked={d.totals.documents}
                  flight={flights[0] ?? null}
                  onFlightLanded={onLanded}
                  reducedMotion={reducedMotion}
                  pulse={pulse}
                  uploadCard={
                    <UploadSourceCard
                      source={upload}
                      state={drop}
                      onFile={(f) => void onFile(f)}
                      onReset={() => setDrop({ phase: "idle" })}
                    />
                  }
                />
              </div>
            </div>
          </Card>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
            <ActivityCard items={d.activity} />
            <HealthCard d={d} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- header + tiles

function LiveIndicator({ updatedAt, paused, error }: { updatedAt: number | null; paused: boolean; error: boolean }) {
  const now = useNow(1000);
  const secs = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  const label = paused
    ? "Paused while this tab is hidden"
    : error
      ? `Reconnecting…${secs !== null ? ` · last update ${secs}s ago` : ""}`
      : secs === null
        ? "Connecting…"
        : `Live · updated ${secs}s ago`;
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 h-7 text-xs text-muted-foreground tabular-nums"
      role="status"
    >
      <span className="relative flex h-2 w-2">
        {!paused && !error && updatedAt && (
          <motion.span
            key={updatedAt}
            className="absolute inset-0 rounded-full bg-ok"
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 2.4 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        )}
        <span className={cn("relative h-2 w-2 rounded-full", paused ? "bg-unknown" : error ? "bg-warn" : "bg-ok")} />
      </span>
      {label}
    </div>
  );
}

function StatTiles({ d }: { d: Dashboard }) {
  const now = useNow(1000);
  const openTotal = LEVEL_ORDER.reduce((n, l) => n + (d.issues.open[l] ?? 0), 0);
  const next = d.issues.next_due;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Documents" value={d.totals.documents} sub={`${d.totals.superseded} superseded · ${d.totals.rejected} rejected`} />
      <Tile label="Live" dot="bg-ok" value={d.totals.live} sub="Can be used in answers" />
      <Tile
        label="Blocked"
        dot="bg-danger"
        value={d.totals.blocked}
        sub={d.totals.blocked ? "Waiting for an owner" : "Nothing is blocked"}
      />
      <Tile
        label="Open issues"
        value={openTotal}
        to="/issues"
        sub={
          next ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">Next:</span>
              <LevelBadge level={next.level} className="px-1.5 py-0 text-[10.5px]" />
              <span className={cn("truncate tabular-nums", countdown(next.due_at, now).overdue && "text-danger font-medium")}>
                {countdown(next.due_at, now).label}
              </span>
            </span>
          ) : (
            "Nothing due"
          )
        }
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  dot,
  to,
}: {
  label: string;
  value: number;
  sub: React.ReactNode;
  dot?: string;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot && <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />}
        {label}
      </div>
      <div className="mt-0.5 text-display-md font-semibold">{value}</div>
      <div className="text-[12px] text-muted-foreground truncate">{sub}</div>
    </>
  );
  return (
    <Card className={cn("px-4 py-3 min-w-0", to && "transition-colors hover:border-foreground/20")}>
      {to ? (
        <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function FlowLegend() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <svg width="18" height="4" aria-hidden>
          <line x1="0" y1="2" x2="18" y2="2" className="stroke-muted-foreground/60" strokeWidth="2" />
        </svg>
        Live path
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="4" aria-hidden>
          <line x1="0" y1="2" x2="18" y2="2" className="stroke-muted-foreground/40" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
        Coming soon
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- bottom row

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  uploaded: Upload,
  published: FileText,
  resolved: Gavel,
};

function ActivityCard({ items }: { items: DashboardActivity[] }) {
  const now = useNow(10_000);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 h-11">
        <h3 className="text-[13px] font-semibold">Activity</h3>
        <span className="text-[11px] text-muted-foreground">Newest first · uploads, checks and decisions</span>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Inbox} title="No activity yet" description="Uploads and decisions will show up here." className="py-8" />
      ) : (
        <ul className="max-h-[372px] overflow-auto divide-y divide-border">
          <AnimatePresence initial={false}>
            {items.map((a) => {
              const Icon = KIND_ICON[a.kind] ?? FileText;
              const inner = (
                <>
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-5 text-foreground line-clamp-2">{a.text}</span>
                    <span className="block text-[11px] text-muted-foreground" title={a.at}>
                      {formatAgo(a.at, now)}
                    </span>
                  </span>
                  {a.outcome && <StatusBadge status={a.outcome} className="mt-0.5 shrink-0 text-[11px]" />}
                </>
              );
              return (
                <motion.li
                  key={a.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  {a.document_id ? (
                    <Link
                      to={`/documents/${encodeURIComponent(a.document_id)}`}
                      className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-2.5">{inner}</div>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}

function HealthCard({ d }: { d: Dashboard }) {
  const topicTotal = d.topics.green + d.topics.amber + d.topics.red;
  return (
    <Card className="p-4">
      <h3 className="text-[13px] font-semibold">Health</h3>

      <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Open issues</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        {LEVEL_ORDER.map((l) => (
          <div key={l} className="flex items-center justify-between">
            <LevelBadge level={l} className="text-[11px]" />
            <span className={cn("text-[13px] tabular-nums", d.issues.open[l] ? "font-semibold" : "text-muted-foreground")}>
              {d.issues.open[l] ?? 0}
            </span>
          </div>
        ))}
      </div>
      <div
        className={cn(
          "mt-3 flex items-center gap-1.5 text-[12px]",
          d.issues.overdue ? "text-danger font-medium" : "text-muted-foreground"
        )}
      >
        {d.issues.overdue ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : null}
        {d.issues.overdue ? `${d.issues.overdue} overdue` : "Nothing overdue"}
      </div>

      <div className="mt-4 border-t border-border pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Topics
      </div>
      {topicTotal > 0 && (
        <div className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          {(["green", "amber", "red"] as const).map(
            (t) =>
              d.topics[t] > 0 && (
                <div
                  key={t}
                  className={cn(t === "green" ? "bg-ok" : t === "amber" ? "bg-warn" : "bg-danger")}
                  style={{ flexGrow: d.topics[t] }}
                />
              )
          )}
        </div>
      )}
      <ul className="mt-2.5 space-y-1.5">
        {(["green", "amber", "red"] as const).map((t) => (
          <li key={t} className="flex items-center gap-2 text-[12px]">
            <TrustDot trust={t} className="[&_.animate-ping]:hidden" />
            <span className="text-muted-foreground">{TRUST_NAME[t]}</span>
            <span className="ml-auto tabular-nums font-medium">{d.topics[t]}</span>
          </li>
        ))}
      </ul>

      <Button asChild variant="outline" size="sm" className="mt-4 w-full">
        <Link to="/issues">
          Open the review queue <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[98px]" />
        ))}
      </div>
      <Skeleton className="h-[540px]" />
    </div>
  );
}
