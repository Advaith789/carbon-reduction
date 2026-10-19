/*
 * The FAQ — the destination for every {@link Term} link, and the reason the rest of the
 * application can be terse.
 *
 * It is built as a **lookup, not an essay**. The methodology page above it is prose, read
 * top to bottom once; this is the part a reader arrives in the middle of, having clicked
 * "spend-based" on a page three screens away, wanting four sentences and nothing else. The
 * three things that follow from that framing:
 *
 * - **Everything is collapsed by default, except the one you came for.** Landing on
 *   `/methodology#spend-based` opens that entry and scrolls to it; the other twenty stay
 *   shut. An FAQ rendered fully expanded is just the wordy page again with worse headings.
 * - **There is a filter.** Twenty-odd entries is past the point where scanning beats
 *   typing, and a reader who does not know which term covers their question can search the
 *   answers rather than guess the heading.
 * - **Answerable questions offer to be answered.** Where a question has a live answer in
 *   the ledger rather than a definitional one, the entry can hand it to Bucky instead of
 *   asserting a figure in static copy — which is also how this page avoids hardcoding
 *   numbers that would go stale the moment the data changed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronRight, Search, Sparkles } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { GLOSSARY, type GlossaryEntry } from '@/lib/badger/glossary';
import { useBucky } from '@/contexts/BuckyProvider';

function matches(entry: GlossaryEntry, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    entry.term.toLowerCase().includes(q) ||
    entry.question.toLowerCase().includes(q) ||
    entry.gloss.toLowerCase().includes(q) ||
    entry.answer.some((p) => p.toLowerCase().includes(q))
  );
}

export default function FaqList() {
  const { hash } = useLocation();
  const { openAndAsk } = useBucky();
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const targetId = hash.startsWith('#') ? hash.slice(1) : '';

  // Open and reveal the entry the reader actually clicked through for. The timeout lets
  // the entry render expanded before we measure where it is, and re-runs on every hash
  // change so clicking a second Term link from inside the FAQ also works.
  useEffect(() => {
    if (!targetId) return;
    if (!GLOSSARY.some((e) => e.id === targetId)) return;
    setOpenIds((cur) => {
      if (cur.has(targetId)) return cur;
      const next = new Set(cur);
      next.add(targetId);
      return next;
    });
    const t = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [targetId]);

  const toggle = useCallback((id: string) => {
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const shown = useMemo(() => GLOSSARY.filter((e) => matches(e, query.trim())), [query]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--c3-style-basic-fg-secondary)]"
          aria-hidden
        />
        <label htmlFor="faq-filter" className="sr-only">
          Filter the FAQ
        </label>
        <Input
          id="faq-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter — e.g. factor, avoided, infeasible"
          className="pl-8 text-[12px]"
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
          Nothing here matches that. Ask Bucky instead — it has the whole ledger, and this list
          only has the vocabulary.
        </p>
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {shown.map((entry) => {
          const isOpen = openIds.has(entry.id);
          const isTarget = entry.id === targetId;
          return (
            <li
              key={entry.id}
              id={entry.id}
              className={cn(
                'scroll-mt-20 rounded-[var(--c3-style-border-radius-6)] border',
                isTarget
                  ? 'border-[var(--c3-style-basic-fg-accent)]'
                  : 'border-[var(--c3-style-basic-border-border)]',
              )}
            >
              <button
                type="button"
                onClick={() => toggle(entry.id)}
                aria-expanded={isOpen}
                aria-controls={`${entry.id}-answer`}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:rounded-[var(--c3-style-border-radius-6)] focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)] focus-visible:outline-none"
              >
                <ChevronRight
                  className={cn(
                    'mt-px size-3.5 shrink-0 text-[var(--c3-style-basic-fg-secondary)] transition-transform',
                    isOpen && 'rotate-90',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] leading-snug font-medium text-[var(--c3-style-basic-fg-primary)]">
                    {entry.question}
                  </span>
                  {isOpen ? null : (
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                      {entry.gloss}
                    </span>
                  )}
                </span>
                <span className="mt-px shrink-0 font-mono text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                  {entry.term}
                </span>
              </button>

              {isOpen ? (
                <div id={`${entry.id}-answer`} className="px-3 pb-3 pl-8">
                  {entry.answer.map((para, i) => (
                    <p
                      key={i}
                      className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]"
                    >
                      {para}
                    </p>
                  ))}
                  {entry.askable ? (
                    <button
                      type="button"
                      onClick={() => openAndAsk(entry.question)}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)] px-2 py-1 text-[11px] text-[var(--c3-style-basic-fg-secondary)] transition-colors hover:text-[var(--c3-style-basic-fg-primary)] focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)] focus-visible:outline-none"
                    >
                      <Sparkles
                        className="size-3 text-[var(--c3-style-basic-fg-accent)]"
                        aria-hidden
                      />
                      Ask Bucky for the live figures
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
