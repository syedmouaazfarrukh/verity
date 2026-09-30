/**
 * Dev-only in-memory mock of the Verity API (v2 shapes). Loaded ONLY when VITE_MOCK=1
 * (see rawFetch in api.ts). Never used in normal builds or production.
 */
import type {
  Alternative,
  AnswerGraph,
  AnswerGraphNode,
  DocumentDetail,
  DocumentSummary,
  GraphEdge,
  GraphNode,
  Issue,
  Level,
  Provenance,
  ProvenanceEvent,
  Topic,
  User,
} from "@/lib/api";

const USERS: Record<string, User> = {
  sofie: { username: "sofie", display_name: "Sofie Claes", role: "consultant", countries: ["BE"], departments: ["payroll", "hr"] },
  daan: { username: "daan", display_name: "Daan de Vries", role: "consultant", countries: ["NL"], departments: ["payroll", "hr"] },
  lies: { username: "lies", display_name: "Lies Vermeulen", role: "owner", countries: ["BE", "NL", "ALL"], departments: ["payroll", "hr"] },
  noor: { username: "noor", display_name: "Noor El Amrani", role: "owner", countries: ["BE", "NL", "ALL"], departments: ["finance"] },
  admin: {
    username: "admin", display_name: "Admin", role: "admin",
    countries: ["BE", "NL", "FR", "DE", "ALL"], departments: ["payroll", "hr", "finance"],
  },
};

// Survives full page reloads in dev (data resets, the sign-in doesn't).
let session: User | null = USERS[sessionStorage.getItem("verity.mock.user") ?? ""] ?? null;

const HOA_BE_V3 = `# Home-office allowance — Belgium

## Purpose
This guidance explains how consultants process the monthly **home-office allowance** for Belgian client employees.

## Rules
- Following the 2026 indexation, the maximum exempt amount is **€150 per month** from 1 August 2026 (was €140).
- Part-time employees can receive the full cap.

## Key rules
- Monthly cap: €150
- Payslip code: 1250`;

type MockDoc = DocumentDetail & { supersedes_id?: string; created_at: string; uploaded_by: string };

function doc(
  p: Partial<MockDoc> & Pick<MockDoc, "id" | "title" | "topic_id" | "topic_name" | "country" | "version">
): MockDoc {
  return {
    owner: "Lies Vermeulen",
    status: "live",
    updated_at: "2026-08-12",
    updated_by: "Lies Vermeulen",
    change_summary: "",
    open_issue_count: 0,
    department: "payroll",
    source: "upload",
    source_detail: "",
    sha256: "",
    content_md: `# ${p.title}\n\nMock content.`,
    effective_date: "2026-01-01",
    review_by: "2027-01-01",
    claims: [],
    history: [],
    issues: [],
    created_at: `${p.updated_at ?? "2026-08-12"}T09:00:00Z`,
    uploaded_by: p.updated_by ?? "Lies Vermeulen",
    ...p,
  };
}

const HOA = { topic_id: "home-office-allowance", topic_name: "Home-office allowance" } as const;
const HOA_RULES = (cap: string) => [
  { key: "monthly-cap", value: cap },
  { key: "eligibility", value: "structural home work, at least 1 day per week" },
  { key: "payslip-code", value: "1250" },
];

const docs: MockDoc[] = [
  doc({
    id: "doc-hoa-be-v3", title: "Home-office allowance — Belgium", ...HOA, country: "BE", version: 3,
    content_md: HOA_BE_V3, supersedes_id: "doc-hoa-be-v2", source: "sharepoint",
    source_detail: "Payroll BE › Allowances › Home office",
    change_summary: "Monthly cap raised from €140 to €150 after the 2026 indexation, applicable from the August 2026 payroll.",
    effective_date: "2026-08-01", review_by: "2027-08-01", claims: HOA_RULES("€150"),
  }),
  doc({
    id: "doc-hoa-be-v2", title: "Home-office allowance — Belgium", ...HOA, country: "BE", version: 2, status: "superseded",
    updated_at: "2025-01-14", updated_by: "Pieter Janssens", supersedes_id: "doc-hoa-be-v1", source: "sharepoint",
    change_summary: "Monthly cap raised from €129.48 to €140 after indexation.", claims: HOA_RULES("€140"),
  }),
  doc({
    id: "doc-hoa-be-v1", title: "Home-office allowance — Belgium", ...HOA, country: "BE", version: 1, status: "superseded",
    updated_at: "2023-01-09", change_summary: "First published version.", claims: HOA_RULES("€129.48"),
  }),
  doc({
    id: "doc-home-office-faq-be", title: "Home-office FAQ (old)", ...HOA, country: "BE", version: 1, status: "blocked",
    owner: "", updated_at: "2023-03-02", updated_by: "Sofie Claes", source: "teams",
    source_detail: "Payroll BE channel, pinned message",
    change_summary: "FAQ compiled from client questions in early 2023.", claims: HOA_RULES("€129.48"),
  }),
  doc({
    id: "doc-hoa-nl-v1", title: "Home-working allowance — Netherlands", ...HOA, country: "NL", version: 1,
    owner: "Anouk Bakker", updated_by: "Anouk Bakker", updated_at: "2026-01-08", change_summary: "First version.",
    claims: [{ key: "daily-allowance", value: "€2.40 per home-working day" }],
  }),
  doc({
    id: "doc-payroll-cutoff-all-v1", title: "Monthly payroll cut-off — all countries", topic_id: "payroll-cutoff",
    topic_name: "Payroll cut-off", country: "ALL", version: 1, owner: "Marc Dubois", updated_by: "Marc Dubois",
    updated_at: "2026-01-02", source: "git", source_detail: "payroll-ops/calendars@main",
    change_summary: "Single group-wide cut-off calendar.",
    claims: [{ key: "cut-off-day", value: "20th of the month" }, { key: "cut-off-time", value: "17:00 CET" }],
  }),
  doc({
    id: "doc-meal-vouchers-be-v2", title: "Meal vouchers — Belgium", topic_id: "meal-vouchers", topic_name: "Meal vouchers",
    country: "BE", version: 2, updated_at: "2026-01-06", change_summary: "Maximum face value raised from €8 to €10.",
    claims: [{ key: "max-face-value", value: "€10 per voucher" }],
  }),
  doc({
    id: "doc-sick-leave-be-v1", title: "Sick-leave reporting — Belgium", topic_id: "sick-leave-reporting",
    topic_name: "Sick-leave reporting", country: "BE", version: 1, department: "hr", owner: "Pieter Janssens",
    updated_by: "Pieter Janssens", updated_at: "2026-02-03", review_by: "2026-06-01", change_summary: "Initial version.",
    claims: [{ key: "guaranteed-salary", value: "30 days" }],
  }),
  doc({
    id: "doc-client-credit-notes-be-v1", title: "Client credit notes — Belgium", topic_id: "client-credit-notes",
    topic_name: "Client credit notes", country: "BE", version: 1, department: "finance", owner: "Noor El Amrani",
    updated_by: "Noor El Amrani", updated_at: "2026-09-15", change_summary: "First version.",
    claims: [
      { key: "approval-threshold", value: "€5,000" },
      { key: "approver", value: "finance controller" },
      { key: "booking-code", value: "CN-400" },
      { key: "deadline", value: "within 5 working days" },
    ],
  }),
];

let issues: Issue[] = [
  {
    id: 1, document_id: "doc-sick-leave-be-v1", document_title: "Sick-leave reporting — Belgium",
    other_document_id: null, other_document_title: null, rule: "review-overdue", level: "medium",
    message: "Review date 1 Jun 2026 has passed.", new_value: null, existing_value: null, status: "open",
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    due_at: new Date(Date.now() + 6 * 86400_000).toISOString(), overdue: false,
    resolved_by: null, resolution: null, resolution_note: null,
  },
  {
    id: 2, document_id: "doc-home-office-faq-be", document_title: "Home-office FAQ (old)",
    other_document_id: null, other_document_title: null, rule: "no-owner", level: "high",
    message: "Nobody owns this document.", new_value: null, existing_value: null, status: "open",
    created_at: new Date(Date.now() - 86400_000).toISOString(),
    due_at: new Date(Date.now() + 2 * 86400_000).toISOString(), overdue: false,
    resolved_by: null, resolution: null, resolution_note: null,
  },
];
let nextIssue = 3;

const SLA_H: Record<Level, number> = { critical: 24, high: 72, medium: 168, low: 720 };

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function ensureHashes() {
  for (const d of docs) if (!d.sha256) d.sha256 = await sha256(d.content_md);
}

function inScope(d: { country: string; department: string }): boolean {
  return (
    !!session &&
    (d.country === "ALL" || session.countries.includes(d.country)) &&
    session.departments.includes(d.department)
  );
}
function openIssuesOn(id: string) {
  return issues.filter((i) => i.document_id === id && i.status === "open");
}
function summary(d: MockDoc): DocumentSummary {
  const {
    content_md: _c, effective_date: _e, review_by: _r, claims: _cl, history: _h, issues: _i, sha256: _s,
    supersedes_id: _sup, created_at: _ca, uploaded_by: _ub, ...s
  } = d;
  return { ...s, open_issue_count: openIssuesOn(d.id).length };
}
function detail(d: MockDoc): DocumentDetail {
  const history = docs
    .filter((x) => x.topic_id === d.topic_id && x.country === d.country && inScope(x))
    .sort((a, b) => b.version - a.version)
    .map((x) => ({
      id: x.id, version: x.version, status: x.status, updated_at: x.updated_at, updated_by: x.updated_by,
      change_summary: x.change_summary,
    }));
  const { supersedes_id: _s, created_at: _c, uploaded_by: _u, ...rest } = d;
  return { ...rest, ...summary(d), sha256: d.sha256, history, issues: issues.filter((i) => i.document_id === d.id) };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function parseFrontMatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}
function parseClaims(text: string) {
  const sec = text.split(/^## Key rules\s*$/m)[1] ?? "";
  return [...sec.matchAll(/^- ([^:]+):\s*(.+)$/gm)].map((m) => ({
    key: m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    value: m[2].trim(),
  }));
}

function newIssue(p: Partial<Issue> & Pick<Issue, "document_id" | "document_title" | "rule" | "level" | "message">): Issue {
  const now = Date.now();
  return {
    id: nextIssue++, other_document_id: null, other_document_title: null, new_value: null, existing_value: null,
    status: "open", created_at: new Date(now).toISOString(),
    due_at: new Date(now + SLA_H[p.level] * 3600_000).toISOString(), overdue: false,
    resolved_by: null, resolution: null, resolution_note: null, ...p,
  };
}

async function handleUpload(init: RequestInit): Promise<Response> {
  const user = session!;
  const file = (init.body as FormData).get("file") as File;
  const text = await file.text();
  const fm = parseFrontMatter(text);
  const country = fm.country || "";
  const department = fm.department || "payroll";
  if (country && country !== "ALL" && !user.countries.includes(country))
    return json(403, { detail: `You can't upload documents for ${country}.` });
  if (!user.departments.includes(department))
    return json(403, { detail: `You can't publish to the ${department} department.` });
  const topic_id = fm.topic || file.name.replace(/\.\w+$/, "");
  const version = Number(fm.version || 1);
  const today = new Date().toISOString().slice(0, 10);
  const d = doc({
    id: `doc-${topic_id}-${country.toLowerCase() || "xx"}-v${version}-${Date.now() % 10000}`,
    title: fm.title || file.name, topic_id, topic_name: fm.topic_name || topic_id, country, version,
    department, source: fm.source || "upload", source_detail: fm.source_detail || "",
    owner: fm.owner || "", updated_by: user.display_name, updated_at: today, uploaded_by: user.display_name,
    created_at: new Date().toISOString(), change_summary: fm.change_summary || "",
    effective_date: fm.effective_date || null, review_by: fm.review_by || null,
    content_md: text, claims: parseClaims(text),
  });
  d.sha256 = await sha256(text);
  const live = docs.find((x) => x.topic_id === topic_id && x.country === country && x.status === "live");
  const found: Issue[] = [];
  if (live) {
    for (const c of d.claims) {
      const lc = live.claims.find((x) => x.key === c.key);
      if (lc && lc.value !== c.value) {
        found.push(newIssue({
          document_id: d.id, document_title: d.title, other_document_id: live.id, other_document_title: live.title,
          rule: "conflict", level: "critical",
          message: `${c.key.replace(/-/g, " ")} says ${c.value} but the live document says ${lc.value}.`,
          new_value: c.value, existing_value: lc.value,
        }));
      }
    }
    if (version <= live.version) {
      found.push(newIssue({
        document_id: d.id, document_title: d.title, other_document_id: live.id, other_document_title: live.title,
        rule: "stale-version", level: "medium", message: `Version ${version} is not newer than live v${live.version}.`,
      }));
    }
  }
  if (!d.owner) found.push(newIssue({ document_id: d.id, document_title: d.title, rule: "no-owner", level: "high", message: "No owner in front-matter." }));
  if (!country || !d.effective_date || !fm.department)
    found.push(newIssue({ document_id: d.id, document_title: d.title, rule: "missing-metadata", level: "low", message: "Country, department or effective date is missing." }));
  issues = [...issues, ...found];
  const blocked = found.some((i) => i.level === "critical" || i.level === "high");
  let outcome: "live" | "blocked" | "superseded_previous" = "live";
  if (blocked) {
    d.status = "blocked";
    outcome = "blocked";
  } else if (live && live.version < version) {
    live.status = "superseded";
    d.supersedes_id = live.id;
    outcome = "superseded_previous";
  }
  docs.push(d);
  return json(200, { document: summary(d), issues: found, outcome });
}

// ---------------------------------------------------------------- chat (v2 A)

function shortDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const personId = (name: string) => `person:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

function reasonFor(alt: MockDoc, used: MockDoc): string {
  const open = openIssuesOn(alt.id);
  if (alt.status === "superseded") {
    const next = docs.find((x) => x.supersedes_id === alt.id);
    return next
      ? `Older version: replaced by v${next.version} on ${shortDate(next.updated_at)}.`
      : `Older version: replaced by v${used.version}.`;
  }
  if (alt.status === "rejected") return `Rejected by ${used.owner} after review.`;
  if (alt.status === "blocked") {
    const conflict = open.find((i) => i.rule === "conflict");
    if (conflict) {
      const due = new Date(conflict.due_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return `Blocked: says ${conflict.new_value} but the live document says ${conflict.existing_value}. Waiting for ${used.owner} (critical, due ${due}).`;
    }
    if (open.some((i) => i.rule === "no-owner")) return "Blocked: nobody owns this document.";
    return "Blocked: it has open issues that a knowledge owner must resolve first.";
  }
  return `Applies to ${alt.country}, not your question.`;
}

function provenanceFor(d: MockDoc): Provenance {
  const events: ProvenanceEvent[] = [];
  const prev = d.supersedes_id ? docs.find((x) => x.id === d.supersedes_id) : undefined;
  events.push({
    at: d.created_at, actor: d.uploaded_by, kind: "created",
    text: d.source === "upload" ? `Uploaded as v${d.version}.` : `Imported as v${d.version} from ${d.source}.`,
  });
  const siblings = docs.filter((x) => x.topic_id === d.topic_id && x.id !== d.id && inScope(x)).length;
  const own = issues.filter((i) => i.document_id === d.id);
  if (own.length === 0) {
    events.push({ at: d.created_at, actor: "Verity", kind: "checked", text: `Checked against ${siblings} documents on this topic: no conflicts.` });
  } else {
    for (const i of own) events.push({ at: i.created_at, actor: "Verity", kind: "flagged", text: i.message });
    for (const i of own.filter((x) => x.status === "resolved"))
      events.push({ at: i.created_at, actor: i.resolved_by ?? "", kind: "resolved", text: `Accepted: ${i.resolution_note ?? ""}` });
  }
  if (prev) events.push({ at: d.created_at, actor: d.updated_by, kind: "superseded_previous", text: `Replaced v${prev.version} (${prev.claims[0]?.value ?? "older values"}).` });
  events.push({ at: d.created_at, actor: d.owner || d.updated_by, kind: "live", text: "Became the single live source for this topic in Belgium." });
  return { source: d.source, source_detail: d.source_detail, sha256: d.sha256, uploaded_by: d.uploaded_by, events };
}

function answerGraphFor(used: MockDoc, alts: MockDoc[]): AnswerGraph {
  const nodes = new Map<string, AnswerGraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: AnswerGraphNode) => !nodes.has(n.id) && nodes.set(n.id, n);
  const edge = (source: string, target: string, type: GraphEdge["type"]) =>
    edges.push({ id: `${type}:${source}->${target}`, source, target, type });
  const tid = `topic:${used.topic_id}`;
  add({ id: tid, label: used.topic_name, type: "topic", trust: "green", role: "context" });
  add({ id: `department:${used.department}`, label: used.department, type: "department", role: "context" });
  edge(tid, `department:${used.department}`, "belongs_to");
  for (const d of [used, ...alts]) {
    const role = d.id === used.id ? "source" : "alternative";
    add({ id: d.id, label: `${d.title} (v${d.version})`, type: "document", status: d.status, role });
    add({ id: `country:${d.country}`, label: d.country, type: "country", role: "context" });
    edge(d.id, tid, "covers");
    edge(d.id, `country:${d.country}`, "applies_to");
    if (d.owner) {
      add({ id: personId(d.owner), label: d.owner, type: "person", role: "context" });
      edge(d.id, personId(d.owner), "owned_by");
    }
    if (d.supersedes_id && (d.supersedes_id === used.id || alts.some((a) => a.id === d.supersedes_id)))
      edge(d.id, d.supersedes_id, "supersedes");
  }
  for (const i of issues)
    if (i.rule === "conflict" && i.status === "open" && nodes.has(i.document_id) && i.other_document_id && nodes.has(i.other_document_id))
      edge(i.document_id, i.other_document_id, "conflicts_with");
  if ([...nodes.values()].some((n) => n.status === "blocked")) nodes.get(tid)!.trust = "red";
  return { nodes: [...nodes.values()], edges };
}

let nextReceipt = 1001;
async function handleChat(question: string): Promise<Response> {
  await ensureHashes();
  const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const live = docs.filter((d) => d.status === "live" && inScope(d));
  const scored = live
    .map((d) => {
      const hay = `${d.title} ${d.topic_name} ${d.claims.map((c) => `${c.key} ${c.value}`).join(" ")}`.toLowerCase();
      return { d, score: words.filter((w) => hay.includes(w.slice(0, 5))).length };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ? scored[0].d : null;
  const receipt = {
    id: `rcpt-${(nextReceipt++).toString(16)}a91c0e7f2`, signature_b64: "bW9jay1zaWduYXR1cmU=",
    payload_sha256: await sha256(question), created_at: new Date().toISOString(),
  };
  if (!best) {
    return json(200, {
      answer: "I couldn't find a trusted live document in your scope that answers this. Ask the topic owner, or upload the guidance so Verity can check it.",
      document: null, matched_claims: [], quotes: [], receipt, answer_mode: "template",
      alternatives: [], provenance: null, graph: null,
      note: "No live, in-scope document matched the question.",
    });
  }
  const claims = best.claims.filter((c) => words.some((w) => c.key.includes(w.slice(0, 4)))).slice(0, 2);
  const matched = claims.length ? claims : best.claims.slice(0, 1);
  const lead = matched.map((c) => `The ${c.key.replace(/-/g, " ")} is ${c.value}.`).join(" ");
  const altDocs = docs
    .filter(
      (d) =>
        d.id !== best.id && d.topic_id === best.topic_id && inScope(d) &&
        (d.country === best.country || d.country === "ALL" || best.country === "ALL")
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const alternatives: Alternative[] = altDocs.map((a) => ({
    id: a.id, title: a.title, country: a.country, version: a.version, status: a.status,
    updated_at: a.updated_at, updated_by: a.updated_by, source: a.source, source_detail: a.source_detail,
    reason: reasonFor(a, best),
    differs: a.claims
      .map((c) => ({ key: c.key, value: c.value, live_value: best.claims.find((x) => x.key === c.key)?.value ?? "" }))
      .filter((c) => c.live_value && c.live_value !== c.value),
  }));
  return json(200, {
    answer: `${lead} (${best.title}, v${best.version}, updated ${shortDate(best.updated_at)} by ${best.updated_by}.)`,
    document: summary(best),
    matched_claims: matched,
    quotes: matched.map((c) => ({
      text: `${c.key.charAt(0).toUpperCase()}${c.key.slice(1).replace(/-/g, " ")}: ${c.value}`,
      section: "Key rules",
    })),
    receipt,
    answer_mode: import.meta.env.VITE_MOCK_AI === "1" ? "ai" : "template",
    note: import.meta.env.VITE_MOCK_AI === "1" ? "Worded by qwen2.5:3b running locally." : undefined,
    alternatives,
    provenance: provenanceFor(best),
    graph: answerGraphFor(best, altDocs),
  });
}

// ---------------------------------------------------------------- graph (v2 C)

function topicMap() {
  const scoped = docs.filter(inScope);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const edge = (source: string, target: string, type: GraphEdge["type"]) => {
    const id = `${type}:${source}->${target}`;
    if (!seen.has(id)) {
      seen.add(id);
      edges.push({ id, source, target, type });
    }
  };
  for (const d of scoped) {
    const tid = `topic:${d.topic_id}`;
    const tdocs = scoped.filter((x) => x.topic_id === d.topic_id && x.status !== "rejected");
    const open = issues.filter((i) => i.status === "open" && tdocs.some((x) => x.id === i.document_id));
    const trust = open.some((i) => i.level === "critical") ? "red" : open.some((i) => i.level !== "low") ? "amber" : "green";
    nodes.set(tid, { id: tid, label: d.topic_name, type: "topic", trust, doc_count: tdocs.length, open_issue_count: open.length });
    nodes.set(`country:${d.country}`, { id: `country:${d.country}`, label: d.country, type: "country" });
    nodes.set(`department:${d.department}`, { id: `department:${d.department}`, label: d.department, type: "department" });
    edge(tid, `country:${d.country}`, "applies_to");
    edge(tid, `department:${d.department}`, "belongs_to");
  }
  return { nodes: [...nodes.values()], edges };
}

function topicGraph(topic: string) {
  const scoped = docs.filter((d) => inScope(d) && d.topic_id === topic);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const d of scoped) {
    const tid = `topic:${d.topic_id}`;
    nodes.set(tid, { id: tid, label: d.topic_name, type: "topic", trust: "green" });
    nodes.set(d.id, { id: d.id, label: `${d.title} (v${d.version})`, type: "document", status: d.status });
    nodes.set(`country:${d.country}`, { id: `country:${d.country}`, label: d.country, type: "country" });
    edges.push({ id: `c-${d.id}`, source: d.id, target: tid, type: "covers" });
    edges.push({ id: `a-${d.id}`, source: d.id, target: `country:${d.country}`, type: "applies_to" });
    if (d.owner) {
      nodes.set(personId(d.owner), { id: personId(d.owner), label: d.owner, type: "person" });
      edges.push({ id: `o-${d.id}`, source: d.id, target: personId(d.owner), type: "owned_by" });
    }
    if (d.supersedes_id && scoped.some((x) => x.id === d.supersedes_id))
      edges.push({ id: `s-${d.id}`, source: d.id, target: d.supersedes_id, type: "supersedes" });
  }
  for (const i of issues) {
    if (i.rule === "conflict" && i.status === "open" && i.other_document_id && nodes.has(i.document_id) && nodes.has(i.other_document_id)) {
      edges.push({ id: `x-${i.id}`, source: i.document_id, target: i.other_document_id, type: "conflicts_with" });
      const t = nodes.get(`topic:${topic}`);
      if (t) t.trust = "red";
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// ---------------------------------------------------------------- router

export async function mockFetch(path: string, init: RequestInit): Promise<Response> {
  await new Promise((r) => setTimeout(r, 250));
  const url = new URL(path, window.location.origin);
  const p = url.pathname.replace(/^\/api/, "");
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;

  if (p === "/health") return json(200, { ok: true });
  if (p === "/auth/login" && method === "POST") {
    const u = USERS[body?.username];
    if (!u || body?.password !== "verity-demo") return json(401, { detail: "Invalid username or password." });
    session = u;
    sessionStorage.setItem("verity.mock.user", u.username);
    return json(200, { user: u });
  }
  if (p === "/auth/logout") {
    session = null;
    sessionStorage.removeItem("verity.mock.user");
    return json(200, { ok: true });
  }
  if (!session) return json(401, { detail: "Not signed in." });
  await ensureHashes();

  if (p === "/me") return json(200, session);

  if (p === "/topics") {
    const ids = [...new Set(docs.filter(inScope).map((d) => d.topic_id))];
    const topics: Topic[] = ids.map((id) => {
      const tdocs = docs.filter((d) => d.topic_id === id && inScope(d));
      const open = issues.filter((i) => i.status === "open" && tdocs.some((d) => d.id === i.document_id));
      const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<Level, number>;
      open.forEach((i) => counts[i.level]++);
      return {
        id,
        name: tdocs[0].topic_name,
        live_documents: tdocs
          .filter((d) => d.status === "live")
          .map((d) => ({ id: d.id, title: d.title, country: d.country, version: d.version, updated_at: d.updated_at, updated_by: d.updated_by })),
        open_issues: counts,
        trust: counts.critical ? "red" : counts.high || counts.medium ? "amber" : "green",
      };
    });
    return json(200, topics);
  }
  if (p === "/documents" && method === "GET") return json(200, docs.filter(inScope).map(summary));
  if (p === "/documents" && method === "POST") return handleUpload(init);
  const dm = /^\/documents\/(.+)$/.exec(p);
  if (dm) {
    const d = docs.find((x) => x.id === decodeURIComponent(dm[1]) && inScope(x));
    return d ? json(200, detail(d)) : json(404, { detail: "Document not found." });
  }
  if (p === "/issues") {
    const status = url.searchParams.get("status") ?? "open";
    const scoped = issues.filter((i) => {
      const d = docs.find((x) => x.id === i.document_id);
      return d && inScope(d) && i.status === status;
    });
    return json(200, scoped.map((i) => ({ ...i, overdue: new Date(i.due_at).getTime() < Date.now() })));
  }
  const rm = /^\/issues\/(\d+)\/resolve$/.exec(p);
  if (rm && method === "POST") {
    if (session.role === "consultant") return json(403, { detail: "Only knowledge owners can resolve issues." });
    if (!body?.note?.trim()) return json(422, { detail: "A note is required." });
    const issue = issues.find((i) => String(i.id) === rm[1]);
    if (!issue) return json(404, { detail: "Issue not found." });
    const d = docs.find((x) => x.id === issue.document_id)!;
    const resolvedFields = { status: "resolved" as const, resolved_by: session.display_name, resolution: body.resolution, resolution_note: body.note };
    if (body.resolution === "accept_new") {
      const live = docs.find((x) => x.topic_id === d.topic_id && x.country === d.country && x.status === "live");
      if (live && live.id !== d.id) {
        live.status = "superseded";
        d.supersedes_id = live.id;
      }
      d.status = "live";
      issues = issues.map((i) => (i.document_id === d.id && i.status === "open" ? { ...i, ...resolvedFields } : i));
    } else {
      d.status = "rejected";
      issues = issues.map((i) => (i.id === issue.id ? { ...i, ...resolvedFields } : i));
    }
    return json(200, { issue: issues.find((i) => i.id === issue.id), document: summary(d) });
  }
  if (p === "/chat") return handleChat(String(body?.question ?? ""));
  const vm = /^\/receipts\/(.+)\/verify$/.exec(p);
  if (vm) return json(200, { valid: true, receipt: { id: decodeURIComponent(vm[1]), algorithm: "Ed25519" } });
  if (p === "/graph") {
    const topic = url.searchParams.get("topic");
    return json(200, topic ? topicGraph(topic) : topicMap());
  }
  return json(404, { detail: `Mock: no handler for ${method} ${p}` });
}
