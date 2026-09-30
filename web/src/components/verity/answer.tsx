import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  CircleCheck,
  FilePlus2,
  FileQuestion,
  FileText,
  Gavel,
  History,
  Layers,
  Loader2,
  Network,
  Quote,
  Receipt as ReceiptIcon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnswerGraph } from "@/components/graph/answer-graph";
import {
  CountryChip,
  DepartmentChip,
  Fingerprint,
  SourceBadge,
  StatusBadge,
} from "@/components/verity/badges";
import { VerityLogo } from "@/components/verity/logo";
import {
  api,
  type Alternative,
  type AnswerGraph as AnswerGraphData,
  type ChatResponse,
  type ProvenanceEvent,
  type ProvenanceKind,
  type Quote as QuoteData,
  type Receipt,
} from "@/lib/api";
import { formatDate, formatDateTime, formatWhen, humanizeKey } from "@/lib/format";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

// ---------------------------------------------------------------- graph id helpers

/** Graph node for a document id (backend may use the bare id or a "doc:" prefix). */
function docNodeId(graph: AnswerGraphData | null, docId: string): string | null {
  if (!graph) return null;
  const n = graph.nodes.find((x) => x.id === docId) ?? graph.nodes.find((x) => x.type === "document" && x.id.endsWith(`:${docId}`));
  return n?.id ?? null;
}
function personNodeId(graph: AnswerGraphData | null, name: string): string | null {
  if (!graph || !name) return null;
  return graph.nodes.find((x) => x.type === "person" && x.label === name)?.id ?? null;
}
function docIdOfNode(nodeId: string): string {
  return nodeId.replace(/^(doc|document):/, "");
}

// ---------------------------------------------------------------- receipt verification

type VerifyState = "checking" | "valid" | "invalid" | "error";

function useReceiptVerification(id: string | undefined) {
  const [state, setState] = React.useState<VerifyState>("checking");
  const [details, setDetails] = React.useState<Record<string, unknown> | null>(null);
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState("checking");
    api
      .verifyReceipt(id)
      .then((r) => {
        if (cancelled) return;
        setState(r.valid ? "valid" : "invalid");
        setDetails(r.receipt ?? null);
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { state, details };
}

const VERIFY_LABEL: Record<VerifyState, string> = {
  checking: "verifying…",
  valid: "verified",
  invalid: "signature invalid",
  error: "could not verify",
};

function ReceiptChip({ receipt, state }: { receipt: Receipt; state: VerifyState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 h-7 text-xs",
        state === "valid" && "border-ok/30 bg-ok-tint text-ok-foreground",
        state === "checking" && "border-border bg-muted text-muted-foreground",
        (state === "invalid" || state === "error") && "border-danger/30 bg-danger-tint text-danger-foreground"
      )}
      title={`Receipt ${receipt.id}\nSHA-256 ${receipt.payload_sha256}\nSigned ${receipt.created_at}`}
    >
      {state === "checking" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "valid" ? (
        <BadgeCheck className="h-3.5 w-3.5" />
      ) : (
        <ShieldAlert className="h-3.5 w-3.5" />
      )}
      Signed receipt · {VERIFY_LABEL[state]}
    </span>
  );
}

// ---------------------------------------------------------------- answer bubble

/** Emphasise the matched claim values inside the answer sentence. */
function EmphasiseValues({ text, values }: { text: string; values: string[] }) {
  const vals = [...new Set(values.filter((v) => v && v.length <= 40 && text.includes(v)))].sort((a, b) => b.length - a.length);
  if (vals.length === 0) return <>{text}</>;
  const re = new RegExp(`(${vals.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((part, i) =>
        vals.includes(part) ? (
          <strong key={i} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

function ModeLabel({ mode }: { mode: ChatResponse["answer_mode"] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-border" aria-hidden>
        ·
      </span>
      {mode === "ai" ? (
        <>
          <Sparkles className="h-3 w-3" aria-hidden /> Worded by local AI · checked against the document
        </>
      ) : (
        <>
          <Quote className="h-3 w-3" aria-hidden /> Quoted from the document
        </>
      )}
    </span>
  );
}

/** A verbatim excerpt from the source: "this is exactly what the document says". */
function QuoteSnippet({ quote }: { quote: QuoteData }) {
  return (
    <figure className="rounded-r-md border-l-2 border-primary bg-primary/[0.06] dark:bg-primary/10 pl-3 pr-3 py-2">
      <blockquote className="text-[13px] leading-5 text-foreground">“{quote.text}”</blockquote>
      <figcaption className="mt-0.5 text-[11px] text-muted-foreground">
        From the document{quote.section ? ` · ${quote.section}` : ""}
      </figcaption>
    </figure>
  );
}

export function AnswerBlock({
  question,
  answer,
  detailsOpen,
  onToggleDetails,
}: {
  question: string;
  answer: ChatResponse;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const doc = answer.document;
  const verify = useReceiptVerification(answer.receipt?.id);
  const alternatives = answer.alternatives ?? [];
  const hasDetails = !!doc;
  const [settled, setSettled] = React.useState(false);

  // Once the panel has expanded, bring the whole panel (cards + graph) into view.
  React.useEffect(() => {
    if (!detailsOpen || !hasDetails) return;
    const t = window.setTimeout(
      () => document.getElementById("answer-details")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      320
    );
    return () => window.clearTimeout(t);
  }, [detailsOpen, hasDetails]);

  const blockedAlts = alternatives.filter((a) => a.status === "blocked").length;
  const quotes = answer.quotes ?? [];

  return (
    <div>
      {/* Question */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm text-foreground">
          {question}
        </div>
      </div>

      {/* Answer */}
      <div className="mt-4 flex gap-3">
        <VerityLogo className="h-7 w-7 mt-1" />
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl rounded-tl-md border border-border bg-card shadow-sm">
            <div className="px-5 pt-3.5 pb-4">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1.5">
                <span className="font-semibold text-foreground/80">Verity</span>
                {doc && <ModeLabel mode={answer.answer_mode} />}
              </div>
              <p className="text-[15px] leading-6 text-foreground">
                <EmphasiseValues text={answer.answer} values={answer.matched_claims?.map((c) => c.value) ?? []} />
              </p>

              {doc && quotes.length > 0 && (
                <div className="mt-3 space-y-2">
                  {quotes.map((q, i) => (
                    <QuoteSnippet key={`${q.section}-${i}`} quote={q} />
                  ))}
                </div>
              )}

              {doc ? (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    From{" "}
                    <Link
                      to={`/documents/${encodeURIComponent(doc.id)}`}
                      className="font-medium text-foreground hover:text-primary underline-offset-4 hover:underline"
                    >
                      {doc.title}
                    </Link>
                    <span className="mx-1.5 text-border">·</span>
                    <span className="font-mono">v{doc.version}</span>
                    <span className="mx-1.5 text-border">·</span>
                    {doc.updated_by}
                    <span className="mx-1.5 text-border">·</span>
                    {formatDate(doc.updated_at)}
                  </span>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-border p-3 flex items-start gap-2.5 text-sm text-muted-foreground">
                  <FileQuestion className="h-4 w-4 mt-0.5 shrink-0" />
                  No trusted live document in your scope answers this. Ask the topic owner, or upload the guidance so
                  Verity can check it.
                </div>
              )}
              {answer.note && <p className="mt-1.5 text-[11px] text-muted-foreground">{answer.note}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
              {answer.receipt && <ReceiptChip receipt={answer.receipt} state={verify.state} />}
              {hasDetails && (
                <div className="ml-auto flex items-center gap-3">
                  {alternatives.length > 0 && (
                    <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums">
                      {alternatives.length} other document{alternatives.length === 1 ? "" : "s"} not used
                      {blockedAlts > 0 && (
                        <span className="text-danger-foreground dark:text-danger font-medium"> · {blockedAlts} blocked</span>
                      )}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={detailsOpen ? "secondary" : "outline"}
                    onClick={onToggleDetails}
                    aria-expanded={detailsOpen}
                    aria-controls="answer-details"
                    className="h-7 gap-1.5"
                  >
                    Details
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform duration-200", detailsOpen && "rotate-180")}
                    />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {detailsOpen && hasDetails && (
          <motion.div
            id="answer-details"
            key="details"
            // overflow is only hidden while animating: the sticky graph column needs it visible.
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            onAnimationStart={() => setSettled(false)}
            onAnimationComplete={() => setSettled(detailsOpen)}
            style={{ overflow: settled ? "visible" : "hidden" }}
          >
            <DetailsPanel answer={answer} verify={verify} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AnswerSkeleton({ question }: { question: string }) {
  return (
    <div>
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm">{question}</div>
      </div>
      <div className="mt-4 flex gap-3">
        <VerityLogo className="h-7 w-7 mt-1 opacity-60" />
        <div className="flex-1 rounded-2xl rounded-tl-md border border-border bg-card px-5 py-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding the single live source…
          </div>
          <div className="h-4 w-4/5 rounded bg-muted animate-pulse" />
          <div className="h-3 w-2/5 rounded bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- details panel

function DetailsPanel({ answer, verify }: { answer: ChatResponse; verify: ReturnType<typeof useReceiptVerification> }) {
  const navigate = useNavigate();
  const graph = answer.graph;
  const [hovered, setHovered] = React.useState<string | null>(null);
  const doc = answer.document!;
  const sourceNode = docNodeId(graph, doc.id);

  const hoverProps = (nodeId: string | null): HoverProps =>
    nodeId
      ? {
          onMouseEnter: () => setHovered(nodeId),
          onMouseLeave: () => setHovered((h) => (h === nodeId ? null : h)),
          onFocus: () => setHovered(nodeId),
          onBlur: () => setHovered((h) => (h === nodeId ? null : h)),
        }
      : {};

  return (
    <div className="pt-4 lg:pl-10">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <div className="space-y-3 min-w-0">
          <SourceCard answer={answer} active={hovered !== null && hovered === sourceNode} hover={hoverProps(sourceNode)} />
          <ProvenanceCard answer={answer} hovered={hovered} hoverProps={hoverProps} />
          <AlternativesCard answer={answer} hovered={hovered} hoverProps={hoverProps} />
          <ReceiptCard receipt={answer.receipt} verify={verify} />
        </div>

        <div className="lg:sticky lg:top-4 min-w-0">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 h-11 border-b border-border">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Network className="h-3.5 w-3.5 text-muted-foreground" /> Answer graph
              </div>
              <GraphLegend />
            </div>
            <div className="relative h-[clamp(320px,calc(100vh-250px),500px)] bg-dot-grid bg-background/60">
              {graph && graph.nodes.length > 0 ? (
                <AnswerGraph
                  data={graph}
                  highlightId={hovered}
                  onHoverNode={setHovered}
                  onOpenNode={(id) => {
                    const n = graph.nodes.find((x) => x.id === id);
                    if (n?.type === "document") navigate(`/documents/${encodeURIComponent(docIdOfNode(id))}`);
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  No graph for this answer.
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
              Hover a card or a node to find it in the other. Click a document to open it.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function GraphLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-primary bg-ok" /> Source
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-unknown/50" /> Not used
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3.5 bg-danger" /> Conflict
      </span>
    </div>
  );
}

function PanelCard({
  icon: Icon,
  title,
  aside,
  children,
  className,
  active,
  ...rest
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card
      className={cn(
        "p-4 transition-[box-shadow,border-color] duration-150",
        active && "border-primary/50 ring-1 ring-primary/30",
        className
      )}
      {...rest}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold min-w-0">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{title}</span>
        </h3>
        {aside}
      </div>
      {children}
    </Card>
  );
}

type HoverProps = Pick<React.HTMLAttributes<HTMLElement>, "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur">;

function SourceCard({
  answer,
  active,
  hover,
}: {
  answer: ChatResponse;
  active: boolean;
  hover: HoverProps;
}) {
  const doc = answer.document!;
  return (
    <PanelCard
      icon={FileText}
      title="Source"
      active={active}
      aside={
        <Button asChild variant="outline" size="sm" className="h-7">
          <Link to={`/documents/${encodeURIComponent(doc.id)}`}>
            Open document <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      }
      {...hover}
    >
      <div className="font-semibold leading-5">{doc.title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <StatusBadge status={doc.status} className="text-[11px] px-1.5 py-0" />
        <CountryChip country={doc.country} />
        {doc.department && <DepartmentChip department={doc.department} />}
        <span className="font-mono text-foreground/80">v{doc.version}</span>
        <span>
          · Updated {formatDate(doc.updated_at)} by <span className="text-foreground/80">{doc.updated_by}</span>
        </span>
      </div>
      {doc.change_summary && (
        <p className="mt-2.5 text-[13px] leading-5 text-muted-foreground">
          <span className="text-foreground/80 font-medium">What changed in v{doc.version}:</span> {doc.change_summary}
        </p>
      )}
      {answer.matched_claims?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {answer.matched_claims.map((c) => (
            <span
              key={`${c.key}-${c.value}`}
              className="text-xs rounded-md border border-ok/30 bg-ok-tint px-2 py-0.5 text-ok-foreground"
            >
              {humanizeKey(c.key)}: <span className="font-semibold">{c.value}</span>
            </span>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

const EVENT_META: Record<ProvenanceKind, { icon: LucideIcon; dot: string }> = {
  created: { icon: FilePlus2, dot: "bg-muted text-muted-foreground border-border" },
  checked: { icon: ShieldCheck, dot: "bg-ok-tint text-ok-foreground border-ok/30" },
  flagged: { icon: TriangleAlert, dot: "bg-danger-tint text-danger-foreground border-danger/30" },
  resolved: { icon: Gavel, dot: "bg-primary/10 text-primary border-primary/30" },
  live: { icon: CircleCheck, dot: "bg-ok text-white border-ok dark:text-zinc-950" },
  superseded_previous: { icon: History, dot: "bg-muted text-muted-foreground border-border" },
};

function ProvenanceCard({
  answer,
  hovered,
  hoverProps,
}: {
  answer: ChatResponse;
  hovered: string | null;
  hoverProps: (id: string | null) => HoverProps;
}) {
  const p = answer.provenance;
  const doc = answer.document!;
  return (
    <PanelCard icon={Layers} title="How it became the source">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
        <SourceBadge source={p?.source ?? doc.source} detail={p?.source_detail ?? doc.source_detail} />
        <Fingerprint value={p?.sha256} />
      </div>
      {!p || p.events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No history recorded for this document.</p>
      ) : (
        <ol className="relative">
          {p.events.map((e, i) => (
            <TimelineEvent
              key={`${e.kind}-${e.at}-${i}`}
              event={e}
              last={i === p.events.length - 1}
              nodeId={personNodeId(answer.graph, e.actor)}
              hovered={hovered}
              hoverProps={hoverProps}
            />
          ))}
        </ol>
      )}
    </PanelCard>
  );
}

function TimelineEvent({
  event,
  last,
  nodeId,
  hovered,
  hoverProps,
}: {
  event: ProvenanceEvent;
  last: boolean;
  nodeId: string | null;
  hovered: string | null;
  hoverProps: (id: string | null) => HoverProps;
}) {
  const meta = EVENT_META[event.kind] ?? EVENT_META.created;
  const Icon = meta.icon;
  const active = nodeId !== null && hovered === nodeId;
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0" {...hoverProps(nodeId)}>
      {!last && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-border" aria-hidden />}
      <span
        className={cn(
          "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
          meta.dot
        )}
      >
        <Icon className="h-3 w-3" aria-hidden />
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-md px-2 py-1 -mx-2 -my-0.5 transition-colors duration-150",
          active && "bg-muted"
        )}
      >
        <p className={cn("text-[13px] leading-5", event.kind === "live" ? "font-medium text-foreground" : "text-foreground/90")}>
          {event.text}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {event.actor && <span className={cn(active && "text-foreground font-medium")}>{event.actor} · </span>}
          {formatWhen(event.at)}
        </p>
      </div>
    </li>
  );
}

function AlternativesCard({
  answer,
  hovered,
  hoverProps,
}: {
  answer: ChatResponse;
  hovered: string | null;
  hoverProps: (id: string | null) => HoverProps;
}) {
  const alts = answer.alternatives ?? [];
  return (
    <PanelCard
      icon={FileText}
      title="Other documents we found, and why we didn't use them"
      aside={
        <span className="shrink-0 text-[11px] tabular-nums rounded-full bg-muted px-2 py-0.5 text-muted-foreground font-medium">
          {alts.length}
        </span>
      }
    >
      {alts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No other versions or copies of this document in your scope. It's the only one.
        </p>
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {alts.map((a) => (
            <AlternativeRow
              key={a.id}
              alt={a}
              nodeId={docNodeId(answer.graph, a.id)}
              active={hovered !== null && hovered === docNodeId(answer.graph, a.id)}
              hoverProps={hoverProps}
            />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function AlternativeRow({
  alt,
  nodeId,
  active,
  hoverProps,
}: {
  alt: Alternative;
  nodeId: string | null;
  active: boolean;
  hoverProps: (id: string | null) => HoverProps;
}) {
  const blocked = alt.status === "blocked";
  return (
    <li>
      <Link
        to={`/documents/${encodeURIComponent(alt.id)}`}
        className={cn(
          "block rounded-md px-2 py-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "bg-muted" : "hover:bg-muted/60"
        )}
        {...hoverProps(nodeId)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={alt.status} className="text-[11px] px-1.5 py-0 shrink-0" />
          <span className="text-[13px] font-medium truncate">{alt.title}</span>
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            <CountryChip country={alt.country} />
            <span className="text-[11px] font-mono text-muted-foreground">v{alt.version}</span>
          </span>
        </div>
        <p className={cn("mt-1 text-xs leading-[18px]", blocked ? "text-foreground/85" : "text-muted-foreground")}>
          {alt.reason}
        </p>
        {(alt.differs.length > 0 || alt.source) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {alt.differs.map((d) => (
              <span
                key={d.key}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-1.5 py-0.5 text-[11px]"
              >
                <span className="text-muted-foreground">{humanizeKey(d.key)}</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    blocked ? "text-danger-foreground dark:text-danger" : "text-muted-foreground line-through decoration-1"
                  )}
                >
                  {d.value}
                </span>
                <span className="text-muted-foreground">vs</span>
                <span className="font-semibold tabular-nums text-ok-foreground dark:text-ok">{d.live_value}</span>
              </span>
            ))}
            {alt.source && alt.source !== "upload" && (
              <SourceBadge source={alt.source} detail={alt.source_detail} className="max-w-[16rem]" />
            )}
          </div>
        )}
      </Link>
    </li>
  );
}

function ReceiptCard({ receipt, verify }: { receipt: Receipt; verify: ReturnType<typeof useReceiptVerification> }) {
  if (!receipt) return null;
  const algorithm = typeof verify.details?.algorithm === "string" ? verify.details.algorithm : "Ed25519";
  return (
    <PanelCard
      icon={ReceiptIcon}
      title="Receipt"
      aside={<ReceiptChip receipt={receipt} state={verify.state} />}
    >
      <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Receipt</dt>
        <dd className="font-mono truncate">{receipt.id}</dd>
        <dt className="text-muted-foreground">Signed</dt>
        <dd>
          {formatDateTime(receipt.created_at)} · {algorithm}
        </dd>
        <dt className="text-muted-foreground">Payload</dt>
        <dd>
          <Fingerprint value={receipt.payload_sha256} label="" />
        </dd>
        <dt className="text-muted-foreground">Signature</dt>
        <dd className="font-mono truncate text-muted-foreground" title={receipt.signature_b64}>
          {receipt.signature_b64.slice(0, 24)}…
        </dd>
      </dl>
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        The question, answer and source version are signed, so anyone can later prove what Verity said and why.
      </p>
    </PanelCard>
  );
}
