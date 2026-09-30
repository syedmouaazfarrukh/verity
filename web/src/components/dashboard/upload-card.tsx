import * as React from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, FileUp, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { UploadMark } from "@/components/verity/brand-icons";
import type { DashboardUploadSource, UploadResult } from "@/lib/api";
import { formatAgo, humanizeKey, LEVEL_ORDER, RULE_LABELS, useNow } from "@/lib/format";
import { UPLOAD_ACCEPT } from "@/lib/upload";
import { cn } from "@/lib/utils";

export type DropState =
  | { phase: "idle" }
  | { phase: "uploading"; name: string }
  /** The server has answered; the dot is on its way through the door. */
  | { phase: "checking"; name: string; result: UploadResult }
  | { phase: "done"; result: UploadResult }
  | { phase: "error"; message: string };

/**
 * The one real connector: a drop zone that sends the file through the normal upload path
 * (POST /api/documents, same checks as the Upload page).
 */
export function UploadSourceCard({
  source,
  state,
  onFile,
  onReset,
}: {
  source: DashboardUploadSource | null;
  state: DropState;
  onFile: (f: File) => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const depth = React.useRef(0);
  const now = useNow(5000);
  const busy = state.phase === "uploading" || state.phase === "checking";

  const pick = () => !busy && inputRef.current?.click();

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        if (!busy) setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = busy ? "none" : "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) onFile(f);
      }}
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm transition-[border-color,box-shadow] duration-150",
        dragging ? "border-primary ring-4 ring-primary/15" : "border-border"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UploadMark className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold leading-5">Upload</span>
            <span className="inline-flex items-center gap-1 rounded border border-ok/25 bg-ok-tint px-1.5 text-[10.5px] font-medium leading-4 text-ok-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden /> Live
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {source?.last_at ? lastLabel(formatAgo(source.last_at, now)) : "No documents yet"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[18px] font-semibold leading-6">{source?.documents ?? "—"}</div>
          <div className="text-[10.5px] leading-3 text-muted-foreground">documents</div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      <div className="mt-2.5 h-[64px]">
        {state.phase === "done" ? (
          <ResultPanel result={state.result} onAgain={onReset} />
        ) : state.phase === "error" ? (
          <div className="h-full flex items-start gap-2 rounded-md border border-danger/30 bg-danger-tint dark:bg-danger/10 px-2.5 py-2">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-4 text-foreground line-clamp-2" role="alert">
                {state.message}
              </p>
              <button type="button" onClick={pick} className="mt-0.5 text-[11px] font-medium text-primary hover:underline">
                Try another file
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={pick}
            disabled={busy}
            aria-label="Drop a .md or .txt file, or choose one"
            className={cn(
              "h-full w-full rounded-md border border-dashed px-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30 hover:bg-muted/40",
              busy && "cursor-progress"
            )}
          >
            {state.phase === "uploading" ? (
              <Status icon={<Loader2 className="h-4 w-4 animate-spin text-primary" />} title={`Uploading ${state.name}`} sub="Sending it to the door…" />
            ) : state.phase === "checking" ? (
              <Status icon={<ShieldCheck className="h-4 w-4 text-primary" />} title={state.result.document.title} sub="Going through the Verity check…" />
            ) : (
              <Status
                icon={<FileUp className={cn("h-4 w-4", dragging ? "text-primary" : "text-muted-foreground")} />}
                title={dragging ? "Release to check it" : "Drop a .md or .txt file"}
                sub={
                  <>
                    or <span className="text-primary">choose one</span> · up to 200 KB
                  </>
                }
              />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function lastLabel(ago: string) {
  return /ago$|^just now$/.test(ago) ? `Last document ${ago}` : `Last document on ${ago}`;
}

function Status({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </span>
  );
}

function ResultPanel({ result, onAgain }: { result: UploadResult; onAgain: () => void }) {
  const blocked = result.outcome === "blocked";
  const worst = LEVEL_ORDER.map((l) => result.issues.find((i) => i.level === l)).find(Boolean);
  const reason = !worst
    ? "no issues found"
    : worst.rule === "conflict" && worst.new_value && worst.existing_value
      ? `Conflict: ${worst.new_value} vs ${worst.existing_value}`
      : `${RULE_LABELS[worst.rule] ?? humanizeKey(worst.rule)}${result.issues.length > 1 ? ` +${result.issues.length - 1} more` : ""}`;
  return (
    <div
      className={cn(
        "h-full rounded-md border px-2.5 py-2",
        blocked ? "border-danger/30 bg-danger-tint dark:bg-danger/10" : "border-ok/30 bg-ok-tint dark:bg-ok/10"
      )}
      role="status"
      aria-label="Upload result"
    >
      <div className="flex items-center gap-1.5 text-[12px]">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", blocked ? "bg-danger" : "bg-ok")} aria-hidden />
        <span className="font-semibold text-foreground shrink-0">
          {blocked ? "Blocked" : result.outcome === "superseded_previous" ? "Live, replaced the old version" : "Live"}
        </span>
        <span className="text-muted-foreground truncate">· {reason}</span>
        <button
          type="button"
          onClick={onAgain}
          className="ml-auto -mr-1 shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Upload another file"
          title="Upload another file"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
      <Link
        to={`/documents/${encodeURIComponent(result.document.id)}`}
        className="group mt-1 flex items-center gap-1 text-[12px] text-foreground hover:text-primary"
      >
        <span className="truncate">{result.document.title}</span>
        <ArrowRight className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100" aria-hidden />
      </Link>
    </div>
  );
}
