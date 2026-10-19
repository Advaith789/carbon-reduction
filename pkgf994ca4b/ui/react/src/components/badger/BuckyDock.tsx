/*
 * Bucky — the floating assistant, mounted once for the whole application.
 *
 * This replaces four separate in-page chat panels that each owned a different
 * conversation and threw it away on navigation. There is now one conversation, it
 * follows the user, and it is reachable from every page without spending a section of
 * that page's layout on it. That last part is the real motivation: the chat panels were
 * competing with the panels that actually answer the page's question, and a reader
 * confronted with both tends to read neither.
 *
 * ## Why the button is draggable
 *
 * A fixed launcher in the bottom-right corner covers whatever is in the bottom-right
 * corner, and on this application that is sometimes the last row of the intercept queue
 * or the corner of the campus map. Rather than guess a safe position, the launcher can be
 * dragged anywhere and remembers where it was put. The position is stored as offsets from
 * the bottom-right corner so that resizing the window keeps the button where the user
 * expects it instead of sliding it off-screen.
 *
 * The drag and the click share one pointer gesture, so they are separated by distance:
 * movement under {@link DRAG_THRESHOLD_PX} is a click that toggles the panel, anything
 * more is a drag and deliberately does *not* toggle. Without that, every drag would end
 * by opening the panel on top of wherever it was just moved to.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Sparkles, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { TurnBubble } from '@/components/badger/CopilotTurn';
import { useBucky } from '@/contexts/BuckyProvider';

/** Below this much pointer movement the gesture counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 5;

const FAB_PX = 48;
const PANEL_W = 384;
const PANEL_H = 560;
const EDGE_PAD = 12;

const POSITION_KEY = 'badger.bucky.launcher';
const INPUT_ID = 'bucky-dock-input';

/** Offsets from the viewport's bottom-right corner, in CSS pixels. */
interface Pos {
  right: number;
  bottom: number;
}

const DEFAULT_POS: Pos = { right: 20, bottom: 20 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Keep the launcher inside the window.
 *
 * Called on every drag frame *and* on resize, because a position that was valid in a
 * wide window can be off-screen in a narrow one — a button the user cannot reach is
 * worse than one in a slightly inconvenient place.
 */
function clampPos(p: Pos): Pos {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  return {
    right: clamp(p.right, EDGE_PAD, Math.max(EDGE_PAD, vw - FAB_PX - EDGE_PAD)),
    bottom: clamp(p.bottom, EDGE_PAD, Math.max(EDGE_PAD, vh - FAB_PX - EDGE_PAD)),
  };
}

function loadPos(): Pos {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return DEFAULT_POS;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const right = Number(o.right);
      const bottom = Number(o.bottom);
      if (Number.isFinite(right) && Number.isFinite(bottom)) return clampPos({ right, bottom });
    }
  } catch {
    // A corrupt or unavailable store is not worth a broken launcher.
  }
  return DEFAULT_POS;
}

/**
 * Where the panel goes, given where the launcher ended up.
 *
 * It opens above the launcher by default, but is clamped into the viewport
 * independently — so dragging the launcher to the top of the window slides the panel
 * down rather than rendering it off the top edge.
 */
function panelPos(p: Pos): { right: number; bottom: number; width: number; height: number } {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const width = Math.min(PANEL_W, vw - 2 * EDGE_PAD);
  const height = Math.min(PANEL_H, vh - 2 * EDGE_PAD);
  return {
    width,
    height,
    right: clamp(p.right, EDGE_PAD, Math.max(EDGE_PAD, vw - width - EDGE_PAD)),
    bottom: clamp(p.bottom + FAB_PX + 8, EDGE_PAD, Math.max(EDGE_PAD, vh - height - EDGE_PAD)),
  };
}

export default function BuckyDock() {
  const { turns, busy, open, setOpen, page, suggestions, send, clear } = useBucky();

  const [pos, setPos] = useState<Pos>(DEFAULT_POS);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState('');

  const dragState = useRef<{ x: number; y: number; from: Pos; moved: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore on mount rather than in the initialiser, so this component is safe to render
  // in an environment without `window`.
  useEffect(() => setPos(loadPos()), []);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep the newest turn in view, and keep it in view while an answer is pending so the
  // spinner is visible rather than below the fold.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, open]);

  // Looked up by id rather than held in a ref: the design-system `Textarea` is a plain
  // function component on React 18, so a forwarded ref would silently stay null.
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(INPUT_ID);
    if (el instanceof HTMLTextAreaElement) el.focus();
  }, [open]);

  // Escape closes the panel from anywhere, including from inside the textarea.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragState.current = { x: e.clientX, y: e.clientY, from: pos, moved: false };
    },
    [pos],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragState.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!st.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    st.moved = true;
    setDragging(true);
    // Negated: the offsets are measured from the bottom-right corner, so dragging the
    // button left or up *increases* them.
    setPos(clampPos({ right: st.from.right - dx, bottom: st.from.bottom - dy }));
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const st = dragState.current;
      dragState.current = null;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (!st) return;
      if (st.moved) {
        try {
          window.localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
        } catch {
          // Position is a convenience; failing to persist it is not worth surfacing.
        }
        return;
      }
      setOpen(!open);
    },
    [open, pos, setOpen],
  );

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void send(text);
  }, [draft, send]);

  const panel = panelPos(pos);
  const empty = turns.length === 0;

  return (
    <>
      {open ? (
        <section
          role="dialog"
          aria-label="Bucky, the Badger Footprint assistant"
          style={{
            right: panel.right,
            bottom: panel.bottom,
            width: panel.width,
            height: panel.height,
          }}
          className={cn(
            'fixed z-50 flex min-h-0 flex-col overflow-hidden',
            'rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)]',
            'bg-[var(--c3-style-basic-bg-primary)] shadow-2xl shadow-black/40',
          )}
        >
          <header className="flex items-start justify-between gap-2 border-b border-[var(--c3-style-basic-border-border)] px-3.5 pt-3 pb-2.5">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-[13px] leading-snug font-semibold text-[var(--c3-style-basic-fg-primary)]">
                <Sparkles
                  className="size-3.5 shrink-0 text-[var(--c3-style-basic-fg-accent)]"
                  aria-hidden
                />
                Bucky
                <span className="rounded-full border border-[var(--c3-style-basic-border-border)] px-1.5 py-px text-[10px] font-normal text-[var(--c3-style-basic-fg-secondary)]">
                  {page}
                </span>
              </h2>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                Picks which agent methods to run and shows which ones it used. It never computes a
                figure itself.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {empty ? null : (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear the conversation"
                  title="Clear the conversation"
                  className="rounded-[var(--c3-style-border-radius-6)] p-1 text-[var(--c3-style-basic-fg-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--c3-style-basic-fg-primary)] focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)] focus-visible:outline-none"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close Bucky"
                className="rounded-[var(--c3-style-border-radius-6)] p-1 text-[var(--c3-style-basic-fg-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--c3-style-basic-fg-primary)] focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)] focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
            {empty ? (
              <p className="text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                Ask anything about the purchasing footprint. Every page works entirely without this
                panel — it is here for the questions we did not build a panel for.
              </p>
            ) : (
              turns.map((turn, i) => <TurnBubble key={i} turn={turn} />)
            )}
            {busy ? (
              <p className="flex items-center gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                <Spinner size="sm" />
                Routing to the agents…
              </p>
            ) : null}
          </div>

          {empty && suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(s)}
                  className={cn(
                    'rounded-[var(--c3-style-border-radius-6)] border px-2 py-1 text-left text-[11px] leading-snug',
                    'border-[var(--c3-style-basic-border-border)] text-[var(--c3-style-basic-fg-secondary)]',
                    'transition-colors hover:text-[var(--c3-style-basic-fg-primary)] disabled:opacity-50',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-1.5 border-t border-[var(--c3-style-basic-border-border)] px-3.5 py-2.5">
            <label htmlFor={INPUT_ID} className="sr-only">
              Ask Bucky
            </label>
            <Textarea
              id={INPUT_ID}
              rows={2}
              value={draft}
              disabled={busy}
              placeholder="e.g. we can only cut IT hardware 4% — can we still hit 2030?"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="min-h-0 resize-none text-[12px]"
            />
            <Button
              size="sm"
              appearance="accent"
              loading={busy}
              disabled={!draft.trim()}
              onClick={submit}
              leadingIcon={<Send className="size-3.5" aria-hidden />}
            >
              Ask
            </Button>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ right: pos.right, bottom: pos.bottom, width: FAB_PX, height: FAB_PX }}
        aria-label={open ? 'Close Bucky' : 'Ask Bucky'}
        title={open ? 'Close Bucky' : 'Ask Bucky — drag to move'}
        className={cn(
          'fixed z-50 flex touch-none items-center justify-center rounded-full',
          'border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-secondary)]',
          'text-[var(--c3-style-basic-fg-primary)] shadow-xl shadow-black/40',
          'transition-colors hover:bg-white/[0.08]',
          'focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)] focus-visible:outline-none',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        {open ? (
          <X className="size-5" aria-hidden />
        ) : (
          <MessageSquare
            className="size-5 text-[var(--c3-style-basic-fg-accent)]"
            aria-hidden
          />
        )}
        {!open && busy ? (
          <span
            className="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-[var(--c3-style-basic-fg-accent)]"
            aria-hidden
          />
        ) : null}
      </button>
    </>
  );
}
