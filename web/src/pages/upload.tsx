import * as React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, FileText, Loader2, OctagonX, RotateCcw, UploadCloud } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CountryChip, DepartmentChip, SourceBadge, StatusBadge } from "@/components/verity/badges";
import { IssueCard } from "@/components/verity/issue-card";
import { PageHeader } from "@/components/verity/states";
import { api, notifyIssuesChanged, type UploadResult } from "@/lib/api";
import { formatDate, LEVEL_ORDER } from "@/lib/format";
import { checkUploadFile, UPLOAD_ACCEPT } from "@/lib/upload";
import { cn } from "@/lib/utils";

export function UploadPage() {
  const [dragging, setDragging] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<UploadResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setResult(null);
    const problem = checkUploadFile(f);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(f);
    setUploading(true);
    try {
      const r = await api.upload(f);
      setResult(r);
      notifyIssuesChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <PageHeader
        title="Upload a document"
        description="Verity checks every upload against the live documents before anyone can use it."
        actions={
          result ? (
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Upload another
            </Button>
          ) : undefined
        }
      />

      {!result && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a .md or .txt file"
          onClick={() => !uploading && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !uploading) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!uploading) void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "rounded-xl border-2 border-dashed p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dragging ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40",
            uploading && "cursor-wait opacity-80"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-9 w-9 text-primary animate-spin" />
              <p className="mt-3 font-medium">Checking {file?.name}…</p>
              <p className="text-sm text-muted-foreground">Extracting rules and comparing with live documents.</p>
            </>
          ) : (
            <>
              <UploadCloud className="h-9 w-9 text-muted-foreground" />
              <p className="mt-3 font-medium">Drop a document here, or click to choose a file</p>
              <p className="text-sm text-muted-foreground">Markdown or plain text (.md, .txt), up to 200 KB.</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-tint text-danger-foreground p-3 text-sm">
          {error}
        </div>
      )}

      {result && <UploadResultView result={result} fileName={file?.name ?? ""} />}
    </div>
  );
}

function UploadResultView({ result, fileName }: { result: UploadResult; fileName: string }) {
  const { document: doc, outcome } = result;
  const blocked = outcome === "blocked";
  const blockingCount = result.issues.filter((i) => i.level === "critical" || i.level === "high").length;
  const issues = [...result.issues].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div
        className={cn(
          "rounded-xl border p-5 flex items-start gap-3",
          blocked ? "border-danger/40 bg-danger-tint" : "border-ok/40 bg-ok-tint"
        )}
      >
        {blocked ? (
          <OctagonX className="h-6 w-6 text-danger shrink-0" />
        ) : (
          <CheckCircle2 className="h-6 w-6 text-ok shrink-0" />
        )}
        <div className={blocked ? "text-danger-foreground" : "text-ok-foreground"}>
          <p className="text-lg font-semibold">
            {blocked
              ? "Blocked: resolve before anyone can use it"
              : `Live: this is now the single source for ${doc.topic_name || doc.topic_id}`}
          </p>
          <p className="text-sm opacity-90 mt-0.5">
            {blocked
              ? `${blockingCount} blocking issue${blockingCount === 1 ? "" : "s"} must be resolved by a knowledge owner. Chat keeps using the current live document.`
              : outcome === "superseded_previous"
                ? "The previous version is now superseded and kept in the version history."
                : "Chat answers for this topic now point to this document."}
          </p>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <FileText className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{doc.title || fileName}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <CountryChip country={doc.country} />
            {doc.department && <DepartmentChip department={doc.department} />}
            <span className="font-mono">v{doc.version}</span>
            <StatusBadge status={doc.status} />
            <SourceBadge source={doc.source} detail={doc.source_detail} className="max-w-[20rem]" />
            <span>
              Uploaded {formatDate(doc.updated_at)} by {doc.updated_by || "—"}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/documents/${encodeURIComponent(doc.id)}`}>
            Open document <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </Card>

      <section>
        <h2 className="text-base font-semibold mb-3">
          Checks <span className="text-muted-foreground font-normal">({issues.length} issue{issues.length === 1 ? "" : "s"})</span>
        </h2>
        {issues.length === 0 ? (
          <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-ok" /> All checks passed: no conflicts, duplicates or missing metadata.
          </Card>
        ) : (
          <div className="space-y-3">
            {issues.map((i) => (
              <IssueCard key={i.id} issue={i} showDocument={false} newLabel="Your document says" />
            ))}
          </div>
        )}
        {issues.length > 0 && (
          <Button asChild variant="link" className="px-0 mt-2">
            <Link to="/issues">
              Go to the review queue <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </section>
    </motion.div>
  );
}
