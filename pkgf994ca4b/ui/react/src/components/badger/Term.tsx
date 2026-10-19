/*
 * An inline jargon link — the mechanism that let every page lose its explanatory
 * paragraphs without losing the explanations.
 *
 * `<Term id="scope-3">Scope 3</Term>` renders the phrase with a dotted underline, hands
 * the one-line gloss over as a tooltip, and links to that term's entry in the FAQ. The
 * page keeps a short sentence; the reader who does not know the word is one hover from a
 * definition and one click from four sentences of it.
 *
 * Two deliberate choices:
 *
 * - **It is a real link, not a popover.** The destination is a URL
 *   (`/methodology#scope-3`), so it can be shared, opened in a new tab, found with the
 *   browser's own search, and read by someone who never hovers anything. A tooltip-only
 *   definition is invisible to a keyboard user and unlinkable.
 * - **An unknown id degrades to plain text rather than throwing.** A typo'd term in a
 *   standfirst must not be able to blank a page, so a missing glossary entry renders the
 *   words with no decoration at all and the sentence still reads correctly.
 */

import React from 'react';
import { Link } from 'react-router-dom';

import { glossaryEntry } from '@/lib/badger/glossary';

export default function Term({
  id,
  children,
}: {
  /** A glossary entry id — see `lib/badger/glossary.ts`. Also the URL fragment. */
  id: string;
  /**
   * The words as they read in this sentence, which are often an inflection of the
   * canonical term ("factors" for "emission factor"). Falls back to the canonical term.
   */
  children?: React.ReactNode;
}) {
  const entry = glossaryEntry(id);

  // Unknown id: render the prose and nothing else. A broken link is worse than no link,
  // and a thrown error here would take down whichever page's heading contained it.
  if (!entry) return <>{children}</>;

  return (
    <Link
      to={`/methodology#${id}`}
      title={entry.gloss}
      className="underline decoration-dotted decoration-from-font underline-offset-2 transition-colors hover:text-[var(--c3-style-basic-fg-accent)] focus-visible:rounded-sm focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)] focus-visible:outline-none"
    >
      {children ?? entry.term}
    </Link>
  );
}
