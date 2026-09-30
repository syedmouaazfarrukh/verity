/**
 * Cytoscape node + edge styling for the Verity knowledge graph.
 * Node types: topic, document, person, country, department.
 * Documents are coloured by status (live green, blocked red, superseded grey);
 * topics carry their trust colour as a ring; conflicts_with edges are red.
 */
import type { GraphNodeType } from "@/lib/api";

// Lucide SVG inner paths, inlined so they render as data URIs.
const LUCIDE = {
  BookOpen: `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`,
  FileText: `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
  User: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  Globe: `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`,
  Briefcase: `<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>`,
} as const;

interface TypeStyle {
  hex: string;
  hexDark: string;
  svg: string;
  size: number;
}

const TYPE_STYLES: Record<GraphNodeType, TypeStyle> = {
  topic: { hex: "#4f46e5", hexDark: "#818cf8", svg: LUCIDE.BookOpen, size: 44 },
  document: { hex: "#10b981", hexDark: "#34d399", svg: LUCIDE.FileText, size: 32 },
  person: { hex: "#71717a", hexDark: "#a1a1aa", svg: LUCIDE.User, size: 28 },
  country: { hex: "#0ea5e9", hexDark: "#38bdf8", svg: LUCIDE.Globe, size: 30 },
  department: { hex: "#52525b", hexDark: "#71717a", svg: LUCIDE.Briefcase, size: 30 },
};

export const ACCENT = { light: "#5145cd", dark: "#a59bf6" } as const;

const DOC_STATUS = {
  light: { live: "#10b981", blocked: "#f43f5e", superseded: "#a1a1aa", rejected: "#d4d4d8" },
  dark: { live: "#34d399", blocked: "#fb7185", superseded: "#71717a", rejected: "#52525b" },
} as const;

const TRUST = {
  light: { green: "#10b981", amber: "#f59e0b", red: "#f43f5e" },
  dark: { green: "#34d399", amber: "#fbbf24", red: "#fb7185" },
} as const;

function iconUri(svgInner: string, strokeColor: string, fillColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 32 32" width="32" height="32"><circle cx="12" cy="12" r="16" fill="${fillColor}"/><g fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type Style = { selector: string; style: Record<string, unknown> };

const DEPT_LABEL: Record<string, string> = { payroll: "Payroll", hr: "HR", finance: "Finance" };

export function nodeStylesheet(opts: { dark: boolean; reducedMotion?: boolean }): Style[] {
  const dark = opts.dark;
  const mode = dark ? "dark" : "light";
  const labelColor = dark ? "#fafafa" : "#18181b";
  const halo = dark ? "#18181b" : "#ffffff";
  const edgeColor = dark ? "#52525b" : "#d4d4d8";
  const red = dark ? "#fb7185" : "#e11d48";

  const typeStyles: Style[] = (Object.keys(TYPE_STYLES) as GraphNodeType[]).map((t) => {
    const ts = TYPE_STYLES[t];
    return {
      selector: `node[type = "${t}"]`,
      style: {
        width: ts.size,
        height: ts.size,
        "background-image": iconUri(ts.svg, dark ? ts.hexDark : ts.hex, halo),
        "background-fit": "contain",
        "background-clip": "node",
        "background-opacity": 0,
        "border-width": 1.5,
        "border-color": dark ? "#3f3f46" : "#d4d4d8",
        "font-weight": t === "topic" ? 600 : 500,
      },
    };
  });

  const docStyles: Style[] = (Object.keys(DOC_STATUS.light) as (keyof typeof DOC_STATUS.light)[]).map((s) => ({
    selector: `node[type = "document"][status = "${s}"]`,
    style: {
      "background-image": iconUri(LUCIDE.FileText, DOC_STATUS[mode][s], halo),
      ...(s === "superseded" || s === "rejected" ? { opacity: 0.75 } : {}),
    },
  }));

  const trustStyles: Style[] = (Object.keys(TRUST.light) as (keyof typeof TRUST.light)[]).map((t) => ({
    selector: `node[type = "topic"][trust = "${t}"]`,
    style: {
      "border-width": 3,
      "border-color": TRUST[mode][t],
      "border-opacity": 1,
    },
  }));

  return [
    {
      selector: "node",
      style: {
        width: 32,
        height: 32,
        "background-color": halo,
        label: "data(label)",
        color: labelColor,
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": 11,
        "font-weight": 500,
        "text-valign": "bottom",
        "text-margin-y": 5,
        "text-max-width": 130,
        "text-wrap": "ellipsis",
        "text-background-color": dark ? "#09090b" : "#fafafa",
        "text-background-opacity": 0.85,
        "text-background-padding": 2,
        "text-background-shape": "roundrectangle",
        "transition-property": "border-color, border-width, width, height, opacity",
        "transition-duration": opts.reducedMotion ? 0 : 200,
      },
    },
    ...typeStyles,
    // Document titles share long prefixes ("Home-office allowance — …"), so wrap instead of truncating.
    { selector: 'node[type = "document"]', style: { "text-wrap": "wrap", "text-max-width": 120, "font-size": 10.5 } },
    ...docStyles,
    ...trustStyles,
    {
      selector: 'node[type = "document"][status = "blocked"]',
      style: {
        "overlay-color": red,
        "overlay-opacity": 0.12,
        "overlay-padding": 6,
        "overlay-shape": "ellipse",
      },
    },
    { selector: "node.hover", style: { "overlay-color": dark ? "#a1a1aa" : "#71717a", "overlay-opacity": 0.1, "overlay-padding": 4, "overlay-shape": "ellipse" } },
    {
      selector: "node:selected",
      style: {
        "border-color": dark ? ACCENT.dark : ACCENT.light,
        "border-width": 3,
        "border-opacity": 1,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": edgeColor,
        "curve-style": "bezier",
        opacity: 0.9,
        "target-arrow-shape": "none",
      },
    },
    {
      selector: 'edge[type = "supersedes"]',
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [4, 3],
        "target-arrow-shape": "triangle",
        "target-arrow-color": edgeColor,
        "arrow-scale": 0.8,
      },
    },
    {
      selector: 'edge[type = "owned_by"]',
      style: { "line-style": "dotted" },
    },
    {
      selector: 'edge[type = "conflicts_with"]',
      style: {
        width: 3,
        "line-color": red,
        "line-style": "solid",
        opacity: 1,
        "z-index": 99,
        label: "conflict",
        "font-size": 10,
        "font-weight": 600,
        color: red,
        "text-background-color": dark ? "#09090b" : "#fafafa",
        "text-background-opacity": 0.9,
        "text-background-padding": 2,
      },
    },
    {
      selector: "edge.hover",
      style: {
        width: 2,
        label: "data(type)",
        "font-size": 10,
        "font-family": "JetBrains Mono, ui-monospace, monospace",
        color: dark ? "#a1a1aa" : "#71717a",
        "text-background-color": dark ? "#09090b" : "#fafafa",
        "text-background-opacity": 0.9,
        "text-background-padding": 2,
        "text-rotation": "autorotate",
      },
    },
    {
      selector: 'edge[type = "belongs_to"]',
      style: { "line-style": "dashed", "line-dash-pattern": [2, 3] },
    },
    {
      selector: 'node[type = "department"]',
      style: { label: (ele: { data: (k: string) => string }) => DEPT_LABEL[ele.data("label")] ?? ele.data("label") },
    },
    // Topic cards: size reflects document count; the border carries trust status.
    {
      selector: 'node[type = "topic"][doc_count]',
      style: {
        shape: "roundrectangle",
        width: "mapData(doc_count, 1, 8, 164, 194)",
        height: "mapData(doc_count, 1, 8, 76, 90)",
        "background-opacity": 1,
        "background-color": halo,
        "background-image": "none",
        "border-width": 1.5,
        "text-valign": "center",
        "text-margin-y": 0,
        "text-background-opacity": 0,
        "font-size": 13,
        "line-height": 1.4,
        "font-weight": 500,
        "text-wrap": "wrap",
        "text-max-width": 150,
        label: (ele: { data: (k: string) => unknown }) => {
          const n = Number(ele.data("doc_count") ?? 0);
          const issues = Number(ele.data("open_issue_count") ?? 0);
          return `${ele.data("label")}\n${n} doc${n === 1 ? "" : "s"}${issues ? ` · ${issues} open` : ""}`;
        },
      },
    },
    ...(Object.keys(TRUST.light) as (keyof typeof TRUST.light)[]).map((t) => ({
      selector: `node[type = "topic"][doc_count][trust = "${t}"]`,
      style: { "border-color": TRUST[mode][t] },
    })),
    { selector: 'edge.hover[type = "conflicts_with"]', style: { "line-color": red, color: red, label: "conflict", width: 3 } },
    { selector: "node.dim, edge.dim", style: { opacity: 0.2 } },
  ];
}

/**
 * Extra rules for the per-answer graph: the source document pops out (accent ring + halo),
 * its direct path stays normal, everything else is muted. `.focus` wins over `.muted` so
 * hovering a card row can bring any node forward.
 */
export function answerGraphStylesheet(opts: { dark: boolean; reducedMotion?: boolean }): Style[] {
  const dark = opts.dark;
  const accent = dark ? ACCENT.dark : ACCENT.light;
  const labelColor = dark ? "#fafafa" : "#18181b";
  const red = dark ? "#fb7185" : "#e11d48";
  return [
    ...nodeStylesheet(opts),
    {
      selector: "node",
      style: {
        "text-wrap": "wrap",
        "text-max-width": 104,
        "font-size": 10.5,
        "transition-property": "opacity, border-width, width, height, underlay-opacity",
        "transition-duration": opts.reducedMotion ? 0 : 300,
        "transition-timing-function": "ease-in-out",
      },
    },
    { selector: "edge", style: { "transition-property": "opacity, width", "transition-duration": opts.reducedMotion ? 0 : 300 } },
    {
      selector: "node.source",
      style: {
        width: 46,
        height: 46,
        "border-width": 3,
        "border-color": accent,
        "border-opacity": 1,
        "underlay-color": accent,
        "underlay-padding": 9,
        "underlay-opacity": 0.16,
        "underlay-shape": "ellipse",
        "font-size": 12,
        "font-weight": 600,
        color: dark ? "#c7d2fe" : "#3730a3",
        "text-margin-y": 8,
        "z-index": 20,
      },
    },
    { selector: "node.muted", style: { opacity: 0.38 } },
    { selector: "edge.muted", style: { opacity: 0.25 } },
    { selector: 'edge.muted[type = "conflicts_with"]', style: { opacity: 0.75 } },
    {
      selector: "edge.path",
      style: { width: 1.5, "line-color": dark ? "#71717a" : "#a1a1aa", opacity: 1 },
    },
    {
      selector: "node.focus",
      style: {
        opacity: 1,
        "underlay-color": dark ? "#a1a1aa" : "#71717a",
        "underlay-padding": 7,
        "underlay-opacity": 0.18,
        "underlay-shape": "ellipse",
        color: labelColor,
        "z-index": 30,
      },
    },
    { selector: 'edge.path[type = "conflicts_with"]', style: { "line-color": red, width: 3 } },
    { selector: "node.source.focus", style: { "underlay-color": accent, "underlay-opacity": 0.28, color: dark ? "#c7d2fe" : "#3730a3" } },
    { selector: "edge.focus", style: { opacity: 1, width: 2 } },
    { selector: 'edge.focus[type = "conflicts_with"]', style: { width: 3, "line-color": red } },
  ];
}
