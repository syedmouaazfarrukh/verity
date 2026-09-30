import * as React from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, BookOpen, Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { CountryChip, LevelBadge, TrustDot } from "@/components/verity/badges";
import { AnswerBlock, AnswerSkeleton } from "@/components/verity/answer";
import { ErrorState } from "@/components/verity/states";
import { api, type ChatResponse, type Topic } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { formatDate, LEVEL_ORDER } from "@/lib/format";
import { useAsync, type AsyncState } from "@/lib/use-async";
import { cn } from "@/lib/utils";

const EXAMPLES: Record<string, string[]> = {
  payroll: [
    "What is the monthly home-office allowance cap?",
    "When is the payroll cut-off?",
    "How is holiday pay calculated?",
  ],
  hr: ["Who pays for the first days of sick leave?"],
  finance: ["What is the approval threshold for client credit notes?", "Which booking code do credit notes use?"],
};

/** Example questions the user can actually get answered (their departments only). */
function examplesFor(departments: string[] | undefined): string[] {
  return (departments ?? []).flatMap((d) => EXAMPLES[d] ?? []).slice(0, 4);
}

export function KnowledgePage() {
  const user = useUser();
  const topics = useAsync(() => api.topics(), []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <AskVerity firstName={user.display_name.split(" ")[0]} examples={examplesFor(user.departments)} />

      <section className="mt-12">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl">Knowledge space</h2>
            <p className="text-sm text-muted-foreground">
              Every topic has one live document per country. Colour shows how much you can trust it right now.
            </p>
          </div>
          <TrustLegend />
        </div>
        <TopicGrid state={topics} />
      </section>
    </div>
  );
}

function TrustLegend() {
  return (
    <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <TrustDot trust="green" /> Trusted
      </span>
      <span className="flex items-center gap-1.5">
        <TrustDot trust="amber" /> Needs attention
      </span>
      <span className="flex items-center gap-1.5">
        <TrustDot trust="red" /> Conflict
      </span>
    </div>
  );
}

function AskVerity({ firstName, examples }: { firstName: string; examples: string[] }) {
  const [question, setQuestion] = React.useState("");
  const [asked, setAsked] = React.useState<string | null>(null);
  const [answer, setAnswer] = React.useState<ChatResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Stays open across follow-up questions, so "ask again" lands straight on the details.
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || loading) return;
    setAsked(text);
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await api.chat(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verity could not answer right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1 className="text-display-lg">
        Hi {firstName}, what do you need to know?
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Verity answers from the single latest live document, and tells you what changed, when and by whom.
      </p>

      <form
        className="mt-5 relative"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <Sparkles className="absolute left-4 top-[18px] h-5 w-5 text-primary" aria-hidden />
        <textarea
          aria-label="Ask Verity"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          placeholder="Ask Verity…"
          maxLength={500}
          className="w-full resize-none rounded-xl border border-border bg-card pl-12 pr-16 py-4 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          size="icon"
          className="absolute right-3 top-3 h-10 w-10 rounded-lg"
          disabled={loading || !question.trim()}
          aria-label="Ask"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setQuestion(ex);
              void ask(ex);
            }}
            className="text-xs rounded-full border border-border bg-card px-3 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {(loading || answer || error) && (
          <motion.div
            key={asked ?? "x"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-6"
          >
            {loading ? (
              <AnswerSkeleton question={asked ?? ""} />
            ) : error ? (
              <Card className="p-5">
                <ErrorState message={error} onRetry={() => asked && void ask(asked)} />
              </Card>
            ) : answer ? (
              <AnswerBlock
                question={asked ?? ""}
                answer={answer}
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsOpen((o) => !o)}
              />
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function TopicGrid({ state }: { state: AsyncState<Topic[]> }) {
  if (state.loading && !state.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  const topics = state.data ?? [];
  if (topics.length === 0) {
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

  const order = { red: 0, amber: 1, green: 2 } as const;
  const sorted = [...topics].sort((a, b) => order[a.trust] - order[b.trust] || a.name.localeCompare(b.name));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((t) => (
        <TopicCard key={t.id} topic={t} />
      ))}
    </div>
  );
}

function TopicCard({ topic }: { topic: Topic }) {
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
