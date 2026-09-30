import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Moon, Sun, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VerityLogo } from "@/components/verity/logo";
import { DepartmentChip, departmentLabel } from "@/components/verity/badges";
import { api } from "@/lib/api";
import { useAuth, useUser } from "@/lib/auth";

const ROLE_LABEL = { consultant: "Consultant", owner: "Knowledge owner", admin: "Admin" } as const;

export function Topbar() {
  const { resolvedTheme, setTheme } = useTheme();
  const user = useUser();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = React.useState(false);
  const dark = resolvedTheme === "dark";

  async function logout() {
    setLeaving(true);
    try {
      await api.logout();
    } catch {
      // Even if the server call fails, drop the local session view.
    } finally {
      setUser(null);
      navigate("/login", { replace: true });
    }
  }

  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2.5">
        <VerityLogo className="h-7 w-7" />
        <div className="flex flex-col leading-none">
          <span className="font-semibold text-lg tracking-tight leading-none">Verity</span>
        </div>
        <span className="hidden lg:inline text-xs font-normal text-muted-foreground ml-1">
          One subject. One source. Always the latest.
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-sm font-medium">{user.display_name}</span>
          <Badge variant={user.role === "consultant" ? "secondary" : "default"} className="text-[11px]">
            {ROLE_LABEL[user.role] ?? user.role}
          </Badge>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="hidden md:flex items-center gap-1" aria-label="Your access: countries and departments">
              {user.countries.map((c) => (
                <span
                  key={c}
                  className="text-[11px] leading-4 font-mono px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground"
                >
                  {c}
                </span>
              ))}
              {(user.departments ?? []).length > 0 && <span className="mx-1 h-3.5 w-px bg-border" aria-hidden />}
              {(user.departments ?? []).map((d) => (
                <DepartmentChip key={d} department={d} />
              ))}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            You see documents for {user.countries.join(", ")} in{" "}
            {(user.departments ?? []).map(departmentLabel).join(", ") || "no departments"}.
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme(dark ? "light" : "dark")}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{dark ? "Switch to light" : "Switch to dark"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={logout} disabled={leaving}>
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sign out</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
