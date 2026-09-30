import * as React from "react";
import {
  Check,
  Clock,
  Copy,
  FolderGit2,
  HardDrive,
  Mail,
  MessagesSquare,
  NotebookText,
  Share2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Department, DocSource, DocStatus, Level, Trust } from "@/lib/api";
import { countdown, formatDateTime, useNow } from "@/lib/format";
import { cn } from "@/lib/utils";

const LEVEL_VARIANT: Record<Level, "danger" | "warn" | "unknown"> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "unknown",
};

export function LevelBadge({ level, className }: { level: Level; className?: string }) {
  return (
    <Badge
      variant={LEVEL_VARIANT[level] ?? "unknown"}
      className={cn("capitalize", level === "critical" && "bg-danger text-white border-transparent", className)}
    >
      {level}
    </Badge>
  );
}

const STATUS_VARIANT: Record<DocStatus, "ok" | "danger" | "unknown"> = {
  live: "ok",
  blocked: "danger",
  superseded: "unknown",
  rejected: "unknown",
};

export function StatusBadge({ status, className }: { status: DocStatus; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "unknown"} className={cn("capitalize", className)}>
      {status}
    </Badge>
  );
}

const TRUST_CLASS: Record<Trust, string> = {
  green: "bg-ok",
  amber: "bg-warn",
  red: "bg-danger",
};
const TRUST_LABEL: Record<Trust, string> = {
  green: "Trusted: no open issues",
  amber: "Attention: open high or medium issues",
  red: "Conflict: open critical issue",
};

export function TrustDot({ trust, className }: { trust: Trust; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)} title={TRUST_LABEL[trust]}>
      {trust === "red" && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-60 animate-ping" />
      )}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", TRUST_CLASS[trust] ?? "bg-unknown")} />
      <span className="sr-only">{TRUST_LABEL[trust]}</span>
    </span>
  );
}

export function CountryChip({ country }: { country: string }) {
  return (
    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground shrink-0">
      {country || "??"}
    </span>
  );
}

/** "due in 23h 58m" — ticks every second, red when overdue. */
export function SlaCountdown({ dueAt, resolved = false }: { dueAt: string; resolved?: boolean }) {
  const now = useNow(1000);
  if (resolved) {
    return <span className="text-xs text-muted-foreground">Resolved</span>;
  }
  const c = countdown(dueAt, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        c.overdue ? "text-danger font-semibold" : "text-muted-foreground"
      )}
      title={`SLA due ${formatDateTime(dueAt)}`}
    >
      <Clock className="h-3.5 w-3.5" />
      SLA {formatDateTime(dueAt)} · {c.label}
    </span>
  );
}

const DEPARTMENT_LABEL: Record<string, string> = { payroll: "Payroll", hr: "HR", finance: "Finance" };

export function departmentLabel(dept: Department | null | undefined): string {
  if (!dept) return "—";
  return DEPARTMENT_LABEL[dept] ?? dept.charAt(0).toUpperCase() + dept.slice(1);
}

export function DepartmentChip({ department, className }: { department: Department; className?: string }) {
  return (
    <span
      className={cn(
        "text-[11px] leading-4 font-medium px-1.5 py-0.5 rounded border border-border bg-card text-muted-foreground shrink-0",
        className
      )}
    >
      {departmentLabel(department)}
    </span>
  );
}

const SOURCE_META: Record<string, { label: string; icon: LucideIcon }> = {
  upload: { label: "Uploaded", icon: Upload },
  email: { label: "Email", icon: Mail },
  "google-drive": { label: "Google Drive", icon: HardDrive },
  sharepoint: { label: "SharePoint", icon: Share2 },
  git: { label: "Git", icon: FolderGit2 },
  teams: { label: "Teams", icon: MessagesSquare },
  notion: { label: "Notion", icon: NotebookText },
};

export function sourceLabel(source: DocSource | null | undefined): string {
  return SOURCE_META[source ?? "upload"]?.label ?? String(source);
}

/** "Email · Forwarded by Pieter Janssens" — where a document came from. */
export function SourceBadge({
  source,
  detail,
  className,
  compact = false,
}: {
  source: DocSource | null | undefined;
  detail?: string | null;
  className?: string;
  /** Icon + label only; the detail moves to the hover title. */
  compact?: boolean;
}) {
  const meta = SOURCE_META[source ?? "upload"] ?? { label: String(source), icon: Upload };
  const Icon = meta.icon;
  const showDetail = !compact && !!detail;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground",
        className
      )}
      title={detail ? `${meta.label} · ${detail}` : meta.label}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="font-medium text-foreground/80 shrink-0">{meta.label}</span>
      {showDetail && <span className="truncate">· {detail}</span>}
    </span>
  );
}

/** Short SHA-256 ("a1b2c3d4…") with the full value on hover; click copies it. */
export function Fingerprint({ value, label = "fingerprint", className }: { value: string | null | undefined; label?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const short = `${value.slice(0, 10)}…`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          className={cn(
            "group inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
            className
          )}
          aria-label={`Copy full ${label}: ${value}`}
        >
          {label && <span>{label}</span>}
          <span className="font-mono text-foreground/80">{short}</span>
          {copied ? (
            <Check className="h-3 w-3 text-ok" aria-hidden />
          ) : (
            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-none">
        <div className="text-[11px] text-muted-foreground mb-0.5">SHA-256 · click to copy</div>
        <div className="font-mono text-[11px] break-all max-w-[22rem]">{value}</div>
      </TooltipContent>
    </Tooltip>
  );
}
