import * as React from "react";
import { NavLink } from "react-router-dom";
import { BookOpen, Upload, ListChecks, Network, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | null;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  openIssues: number | null;
}

export function Sidebar({ collapsed, onToggle, openIssues }: SidebarProps) {
  const items: NavItem[] = [
    { to: "/", label: "Knowledge", icon: BookOpen },
    { to: "/upload", label: "Upload", icon: Upload },
    { to: "/issues", label: "Review queue", icon: ListChecks, badge: openIssues },
    { to: "/graph", label: "Graph", icon: Network },
  ];

  return (
    <aside
      className={cn(
        "h-full border-r border-border bg-card flex flex-col transition-[width] duration-300 ease-out shrink-0",
        collapsed ? "w-16" : "w-56"
      )}
      aria-label="Primary"
    >
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {items.map((item) => (
          <SidebarItem key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="px-2 py-3 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className={cn("w-full justify-start gap-2", collapsed && "justify-center px-0")}
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span className="text-xs text-muted-foreground">Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { to, label, icon: Icon, badge } = item;
  const hasBadge = typeof badge === "number" && badge > 0;

  const content = (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 rounded-md px-2.5 h-9 text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {hasBadge && !collapsed && (
        <span
          className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-semibold flex items-center justify-center tabular-nums"
          aria-label={`${badge} open issues`}
        >
          {badge}
        </span>
      )}
      {hasBadge && collapsed && (
        <span className="absolute top-1.5 right-3 h-2 w-2 rounded-full bg-danger" aria-label={`${badge} open issues`} />
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{content}</div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {label}
          {hasBadge ? ` (${badge} open)` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }
  return content;
}
