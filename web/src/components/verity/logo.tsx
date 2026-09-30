import { cn } from "@/lib/utils";

/** An open page and a decisive check: many records, one verified source. */
export function VerityLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("shrink-0 text-primary", className)} aria-hidden="true">
      <path d="M18 5H8a3 3 0 0 0-3 3v16a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3v-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 15.5 16 21 28 6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 10h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}

export function VerityWordmark({ className }: { className?: string }) {
  return <span className={cn("font-semibold tracking-[-0.055em] leading-none", className)}>verity<span className="text-primary">.</span></span>;
}
