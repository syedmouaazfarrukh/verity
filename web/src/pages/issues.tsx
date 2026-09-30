import * as React from "react";
import { CheckCircle2, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { LevelBadge } from "@/components/verity/badges";
import { IssueCard } from "@/components/verity/issue-card";
import { ErrorState, PageHeader } from "@/components/verity/states";
import { api, notifyIssuesChanged, type Issue } from "@/lib/api";
import { canResolve, useUser } from "@/lib/auth";
import { LEVEL_ORDER, RULE_LABELS } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";

const LEVEL_HEADING = {
  critical: "24-hour SLA",
  high: "72-hour SLA",
  medium: "7-day SLA",
  low: "30-day SLA",
} as const;

export function IssuesPage() {
  const user = useUser();
  const resolver = canResolve(user);
  const [tab, setTab] = React.useState<"open" | "resolved">("open");
  const state = useAsync(() => api.issues(tab), [tab]);
  const [resolving, setResolving] = React.useState<Issue | null>(null);

  const issues = state.data ?? [];
  const grouped = LEVEL_ORDER.map((level) => ({
    level,
    items: issues
      .filter((i) => i.level === level)
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <PageHeader
        title="Review queue"
        description={
          resolver
            ? "Resolve conflicts before their SLA runs out. Every decision is written to the audit log."
            : "Issues on documents in your countries and departments. Only knowledge owners can resolve them."
        }
        actions={
          <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="tablist">
            {(["open", "resolved"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3 h-7 text-xs rounded capitalize transition-colors",
                  tab === t ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        }
      />

      {!resolver && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" /> Read-only: you're signed in as a consultant.
        </div>
      )}

      {state.loading && !state.data ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={tab === "open" ? "Nothing to review" : "No resolved issues yet"}
          description={
            tab === "open"
              ? "Every live document in your scope is consistent. New conflicts appear here as soon as someone uploads."
              : "Resolved issues and their decisions will show up here."
          }
        />
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => (
            <section key={g.level}>
              <div className="flex items-center gap-2 mb-3">
                <LevelBadge level={g.level} />
                <h2 className="text-sm font-semibold">{LEVEL_HEADING[g.level]}</h2>
                <span className="text-xs text-muted-foreground">({g.items.length})</span>
              </div>
              <div className="space-y-3">
                {g.items.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    actions={
                      resolver && issue.status === "open" ? (
                        <Button size="sm" onClick={() => setResolving(issue)}>
                          Resolve
                        </Button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ResolveDialog
        issue={resolving}
        onClose={() => setResolving(null)}
        onResolved={() => {
          setResolving(null);
          notifyIssuesChanged();
          state.reload();
        }}
      />
    </div>
  );
}

function ResolveDialog({
  issue,
  onClose,
  onResolved,
}: {
  issue: Issue | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [choice, setChoice] = React.useState<"accept_new" | "keep_existing" | null>(null);
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (issue) {
      setChoice(null);
      setNote("");
      setTouched(false);
    }
  }, [issue]);

  const valid = choice !== null && note.trim().length > 0;

  async function submit() {
    setTouched(true);
    if (!issue || !valid || !choice) return;
    setSubmitting(true);
    try {
      await api.resolveIssue(issue.id, choice, note.trim());
      toast.success(
        choice === "accept_new"
          ? "New version accepted: it is now the single source."
          : "Existing document kept. The upload was rejected."
      );
      onResolved();
    } catch {
      // api client already toasts the server's detail
    } finally {
      setSubmitting(false);
    }
  }

  const options = [
    {
      value: "accept_new" as const,
      title: "Accept new version",
      body: "The uploaded document goes live; the current one is superseded and kept in history.",
    },
    {
      value: "keep_existing" as const,
      title: "Keep existing",
      body: "The live document stays the single source; the upload is rejected.",
    },
  ];

  return (
    <Dialog open={issue !== null} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve issue</DialogTitle>
          <DialogDescription>
            {issue ? `${RULE_LABELS[issue.rule] ?? issue.rule} on “${issue.document_title}”.` : ""}
          </DialogDescription>
        </DialogHeader>

        {issue && (issue.existing_value || issue.new_value) && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border border-border bg-muted/50 p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Live document says</div>
              <div className="font-medium mt-0.5">{issue.existing_value || "—"}</div>
            </div>
            <div className="rounded-md border border-danger/30 bg-danger-tint p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-danger-foreground">New document says</div>
              <div className="font-medium mt-0.5">{issue.new_value || "—"}</div>
            </div>
          </div>
        )}

        <div className="grid gap-2" role="radiogroup" aria-label="Decision">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={choice === o.value}
              onClick={() => setChoice(o.value)}
              className={cn(
                "text-left rounded-lg border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                choice === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              )}
            >
              <div className="text-sm font-semibold">{o.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{o.body}</div>
            </button>
          ))}
          {touched && !choice && <p className="text-xs text-danger">Choose a decision.</p>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="resolve-note" className="text-xs font-medium">
            Note (required, goes to the audit log)
          </label>
          <textarea
            id="resolve-note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Confirmed with BE payroll: 2026 indexation applies from August."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {touched && !note.trim() && <p className="text-xs text-danger">A note is required.</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
