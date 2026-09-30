import * as React from "react";
import { Link } from "react-router-dom";
import { BookOpen, Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { departmentLabel, TrustDot } from "@/components/verity/badges";
import { ErrorState, PageHeader } from "@/components/verity/states";
import { sortTopics, TopicCard, TRUST_NAME } from "@/components/verity/topic-card";
import { api, type DocumentSummary, type Topic, type Trust } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";

const ALL = "";

export function LibraryPage() {
  const data = useAsync(() => Promise.all([api.topics(), api.documents()]), []);
  const [query, setQuery] = React.useState("");
  const [country, setCountry] = React.useState(ALL);
  const [department, setDepartment] = React.useState(ALL);
  const [trust, setTrust] = React.useState<Trust | typeof ALL>(ALL);

  const [topics, documents] = data.data ?? [[], []];

  // Options come from what the user can actually see, so a filter never offers an empty choice.
  // Real countries first, the group-wide "ALL" last.
  const countries = React.useMemo(
    () => uniqueSorted(documents.map((d) => d.country)).sort((a, b) => Number(a === "ALL") - Number(b === "ALL")),
    [documents]
  );
  const departments = React.useMemo(() => uniqueSorted(documents.map((d) => d.department)), [documents]);

  const docsByTopic = React.useMemo(() => {
    const m = new Map<string, DocumentSummary[]>();
    for (const d of documents) m.set(d.topic_id, [...(m.get(d.topic_id) ?? []), d]);
    return m;
  }, [documents]);

  const q = query.trim().toLowerCase();
  // A group-wide ("ALL") document applies in every country, so it matches any country filter.
  const matchesDoc = (d: DocumentSummary) =>
    (!country || d.country === country || d.country === "ALL") && (!department || d.department === department);

  const filtered = sortTopics(topics).filter((t) => {
    if (trust && t.trust !== trust) return false;
    const tdocs = docsByTopic.get(t.id) ?? [];
    if ((country || department) && !tdocs.some(matchesDoc)) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      tdocs.some((d) => d.title.toLowerCase().includes(q)) ||
      t.live_documents.some((d) => d.title.toLowerCase().includes(q))
    );
  });
  const docCount = filtered.reduce((n, t) => n + (docsByTopic.get(t.id) ?? []).filter(matchesDoc).length, 0);
  const filtering = !!(q || country || department || trust);

  function clear() {
    setQuery("");
    setCountry(ALL);
    setDepartment(ALL);
    setTrust(ALL);
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <PageHeader
        title="Library"
        description="Every topic has one live document per country. Colour shows how much you can trust it right now."
      />

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics and documents"
            aria-label="Search topics and documents"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
          {!data.loading && !data.error && (
            <span aria-live="polite">
              {plural(filtered.length, "topic")} · {plural(docCount, "document")}
            </span>
          )}
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clear} className="h-8 -mr-2">
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-6">
        {countries.length > 1 && (
          <Segmented
            label="Country"
            value={country}
            onChange={setCountry}
            options={[{ value: ALL, label: "All" }, ...countries.map((c) => (c === "ALL" ? { value: c, label: "Group-wide" } : { value: c, label: c, mono: true }))]}
          />
        )}
        {departments.length > 1 && (
          <Segmented
            label="Department"
            value={department}
            onChange={setDepartment}
            options={[{ value: ALL, label: "All" }, ...departments.map((d) => ({ value: d, label: departmentLabel(d) }))]}
          />
        )}
        <Segmented
          label="Trust"
          value={trust}
          onChange={(v) => setTrust(v as Trust | typeof ALL)}
          options={[
            { value: ALL, label: "All" },
            ...(["green", "amber", "red"] as const).map((t) => ({
              value: t,
              label: TRUST_NAME[t],
              icon: <TrustDot trust={t} className="[&_.animate-ping]:hidden" />,
            })),
          ]}
        />
      </div>

      <LibraryGrid
        loading={data.loading && !data.data}
        error={data.error}
        onRetry={data.reload}
        total={topics.length}
        topics={filtered}
        onClear={clear}
      />
    </div>
  );
}

function LibraryGrid({
  loading,
  error,
  onRetry,
  total,
  topics,
  onClear,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  total: number;
  topics: Topic[];
  onClear: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (total === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No topics in your scope yet"
        description="Upload a document to create the first topic."
        action={
          <Button asChild size="sm">
            <Link to="/upload">Upload a document</Link>
          </Button>
        }
      />
    );
  }
  if (topics.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No topics match these filters"
        description="Try a different search, or clear the filters to see everything in your scope."
        action={
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {topics.map((t) => (
        <TopicCard key={t.id} topic={t} />
      ))}
    </div>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; mono?: boolean; icon?: React.ReactNode }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-md border border-border bg-card p-0.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value || "all"}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                o.mono && "font-mono",
                active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
