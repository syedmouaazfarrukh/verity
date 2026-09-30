/**
 * Small inline brand marks for the dashboard's source cards (no icon dependency).
 * Simplified, recognisable shapes on a 24×24 grid. Marks that are monochrome in real life
 * (GitHub, Notion) use currentColor so they follow the theme; the rest keep their brand colours
 * and are rendered greyscale by the caller when a connector is not available.
 */
import * as React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type MarkProps = { className?: string };

function Svg({ className, children }: MarkProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5 shrink-0", className)} aria-hidden focusable="false">
      {children}
    </svg>
  );
}

export function GmailMark({ className }: MarkProps) {
  return (
    <Svg className={className}>
      <path fill="#4285F4" d="M1.64 21h3.81v-9.27L0 7.64v11.73C0 20.27.73 21 1.64 21z" />
      <path fill="#34A853" d="M18.55 21h3.81c.9 0 1.64-.73 1.64-1.64V7.64l-5.45 4.09z" />
      <path fill="#FBBC04" d="M18.55 4.64v7.09L24 7.64V5.46c0-2.02-2.31-3.18-3.93-1.96z" />
      <path fill="#EA4335" d="M5.45 11.73V4.64L12 9.55l6.55-4.91v7.09L12 16.64z" />
      <path fill="#C5221F" d="M0 5.46v2.18l5.45 4.09V4.64L3.93 3.5C2.31 2.28 0 3.44 0 5.46z" />
    </Svg>
  );
}

export function SlackMark({ className }: MarkProps) {
  const r = 2.52;
  return (
    <Svg className={className}>
      {/* blue: top-left */}
      <rect x="0" y="6.31" width="11.36" height="5.04" rx={r} fill="#36C5F0" />
      <rect x="6.31" y="0" width="5.04" height="5.04" rx={r} fill="#36C5F0" />
      {/* green: top-right */}
      <rect x="12.64" y="0" width="5.04" height="11.36" rx={r} fill="#2EB67D" />
      <rect x="18.96" y="6.31" width="5.04" height="5.04" rx={r} fill="#2EB67D" />
      {/* yellow: bottom-right */}
      <rect x="12.64" y="12.64" width="11.36" height="5.04" rx={r} fill="#ECB22E" />
      <rect x="12.64" y="18.96" width="5.04" height="5.04" rx={r} fill="#ECB22E" />
      {/* red: bottom-left */}
      <rect x="6.31" y="12.64" width="5.04" height="11.36" rx={r} fill="#E01E5A" />
      <rect x="0" y="12.64" width="5.04" height="5.04" rx={r} fill="#E01E5A" />
    </Svg>
  );
}

export function GitHubMark({ className }: MarkProps) {
  return (
    <Svg className={className}>
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </Svg>
  );
}

export function NotionMark({ className }: MarkProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        fill="currentColor"
        d="M7.4 6.6h2.1l5 7.4V8.1l-1.2-.3v-1.2h3.9v1.2l-1 .3v9.3h-1.6L9.3 9.6v6.3l1.3.3v1.2H6.7v-1.2l1-.3V8l-.3-.2z"
      />
    </Svg>
  );
}

export function SharePointMark({ className }: MarkProps) {
  return (
    <Svg className={className}>
      <circle cx="14" cy="8" r="6.5" fill="#036C70" />
      <circle cx="17.5" cy="14.5" r="5" fill="#1A9BA1" />
      <circle cx="13.5" cy="19.2" r="3.8" fill="#37C6D0" />
      <rect x="1" y="6" width="12" height="12" rx="2" fill="#03787C" />
      <path
        fill="#fff"
        d="M5.3 14.5c.5.4 1.1.6 1.7.6.7 0 1-.3 1-.7 0-.4-.3-.6-1.1-.9-1.1-.4-1.7-.9-1.7-1.8 0-1 .9-1.8 2.2-1.8.6 0 1.2.1 1.6.4l-.3 1c-.3-.2-.8-.4-1.3-.4-.6 0-.9.3-.9.6 0 .4.3.6 1.2.9 1.1.4 1.6 1 1.6 1.8 0 1-.8 1.9-2.4 1.9-.6 0-1.3-.2-1.7-.4z"
      />
    </Svg>
  );
}

export function GoogleDriveMark({ className }: MarkProps) {
  return (
    <Svg className={className}>
      <path fill="#0F9D58" d="M8 3l3.25 6L4.75 21 1.5 15z" />
      <path fill="#4285F4" d="M4.75 21h14.5l3.25-6H8z" />
      <path fill="#F4B400" d="M8 3h8l6.5 12h-8z" />
    </Svg>
  );
}

export function TeamsMark({ className }: MarkProps) {
  return (
    <Svg className={className}>
      <circle cx="19" cy="6.5" r="2.3" fill="#5059C9" />
      <rect x="15.5" y="10" width="8" height="8.5" rx="2.5" fill="#5059C9" />
      <circle cx="13" cy="5" r="3.2" fill="#7B83EB" />
      <rect x="8.5" y="9.5" width="10" height="11.5" rx="2.5" fill="#7B83EB" />
      <rect x="1" y="6" width="12" height="12" rx="2" fill="#4B53BC" />
      <path fill="#fff" d="M4 9h6v1.6H7.8V15H6.2v-4.4H4z" />
    </Svg>
  );
}

export function UploadMark({ className }: MarkProps) {
  return <Upload className={cn("h-5 w-5 shrink-0", className)} aria-hidden />;
}

const MARKS: Record<string, (p: MarkProps) => React.ReactElement> = {
  upload: UploadMark,
  email: GmailMark,
  gmail: GmailMark,
  slack: SlackMark,
  github: GitHubMark,
  git: GitHubMark,
  notion: NotionMark,
  sharepoint: SharePointMark,
  "google-drive": GoogleDriveMark,
  teams: TeamsMark,
};

/** Brand mark for a source id; falls back to the upload glyph. */
export function BrandMark({ source, className }: { source: string; className?: string }) {
  const Mark = MARKS[source] ?? UploadMark;
  return <Mark className={className} />;
}
