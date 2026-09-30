import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, ApiError, type User } from "@/lib/api";

interface AuthState {
  user: User | null;
  status: "loading" | "ready";
  /** Network/server problem while checking the session (not a 401). */
  error: string | null;
  setUser: (u: User | null) => void;
  refresh: () => void;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [status, setStatus] = React.useState<AuthState["status"]>("loading");
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    setStatus("loading");
    setError(null);
    api
      .me()
      .then((u) => setUser(u))
      .catch((e: unknown) => {
        setUser(null);
        if (!(e instanceof ApiError && e.status === 401)) {
          setError(e instanceof Error ? e.message : "Could not check your session.");
        }
      })
      .finally(() => setStatus("ready"));
  }, []);

  React.useEffect(() => {
    // The login page doesn't need a session check.
    if (window.location.pathname === "/login") {
      setStatus("ready");
      return;
    }
    refresh();
  }, [refresh]);

  const value = React.useMemo(
    () => ({ user, status, error, setUser, refresh }),
    [user, status, error, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The signed-in user. Only call below <RequireAuth>. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called without a session");
  return user;
}

export function canResolve(user: User): boolean {
  return user.role === "owner" || user.role === "admin";
}

/** Only allow same-origin relative paths as a post-login destination. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/";
  return next;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, status, error, refresh } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-muted-foreground gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
      </div>
    );
  }
  if (!user && error) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 text-sm">
        <p className="text-muted-foreground">{error}</p>
        <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={refresh}>
          Try again
        </button>
      </div>
    );
  }
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
