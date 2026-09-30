/**
 * Tiny, safe markdown renderer. Builds React elements only — never injects
 * HTML. Supports: front-matter stripping, # headings, - / * / 1. lists,
 * > quotes, paragraphs, **bold**, *italic*, `code`, and http(s) links.
 */
import * as React from "react";

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "p"; text: string }
  | { kind: "hr" };

function stripFrontMatter(md: string): string {
  const m = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

function parseBlocks(md: string): Block[] {
  const lines = stripFrontMatter(md).split(/\r?\n/);
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara();
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ kind: "hr" });
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (ul) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ul") last.items.push(ul[1]);
      else blocks.push({ kind: "ul", items: [ul[1]] });
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ol) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ol") last.items.push(ol[1]);
      else blocks.push({ kind: "ol", items: [ol[1]] });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(trimmed);
    if (q) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "quote") last.text += " " + q[1];
      else blocks.push({ kind: "quote", text: q[1] });
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const key = `i${i++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInline(tok.slice(2, -2))}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="font-mono text-[12px] px-1 py-0.5 rounded bg-muted">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm?.[2] ?? "";
      if (lm && /^https?:\/\//i.test(href)) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
            {lm[1]}
          </a>
        );
      } else {
        out.push(lm ? lm[1] : tok);
      }
    } else {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1))}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline-only formatting (bold, code, links) for short server strings. */
export function InlineText({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

const H_CLASS: Record<number, string> = {
  1: "text-display-md mt-2 mb-4",
  2: "text-lg font-semibold mt-6 mb-2",
  3: "text-base font-semibold mt-5 mb-2",
};

export function Markdown({ source }: { source: string }) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return (
    <div className="text-[14px] leading-7 text-foreground/90">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const Tag = `h${Math.min(b.level, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag key={i} className={H_CLASS[b.level] ?? "text-sm font-semibold mt-4 mb-1"}>
                {renderInline(b.text)}
              </Tag>
            );
          }
          case "ul":
            return (
              <ul key={i} className="list-disc pl-5 my-2 space-y-1">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal pl-5 my-2 space-y-1">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border pl-3 my-3 text-muted-foreground">
                {renderInline(b.text)}
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="my-6 border-border" />;
          default:
            return (
              <p key={i} className="my-2">
                {renderInline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
