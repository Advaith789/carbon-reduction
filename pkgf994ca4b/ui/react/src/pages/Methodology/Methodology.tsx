/*
 * Methodology — the page that says what is real, what is modelled, and what is
 * assumed, before anyone asks.
 *
 * **The calculation, the factor table, the provenance breakdown, the FAQ, and the tool
 * manifest.** The scope boundary and the four named limitations each used to be a section
 * in their own right; they are now one note and one compact strip at the foot of the
 * provenance section. Nothing was softened in the compression — a limitation hidden
 * behind a shorter page is still disclosed, but a limitation on page six of six is not
 * read at all.
 *
 * The FAQ near the foot is this page's second job, and it is why every other page can
 * afford to be terse. It is the link target for every dotted-underlined {@link Term} in
 * the application, so an explanation removed from the middle of the Overview was moved
 * here rather than dropped.
 */

import React, { useMemo } from 'react';
import { CircleSlash, Sigma } from 'lucide-react';

import PageShell, { Section } from '@/components/badger/PageShell';
import Panel from '@/components/badger/Panel';
import CopilotManifestTable from '@/components/badger/CopilotManifest';
import FaqList from '@/components/badger/FaqList';
import { ErrorState, LoadingBlock } from '@/components/badger/DataState';
import { useBadgerData } from '@/contexts/BadgerDataProvider';
import { intensity, pct, tonnes, usd } from '@/lib/badger/format';
import { STATUS } from '@/lib/badger/palette';

interface FactorRow {
  categoryId: string;
  name: string;
  naicsCode: string;
  naicsTitle: string;
  kgPerDollar: number;
  spend: number;
  tonnes: number;
  carbonShare: number;
}

/*
 * The FAQ, and the reason every other page in this application is allowed to be
 * terse. Each entry is the destination of a dotted-underline {@link Term} link
 * somewhere else — so the explanations that used to sit in the middle of the
 * Overview, the Intercept and the Planner, pushing the actual numbers below the
 * fold, now live one click away instead of being deleted.
 *
 * It is a component rather than inline JSX for one reason: it reads no backend data,
 * so it must survive the failure of the backend. Every `<Term>` in the application
 * points here, and a reader who clicks "what does avoided mean?" during an outage
 * should get the answer — not a retry button. The rest of this page is a factor table
 * and cannot render without the ledger; this part always can, so it renders in the
 * error and loading branches too.
 */
function FaqSection() {
  return (
    <Section
      title="Every term, defined"
      description="The jargon this subject cannot avoid, in one place. Dotted-underlined words elsewhere in the application link straight to their entry here."
    >
      <Panel
        title="FAQ & glossary"
        subtitle="Collapsed by default — open what you came for"
        note="Deliberately contains no figures. A number typed into this list would be a second source of truth that goes stale the moment the ledger changes, so entries explain what a number means and the panels above compute what it is. Where a question has a live answer, there is a button to make Bucky go and get it."
      >
        <FaqList />
      </Panel>
    </Section>
  );
}

export default function Methodology() {
  const { data, loading, error, reload } = useBadgerData();

  const derived = useMemo(() => {
    if (!data) return null;

    const totals = new Map(data.categoryTotals.map((c) => [c.categoryId, c]));
    const rows: FactorRow[] = data.categories
      .map((c) => {
        const t = totals.get(c.id);
        return {
          categoryId: c.id,
          name: c.name,
          naicsCode: c.emissionFactor?.naicsCode ?? '—',
          naicsTitle: c.emissionFactor?.naicsTitle ?? '—',
          kgPerDollar: c.emissionFactor?.kgCo2ePerDollar ?? 0,
          spend: t?.spend ?? 0,
          tonnes: t?.tonnes ?? 0,
          carbonShare: t?.carbonShare ?? 0,
        };
      })
      .sort((a, b) => b.kgPerDollar - a.kgPerDollar);

      const withFactor = rows.filter((r) => r.kgPerDollar > 0);
    const highest = withFactor[0];
    const lowest = withFactor[withFactor.length - 1];
    const worked = [...rows].sort((a, b) => b.tonnes - a.tonnes)[0];

    return {
      rows,
      highest,
      lowest,
      spread: highest && lowest && lowest.kgPerDollar > 0 ? highest.kgPerDollar / lowest.kgPerDollar : 0,
      worked,
      unmapped: rows.filter((r) => r.kgPerDollar === 0).length,
    };
  }, [data]);

  /* Both early returns still render the FAQ. The factor table genuinely needs the
     ledger, but the glossary does not, and this page is the link target for every
     `<Term>` in the application — so a backend outage must not turn all of them into
     dead ends. The error sits above it, honestly, with the definitions still readable
     underneath. */
  if (error) {
    return (
      <PageShell kicker="Provenance" title="How these numbers were produced">
        <ErrorState message={error} onRetry={reload} />
        <div className="mt-4">
          <FaqSection />
        </div>
      </PageShell>
    );
  }

  if (loading || !data || !derived) {
    return (
      <PageShell kicker="Provenance" title="How these numbers were produced">
        <LoadingBlock height={420} label="Loading factor table…" />
        <div className="mt-4">
          <FaqSection />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      kicker="Provenance · Read this before trusting a number"
      title="How these numbers were produced"
      standfirst="Every figure in this application is either measured, modelled, or assumed, and it should always be obvious which. This page draws that line explicitly — including the places where the method is genuinely weak, because a carbon tool that hides its uncertainty is worse than no tool."
    >
      {/* ------------------------------- the maths --------------------------- */}
      <Section
        title="The calculation"
        description="Spend-based Scope 3 accounting, GHG Protocol Category 1 (purchased goods and services). One multiplication, applied consistently."
      >
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <Panel
            title="The formula"
            note="Factors are published in kg CO₂e per 2022 US dollar, so the divide by 1,000 converts to tonnes. No other transformation is applied anywhere in the application."
          >
            <div className="rounded-[4px] border border-[var(--c3-style-basic-border-border)] bg-white/[0.025] p-4">
              <p className="font-mono text-[13px] leading-relaxed text-[var(--c3-style-basic-fg-primary)]">
                tonnes CO₂e&nbsp;=&nbsp;
                <span className="text-[var(--c3-style-basic-fg-accent)]">spend&nbsp;(USD)</span>
                &nbsp;×&nbsp;
                <span className="text-[var(--c3-style-basic-fg-accent)]">
                  factor&nbsp;(kg&nbsp;CO₂e/$)
                </span>
                &nbsp;÷&nbsp;1000
              </p>
            </div>

            {derived.worked ? (
              <>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)]">
                  Worked example — the largest source
                </p>
                <div className="mt-1.5 rounded-[4px] border border-[var(--c3-style-basic-border-border)] p-3">
                  <p className="text-[12px] font-medium text-[var(--c3-style-basic-fg-primary)]">
                    {derived.worked.name}
                  </p>
                  <p className="mt-1 font-mono text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                    {usd(derived.worked.spend)} × {derived.worked.kgPerDollar.toFixed(3)} ÷ 1000 ={' '}
                    <span className="font-semibold text-[var(--c3-style-basic-fg-primary)]">
                      {tonnes(derived.worked.tonnes)}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                    NAICS {derived.worked.naicsCode} · {derived.worked.naicsTitle}. That single
                    category is {pct(derived.worked.carbonShare, 1)} of the FY{data.baselineFy}{' '}
                    footprint.
                  </p>
                </div>
              </>
            ) : null}

            <p className="mt-3 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              Fiscal years run 1 July – 30 June, matching UW&apos;s own calendar, so FY
              {data.baselineFy} is July {data.baselineFy - 1} through June {data.baselineFy}. All
              spend is in nominal dollars with no deflation applied — a known simplification, noted
              below.
            </p>
          </Panel>

          <Panel
            title="Where the arithmetic happens"
            subtitle="And where it deliberately does not"
            note="This matters for a tool that will eventually have a language-model narration layer on top of it."
          >
            <ul className="flex flex-col gap-2.5 text-[12px] leading-relaxed">
              <li className="flex gap-2">
                <Sigma
                  className="mt-[2px] size-4 shrink-0 text-[var(--c3-style-basic-fg-accent)]"
                  aria-hidden
                />
                <span className="text-[var(--c3-style-basic-fg-secondary)]">
                  <strong className="text-[var(--c3-style-basic-fg-primary)]">
                    Totals are computed in the database.
                  </strong>{' '}
                  Category, department, building and month rollups come back as grouped{' '}
                  <code className="font-mono text-[11px]">evaluate</code> results from the C3
                  platform, not as a client-side loop over the transaction ledger. The browser never
                  downloads the full ledger.
                </span>
              </li>
              <li className="flex gap-2">
                <Sigma className="mt-[2px] size-4 shrink-0 text-[var(--c3-style-basic-fg-accent)]" aria-hidden />
                <span className="text-[var(--c3-style-basic-fg-secondary)]">
                  <strong className="text-[var(--c3-style-basic-fg-primary)]">
                    The planner is a deterministic solver.
                  </strong>{' '}
                  Ceilings, water-filling redistribution, pinning and the feasibility test are
                  closed-form arithmetic. The same inputs always produce the same plan, and you can
                  check it by hand.
                </span>
              </li>
              <li className="flex gap-2">
                <CircleSlash className="mt-[2px] size-4 shrink-0" style={{ color: STATUS.warning }} aria-hidden />
                <span className="text-[var(--c3-style-basic-fg-secondary)]">
                  <strong className="text-[var(--c3-style-basic-fg-primary)]">
                    No language model computes any number shown anywhere in this application.
                  </strong>{' '}
                  Narration explains results it is given. The moment a model is allowed to produce a
                  tonne figure, every number on every screen becomes unauditable — so that boundary
                  is structural, not a matter of prompt discipline.
                </span>
              </li>
            </ul>
          </Panel>
        </div>
      </Section>

      {/* ------------------------------ factor table ------------------------- */}
      <Section
        title="The factor table, in full"
        description="Thirteen spend categories, each bridged to exactly one NAICS-6 code in the EPA table. This is the entire mapping — there is no hidden adjustment layer."
      >
        <Panel
          title="Category → NAICS → factor"
          subtitle={`Sorted by carbon intensity, highest first${
            derived.spread ? ` — a ${derived.spread.toFixed(1)}× spread across the basket` : ''
          }`}
          note="Source: US EPA Supply Chain GHG Emission Factors for US Industries and Commodities, USEEIO v1.3, NAICS-6 detail, 2022 USD, 'with margins'. The margins variant is the correct one for purchased goods because it includes wholesale and retail trade margins, which is what a purchase order actually pays for."
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[var(--c3-style-basic-border-border)]">
                  <th scope="col" className="py-2 pr-3 text-left font-medium text-[var(--c3-style-basic-fg-secondary)]">
                    Spend category
                  </th>
                  <th scope="col" className="py-2 pr-3 text-left font-medium text-[var(--c3-style-basic-fg-secondary)]">
                    NAICS
                  </th>
                  <th scope="col" className="py-2 pr-3 text-left font-medium text-[var(--c3-style-basic-fg-secondary)]">
                    EPA industry title
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium text-[var(--c3-style-basic-fg-secondary)]">
                    kg CO₂e / $
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium text-[var(--c3-style-basic-fg-secondary)]">
                    FY{data.baselineFy} spend
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium text-[var(--c3-style-basic-fg-secondary)]">
                    tCO₂e
                  </th>
                  <th scope="col" className="py-2 text-right font-medium text-[var(--c3-style-basic-fg-secondary)]">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {derived.rows.map((r) => (
                  <tr
                    key={r.categoryId}
                    className="border-b border-[var(--c3-style-basic-border-border)] last:border-b-0 hover:bg-white/[0.025]"
                  >
                    <td className="py-2 pr-3 font-medium text-[var(--c3-style-basic-fg-primary)]">
                      {r.name}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                      {r.naicsCode}
                    </td>
                    <td className="max-w-[320px] truncate py-2 pr-3 text-[var(--c3-style-basic-fg-secondary)]" title={r.naicsTitle}>
                      {r.naicsTitle}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                      {r.kgPerDollar.toFixed(3)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--c3-style-basic-fg-secondary)]">
                      {usd(r.spend)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                      {tonnes(r.tonnes, false)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--c3-style-basic-fg-secondary)]">
                      {pct(r.carbonShare, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--c3-style-basic-border-border)]">
                  <td className="py-2 pr-3 font-semibold text-[var(--c3-style-basic-fg-primary)]" colSpan={4}>
                    Total — weighted average {intensity(data.baselineIntensity)}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                    {usd(data.baselineSpend)}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                    {tonnes(data.baselineTonnes, false)}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums text-[var(--c3-style-basic-fg-secondary)]">
                    100%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {derived.highest && derived.lowest ? (
            <p className="px-4 pb-4 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              The spread is the whole reason this tool exists. A dollar spent on{' '}
              <strong className="text-[var(--c3-style-basic-fg-primary)]">
                {derived.highest.name}
              </strong>{' '}
              carries {intensity(derived.highest.kgPerDollar)} — {derived.spread.toFixed(1)}× a
              dollar spent on{' '}
              <strong className="text-[var(--c3-style-basic-fg-primary)]">
                {derived.lowest.name}
              </strong>{' '}
              at {intensity(derived.lowest.kgPerDollar)}. Any budget-based view of emissions is
              wrong by up to that factor.
              {derived.unmapped > 0
                ? ` ${derived.unmapped} category has no mapped factor and contributes zero — it is shown rather than dropped.`
                : ''}
            </p>
          ) : null}
        </Panel>
      </Section>

      {/* ----------------------------- provenance ---------------------------- */}
      <Section
        title="Real, modelled, assumed"
        description="The honest breakdown. We would rather lose points for admitting the ledger is synthetic than win them by implying it is not."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel
            title="Real — loaded verbatim"
            subtitle="Not touched, not adjusted"
            note="If a figure traces back only to these inputs, it is as good as the published source."
          >
            <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  EPA emission factors.
                </strong>{' '}
                All 1,016 NAICS-6 rows of USEEIO v1.3 (2022 USD, with margins) are loaded as{' '}
                <code className="font-mono text-[11px]">EmissionFactor</code> records. The{' '}
                {derived.rows.length} used here are a subset of that table, unmodified.
              </li>
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  Campus geography.
                </strong>{' '}
                {data.buildings.length} buildings with real coordinates, and the{' '}
                {data.departments.length} academic departments that occupy them.
              </li>
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  The accounting method.
                </strong>{' '}
                GHG Protocol Scope 3 Category 1, spend-based approach, as published.
              </li>
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  Reduction milestones.
                </strong>{' '}
                The {data.goals.length} target years and percentages the planner aims at are the
                published commitments, not numbers we chose to make the demo work.
              </li>
            </ul>
          </Panel>

          <Panel
            title="Modelled — shaped to be realistic"
            subtitle="Right in aggregate, invented in detail"
            note="Totals, mixes and seasonality are calibrated to public disclosure. Individual rows are not real purchase orders and must never be quoted as such."
          >
            <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  The transaction ledger.
                </strong>{' '}
                Purchase orders across {data.yearTotals.length} fiscal years, generated to match the
                shape of published UW purchasing data: vendor concentration, category mix,
                department skew, and the 30 June fiscal-year-end spike.
              </li>
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  Vendor attribution.
                </strong>{' '}
                Real vendor names appear in public spend disclosure; which specific line items sit
                against which vendor here is modelled.
              </li>
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  Today&apos;s request queue.
                </strong>{' '}
                The {data.requests.length} pending requests are representative examples
                constructed to exercise each intervention type, not a live feed from Shop@UW.
              </li>
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  Product-level footprints.
                </strong>{' '}
                {data.footprints.length} item-level carbon estimates used for substitution
                comparisons, derived from category factors rather than supplier EPDs.
              </li>
            </ul>
          </Panel>

          <Panel
            title="Assumed — and always labelled"
            subtitle="Judgement calls, visible as such"
            note="Every one of these is a number a real deployment would replace with an institutional one. None of them changes the ranking of where the carbon is."
          >
            <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  Reduction ceilings and abatement costs.
                </strong>{' '}
                The {data.levers.length} levers carry a maximum feasible reduction, a cost per
                tonne and an effort level. These are our estimates. In a real deployment they are
                negotiated with the departments and vendors who would have to deliver them — which
                is precisely why the planner lets you pin a category and watch the ceiling move.
              </li>
              <li
                className="rounded-[4px] border p-2.5"
                style={{ borderColor: 'rgba(210,153,34,0.45)', backgroundColor: 'rgba(210,153,34,0.06)' }}
              >
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  The surplus inventory feed does not exist.
                </strong>{' '}
                The reuse suggestions read {data.inventory.length} unopened surplus items from a C3
                entity we seeded. There is no campus-wide surplus API at UW today. Building one — or
                at minimum a shared stockroom register per building — is a prerequisite for the
                reuse lever, and we would rather name that dependency than demo around it.
              </li>
              <li>
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  Contract coverage.
                </strong>{' '}
                {data.contracts.length} supplier agreements with lower-carbon alternates. Real
                contract terms are procurement-confidential; these are plausible stand-ins.
              </li>
            </ul>
          </Panel>
        </div>

        {/*
          The four weaknesses used to be a section of their own, with a paragraph
          each, plus a companion section on what a production deployment would
          change. Both were cut: a page with six sections gets skimmed, and these
          are claims that only need to be *checkable*, not expanded. Each one is
          now a single sentence — still named, still unhedged, and still the first
          thing a sceptical reader can find.
        */}
        <Panel
          className="mt-3"
          title="Where this method is weak"
          subtitle="Four limitations, named rather than buried"
          note="Scope boundary: this is Category 1 (purchased goods and services) only. Campus combustion and purchased electricity are Scopes 1 and 2 and are not in this application; the other fourteen Scope 3 categories — commuting, travel, waste, capital goods — are out of scope too. Nothing here is a university-wide inventory."
        >
          <ul className="grid gap-2.5 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)] sm:grid-cols-2">
            <li>
              <strong className="text-[var(--c3-style-basic-fg-primary)]">
                Price is not carbon.
              </strong>{' '}
              At a fixed factor, a cheaper item always looks cleaner — so buying the same thing from
              a discount vendor reads as a reduction, and buying a better-built version reads as
              harm. Our own Apple-PCF fit puts the laptop elasticity at β≈0.76, meaning spend-based
              accounting over-counts premium laptops by roughly 74%.
            </li>
            <li>
              <strong className="text-[var(--c3-style-basic-fg-primary)]">
                Suppliers are indistinguishable.
              </strong>{' '}
              One EPA factor per NAICS code means every vendor in a category is assumed equally
              dirty, so a supplier who genuinely decarbonises cannot show up in the measurement —
              only in the lever that models them.
            </li>
            <li>
              <strong className="text-[var(--c3-style-basic-fg-primary)]">
                Nominal dollars drift.
              </strong>{' '}
              Factors are per 2022 USD. Across the {data.yearTotals.length}-year trend, price
              inflation presents as emissions growth unless spend is deflated first — which is why
              the trend is read for mix, not for progress.
            </li>
            <li>
              <strong className="text-[var(--c3-style-basic-fg-primary)]">
                Mapping is coarse.
              </strong>{' '}
              Each vendor resolves to exactly one of {derived.rows.length} categories, so a
              distributor selling gases and plastics on the same invoice is attributed wholly to one
              factor. {derived.unmapped > 0 ? `${derived.unmapped} categories still carry no factor at all.` : 'Every category in use currently carries a factor.'}
            </li>
          </ul>
        </Panel>
      </Section>

      {/* ---------------------------- faq & glossary ------------------------- */}
      {/*
        The FAQ. Defined above as {@link FaqSection} rather than written out here,
        because the loading and error branches of this page render it too — see the
        comment on that component.
      */}
      <FaqSection />

      {/* ------------------------- what the copilot may do ------------------- */}
      {/*
        The agentic layer, audited the same way the factors are. No chat panel is
        embedded in this page: a page whose purpose is to let a reader check our working
        should not answer with generated prose, and Bucky is one click away in the
        floating dock anyway — which is the point. What belongs here is the boundary:
        the complete, finite list of things Bucky can do, pulled from the agent itself
        so the table and the model's real reach cannot diverge.
      */}
      <Section
        title="What Bucky is allowed to do"
        description="Bucky routes questions to the methods below and narrates what they return. It is not a second source of numbers — it has no way to produce one."
      >
        <Panel
          title="Tool manifest"
          subtitle="Fetched live from BadgerCopilot.toolManifest()"
          note="This is the same manifest handed to the model on every request, not a transcription of it — so what the model can reach and what this table shows cannot diverge. The two write methods are declared to the model but never executed by it: a proposed write is returned as an offer and a person approves it."
        >
          <CopilotManifestTable />
        </Panel>
      </Section>
    </PageShell>
  );
}
