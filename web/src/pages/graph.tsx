import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronRight, Network, RefreshCw, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { CytoscapeGraph } from "@/components/graph/cytoscape-graph";
import { departmentLabel, StatusBadge, TrustDot } from "@/components/verity/badges";
import { ErrorState } from "@/components/verity/states";
import { api, type GraphEdge, type GraphNode, type GraphResponse } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<GraphNode["type"], string> = {
  topic: "Topic",
  document: "Document",
  person: "Person",
  country: "Country",
  department: "Department",
};

const EDGE_LABEL: Record<GraphEdge["type"], string> = {
  covers: "covers",
  owned_by: "owned by",
  applies_to: "applies to",
  supersedes: "supersedes",
  conflicts_with: "conflicts with",
  belongs_to: "belongs to",
};

/** Graph document node ids may be prefixed ("doc:…"); strip to get the document id. */
function documentIdOf(node: GraphNode): string {
  return node.id.replace(/^(doc|document):/, "");
}
/** Topic node ids are "topic:<slug>"; the drill-down API wants the slug. */
function topicIdOf(node: GraphNode): string {
  return node.id.replace(/^topic:/, "");
}
function nodeLabel(node: GraphNode): string {
  return node.type === "department" ? departmentLabel(node.label) : node.label;
}

export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const topic = params.get("topic");
  const state = useAsync(() => api.graph(topic ?? undefined), [topic]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const isMap = !topic;

  React.useEffect(() => setSelectedId(null), [topic]);

  const drillInto = React.useCallback(
    (topicId: string) => setParams({ topic: topicId }),
    [setParams]
  );

  const onSelect = React.useCallback(
    (id: string | null) => {
      if (id && isMap) {
        const node = state.data?.nodes.find((n) => n.id === id);
        if (node?.type === "topic") {
          drillInto(topicIdOf(node));
          return;
        }
      }
      setSelectedId(id);
    },
    [isMap, state.data, drillInto]
  );

  const topicName = topic
    ? (state.data?.nodes.find((n) => n.type === "topic" && topicIdOf(n) === topic)?.label ?? topic)
    : null;

  return (
    <div className="relative h-full w-full bg-dot-grid overflow-hidden">
      {state.loading && !state.data ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-24 w-24 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      ) : state.error ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <ErrorState message={state.error} onRetry={state.reload} />
        </div>
      ) : state.data && state.data.nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <EmptyState
            icon={Network}
            title={isMap ? "Nothing to map yet" : "No documents on this topic in your scope"}
            description={
              isMap
                ? "Upload documents to see how topics, countries and departments connect."
                : "It may have been removed, or it's outside your countries or departments."
            }
            action={
              !isMap ? (
                <Button size="sm" variant="outline" onClick={() => setParams({})}>
                  Back to all topics
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : state.data ? (
        <>
          <CytoscapeGraph
            key={topic ?? "__map"}
            data={state.data}
            selectedId={selectedId}
            onSelectNode={onSelect}
            variant={isMap ? "map" : "detail"}
          />
          <GraphHeader
            data={state.data}
            topicName={topicName}
            loading={state.loading}
            onBack={() => setParams({})}
            onRefresh={state.reload}
            selectedId={selectedId}
            onSelect={onSelect}
          />
          {isMap ? <MapLegend /> : <DetailLegend />}
          <AnimatePresence>
            {selectedId && (
              <NodePanel
                key={selectedId}
                data={state.data}
                nodeId={selectedId}
                isMap={isMap}
                onClose={() => setSelectedId(null)}
                onSelect={onSelect}
              />
            )}
          </AnimatePresence>
        </>
      ) : null}
    </div>
  );
}

function GraphHeader({
  data,
  topicName,
  loading,
  onBack,
  onRefresh,
  selectedId,
  onSelect,
}: {
  data: GraphResponse;
  topicName: string | null;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const conflicts = data.edges.filter((e) => e.type === "conflicts_with").length;
  const topics = data.nodes.filter((n) => n.type === "topic").length;
  const docs = data.nodes.filter((n) => n.type === "document").length;
  const redTopics = data.nodes.filter((n) => n.type === "topic" && n.trust === "red").length;

  return (
    <div className="absolute top-0 inset-x-0 z-10 border-b border-border bg-background/95 px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {topicName ? <><button type="button" onClick={onBack} className="rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">All topics</button><ChevronRight className="h-3 w-3" aria-hidden /><span aria-current="page" className="truncate">{topicName}</span></> : <span aria-current="page">All topics</span>}
          </nav>
          <h1 className="text-xl tracking-tight">{topicName ?? "Your knowledge, connected"}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {topicName ? `${docs} document${docs === 1 ? "" : "s"} · explore their relationships` : `${topics} topic${topics === 1 ? "" : "s"} · choose a topic to explore its documents`}
            {(topicName ? conflicts : redTopics) > 0 && <span className="ml-2 text-danger-foreground dark:text-danger">· {topicName ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}` : `${redTopics} with a conflict`}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div>
            <label htmlFor="graph-node" className="sr-only">Explore a node</label>
            <select id="graph-node" value={selectedId ?? ""} onChange={(event) => onSelect(event.target.value || null)} className="h-9 w-44 rounded-lg border border-border bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">{topicName ? "Explore a node…" : "Explore a topic…"}</option>
              {data.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)} · {TYPE_LABEL[node.type]}</option>)}
            </select>
          </div>
          <Button variant="outline" size="icon" className="bg-card h-9 w-9" onClick={onRefresh} aria-label="Refresh graph"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
        </div>
      </div>
    </div>
  );
}

const dot = (cls: string) => <span className={cn("h-2.5 w-2.5 rounded-full inline-block shrink-0", cls)} />;

function MapLegend() {
  return (
    <Card className="absolute bottom-5 left-5 z-10 p-3 text-[11px] flex flex-wrap items-center gap-x-4 gap-y-2 max-w-[calc(100%-12rem)]">
      <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground">Legend</div>
      <div className="flex items-center gap-2">
        {dot("border border-primary bg-card")} Topic · size = documents
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="flex items-center gap-1">{dot("bg-ok")} trusted</span>
        <span className="flex items-center gap-1">{dot("bg-warn")} attention</span>
        <span className="flex items-center gap-1">{dot("bg-danger")} conflict</span>
      </div>
      <div className="flex items-center gap-2">{dot("bg-sky-500")} Country</div>
      <div className="flex items-center gap-2">{dot("bg-zinc-600")} Department</div>
    </Card>
  );
}

function DetailLegend() {
  return (
    <Card className="absolute bottom-5 left-5 z-10 p-3 text-[11px] flex flex-wrap items-center gap-x-4 gap-y-2 max-w-[calc(100%-12rem)]">
      <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground">Legend</div>
      <div className="flex items-center gap-2">{dot("bg-primary")} Topic · ring = trust</div>
      <div className="flex items-center gap-2">{dot("bg-ok")} Live document</div>
      <div className="flex items-center gap-2">{dot("bg-danger")} Blocked document</div>
      <div className="flex items-center gap-2">{dot("bg-unknown")} Superseded document</div>
      <div className="flex items-center gap-2">{dot("bg-zinc-500")} Person</div>
      <div className="flex items-center gap-2">{dot("bg-sky-500")} Country</div>
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-2.5 bg-danger inline-block" /> Conflict
      </div>
    </Card>
  );
}

function NodePanel({
  data,
  nodeId,
  isMap,
  onClose,
  onSelect,
}: {
  data: GraphResponse;
  nodeId: string;
  isMap: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const links = data.edges
    .filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => {
      const outgoing = e.source === nodeId;
      const other = byId.get(outgoing ? e.target : e.source);
      return other ? { edge: e, other, outgoing } : null;
    })
    .filter((x): x is { edge: GraphEdge; other: GraphNode; outgoing: boolean } => x !== null);

  return (
    <motion.div
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="absolute top-28 right-4 bottom-24 z-20 w-80 max-w-[calc(100%-2rem)]"
    >
      <Card className="h-full flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{TYPE_LABEL[node.type]}</div>
            <div className="font-semibold mt-0.5 break-words">{nodeLabel(node)}</div>
            {(node.status || node.trust) && (
              <div className="mt-2 flex items-center gap-2">
                {node.status && <StatusBadge status={node.status} />}
                {node.trust && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrustDot trust={node.trust} />{" "}
                    {node.trust === "green" ? "Trusted" : node.trust === "amber" ? "Needs attention" : "Conflict"}
                  </span>
                )}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label="Close panel">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            {isMap ? "Topics" : "Connections"} ({links.length})
          </div>
          {links.length === 0 ? (
            <p className="text-xs text-muted-foreground">No connections.</p>
          ) : (
            <ul className="space-y-1">
              {links.map(({ edge, other, outgoing }) => (
                <li key={edge.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(other.id)}
                    className={cn(
                      "w-full text-left rounded-md px-2 py-1.5 hover:bg-muted text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      edge.type === "conflicts_with" && "bg-danger-tint text-danger-foreground hover:bg-danger-tint/80"
                    )}
                  >
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      {other.trust && <TrustDot trust={other.trust} className="h-2 w-2" />}
                      {outgoing ? EDGE_LABEL[edge.type] : `${EDGE_LABEL[edge.type]} (from)`} · {TYPE_LABEL[other.type]}
                      {isMap && other.type === "topic" && typeof other.doc_count === "number" && (
                        <span className="ml-auto tabular-nums">
                          {other.doc_count} doc{other.doc_count === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                    <span className="truncate block">{nodeLabel(other)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {node.type === "document" && (
          <div className="p-4 border-t border-border">
            <Button asChild className="w-full">
              <Link to={`/documents/${encodeURIComponent(documentIdOf(node))}`}>
                Open document <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
