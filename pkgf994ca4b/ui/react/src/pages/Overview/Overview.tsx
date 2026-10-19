/*
 * Overview — the measurement page. What did UW's purchasing actually emit?
 *
 * **Deliberately three things and no more:** the headline numbers, the ranking
 * that says where the carbon is, and the one picture that says dollars are a bad
 * proxy for it. Earlier revisions also carried a spend ranking, a multi-year
 * trend, a month-by-month spike chart and a departmental league table — all true,
 * all interesting, and collectively enough to stop a demo audience reading any of
 * it. The trend and the departmental split are reachable from the campus map and
 * the planner; the year-end spike now lives on the Intercept page, where it
 * motivates the "defer" lever instead of being a fact with nowhere to go.
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CircleDollarSign, Gauge } from 'lucide-react';

import PageShell, { Section } from '@/components/badger/PageShell';
import Panel from '@/components/badger/Panel';
import StatTile from '@/components/badger/StatTile';
import RankedBars, { type RankedBarDatum } from '@/components/badger/RankedBars';
import Term from '@/components/badger/Term';
import { SpendCarbonScatter } from '@/components/badger/Charts';
import { ErrorState, LoadingBlock } from '@/components/badger/DataState';
import { useBadgerData } from '@/contexts/BadgerDataProvider';
import { intensity, pct, tonnes, usd, usdCompact } from '@/lib/badger/format';

export default function Overview() {
  const { data, loading, error, reload } = useBadgerData();

  const derived = useMemo(() => {
    if (!data) return null;
    const cats = data.categoryTotals.filter((c) => c.spend > 0);

    const byCarbon: RankedBarDatum[] = cats.map((c) => ({
      id: c.categoryId,
      label: c.name,
      value: c.tonnes,
      display: tonnes(c.tonnes),
      emphasis: c.categoryId === cats[0]?.categoryId,
      tooltip: [
        { label: 'Share of carbon', value: pct(c.carbonShare, 1) },
        { label: 'Share of spend', value: pct(c.spendShare, 1) },
        { label: 'Spend', value: usd(c.spend) },
        { label: 'Factor', value: intensity(c.kgPerDollar) },
        { label: 'NAICS', value: c.naicsTitle },
      ],
    }));

    // The divergence that makes the whole argument: a category that is a far
    // bigger share of carbon than of dollars cannot be managed from a budget
    // report, because the budget report does not show it as big.
    const ranked = [...cats].sort(
      (a, b) => b.carbonShare - b.spendShare - (a.carbonShare - a.spendShare),
    );

    return {
      cats,
      byCarbon,
      mostUnderweight: ranked[0],
      scatter: cats.map((c) => ({
        categoryId: c.categoryId,
        name: c.name,
        spend: c.spend,
        tonnes: c.tonnes,
      })),
    };
  }, [data]);

  if (error) {
    return (
      <PageShell title="Overview">
        <ErrorState message={error} onRetry={reload} />
      </PageShell>
    );
  }

  if (loading || !data || !derived) {
    return (
      <PageShell kicker="Past · Measure" title="Where the carbon actually is">
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <LoadingBlock key={i} height={104} />
          ))}
        </div>
        <div className="mt-4">
          <LoadingBlock height={360} label="Loading spend ledger…" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      kicker={`Past · Measured · FY${data.baselineFy}`}
      title="Where the carbon actually is"
      standfirst={
        <>
          UW–Madison&apos;s purchasing ledger, converted into{' '}
          <Term id="tco2e">tonnes CO₂e</Term> and ranked — because{' '}
          <Term id="carbon-vs-spend-share">dollars are a bad proxy for carbon</Term>.
        </>
      }
      actions={
        <Link
          to="/intercept"
          className="inline-flex items-center gap-1.5 rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--c3-style-basic-fg-primary)] transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]"
        >
          Go to today&apos;s queue
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {/* ---------------------------- 1. headline ---------------------------- */}
      <div className="mb-7 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          hero
          label={`FY${data.baselineFy} purchased goods & services`}
          value={tonnes(data.baselineTonnes, false)}
          unit="tCO₂e"
          caption={`Scope 3, Category 1. Spend-based estimate across ${derived.cats.length} categories.`}
          className="xl:col-span-2"
        />
        <StatTile
          label="Addressable spend"
          value={usdCompact(data.baselineSpend)}
          caption={`${usd(data.baselineSpend)} of purchase orders in scope`}
          icon={<CircleDollarSign className="size-3.5" />}
        />
        <StatTile
          label="Carbon intensity"
          value={data.baselineIntensity.toFixed(3)}
          unit="kg CO₂e / $"
          caption="Weighted average across the whole basket"
          icon={<Gauge className="size-3.5" />}
        />
      </div>

      {/* -------------------- 2. ranking + 3. divergence --------------------- */}
      <Section
        title="Dollars are a bad proxy for carbon"
        description="Same ledger, two views: where the emissions are, and why a spend report would not have found them."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel
            title="Ranked by carbon"
            subtitle="tonnes CO₂e"
            note={
              <>
                Spend × each category&apos;s{' '}
                <Term id="emission-factor">emission factor</Term>. Hover a row for the detail.
              </>
            }
          >
            <RankedBars data={derived.byCarbon} ariaLabel="Categories ranked by emissions" />
          </Panel>

          <Panel
            title="The same divergence, as one picture"
            subtitle="One dot per category — dollars across, carbon up"
            note={
              derived.mostUnderweight ? (
                <>
                  If dollars predicted carbon, every dot would sit on a straight line.{' '}
                  {derived.mostUnderweight.name} is {pct(derived.mostUnderweight.carbonShare, 1)} of
                  the carbon on {pct(derived.mostUnderweight.spendShare, 1)} of the spend — high and
                  to the left, and invisible to a budget review.{' '}
                  <Term id="carbon-vs-spend-share">Why that happens</Term>.
                </>
              ) : (
                'If dollars predicted carbon, every dot would sit on a straight line.'
              )
            }
          >
            <SpendCarbonScatter data={derived.scatter} />
          </Panel>
        </div>
      </Section>

      {/*
        No copilot panel here any more. The panels above answer the questions we
        anticipated; the ones we did not are answered by Bucky, which now floats over
        every page from {@link BuckyDock} instead of occupying a screen's worth of
        this one. Its per-page suggestions for `overview` live in BuckyProvider.
      */}
    </PageShell>
  );
}
