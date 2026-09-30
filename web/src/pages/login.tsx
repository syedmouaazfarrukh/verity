import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VerityLogo } from "@/components/verity/logo";
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
  const passwordRef = React.useRef<HTMLInputElement>(null);

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
    "w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background bg-dot-grid px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <VerityLogo className="h-11 w-11 mb-3" />
          <h1 className="text-display-md">Verity</h1>
          <p className="text-sm text-muted-foreground mt-1">One subject. One source. Always the latest.</p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-xs font-medium">
                Username
              </label>
              <input
                id="username"
                autoComplete="username"
                autoFocus
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium">
                Password
              </label>
              <input
                id="password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-danger-foreground bg-danger-tint border border-danger/30 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full h-10" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">Demo users (click to sign in)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.username}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    // One click signs in with the public demo password, so a browser-saved
                    // password for localhost can't get in the way.
                    setUsername(u.username);
                    setPassword(DEMO_PASSWORD);
                    void signIn(u.username, DEMO_PASSWORD);
                  }}
                  className={cn(
                    "flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors last:odd:col-span-2",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    username === u.username
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <span className="text-xs font-semibold font-mono">{u.username}</span>
                  <span className="text-[11px] text-muted-foreground">{u.hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Demo password: <code className="font-mono px-1 py-0.5 rounded bg-muted">{DEMO_PASSWORD}</code>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
