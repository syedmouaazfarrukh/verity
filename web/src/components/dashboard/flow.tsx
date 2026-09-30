/**
 * "Many sources, one door": the dashboard's live diagram.
 *
 * Layout is plain HTML (CSS grid) so it stays crisp and responsive; the connectors are an SVG
 * layer underneath, drawn from the nodes' measured positions (ResizeObserver keeps them in sync).
 * The real path (Upload → door → Live → Answers) runs on one horizontal spine: the source column
 * is balanced around the Upload card, so every column's centre lines up with it.
 *
 * A "flight" is one document travelling through the door: a dot moves Upload → door, the door
 * shows it is checking, then the dot leaves for Live or Blocked and the parent pulses the count.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Loader2, MessageSquare, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/verity/brand-icons";
import type { DashboardSource } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Outcome = "live" | "blocked";

export interface Flight {
  key: string;
  /** Uploads enter at the Upload card; a resolution starts inside the door. */
  from: "upload" | "door";
  outcome: Outcome;
  title: string;
  documentId: string | null;
  /** Started by this user's drop on the Upload card. */
  local: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Pt = [number, number];
type Bezier = [Pt, Pt, Pt, Pt];

const SEG_MS = 650;
const DOOR_MS = 450;

/** Horizontal S-curve between two points. */
function curve(a: Pt, b: Pt): Bezier {
  const dx = Math.max(24, (b[0] - a[0]) * 0.5);
  return [a, [a[0] + dx, a[1]], [b[0] - dx, b[1]], b];
}
function pathD([p0, p1, p2, p3]: Bezier): string {
  return `M${p0[0]},${p0[1]} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;
}
function at([p0, p1, p2, p3]: Bezier, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const right = (r: Rect): Pt => [r.x + r.w, r.y + r.h / 2];
const left = (r: Rect): Pt => [r.x, r.y + r.h / 2];

export function FlowDiagram({
  sources,
  live,
  blocked,
  checked,
  uploadCard,
  flight,
  onFlightLanded,
  reducedMotion,
  pulse,
}: {
  sources: DashboardSource[];
  live: number;
  blocked: number;
  /** Documents that have been through the door (shown on the door). */
  checked: number;
  /** The Upload source card (a drop zone), rendered by the page. */
  uploadCard: React.ReactNode;
  flight: Flight | null;
  onFlightLanded: (f: Flight) => void;
  reducedMotion: boolean;
  pulse: { outcome: Outcome; n: number } | null;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const els = React.useRef(new Map<string, HTMLElement>());
  const refCbs = React.useRef(new Map<string, (el: HTMLElement | null) => void>());
  const [geo, setGeo] = React.useState<Record<string, Rect>>({});
  const geoRef = React.useRef(geo);
  geoRef.current = geo;

  const reg = React.useCallback((id: string) => {
    let cb = refCbs.current.get(id);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) els.current.set(id, el);
        else els.current.delete(id);
      };
      refCbs.current.set(id, cb);
    }
    return cb;
  }, []);

  const comingSoon = sources.filter((s) => s.status === "coming_soon");
  const above = comingSoon.slice(0, 4);
  const below = comingSoon.slice(4);
  // Visual order top → bottom; the Upload card sits in the middle, on the spine.
  const order = [...above.map((s) => s.id), "upload", ...below.map((s) => s.id)];

  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const base = wrap.getBoundingClientRect();
      const next: Record<string, Rect> = {};
      els.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        next[id] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      });
      setGeo((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    els.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [sources.length]);

  // ---------------------------------------------------------------- connectors
  const door = geo.door;
  const doorIn = (id: string): Pt | null => {
    if (!door) return null;
    const k = order.indexOf(id) - order.indexOf("upload");
    const step = Math.min(18, (door.h * 0.8) / Math.max(1, order.length));
    return [door.x, door.y + door.h / 2 + k * step];
  };
  const doorOutLive: Pt | null = door ? right(door) : null;
  const doorOutBlocked: Pt | null = door ? [door.x + door.w, door.y + door.h / 2 + Math.min(40, door.h * 0.28)] : null;

  const edges: { id: string; d: string; className: string; width: number; dashed?: boolean }[] = [];
  for (const s of comingSoon) {
    const r = geo[`src-${s.id}`];
    const to = doorIn(s.id);
    if (r && to) {
      edges.push({ id: s.id, d: pathD(curve(right(r), to)), className: "stroke-muted-foreground/25", width: 1, dashed: true });
    }
  }
  const up = sources.find((s) => s.id === "upload");
  const upDocs = up && up.status === "live" ? up.documents : 0;
  const upBez = geo["src-upload"] && door ? curve(right(geo["src-upload"]), doorIn("upload")!) : null;
  const liveBez = doorOutLive && geo.live ? curve(doorOutLive, left(geo.live)) : null;
  const blockedBez = doorOutBlocked && geo.blocked ? curve(doorOutBlocked, left(geo.blocked)) : null;
  const answersBez = geo.live && geo.answers ? curve(right(geo.live), left(geo.answers)) : null;

  // ---------------------------------------------------------------- flight
  const dotRef = React.useRef<SVGGElement>(null);
  const [phase, setPhase] = React.useState<"idle" | "in" | "door" | "out">("idle");
  const landedRef = React.useRef(onFlightLanded);
  landedRef.current = onFlightLanded;

  React.useEffect(() => {
    if (!flight) return;
    const g = geoRef.current;
    const d = g.door;
    const enter =
      flight.from === "upload" && g["src-upload"] && d
        ? curve(right(g["src-upload"]), [d.x, d.y + d.h / 2])
        : null;
    const target = g[flight.outcome];
    const exitFrom: Pt | null = d
      ? flight.outcome === "live"
        ? right(d)
        : [d.x + d.w, d.y + d.h / 2 + Math.min(40, d.h * 0.28)]
      : null;
    const exit = exitFrom && target ? curve(exitFrom, left(target)) : null;

    if (reducedMotion || !exit) {
      // No travel: the count update itself confirms the change.
      landedRef.current(flight);
      return;
    }

    const t1 = enter ? SEG_MS : 0;
    const t2 = t1 + DOOR_MS;
    const t3 = t2 + SEG_MS;
    const start = performance.now();
    let raf = 0;
    let last: typeof phase | null = null;
    const set = (p: typeof phase) => {
      if (p !== last) {
        last = p;
        setPhase(p);
      }
    };
    const place = (pt: Pt, visible: boolean) => {
      const el = dotRef.current;
      if (!el) return;
      el.setAttribute("transform", `translate(${pt[0]},${pt[1]})`);
      el.style.opacity = visible ? "1" : "0";
    };

    const frame = (now: number) => {
      const t = now - start;
      if (enter && t < t1) {
        set("in");
        place(at(enter, easeInOut(t / t1)), true);
      } else if (t < t2) {
        set("door");
        place([d!.x + d!.w / 2, d!.y + d!.h / 2], false);
      } else if (t < t3) {
        set("out");
        place(at(exit, easeInOut((t - t2) / SEG_MS)), true);
      } else {
        place(exit[3], false);
        set("idle");
        landedRef.current(flight);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      setPhase("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.key, reducedMotion]);

  const travelling = flight && phase !== "idle" ? flight : null;
  const hot = (edge: "upload" | Outcome) =>
    !!travelling &&
    ((edge === "upload" && phase === "in") || (edge === travelling.outcome && phase === "out"));

  return (
    <div
      ref={wrapRef}
      className="relative grid items-center gap-x-10 [grid-template-columns:minmax(284px,320px)_minmax(224px,264px)_minmax(158px,176px)_minmax(152px,172px)] justify-between"
    >
      {/* connectors */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {edges.map((e) => (
          <path
            key={e.id}
            d={e.d}
            fill="none"
            className={e.className}
            strokeWidth={e.width}
            strokeDasharray={e.dashed ? "3 4" : undefined}
          />
        ))}
        {upBez && (
          <path
            d={pathD(upBez)}
            fill="none"
            className={cn("transition-[stroke] duration-200", hot("upload") ? "stroke-primary" : "stroke-muted-foreground/60")}
            strokeWidth={1.5 + Math.min(2, upDocs / 10)}
            strokeLinecap="round"
          />
        )}
        {liveBez && (
          <path
            d={pathD(liveBez)}
            fill="none"
            className={cn("stroke-ok transition-opacity duration-200", hot("live") ? "opacity-100" : "opacity-60")}
            strokeWidth={1.5 + Math.min(2, live / 8)}
            strokeLinecap="round"
          />
        )}
        {blockedBez && (
          <path
            d={pathD(blockedBez)}
            fill="none"
            className={cn(
              "stroke-danger transition-opacity duration-200",
              hot("blocked") ? "opacity-100" : blocked > 0 ? "opacity-60" : "opacity-30"
            )}
            strokeWidth={blocked > 0 ? 1.5 + Math.min(2, blocked / 4) : 1}
            strokeDasharray={blocked > 0 ? undefined : "3 4"}
            strokeLinecap="round"
          />
        )}
        {answersBez && (
          <path d={pathD(answersBez)} fill="none" className="stroke-ok opacity-60" strokeWidth={1.5} strokeLinecap="round" />
        )}
        {/* ports on the door */}
        {door &&
          [doorIn("upload"), doorOutLive, doorOutBlocked].map(
            (p, i) =>
              p && <circle key={i} cx={p[0]} cy={p[1]} r={3} className="fill-card stroke-muted-foreground/60" strokeWidth={1.5} />
          )}
      </svg>

      {/* column 1: sources, balanced around Upload */}
      <div className="relative z-10 flex flex-col gap-1">
        {above.map((s) => (
          <ComingSoonCard key={s.id} source={s} nodeRef={reg(`src-${s.id}`)} />
        ))}
        <div ref={reg("src-upload")} className="my-2">
          {uploadCard}
        </div>
        {below.map((s) => (
          <ComingSoonCard key={s.id} source={s} nodeRef={reg(`src-${s.id}`)} />
        ))}
        {/* Balances the column (4 above, 3 + this below) and says plainly what is real. */}
        <p className="h-[30px] flex items-center px-1 text-[11px] leading-[14px] text-muted-foreground">
          Only Upload is live today. These connectors are on the roadmap.
        </p>
      </div>

      {/* column 2: the door */}
      <div ref={reg("door")} className="relative z-10">
        <Door checking={travelling && phase === "door" ? travelling.title : null} checked={checked} />
      </div>

      {/* column 3: outcomes; a spacer the size of Blocked keeps Live on the spine */}
      <div className="relative z-10 flex flex-col gap-4">
        <div className="h-[92px] invisible" aria-hidden />
        <div ref={reg("live")}>
          <OutcomeNode outcome="live" count={live} pulse={pulse?.outcome === "live" ? pulse.n : 0} reducedMotion={reducedMotion} />
        </div>
        <div ref={reg("blocked")}>
          <OutcomeNode outcome="blocked" count={blocked} pulse={pulse?.outcome === "blocked" ? pulse.n : 0} reducedMotion={reducedMotion} />
        </div>
      </div>

      {/* column 4: answers */}
      <div ref={reg("answers")} className="relative z-10">
        <AnswersNode />
      </div>

      {/* the travelling document, above everything */}
      <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible" aria-hidden>
        <g ref={dotRef} style={{ opacity: 0 }}>
          <circle
            r={11}
            className={cn(
              "opacity-25",
              phase === "out" ? (travelling?.outcome === "blocked" ? "fill-danger" : "fill-ok") : "fill-primary"
            )}
          />
          <circle
            r={6}
            className={cn(
              "stroke-card",
              phase === "out" ? (travelling?.outcome === "blocked" ? "fill-danger" : "fill-ok") : "fill-primary"
            )}
            strokeWidth={2}
          />
        </g>
      </svg>
      <span className="sr-only" aria-live="polite">
        {travelling && phase === "door" ? `Checking ${travelling.title}` : ""}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- nodes

function ComingSoonCard({
  source,
  nodeRef,
}: {
  source: DashboardSource;
  nodeRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={nodeRef}
      aria-disabled
      title={`${source.label}: coming soon. Not connected.`}
      className="h-[30px] flex items-center gap-2.5 rounded-md border border-dashed border-border bg-background/40 px-2.5 select-none"
    >
      <span className="flex h-5 w-5 items-center justify-center opacity-60 grayscale blur-[0.6px]">
        <BrandMark source={source.id} className="h-4 w-4 text-foreground" />
      </span>
      <span className="text-[13px] text-muted-foreground/80 truncate blur-[0.3px]">{source.label}</span>
      <span className="ml-auto shrink-0 rounded px-1.5 py-px text-[10.5px] leading-4 font-medium text-muted-foreground bg-muted">
        Coming soon
      </span>
    </div>
  );
}

const CHECKS = [
  "Source and uploader recorded",
  "Fingerprint (SHA-256)",
  "Rules per country: conflicts, versions, owner",
  "Department access",
];

function Door({ checking, checked }: { checking: string | null; checked: number }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-[border-color,box-shadow] duration-200",
        checking ? "border-primary/60 ring-4 ring-primary/15" : "border-border"
      )}
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">One door</div>
            <div className="text-[14px] font-semibold leading-5">The Verity check</div>
          </div>
        </div>
        <ul className="mt-3 space-y-1.5">
          {CHECKS.map((c) => (
            <li key={c} className="flex items-start gap-2 text-[12px] leading-4 text-muted-foreground">
              <Check className="mt-px h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 h-9 text-[12px]">
        {checking ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
            <span className="truncate text-foreground">Checking “{checking}”</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
            <span className="text-muted-foreground">
              Monitoring · <span className="tabular-nums text-foreground">{checked}</span> checked
            </span>
          </>
        )}
      </div>
    </div>
  );
}

const OUTCOME_META: Record<Outcome, { label: string; sub: string; box: string; dot: string; ring: string }> = {
  live: {
    label: "Live",
    sub: "Used in answers",
    box: "bg-ok-tint border-ok/30 dark:bg-ok/10",
    dot: "bg-ok",
    ring: "hsl(var(--ok) / 0.45)",
  },
  blocked: {
    label: "Blocked",
    sub: "Waiting for an owner",
    box: "bg-danger-tint border-danger/30 dark:bg-danger/10",
    dot: "bg-danger",
    ring: "hsl(var(--danger) / 0.45)",
  },
};

function OutcomeNode({
  outcome,
  count,
  pulse,
  reducedMotion,
}: {
  outcome: Outcome;
  count: number;
  pulse: number;
  reducedMotion: boolean;
}) {
  const m = OUTCOME_META[outcome];
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
        <span className={cn("h-2 w-2 rounded-full", m.dot)} aria-hidden />
        {m.label}
      </div>
      <motion.div
        key={pulse}
        initial={pulse && !reducedMotion ? { scale: 1.18 } : false}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="mt-1 origin-left text-display-md font-semibold text-foreground"
      >
        {count}
      </motion.div>
      <div className="text-[11px] text-muted-foreground truncate">
        {outcome === "blocked" && count === 0 ? "Nothing is blocked" : m.sub}
      </div>
    </>
  );
  return (
    <motion.div
      key={pulse}
      initial={pulse ? { boxShadow: `0 0 0 0 ${m.ring}` } : false}
      animate={{ boxShadow: `0 0 0 12px ${m.ring.replace("0.45", "0")}` }}
      transition={{ duration: 0.9, ease: "easeOut" }}
      className={cn("h-[92px] rounded-lg border px-3.5 py-2.5", m.box)}
    >
      {outcome === "blocked" ? (
        <Link
          to="/issues"
          className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Open the review queue"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </motion.div>
  );
}

function AnswersNode() {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Answers
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground">Chat · Copilot · search</div>
      <div className="mt-2 text-[11px] leading-4 text-muted-foreground">Only live documents are used.</div>
    </div>
  );
}
