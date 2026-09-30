import * as React from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Loader2, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnswerBlock, AnswerSkeleton } from "@/components/verity/answer";
import { VerityLogo } from "@/components/verity/logo";
import { ErrorState } from "@/components/verity/states";
import { api, type ChatResponse } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

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

interface Turn {
  id: string;
  question: string;
  answer?: ChatResponse;
  error?: string;
  pending?: boolean;
}

/** The thread lives for the browser session (per user), so visiting Library and coming back keeps it. */
function useSessionThread(username: string) {
  const key = `verity.ask.thread.${username}`;
  const [turns, setTurns] = React.useState<Turn[]>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Turn[]).filter((t) => !t.pending) : [];
    } catch {
      return [];
    }
  });
  React.useEffect(() => {
    try {
      const done = turns.filter((t) => !t.pending);
      if (done.length) sessionStorage.setItem(key, JSON.stringify(done));
      else sessionStorage.removeItem(key);
    } catch {
      // Storage full or disabled: the thread still works, it just won't survive navigation.
    }
  }, [key, turns]);
  return [turns, setTurns] as const;
}

export function AskPage() {
  const user = useUser();
  const reducedMotion = useReducedMotion();
  const firstName = user.display_name.split(" ")[0];
  const examples = examplesFor(user.departments);
  const [turns, setTurns] = useSessionThread(user.username);
  const [question, setQuestion] = React.useState("");
  // One Details panel open at a time; it follows you to the next answer, as before.
  const [openId, setOpenId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const loading = turns.some((t) => t.pending);
  const empty = turns.length === 0;

  const run = React.useCallback(
    async (id: string, text: string, carryDetails: boolean) => {
      try {
        const answer = await api.chat(text);
        setTurns((ts) => ts.map((t) => (t.id === id ? { id, question: text, answer } : t)));
        if (carryDetails && answer.document) setOpenId(id);
      } catch (e) {
        const error = e instanceof Error ? e.message : "Verity could not answer right now.";
        setTurns((ts) => ts.map((t) => (t.id === id ? { id, question: text, error } : t)));
      }
    },
    [setTurns]
  );

  function ask(q: string) {
    const text = q.trim();
    if (!text || loading) return;
    const id = `t${Date.now().toString(36)}`;
    const last = turns[turns.length - 1];
    const carry = !!last && openId === last.id;
    setOpenId(null);
    setTurns((ts) => [...ts, { id, question: text, pending: true }]);
    setQuestion("");
    void run(id, text, carry);
  }

  function retry(turn: Turn) {
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { id: t.id, question: t.question, pending: true } : t)));
    void run(turn.id, turn.question, false);
  }

  function newChat() {
    setTurns([]);
    setOpenId(null);
    setQuestion("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // New turn: bring it into view (the answer's own Details scroll takes over when it opens).
  const lastId = turns[turns.length - 1]?.id;
  React.useEffect(() => {
    if (!lastId) return;
    const el = document.getElementById(`turn-${lastId}`);
    el?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }, [lastId, reducedMotion]);

  const composer = (
    <Composer
      ref={inputRef}
      value={question}
      onChange={setQuestion}
      onSubmit={() => ask(question)}
      loading={loading}
      docked={!empty}
    />
  );

  return (
    <LayoutGroup>
      {empty ? (
        <div className="h-full overflow-auto">
          <div className="min-h-full flex items-center justify-center px-6 py-10">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-[720px] -mt-[6vh] text-center"
            >
              <VerityLogo className="h-10 w-10 mx-auto" />
              <h1 className="mt-5 text-display-lg">Hi {firstName}, what do you need to know?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Verity answers from the single latest live document, and tells you what changed, when and by whom.
              </p>
              <div className="mt-7 text-left">{composer}</div>
              {examples.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {examples.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => ask(ex)}
                      className="text-xs rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      ) : (
        <div className="h-full flex flex-col">
          <div className="shrink-0 border-b border-border bg-background">
            <div className="max-w-5xl mx-auto px-6 h-11 flex items-center justify-between gap-3">
              <div className="text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">This conversation</span>
                <span className="mx-1.5 text-border">·</span>
                <span className="tabular-nums">
                  {turns.length} question{turns.length === 1 ? "" : "s"}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={newChat} disabled={loading} className="h-8">
                <SquarePen className="h-3.5 w-3.5" /> New chat
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="max-w-5xl mx-auto px-6 pt-6 pb-10 space-y-10" aria-live="polite">
              <AnimatePresence initial={false}>
                {turns.map((t) => (
                  <motion.section
                    key={t.id}
                    id={`turn-${t.id}`}
                    className="scroll-mt-4"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    {t.pending ? (
                      <AnswerSkeleton question={t.question} />
                    ) : t.answer ? (
                      <AnswerBlock
                        question={t.question}
                        answer={t.answer}
                        detailsId={`details-${t.id}`}
                        detailsOpen={openId === t.id}
                        onToggleDetails={() => setOpenId((o) => (o === t.id ? null : t.id))}
                      />
                    ) : (
                      <FailedTurn turn={t} onRetry={() => retry(t)} />
                    )}
                  </motion.section>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-background">
            <div className="max-w-5xl mx-auto px-6 pt-3 pb-4">
              {composer}
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Enter to send · Shift+Enter for a new line · Answers come only from live documents in your scope.
              </p>
            </div>
          </div>
        </div>
      )}
    </LayoutGroup>
  );
}

function FailedTurn({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  return (
    <div>
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm">{turn.question}</div>
      </div>
      <Card className="mt-4 ml-10 p-2">
        <ErrorState message={turn.error ?? "Verity could not answer right now."} onRetry={onRetry} />
      </Card>
    </div>
  );
}

const Composer = React.forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    loading: boolean;
    docked: boolean;
  }
>(function Composer({ value, onChange, onSubmit, loading, docked }, ref) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  // Grow with the text, up to ~6 lines.
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value, docked]);

  // Keep focus when the box moves from the centre to the bottom.
  React.useEffect(() => {
    innerRef.current?.focus({ preventScroll: true });
  }, [docked]);

  return (
    <motion.form
      layoutId="ask-composer"
      transition={{ duration: 0.3, ease: EASE_OUT }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={cn(
        "relative flex items-end gap-2 rounded-2xl border border-border bg-card shadow-sm",
        "focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-ring/10 transition-[border-color,box-shadow] duration-150",
        docked ? "p-2 pl-4" : "p-2.5 pl-5"
      )}
    >
      <textarea
        ref={setRefs}
        aria-label="Ask Verity"
        rows={docked ? 1 : 2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={docked ? "Ask a follow-up…" : "Ask about a rule, an amount or a deadline…"}
        maxLength={500}
        className={cn(
          "flex-1 resize-none bg-transparent text-[15px] leading-6 placeholder:text-muted-foreground focus-visible:outline-none",
          docked ? "py-1.5 min-h-9" : "py-2 min-h-[64px]"
        )}
      />
      <Button
        type="submit"
        size="icon"
        className="h-9 w-9 rounded-xl shrink-0"
        disabled={loading || !value.trim()}
        aria-label="Ask"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </Button>
    </motion.form>
  );
});
