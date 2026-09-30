import * as React from "react";
import cytoscape, { type Core, type EventObject, type NodeSingular, type EdgeSingular } from "cytoscape";
import { useReducedMotion } from "framer-motion";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import coseBilkent from "cytoscape-cose-bilkent";
import { useTheme } from "next-themes";
import { nodeStylesheet } from "@/components/graph/node-styles";
import type { GraphResponse } from "@/lib/api";

cytoscape.use(coseBilkent);

interface Props {
  data: GraphResponse;
  selectedId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /** "map" = topic map (bigger, two-line topic nodes need more room). */
  variant?: "map" | "detail";
}

/** Mount a Cytoscape instance into a div; diffs data in so pan/zoom survive refreshes. */
export function CytoscapeGraph({ data, selectedId, onSelectNode, variant = "detail" }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<Core | null>(null);
  const onSelectRef = React.useRef(onSelectNode);
  onSelectRef.current = onSelectNode;
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const reducedMotion = !!useReducedMotion();

  function fitGraph() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.fit(undefined, 48);
    if (cy.zoom() > 1.1) { cy.zoom(1.1); cy.center(); }
  }

  function zoomBy(factor: number) {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  React.useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: nodeStylesheet({ dark, reducedMotion }) as never,
      minZoom: 0.2,
      maxZoom: 2.5,
      boxSelectionEnabled: false,
    });
    cy.on("tap", "node", (evt: EventObject) => onSelectRef.current((evt.target as NodeSingular).id()));
    cy.on("tap", (evt: EventObject) => {
      if (evt.target === cy) onSelectRef.current(null);
    });
    const el = containerRef.current;
    cy.on("mouseover", "node", (evt: EventObject) => {
      (evt.target as NodeSingular).addClass("hover");
      el.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", (evt: EventObject) => {
      (evt.target as NodeSingular).removeClass("hover");
      el.style.cursor = "";
    });
    cy.on("mouseover", "edge", (evt: EventObject) => (evt.target as EdgeSingular).addClass("hover"));
    cy.on("mouseout", "edge", (evt: EventObject) => (evt.target as EdgeSingular).removeClass("hover"));
    cyRef.current = cy;
    const observer = new ResizeObserver(() => { cy.resize(); });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    // Drop edges pointing at nodes we don't have (keeps Cytoscape from throwing).
    const edges = data.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    const desired = new Set<string>([...nodeIds, ...edges.map((e) => e.id)]);
    const firstMount = cy.elements().length === 0;

    cy.batch(() => {
      cy.elements().forEach((el) => {
        if (!desired.has(el.id())) el.remove();
      });
      for (const n of data.nodes) {
        const existing = cy.getElementById(n.id);
        const nodeData = { ...n };
        if (existing.empty()) cy.add({ group: "nodes", data: nodeData });
        else existing.data(nodeData);
      }
      for (const e of edges) {
        if (cy.getElementById(e.id).empty()) cy.add({ group: "edges", data: { ...e } });
      }
    });

    if (firstMount && data.nodes.length > 0) {
      if (variant === "map") {
        // Stable topic orbit keeps labels readable and refreshes visually predictable.
        const topics = cy.nodes().filter((node) => node.data("type") === "topic");
        const context = cy.nodes().filter((node) => node.data("type") !== "topic");
        const radiusX = Math.max(300, topics.length * 50);
        const radiusY = Math.max(160, topics.length * 26);
        topics.forEach((node, index) => {
          const angle = -Math.PI / 2 + (index * Math.PI * 2) / topics.length;
          node.position({ x: Math.cos(angle) * radiusX, y: Math.sin(angle) * radiusY });
        });
        const columns = Math.min(3, context.length);
        context.forEach((node, index) => { node.position({
          x: ((index % columns) - (columns - 1) / 2) * 105,
          y: (Math.floor(index / columns) - (Math.ceil(context.length / columns) - 1) / 2) * 85,
        }); });
        cy.layout({ name: "preset", fit: true, padding: 48 }).run();
      } else cy.layout({
        name: "cose-bilkent",
        idealEdgeLength: 120,
        nodeRepulsion: 12000,
        randomize: true,
        nodeDimensionsIncludeLabels: true,
        animate: false,
        fit: true,
        padding: 48,
      } as cytoscape.LayoutOptions).run();
      // Small graphs get over-zoomed by fit; cap it so labels stay readable.
      if (cy.zoom() > 1.1) {
        cy.zoom(1.1);
        cy.center();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    cyRef.current?.style(nodeStylesheet({ dark, reducedMotion }) as never).update();
  }, [dark, reducedMotion]);

  // Highlight the selected node's neighbourhood.
  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("dim");
      cy.elements().unselect();
      if (!selectedId) return;
      const node = cy.getElementById(selectedId);
      if (node.empty()) return;
      node.select();
      const keep = node.closedNeighborhood();
      cy.elements().not(keep).addClass("dim");
    });
  }, [selectedId, data]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectRef.current(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div ref={containerRef} className="absolute inset-x-0 top-28 bottom-24" role="img" aria-label={`Knowledge graph: ${data.nodes.length} nodes, ${data.edges.length} relationships. Use the node picker to explore with a keyboard.`} />
      <div className="absolute bottom-5 right-5 z-10 flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm" role="group" aria-label="Graph view controls">
        <Button variant="ghost" size="icon" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={fitGraph} aria-label="Fit graph to view"><Maximize className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus className="h-4 w-4" /></Button>
      </div>
    </>
  );
}
