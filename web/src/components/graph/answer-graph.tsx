import * as React from "react";
import { useReducedMotion } from "framer-motion";
import cytoscape, { type Core, type EventObject, type NodeSingular } from "cytoscape";
import { useTheme } from "next-themes";
import { answerGraphStylesheet } from "@/components/graph/node-styles";
import type { AnswerGraph as AnswerGraphData } from "@/lib/api";

interface Props {
  data: AnswerGraphData;
  /** Node brought forward from outside (a hovered card row). */
  highlightId: string | null;
  onHoverNode: (nodeId: string | null) => void;
  onOpenNode?: (nodeId: string) => void;
}

const TYPE_ORDER: Record<string, number> = { topic: 0, country: 1, person: 2, document: 3, department: 4 };

function fitCapped(cy: Core) {
  cy.fit(undefined, 28);
  if (cy.zoom() > 1.25) {
    cy.zoom(1.25);
    cy.center();
  }
}

/**
 * Radial layout on ellipses (the panel is wider than tall). Ring = graph distance from the source.
 * Ring 1 is spread evenly with the topic on top; outer rings cluster around the angle of the
 * ring-1 node they hang off, which keeps edges short and uncrossed.
 */
function radialLayout(cy: Core, sourceId: string | null) {
  const src = sourceId ? cy.getElementById(sourceId) : cy.collection();
  const depth = new Map<string, number>();
  const parent = new Map<string, string>();
  if (src.nonempty()) {
    depth.set(src.id(), 0);
    const queue = [src.id()];
    while (queue.length) {
      const id = queue.shift()!;
      const d = depth.get(id)!;
      const neighbours = cy
        .getElementById(id)
        .neighborhood()
        .nodes()
        .sort((a, b) => (TYPE_ORDER[a.data("type")] ?? 9) - (TYPE_ORDER[b.data("type")] ?? 9));
      neighbours.forEach((n) => {
        if (!depth.has(n.id())) {
          depth.set(n.id(), d + 1);
          parent.set(n.id(), id);
          queue.push(n.id());
        }
      });
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  cy.nodes().forEach((n) => {
    if (!depth.has(n.id())) depth.set(n.id(), maxDepth + 1);
  });

  const RX = [0, 170, 300, 400];
  const RY = [0, 118, 222, 290];
  const angle = new Map<string, number>();
  const pos = new Map<string, { x: number; y: number }>();
  const place = (id: string, ring: number, a: number) => {
    const r = Math.min(ring, RX.length - 1);
    angle.set(id, a);
    pos.set(id, { x: RX[r] * Math.cos(a), y: RY[r] * Math.sin(a) });
  };
  if (src.nonempty()) pos.set(src.id(), { x: 0, y: 0 });

  const ring = (k: number) =>
    cy
      .nodes()
      .filter((n) => depth.get(n.id()) === k)
      .sort((a, b) => (TYPE_ORDER[a.data("type")] ?? 9) - (TYPE_ORDER[b.data("type")] ?? 9));

  // Ring 1: topic at the top, the rest evenly round.
  const r1 = ring(1);
  r1.forEach((n, i) => place(n.id(), 1, -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, r1.length)));

  for (let k = 2; k <= maxDepth + 1; k++) {
    const groups = new Map<string, string[]>();
    ring(k).forEach((n) => {
      const p = parent.get(n.id()) ?? "";
      groups.set(p, [...(groups.get(p) ?? []), n.id()]);
    });
    const orphans = groups.get("") ?? [];
    groups.delete("");
    const step = 0.52; // radians between siblings
    for (const [p, ids] of groups) {
      const base = angle.get(p) ?? -Math.PI / 2;
      ids.forEach((id, i) => place(id, k, base + (i - (ids.length - 1) / 2) * step));
    }
    orphans.forEach((id, i) => place(id, k, Math.PI / 2 + (i - (orphans.length - 1) / 2) * step));
  }

  cy.layout({
    name: "preset",
    positions: (n: NodeSingular) => pos.get(n.id()) ?? { x: 0, y: 0 },
    fit: false,
    animate: false,
  } as cytoscape.LayoutOptions).run();
}

/**
 * The graph of one answer. Layout is deterministic and radial (see radialLayout): the source
 * document sits in the middle, its direct neighbours form the first ring, everything else outside. On mount the whole graph is shown,
 * then the focus transition runs once: the source ring grows and everything off its path dims.
 */
export function AnswerGraph({ data, highlightId, onHoverNode, onOpenNode }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<Core | null>(null);
  const hoverRef = React.useRef(onHoverNode);
  hoverRef.current = onHoverNode;
  const openRef = React.useRef(onOpenNode);
  openRef.current = onOpenNode;
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const reducedMotion = !!useReducedMotion();
  const [focused, setFocused] = React.useState(false);

  const sourceId = React.useMemo(() => data.nodes.find((n) => n.role === "source")?.id ?? null, [data]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    const edges = data.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    const cy = cytoscape({
      container: el,
      elements: [
        ...data.nodes.map((n) => ({ group: "nodes" as const, data: { ...n } })),
        ...edges.map((e) => ({ group: "edges" as const, data: { ...e } })),
      ],
      style: answerGraphStylesheet({ dark, reducedMotion }) as never,
      minZoom: 0.4,
      maxZoom: 1.6,
      boxSelectionEnabled: false,
      autoungrabify: false,
      userZoomingEnabled: false,
    });
    cyRef.current = cy;

    radialLayout(cy, sourceId);
    fitCapped(cy);

    cy.on("mouseover", "node", (evt: EventObject) => hoverRef.current((evt.target as NodeSingular).id()));
    cy.on("mouseout", "node", () => hoverRef.current(null));
    cy.on("tap", "node", (evt: EventObject) => openRef.current?.((evt.target as NodeSingular).id()));

    const ro = new ResizeObserver(() => {
      cy.resize();
      fitCapped(cy);
    });
    ro.observe(el);

    // Let the reader see the whole answer graph for a beat, then focus it.
    setFocused(false);
    const t = window.setTimeout(() => setFocused(true), reducedMotion ? 0 : 450);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // Theme changes restyle below; data changes rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sourceId]);

  React.useEffect(() => {
    cyRef.current?.style(answerGraphStylesheet({ dark, reducedMotion }) as never).update();
  }, [dark, reducedMotion]);

  // Source focus: source + its direct path at full strength, everything else muted.
  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !sourceId) return;
    const src = cy.getElementById(sourceId);
    if (src.empty()) return;
    cy.batch(() => {
      cy.elements().removeClass("source muted path");
      if (!focused) return;
      src.addClass("source");
      const path = src.closedNeighborhood();
      path.edges().addClass("path");
      cy.elements().not(path).addClass("muted");
      // Documents the source replaced or conflicts with are alternatives, so they stay muted.
      path.nodes().filter((n) => n.data("role") === "alternative").addClass("muted");
    });
  }, [focused, sourceId, data, dark]);

  // Cross-highlight from card rows.
  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("focus");
      if (!highlightId) return;
      const n = cy.getElementById(highlightId);
      if (n.empty()) return;
      n.addClass("focus");
      n.connectedEdges().addClass("focus");
    });
  }, [highlightId, data]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      role="img"
      aria-label={`Answer graph: ${data.nodes.length} nodes. The highlighted document is the source of the answer.`}
    />
  );
}
