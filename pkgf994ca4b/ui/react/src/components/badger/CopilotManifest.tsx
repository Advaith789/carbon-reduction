/*
 * The copilot's declared capabilities, fetched live from the agent itself.
 *
 * This belongs on the methodology page rather than a chat box, because the
 * methodology page's job is to let a sceptic audit the tool. The strongest claim
 * we can make about the copilot is not "it is accurate" — it is that it has a
 * *finite, enumerable* set of things it can do, each one a named method in this
 * repository, and that the two which write anything cannot fire unattended. A
 * table of twelve rows makes that checkable in a way a paragraph cannot.
 *
 * It is fetched from `BadgerCopilot.toolManifest()` — the same call that builds
 * every request to the model — rather than transcribed here, so the published
 * manifest and the live one cannot drift apart. If a thirteenth tool is added
 * tomorrow, this table grows a row without anyone remembering to update it.
 */

import React, { useEffect, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { fetchCopilotManifest, type CopilotManifest } from '@/api/copilot';
import { LoadingBlock } from '@/components/badger/DataState';
import { STATUS } from '@/lib/badger/palette';

export default function CopilotManifestTable() {
  const [manifest, setManifest] = useState<CopilotManifest | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchCopilotManifest()
      .then((m) => {
        if (live) setManifest(m);
      })
      .catch((e: unknown) => {
        if (live) setFailed(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
        The manifest could not be loaded ({failed}). Everything else on this page is computed
        client-side and is unaffected.
      </p>
    );
  }
  if (!manifest) return <LoadingBlock height={200} label="Loading the agent's manifest…" />;

  return (
    <div className="min-w-0">
      <p className="text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
        {manifest.readOnlyCount} read-only methods and {manifest.writeCount} writes, across at most{' '}
        {manifest.maxToolRounds} rounds per question. The grounding rule handed to the model with
        every request:{' '}
        <em className="text-[var(--c3-style-basic-fg-primary)]">{manifest.groundingRule}</em>
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-[var(--c3-style-basic-border-border)]">
              <th className="py-1.5 pr-3 font-medium tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)] uppercase">
                Tool
              </th>
              <th className="py-1.5 pr-3 font-medium tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)] uppercase">
                Backing method
              </th>
              <th className="py-1.5 pr-3 font-medium tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)] uppercase">
                Access
              </th>
              <th className="py-1.5 font-medium tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)] uppercase">
                Arguments
              </th>
            </tr>
          </thead>
          <tbody>
            {manifest.tools.map((tool) => (
              <tr
                key={tool.name}
                className="border-b border-[var(--c3-style-basic-border-border)] align-top"
              >
                <td className="py-1.5 pr-3 font-mono text-[var(--c3-style-basic-fg-primary)]">
                  {tool.name}
                </td>
                <td className="py-1.5 pr-3 font-mono text-[var(--c3-style-basic-fg-secondary)]">
                  {tool.backs}.{tool.name.split('_').slice(1).join('_')}()
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <span
                    className="inline-flex items-center gap-1"
                    style={{ color: tool.write ? STATUS.warning : undefined }}
                  >
                    {tool.write ? (
                      <Lock className="size-3 shrink-0" aria-hidden />
                    ) : (
                      <Unlock className="size-3 shrink-0" aria-hidden />
                    )}
                    {tool.write ? 'write · needs approval' : 'read'}
                  </span>
                </td>
                {/* Required arguments carry a `!`, matching the .c3typ convention. */}
                <td className="py-1.5 font-mono text-[var(--c3-style-basic-fg-secondary)]">
                  {tool.params.length > 0
                    ? tool.params
                        .map((p) => `${p.name}${p.required ? '!' : ''}: ${p.type}`)
                        .join(', ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
