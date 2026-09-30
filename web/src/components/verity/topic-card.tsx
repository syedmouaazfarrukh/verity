import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { CountryChip, LevelBadge, TrustDot } from "@/components/verity/badges";
import type { Topic, Trust } from "@/lib/api";
import { formatDate, LEVEL_ORDER } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TRUST_NAME: Record<Trust, string> = {
  green: "Trusted",
  amber: "Needs attention",
  red: "Conflict",
};

/** Red first, then amber, then green; alphabetical within a colour. */
export function sortTopics(topics: Topic[]): Topic[] {
  const order = { red: 0, amber: 1, green: 2 } as const;
  return [...topics].sort((a, b) => order[a.trust] - order[b.trust] || a.name.localeCompare(b.name));
}

export function TopicCard({ topic }: { topic: Topic }) {
  const openLevels = LEVEL_ORDER.filter((l) => (topic.open_issues?.[l] ?? 0) > 0);
  return (
    <Card
      className={cn(
        "p-4 flex flex-col gap-3 transition-shadow hover:shadow-md",
        topic.trust === "red" && "border-danger/40"
      )}
    >
      <div className="flex items-center gap-2">
        <TrustDot trust={topic.trust} />
        <h3 className="font-semibold truncate">{topic.name}</h3>
      </div>

      <div className="flex-1 space-y-1.5">
        {topic.live_documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No live document yet.</p>
        ) : (
          topic.live_documents.map((d) => (
            <Link
              key={d.id}
              to={`/documents/${encodeURIComponent(d.id)}`}
              className="group flex items-center gap-2 rounded-md -mx-1.5 px-1.5 py-1 hover:bg-muted"
            >
              <CountryChip country={d.country} />
              <span className="text-sm truncate flex-1 group-hover:text-primary">{d.title}</span>
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">v{d.version}</span>
            </Link>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border">
        {openLevels.length === 0 ? (
          <span className="text-xs text-muted-foreground">No open issues</span>
        ) : (
          openLevels.map((l) => (
            <Link key={l} to="/issues" className="flex items-center gap-1">
              <LevelBadge level={l} className="text-[11px]" />
              <span className="text-xs tabular-nums text-muted-foreground">×{topic.open_issues[l]}</span>
            </Link>
          ))
        )}
        {topic.live_documents[0] && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {formatDate(topic.live_documents[0].updated_at)}
          </span>
        )}
      </div>
    </Card>
  );
}
