/**
 * Verity API client — the only place the web app talks to the backend.
 * Shapes follow CONTRACT.md exactly.
 */
import { toast } from "sonner";

export type Role = "consultant" | "owner" | "admin";
export type Level = "critical" | "high" | "medium" | "low";
export type Trust = "green" | "amber" | "red";
export type DocStatus = "live" | "blocked" | "superseded" | "rejected";
/** v2: second scope dimension. Known values: payroll | hr | finance. */
export type Department = "payroll" | "hr" | "finance" | (string & {});
/** v2 D: where a document came from. */
export type DocSource =
  | "upload"
  | "email"
  | "google-drive"
  | "sharepoint"
  | "git"
  | "teams"
  | "notion"
  | (string & {});

export interface User {
  username: string;
  display_name: string;
  role: Role;
  countries: string[];
  departments: Department[];
}

export interface LiveDocRef {
  id: string;
  title: string;
  country: string;
  version: number;
  updated_at: string;
  updated_by: string;
}

export interface Topic {
  id: string;
  name: string;
  live_documents: LiveDocRef[];
  open_issues: Record<Level, number>;
  trust: Trust;
}

export interface DocumentSummary {
  id: string;
  title: string;
  topic_id: string;
  topic_name: string;
  country: string;
  owner: string;
  status: DocStatus;
  version: number;
  updated_at: string;
  updated_by: string;
  change_summary: string;
  open_issue_count: number;
  department: Department;
  source: DocSource;
  source_detail: string;
}

export interface Claim {
  key: string;
  value: string;
}

export interface HistoryEntry {
  id: string;
  version: number;
  status: DocStatus;
  updated_at: string;
  updated_by: string;
  change_summary: string;
}

export interface Issue {
  id: number | string;
  document_id: string;
  document_title: string;
  other_document_id: string | null;
  other_document_title: string | null;
  rule: string;
  level: Level;
  message: string;
  new_value: string | null;
  existing_value: string | null;
  status: "open" | "resolved";
  created_at: string;
  due_at: string;
  overdue: boolean;
  resolved_by: string | null;
  resolution: string | null;
  resolution_note: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  /** Hex SHA-256 of content_md. */
  sha256: string;
  content_md: string;
  effective_date: string | null;
  review_by: string | null;
  claims: Claim[];
  history: HistoryEntry[];
  issues: Issue[];
}

export type UploadOutcome = "live" | "blocked" | "superseded_previous";

export interface UploadResult {
  document: DocumentSummary;
  issues: Issue[];
  outcome: UploadOutcome;
}

export interface Receipt {
  id: string;
  signature_b64: string;
  payload_sha256: string;
  created_at: string;
}

/** A claim whose value in an alternative differs from the document that was used. */
export interface ClaimDiff {
  key: string;
  value: string;
  live_value: string;
}

/** Another in-scope document on the same topic that was NOT used for the answer. */
export interface Alternative {
  id: string;
  title: string;
  country: string;
  version: number;
  status: DocStatus;
  updated_at: string;
  updated_by: string;
  source: DocSource;
  source_detail: string;
  /** One plain-English sentence. */
  reason: string;
  differs: ClaimDiff[];
}

export type ProvenanceKind = "created" | "checked" | "flagged" | "resolved" | "live" | "superseded_previous";

export interface ProvenanceEvent {
  at: string;
  actor: string;
  kind: ProvenanceKind;
  text: string;
}

/** How the used document became the single source of truth (events oldest first). */
export interface Provenance {
  source: DocSource;
  source_detail: string;
  sha256: string;
  uploaded_by: string;
  events: ProvenanceEvent[];
}

export type AnswerNodeRole = "source" | "alternative" | "context";

export interface AnswerGraphNode extends GraphNode {
  role: AnswerNodeRole;
}

export interface AnswerGraph {
  nodes: AnswerGraphNode[];
  edges: GraphEdge[];
}

/** Exact verbatim excerpt from the source document. */
export interface Quote {
  text: string;
  /** Heading of the section it came from, e.g. "Key rules". */
  section: string;
}

export interface ChatResponse {
  answer: string;
  /** Verbatim excerpts from the source that back the answer. Empty when document is null. */
  quotes: Quote[];
  document: DocumentSummary | null;
  matched_claims: Claim[];
  receipt: Receipt;
  note?: string | null;
  /** "ai" = worded by a (local) AI model and checked against the document; "template" = quoted. */
  answer_mode: "ai" | "template";
  /** Newest first. Empty when document is null. */
  alternatives: Alternative[];
  provenance: Provenance | null;
  graph: AnswerGraph | null;
}

export interface VerifyResponse {
  valid: boolean;
  receipt: Record<string, unknown>;
}

export type GraphNodeType = "topic" | "document" | "person" | "country" | "department";
export type GraphEdgeType =
  | "covers"
  | "owned_by"
  | "applies_to"
  | "supersedes"
  | "conflicts_with"
  | "belongs_to";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  status?: DocStatus;
  trust?: Trust;
  /** Topic map only (GET /graph without ?topic). */
  doc_count?: number;
  open_issue_count?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------- dashboard (v3 D + v3.1)

/** Upload is the only real ingestion path; it carries every in-scope document. */
export interface DashboardUploadSource {
  id: "upload";
  label: string;
  status: "live";
  documents: number;
  live: number;
  blocked: number;
  last_at: string | null;
}

/** Roadmap connectors: id/label/status only, never numbers. */
export interface DashboardComingSoonSource {
  id: string;
  label: string;
  status: "coming_soon";
}

export type DashboardSource = DashboardUploadSource | DashboardComingSoonSource;

export type ActivityKind = "published" | "uploaded" | "blocked" | "live" | "resolved" | "superseded";

export interface DashboardActivity {
  id: string;
  at: string;
  actor: string;
  kind: ActivityKind | (string & {});
  /** Plain-English one-liner. */
  text: string;
  document_id: string | null;
  source: string | null;
  outcome: "live" | "blocked" | null;
}

export interface Dashboard {
  totals: { documents: number; live: number; blocked: number; superseded: number; rejected: number };
  sources: DashboardSource[];
  issues: {
    open: Record<Level, number>;
    overdue: number;
    next_due: { id: number | string; document_id: string; document_title: string; level: Level; due_at: string } | null;
  };
  topics: Record<Trust, number>;
  /** Newest first, max 25. */
  activity: DashboardActivity[];
  generated_at: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Do not show a toast on error (caller renders the error inline). */
  silent?: boolean;
  /** Do not redirect to /login on 401 (used by the login form itself). */
  noAuthRedirect?: boolean;
}

const USE_MOCK = import.meta.env.VITE_MOCK === "1";

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  if (USE_MOCK) {
    const { mockFetch } = await import("@/lib/mock");
    return mockFetch(path, init);
  }
  return fetch(path, init);
}

function redirectToLogin() {
  if (window.location.pathname !== "/login") {
    const next = window.location.pathname + window.location.search;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "verity",
  };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await rawFetch(`/api${path}`, {
      method: opts.method ?? "GET",
      headers,
      body,
      credentials: "include",
    });
  } catch {
    const msg = "Can't reach the Verity server. Check your connection and try again.";
    if (!opts.silent) toast.error(msg);
    throw new ApiError(0, msg);
  }

  if (res.status === 401 && !opts.noAuthRedirect) {
    redirectToLogin();
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? formatDetail((data as { detail: unknown }).detail)
        : `Request failed (${res.status})`;
    if (!opts.silent) toast.error(detail);
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{loc, msg, type}]
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
      .join("; ");
  }
  return "Something went wrong.";
}

export const api = {
  login: (username: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: { username, password },
      silent: true,
      noAuthRedirect: true,
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST", noAuthRedirect: true }),
  /** Used by the auth guard, which handles 401 itself (client-side redirect). */
  me: () => request<User>("/me", { silent: true, noAuthRedirect: true }),
  topics: () => request<Topic[]>("/topics", { silent: true }),
  documents: (params: { topic?: string; country?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
    const qs = q.toString();
    return request<DocumentSummary[]>(`/documents${qs ? `?${qs}` : ""}`, { silent: true });
  },
  document: (id: string) => request<DocumentDetail>(`/documents/${encodeURIComponent(id)}`, { silent: true }),
  /** `silent`: the caller renders the error inline (e.g. the dashboard drop zone). */
  upload: (file: File, opts: { silent?: boolean } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<UploadResult>("/documents", { method: "POST", body: fd, silent: opts.silent });
  },
  issues: (status: "open" | "resolved" = "open") =>
    request<Issue[]>(`/issues?status=${status}`, { silent: true }),
  resolveIssue: (id: Issue["id"], resolution: "accept_new" | "keep_existing", note: string) =>
    request<{ issue: Issue; document: DocumentSummary }>(`/issues/${encodeURIComponent(String(id))}/resolve`, {
      method: "POST",
      body: { resolution, note },
    }),
  chat: (question: string) => request<ChatResponse>("/chat", { method: "POST", body: { question } }),
  verifyReceipt: (id: string) =>
    request<VerifyResponse>(`/receipts/${encodeURIComponent(id)}/verify`, { silent: true }),
  dashboard: () => request<Dashboard>("/dashboard", { silent: true }),
  /** No topic: the topic map. With a topic id: that topic's documents, owners and countries. */
  graph: (topic?: string) =>
    request<GraphResponse>(topic ? `/graph?topic=${encodeURIComponent(topic)}` : "/graph", { silent: true }),
};

/** Fired after anything that changes the open-issue count (upload, resolve). */
export const ISSUES_CHANGED = "verity:issues-changed";
export function notifyIssuesChanged() {
  window.dispatchEvent(new Event(ISSUES_CHANGED));
}
