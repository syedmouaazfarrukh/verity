import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileX, History, ListChecks, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { CountryChip, departmentLabel, DepartmentChip, Fingerprint, SourceBadge, StatusBadge } from "@/components/verity/badges";
import { IssueCard } from "@/components/verity/issue-card";
import { Markdown } from "@/components/verity/markdown";
import { ErrorState } from "@/components/verity/states";
import { api, ApiError, type DocumentDetail } from "@/lib/api";
import { formatDate, humanizeKey } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";

export function DocumentPage() {
  const { id = "" } = useParams();
  const [notFound, setNotFound] = React.useState(false);
  const state = useAsync(async () => {
    setNotFound(false);
    try {
      return await api.document(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      throw e;
    }
  }, [id]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Knowledge space
      </Link>
      {state.loading && !state.data ? (
        <DocumentSkeleton />
      ) : notFound ? (
        <EmptyState
          icon={FileX}
          title="Document not found"
          description="It doesn't exist, or it's outside the countries or departments you have access to."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/">Back to knowledge space</Link>
            </Button>
          }
        />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data ? (
        <DocumentView doc={state.data} />
      ) : null}
    </div>
  );
}

function DocumentSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Skeleton className="h-[480px]" />
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}

function DocumentView({ doc }: { doc: DocumentDetail }) {
  const openIssues = doc.issues.filter((i) => i.status === "open");
  const latestLive = doc.history.find((h) => h.status === "live");
  const reviewOverdue = doc.review_by ? new Date(doc.review_by).getTime() < Date.now() : false;

  return (
    <>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{doc.topic_name}</span>
          <CountryChip country={doc.country} />
          {doc.department && <DepartmentChip department={doc.department} />}
          <StatusBadge status={doc.status} />
        </div>
        <h1 className="text-display-md mt-2">{doc.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span>
            <span className="font-mono">v{doc.version}</span> · Updated {formatDate(doc.updated_at)} by {doc.updated_by}
          </span>
          <SourceBadge source={doc.source} detail={doc.source_detail} />
          <Fingerprint value={doc.sha256} />
        </div>
      </div>

      {doc.status !== "live" && (
        <div
          className={cn(
            "mb-6 rounded-lg border p-3 text-sm flex items-start gap-2",
            doc.status === "blocked"
              ? "border-danger/30 bg-danger-tint text-danger-foreground"
              : "border-border bg-muted text-muted-foreground"
          )}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            {doc.status === "blocked" && "Blocked: this document has open issues and is not used to answer questions until they are resolved."}
            {doc.status === "superseded" && "Superseded: a newer version is the single source for this topic."}
            {doc.status === "rejected" && "Rejected: a reviewer kept the existing document instead of this one."}
            {latestLive && latestLive.id !== doc.id && (
              <>
                {" "}
                <Link to={`/documents/${encodeURIComponent(latestLive.id)}`} className="font-medium underline underline-offset-4">
                  Open the live version (v{latestLive.version})
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="space-y-6 min-w-0">
          <Card className="p-6 lg:p-8">
            {doc.content_md?.trim() ? (
              <Markdown source={doc.content_md} />
            ) : (
              <p className="text-sm text-muted-foreground">This document has no content.</p>
            )}
          </Card>

          <section>
            <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" /> Open issues
              <span className="text-muted-foreground font-normal">({openIssues.length})</span>
            </h2>
            {openIssues.length === 0 ? (
              <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-ok" /> No open issues on this document.
              </Card>
            ) : (
              <div className="space-y-3">
                {openIssues.map((i) => (
                  <IssueCard key={i.id} issue={i} showDocument={false} newLabel="This document says" />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">Details</h2>
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Owner</dt>
              <dd className={cn(!doc.owner && "text-danger font-medium")}>{doc.owner || "Missing"}</dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-mono">v{doc.version}</dd>
              <dt className="text-muted-foreground">Country</dt>
              <dd>{doc.country || "—"}</dd>
              <dt className="text-muted-foreground">Department</dt>
              <dd>{departmentLabel(doc.department)}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="min-w-0">
                <SourceBadge source={doc.source} compact />
                {doc.source_detail && <div className="text-xs text-muted-foreground mt-1 break-words">{doc.source_detail}</div>}
              </dd>
              <dt className="text-muted-foreground">Fingerprint</dt>
              <dd className="min-w-0">
                <Fingerprint value={doc.sha256} label="" />
              </dd>
              <dt className="text-muted-foreground">Effective</dt>
              <dd>{formatDate(doc.effective_date)}</dd>
              <dt className="text-muted-foreground">Review by</dt>
              <dd className={cn(reviewOverdue && "text-danger font-medium")}>
                {formatDate(doc.review_by)}
                {reviewOverdue && " (overdue)"}
              </dd>
              <dt className="text-muted-foreground">Updated</dt>
              <dd>
                {formatDate(doc.updated_at)}
                <div className="text-xs text-muted-foreground">by {doc.updated_by || "—"}</div>
              </dd>
            </dl>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" /> Version history
            </h2>
            {doc.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No history recorded.</p>
            ) : (
              <ol className="relative border-l border-border ml-1.5 space-y-4">
                {doc.history.map((h) => {
                  const current = h.id === doc.id;
                  return (
                    <li key={h.id} className="pl-4 relative">
                      <span
                        className={cn(
                          "absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                          h.status === "live" ? "bg-ok" : h.status === "blocked" ? "bg-danger" : "bg-unknown"
                        )}
                      />
                      <Link
                        to={`/documents/${encodeURIComponent(h.id)}`}
                        className={cn(
                          "block rounded-md -mx-1.5 px-1.5 py-0.5",
                          current ? "bg-muted" : "hover:bg-muted/60"
                        )}
                        aria-current={current ? "page" : undefined}
                      >
                        <div className="text-xs font-medium">
                          <span className="font-mono">v{h.version}</span> · {formatDate(h.updated_at)} · {h.updated_by || "—"}
                          {h.status !== "superseded" && (
                            <StatusBadge status={h.status} className="ml-1.5 text-[10px] px-1.5 py-0" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{h.change_summary || "No change summary."}</div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" /> Key rules extracted
            </h2>
            {doc.claims.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rules extracted from this document.</p>
            ) : (
              <ul className="space-y-1.5">
                {doc.claims.map((c) => (
                  <li key={`${c.key}-${c.value}`} className="flex items-start gap-2 text-sm">
                    <Tag className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    <span>
                      <span className="text-muted-foreground">{humanizeKey(c.key)}:</span>{" "}
                      <span className="font-medium">{c.value}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
