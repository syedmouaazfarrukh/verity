import * as React from "react";
import cytoscape, { type Core, type EventObject, type NodeSingular, type EdgeSingular } from "cytoscape";
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

  React.useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: nodeStylesheet({ dark }) as never,
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
    return () => {
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
      cy.layout({
        name: "cose-bilkent",
        idealEdgeLength: variant === "map" ? 130 : 120,
        nodeRepulsion: variant === "map" ? 14000 : 12000,
        randomize: true,
        nodeDimensionsIncludeLabels: true,
        animate: false,
        fit: true,
        padding: 80,
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
    cyRef.current?.style(nodeStylesheet({ dark }) as never).update();
  }, [dark]);

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
    <div
      ref={containerRef}
      className="absolute inset-0"
      role="application"
      aria-label={`Knowledge graph: ${data.nodes.length} nodes, ${data.edges.length} relationships`}
    />
  );
}
