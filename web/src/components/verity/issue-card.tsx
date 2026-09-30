import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LevelBadge, SlaCountdown } from "@/components/verity/badges";
import type { Issue } from "@/lib/api";
import { InlineText } from "@/components/verity/markdown";
import { RULE_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

interface IssueCardProps {
  issue: Issue;
  /** Label for the uploaded/new side of a conflict. */
  newLabel?: string;
  /** Show which document the issue is on (hidden when already on that document). */
  showDocument?: boolean;
  actions?: React.ReactNode;
}

const LEVEL_BORDER: Record<string, string> = {
  critical: "border-l-danger",
  high: "border-l-danger/70",
  medium: "border-l-warn",
  low: "border-l-border",
};

export function IssueCard({ issue, newLabel = "New document says", showDocument = true, actions }: IssueCardProps) {
  // Side-by-side only makes sense when there is another document to compare with.
  const hasComparison =
    Boolean(issue.existing_value || issue.new_value) && (issue.rule === "conflict" || Boolean(issue.other_document_id));
  const otherLabel = issue.rule === "conflict" ? "Conflicts with" : "Compared with";
  const resolved = issue.status === "resolved";

  return (
    <Card className={cn("p-4 border-l-4", LEVEL_BORDER[issue.level] ?? "border-l-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <LevelBadge level={issue.level} />
          <span className="text-sm font-semibold">{RULE_LABELS[issue.rule] ?? issue.rule}</span>
        </div>
        <SlaCountdown dueAt={issue.due_at} resolved={resolved} />
      </div>

      <p className="mt-2 text-sm text-foreground/90">
        <InlineText text={issue.message} />
      </p>

      {showDocument && (
        <Link
          to={`/documents/${encodeURIComponent(issue.document_id)}`}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" />
          {issue.document_title || issue.document_id}
        </Link>
      )}

      {hasComparison && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Live document says
            </div>
            <div className="mt-1 text-sm font-medium break-words">{issue.existing_value || "—"}</div>
          </div>
          <div
            className={cn(
              "rounded-md border p-3",
              issue.rule === "conflict" ? "border-danger/30 bg-danger-tint" : "border-border bg-card"
            )}
          >
            <div
              className={cn(
                "text-[11px] uppercase tracking-wide font-medium",
                issue.rule === "conflict" ? "text-danger-foreground" : "text-muted-foreground"
              )}
            >
              {newLabel}
            </div>
            <div className="mt-1 text-sm font-medium break-words">{issue.new_value || "—"}</div>
          </div>
        </div>
      )}

      {(issue.other_document_id || actions) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {issue.other_document_id ? (
            <Link
              to={`/documents/${encodeURIComponent(issue.other_document_id)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-4"
            >
              {otherLabel}: {issue.other_document_title || issue.other_document_id}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}

      {resolved && (
        <div className="mt-3 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
          Resolved by <span className="font-medium text-foreground">{issue.resolved_by ?? "—"}</span>
          {issue.resolution ? ` · ${issue.resolution === "accept_new" ? "accepted new version" : "kept existing"}` : ""}
          {issue.resolution_note ? ` — “${issue.resolution_note}”` : ""}
        </div>
      )}
    </Card>
  );
}
