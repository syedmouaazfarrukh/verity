import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, FileText, Layers3, Loader2, LockKeyhole, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { VerityLogo, VerityWordmark } from "@/components/verity/logo";
import { api } from "@/lib/api";
import { safeNext, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const DEMO_PASSWORD = "verity-demo";

const DEMO_USERS = [
  { username: "sofie", hint: "Consultant · BE" },
  { username: "daan", hint: "Consultant · NL" },
  { username: "lies", hint: "Payroll & HR owner" },
  { username: "noor", hint: "Finance owner" },
  { username: "admin", hint: "Admin · everything" },
];

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn(username, password);
  }

  async function signIn(name: string, pass: string) {
    if (!name.trim() || !pass) {
      setError("Enter your username and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { user } = await api.login(name.trim(), pass);
      setUser(user);
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full h-11 rounded-lg border border-input bg-background px-3.5 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/10";

  return (
    <main className="login-layout min-h-screen bg-background">
      <section className="login-story relative flex flex-col overflow-hidden border-b border-border lg:border-b-0 lg:border-r" aria-labelledby="brand-promise">
        <div className="relative z-10 flex items-center gap-3">
          <VerityLogo className="h-9 w-9" />
          <VerityWordmark className="text-[32px]" />
          <span className="ml-auto text-[11px] font-medium tracking-[0.12em] uppercase text-muted-foreground">Knowledge, verified</span>
        </div>

        <div className="relative z-10 my-auto py-12 lg:py-10">
          <p className="mb-5 text-xs font-medium tracking-[0.16em] uppercase text-muted-foreground">Unlock the knowledge within</p>
          <h1 id="brand-promise" className="text-[42px] xl:text-[54px] leading-[1.08] tracking-[-0.055em] font-semibold">
            One subject.<br />One source.<br /><span className="text-primary">Always the latest.</span>
          </h1>
          <p className="mt-6 max-w-[380px] text-[15px] leading-6 text-muted-foreground">
            Clear answers for the work that matters.<br className="hidden xl:block" /> Grounded in one live document, with the exact lines to back them up.
          </p>
          <SourceIllustration />
        </div>

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
          <span>Built for SD Worx</span>
          <span className="flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" aria-hidden /> AI runs on-premise</span>
        </div>
      </section>

      <section className="relative flex flex-col items-center justify-center px-6 py-16 lg:px-12" aria-labelledby="sign-in-heading">
        <Button variant="ghost" size="icon" className="absolute right-5 top-5 rounded-full" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(dark ? "light" : "dark")}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <div className="w-full max-w-[360px]">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Your knowledge space</p>
          <h2 id="sign-in-heading" className="mt-3 text-[30px] leading-9 font-semibold tracking-[-0.035em]">Welcome to Verity</h2>
          <p className="mt-2 mb-7 text-sm text-muted-foreground">Sign in to find the answer you can stand behind.</p>
          <form onSubmit={onSubmit} className="space-y-4" noValidate aria-busy={submitting}>
            <div className="space-y-2">
              <label htmlFor="username" className="text-xs font-medium">Username</label>
              <input id="username" autoComplete="username" autoFocus placeholder="Your username" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} aria-describedby={error ? "login-error" : undefined} />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-xs font-medium">Password</label>
              <input id="password" type="password" autoComplete="current-password" placeholder="Your password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={error ? "login-error" : undefined} />
            </div>
            {error && <p id="login-error" role="alert" className="text-sm text-danger-foreground bg-danger-tint border border-danger/30 rounded-lg px-3 py-2">{error}</p>}
            <Button type="submit" className="w-full h-11 rounded-lg justify-between px-4" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-7 border-t border-border pt-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold">Explore the demo</p>
              <span className="text-[11px] text-muted-foreground">Choose a role to sign in</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_USERS.map((u) => (
                <button key={u.username} type="button" disabled={submitting} onClick={() => {
                  // Use the public demo password, independent of browser-saved credentials.
                  setUsername(u.username);
                  setPassword(DEMO_PASSWORD);
                  void signIn(u.username, DEMO_PASSWORD);
                }} className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left transition-colors last:odd:col-span-2 disabled:opacity-50 disabled:cursor-wait",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  username === u.username ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:border-primary/40 hover:bg-primary/5"
                )}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground" aria-hidden>{u.username.charAt(0).toUpperCase()}</span>
                  <span className="min-w-0"><span className="block text-xs font-semibold">{u.username}</span><span className="block text-[10px] leading-4 text-muted-foreground">{u.hint}</span></span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">Demo password: <code className="font-mono rounded bg-muted px-1.5 py-0.5">{DEMO_PASSWORD}</code></p>
          </div>
        </div>
      </section>
    </main>
  );
}

/** A conceptual diagram, deliberately separate from live product data. */
function SourceIllustration() {
  return (
    <div className="mt-10 max-w-[440px]" role="img" aria-label="Many sources pass through the Verity check to become one grounded answer.">
      <div className="flex items-center" aria-hidden="true">
        <div className="relative flex h-[84px] w-[70px] shrink-0 items-center justify-center">
          <div className="absolute h-14 w-11 -rotate-12 -translate-x-2 rounded-lg border border-border bg-card" />
          <div className="absolute h-14 w-11 rotate-6 translate-x-1 rounded-lg border border-border bg-card" />
          <div className="relative flex h-14 w-11 items-center justify-center rounded-lg border border-border bg-card"><FileText className="h-5 w-5 text-muted-foreground" /></div>
        </div>
        <div className="h-px flex-1 bg-border" /><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="mx-3 flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-card shadow-sm"><VerityLogo className="h-10 w-10" /></div>
        <div className="h-px flex-1 bg-border" /><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="ml-3 w-[102px] rounded-xl border border-border bg-card p-3">
          <Layers3 className="mb-2 h-4 w-4 text-primary" /><div className="h-1 w-full rounded bg-primary/35" /><div className="mt-1.5 h-1 w-3/4 rounded bg-primary/20" /><div className="mt-2.5 h-px bg-border" /><div className="mt-2 h-1 w-1/2 rounded bg-muted-foreground/25" />
        </div>
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true"><span>Many sources</span><span className="font-medium text-foreground">The Verity check</span><span>One answer</span></div>
    </div>
  );
}
